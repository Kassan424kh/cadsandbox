// Typed values (VCB) in InputManager: they belong to the tool step they were typed for and typing them
// never reaches tool keys or the app's tool shortcuts.
import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditorState } from '../src/api'
import { InputManager } from '../src/core/input'
import type { ToolHost } from '../src/core/toolHost'
import type { Core } from '../src/core/types'
import type { Picker } from '../src/core/picker'
import type { Pipeline } from '../src/renderer/pipeline'
import type { Viewport } from '../src/renderer/viewport'
import type { ViewportManager } from '../src/renderer/viewportManager'
import { createEditorStore } from '../src/store'

type Listener = (ev: unknown) => void

interface FakeKey {
  key: string
  code: string
  repeat: boolean
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  target: null
  defaultPrevented: boolean
  preventDefault(): void
}

function keyEvent(key: string): FakeKey {
  return {
    key,
    code: key === ' ' ? 'Space' : key.length === 1 ? `Key${key.toUpperCase()}` : key,
    repeat: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    target: null,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true
    },
  }
}

function element() {
  const listeners = new Map<string, Listener>()
  return {
    listeners,
    style: {} as Record<string, string>,
    tabIndex: 0,
    hasAttribute: () => true,
    focus: () => undefined,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    addEventListener: (type: string, cb: Listener) => void listeners.set(type, cb),
    removeEventListener: () => undefined,
    setPointerCapture: () => undefined,
    releasePointerCapture: () => undefined,
  }
}

describe('InputManager typed values (VCB)', () => {
  const windowListeners = new Map<string, Listener>()
  let store: ReturnType<typeof createEditorStore>
  let input: InputManager
  let host: { currentId: string; isDragging: boolean; keyDown: ReturnType<typeof vi.fn>; input: ReturnType<typeof vi.fn>; pointerDown: ReturnType<typeof vi.fn>; pointerUp: ReturnType<typeof vi.fn>; pointerMove: ReturnType<typeof vi.fn>; doubleClick: ReturnType<typeof vi.fn> }
  let vpEl: ReturnType<typeof element>

  const type = (...keys: string[]) => keys.map((k) => {
    const ev = keyEvent(k)
    windowListeners.get('keydown')!(ev)
    return ev
  })
  const value = () => store.getState().toolInput?.value
  /** What ToolHost.setTool does, followed by the new tool offering its first input step. */
  const switchTool = (tool: EditorState['tool'], label: string) => {
    store.setState({ tool, toolInput: null })
    store.setState({ toolInput: { label, value: '' } })
  }
  const click = () => {
    const ev = { isPrimary: true, button: 0, buttons: 1, clientX: 400, clientY: 300, pointerId: 1, shiftKey: false, altKey: false, metaKey: false, ctrlKey: false, pointerType: 'mouse' }
    vpEl.listeners.get('pointerdown')!(ev)
    vpEl.listeners.get('pointerup')!({ ...ev, buttons: 0 })
  }

  beforeEach(() => {
    vi.stubGlobal('window', {
      addEventListener: (t: string, cb: Listener) => void windowListeners.set(t, cb),
      removeEventListener: () => undefined,
    })
    store = createEditorStore('light', false, 'test', 'high')
    store.setState({ tool: 'draw.line', toolInput: { label: 'Length', value: '' } })
    const container = element()
    const core = {
      store,
      ctx: { container, viewCubeOffset: { left: 10_000, top: 10_000 } },
      requestRender: () => undefined,
      notifyMotion: () => undefined,
      emit: () => undefined,
    } as unknown as Core
    vpEl = element()
    const viewport = {
      el: vpEl,
      index: 0,
      rect: { x: 0, y: 0, width: 800, height: 600 },
      camera: new THREE.PerspectiveCamera(),
      controls: { enabled: true },
      isPlanView: false,
      onControl: null,
      connect: () => undefined,
      setNavigationButtons: () => undefined,
      setRightButtonAction: () => undefined,
      ndc: (_x: number, _y: number, _r: unknown, out: THREE.Vector2) => out.set(0, 0),
    } as unknown as Viewport
    const viewports = { viewports: [viewport], active: 0, setActive: () => undefined } as unknown as ViewportManager
    host = {
      currentId: 'draw.line',
      isDragging: false,
      keyDown: vi.fn((ev: FakeKey) => ev.key === 'c' || ev.key === 'C'), // e.g. C closes a line
      input: vi.fn(),
      pointerDown: vi.fn(() => true), // the tool places a point
      pointerUp: vi.fn(() => true),
      pointerMove: vi.fn(),
      doubleClick: vi.fn(() => false),
    }
    const hooks = {
      onEscape: vi.fn(),
      onEnter: vi.fn(),
      onDelete: vi.fn(),
      onPickForContextMenu: () => null,
      onPointerMoved: () => undefined,
      onViewCube: () => undefined,
      isWalking: () => false,
    }
    input = new InputManager(core, viewports, host as unknown as ToolHost, {} as Pipeline, {} as Picker, hooks)
  })

  afterEach(() => {
    input.dispose()
    windowListeners.clear()
    vi.unstubAllGlobals()
  })

  it('never leaks typed digits into the next tool', () => {
    type('1', '2')
    expect(value()).toBe('12')
    switchTool('draw.rect', 'Width;Depth')
    type('3')
    expect(value()).toBe('3')
    type('Enter')
    expect(host.input).toHaveBeenLastCalledWith('3')
  })

  it('drops an unsent typed value on cancel, on commit and when the tool ends its input step', () => {
    type('4', '2')
    input.resetInput() // Editor.cancel() / tool.confirm
    expect(value()).toBe('')
    type('7')
    expect(value()).toBe('7')

    click() // the click commits the step with the pointer position
    expect(value()).toBe('')
    type('8')
    expect(value()).toBe('8')

    store.setState({ toolInput: null }) // e.g. the tool finished
    store.setState({ toolInput: { label: 'Length', value: '' } })
    type('9', 'Enter')
    expect(host.input).toHaveBeenLastCalledWith('9')
  })

  it('keeps every key of a value away from tool keys and tool shortcuts', () => {
    const events = type('2', '.', '4', 'c', 'm')
    expect(value()).toBe('2.4cm')
    expect(events.every((e) => e.defaultPrevented)).toBe(true) // the app's tool shortcuts skip prevented keys
    expect(host.keyDown.mock.calls.map(([e]) => (e as FakeKey).key)).toEqual(['2']) // not C: it would close the line

    type('Escape')
    expect(value()).toBe('')
    const imperial = type('8', "'", ' ', '6', '"')
    expect(value()).toBe(`8' 6"`) // Space is part of the value, not Space-to-pan
    expect(input.isSpaceHeld).toBe(false)
    expect(imperial.every((e) => e.defaultPrevented)).toBe(true)

    type('Escape', '0', '.', '5', 'r', 'a', 'd') // R / A / D are tool shortcuts
    expect(value()).toBe('0.5rad')

    // Without a value in progress, letters stay tool keys / shortcuts.
    type('Escape')
    const [letter] = type('m')
    expect(letter.defaultPrevented).toBe(false)
  })
})
