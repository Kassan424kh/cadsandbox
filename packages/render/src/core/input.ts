// InputManager — pointer / wheel / keyboard handling on the viewport overlays. Builds
// ToolPointerEvents, dispatches to gizmo layers and the active tool, keeps camera-controls from
// reacting to consumed events, implements trackpad gestures, Space-to-pan, view cube interaction,
// context menu / double-click events and VCB typing.
import * as THREE from 'three'
import type { ToolPointerEvent } from '../tools/types'
import type { Viewport } from '../renderer/viewport'
import type { ViewportManager } from '../renderer/viewportManager'
import type { ToolHost } from './toolHost'
import type { Core } from './types'
import { IS_MAC } from './types'
import { anglesForDirection, VIEWCUBE_SIZE } from '../renderer/viewcube'
import type { Pipeline } from '../renderer/pipeline'
import type { Picker } from './picker'

const DRAG_PX = 4

export interface InputHooks {
  /** Escape when the tool did not consume it. */
  onEscape(): void
  onEnter(): void
  onDelete(): void
  onPickForContextMenu(vp: Viewport, ndc: THREE.Vector2): string | null
  /** Called after any pointer move (hover/cursor tracking). */
  onPointerMoved(e: ToolPointerEvent): void
  onViewCube(vp: Viewport, azimuth: number, polar: number, preset: string | null): void
  isWalking(): boolean
}

export class InputManager {
  private core: Core
  private viewports: ViewportManager
  private host: ToolHost
  private pipeline: Pipeline
  private picker: Picker
  private hooks: InputHooks
  private attached = new WeakSet<HTMLElement>()
  private raycaster = new THREE.Raycaster()
  private down: { x: number; y: number; button: number; vp: Viewport; consumed: boolean; pointerId: number; time: number } | null = null
  private spaceHeld = false
  private vcb = ''
  private cubeHover: Viewport | null = null
  /** Viewports whose camera-controls are paused for the current gesture (see gate()). */
  private gated = new Set<Viewport>()
  private disposers: (() => void)[] = []
  /** Active pointer position (client) for tools that need it without an event. */
  lastClient = { x: 0, y: 0 }

  constructor(core: Core, viewports: ViewportManager, host: ToolHost, pipeline: Pipeline, picker: Picker, hooks: InputHooks) {
    this.core = core
    this.viewports = viewports
    this.host = host
    this.pipeline = pipeline
    this.picker = picker
    this.hooks = hooks
    const container = core.ctx.container
    if (!container.hasAttribute('tabindex')) container.tabIndex = 0
    container.style.outline = 'none'
    const onKeyDown = (ev: KeyboardEvent) => this.onKeyDown(ev)
    const onKeyUp = (ev: KeyboardEvent) => this.onKeyUp(ev)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    const onBlur = () => {
      this.spaceHeld = false
      this.applyNavigation()
    }
    window.addEventListener('blur', onBlur)
    // A release outside the canvas never reaches the viewport element (camera-controls tracks drags on
    // the document): clear the stale gesture here so camera-controls is never left paused.
    const onWindowUp = (ev: PointerEvent) => {
      if (this.down && ev.pointerId === this.down.pointerId) this.down = null
      if (!this.down && this.gated.size) setTimeout(() => this.ungate(), 0)
    }
    window.addEventListener('pointerup', onWindowUp)
    window.addEventListener('pointercancel', onWindowUp)
    this.disposers.push(
      () => window.removeEventListener('keydown', onKeyDown),
      () => window.removeEventListener('keyup', onKeyUp),
      () => window.removeEventListener('blur', onBlur),
      () => window.removeEventListener('pointerup', onWindowUp),
      () => window.removeEventListener('pointercancel', onWindowUp),
      // A typed value belongs to the tool step it was typed for: drop it when the tool changes or ends
      // its input step, so digits never leak into the next tool.
      core.store.subscribe((s, prev) => {
        if (this.vcb && (s.tool !== prev.tool || !s.toolInput)) this.vcb = ''
      }),
    )
    this.attachAll()
  }

  /** Attach listeners to every viewport element (idempotent; call after layout changes). */
  attachAll(): void {
    for (const vp of this.viewports.viewports) this.attach(vp)
    this.applyNavigation()
  }

  private attach(vp: Viewport): void {
    if (this.attached.has(vp.el)) return
    this.attached.add(vp.el)
    const el = vp.el
    // camera-controls gestures (orbit/pan/zoom, animated transitions) must wake the on-demand loop
    vp.onControl = () => this.core.notifyMotion(60)
    el.addEventListener('pointerdown', (ev) => this.onPointerDown(ev, vp))
    el.addEventListener('pointermove', (ev) => this.onPointerMove(ev, vp))
    el.addEventListener('pointerup', (ev) => this.onPointerUp(ev, vp))
    el.addEventListener('pointercancel', (ev) => this.onPointerUp(ev, vp))
    el.addEventListener('pointerleave', () => this.onPointerLeave(vp))
    el.addEventListener('dblclick', (ev) => this.onDoubleClick(ev, vp))
    el.addEventListener('contextmenu', (ev) => ev.preventDefault())
    el.addEventListener('wheel', (ev) => this.onWheel(ev, vp), { passive: false })
    // camera-controls listeners are registered after ours; gate() pauses them for gestures we consume
    vp.connect()
  }

  /** Mouse-button mapping for the active tool / Space state. */
  applyNavigation(): void {
    const id = this.host.currentId
    const nav = this.viewOnly() ? 'orbit' : id === 'pan' ? 'pan' : id === 'orbit' ? 'orbit' : 'select'
    for (const vp of this.viewports.viewports) vp.setNavigationButtons(nav, this.spaceHeld)
  }

  private modKey(ev: MouseEvent | KeyboardEvent): boolean {
    return IS_MAC ? ev.metaKey : ev.ctrlKey
  }

  buildEvent(native: PointerEvent | MouseEvent, vp: Viewport): ToolPointerEvent {
    const rect = this.core.ctx.container.getBoundingClientRect()
    const ndc = vp.ndc(native.clientX, native.clientY, rect, _ndc)
    this.raycaster.setFromCamera(ndc, vp.camera)
    const o = this.raycaster.ray.origin
    const d = this.raycaster.ray.direction
    const pe = native as PointerEvent
    return {
      clientX: native.clientX,
      clientY: native.clientY,
      ndc: [ndc.x, ndc.y],
      button: native.button,
      buttons: native.buttons,
      shift: native.shiftKey,
      alt: native.altKey,
      mod: this.modKey(native),
      viewport: vp.index,
      ray: { origin: [o.x, o.y, o.z], direction: [d.x, d.y, d.z] },
      pointerType: (pe.pointerType as 'mouse' | 'pen' | 'touch') || 'mouse',
      native,
    }
  }

  private cubeLocal(ev: MouseEvent, vp: Viewport): { x: number; y: number } | null {
    const rect = this.core.ctx.container.getBoundingClientRect()
    const cube = this.core.ctx.viewCubeOffset
    const x = ev.clientX - rect.left - vp.rect.x - cube.left
    const y = ev.clientY - rect.top - vp.rect.y - cube.top
    if (x < 0 || y < 0 || x > VIEWCUBE_SIZE || y > VIEWCUBE_SIZE) return null
    return { x, y }
  }

  private onPointerDown(ev: PointerEvent, vp: Viewport): void {
    if (ev.isPrimary) {
      // new gesture: drop any stale state so camera-controls can take this gesture (runs before its listener)
      this.down = null
      if (this.gated.size) this.releaseGate()
    }
    this.lastClient = { x: ev.clientX, y: ev.clientY }
    this.core.ctx.container.focus({ preventScroll: true })
    if (vp.index !== this.viewports.active) this.viewports.setActive(vp.index)
    // right-drag: orbit — except in plan views, where it pans unless Shift is held (accidental tilting
    // of a plan is the most common navigation complaint); camera-controls reads the mapping after us
    if (ev.button === 2) vp.setRightButtonAction(vp.isPlanView && !ev.shiftKey ? 'pan' : 'orbit')
    // view cube
    const cube = this.cubeLocal(ev, vp)
    if (cube && ev.button === 0) {
      this.pipeline.viewCube.sync(vp.camera)
      const hit = this.pipeline.viewCube.hitTest(cube.x, cube.y)
      if (hit) {
        const a = anglesForDirection(hit.direction)
        this.hooks.onViewCube(vp, a.azimuth, a.polar, hit.preset)
        this.gate(vp)
        ev.preventDefault()
        return
      }
    }
    if (this.hooks.isWalking()) {
      this.gate(vp)
      return
    }
    // view-only (phones): never start a marquee/selection/tool — camera-controls takes the gesture
    if (this.viewOnly()) return
    const e = this.buildEvent(ev, vp)
    let consumed = false
    if (ev.button === 0 && !this.spaceHeld) consumed = this.host.pointerDown(e)
    else if (ev.button !== 0) consumed = this.host.pointerDown(e) && ev.button !== 2 ? true : false
    this.down = { x: ev.clientX, y: ev.clientY, button: ev.button, vp, consumed, pointerId: ev.pointerId, time: performance.now() }
    if (consumed && ev.button === 0) this.resetInput() // a click commits the step: an unsent typed value is stale
    if (consumed) {
      this.gate(vp)
      try {
        vp.el.setPointerCapture(ev.pointerId)
      } catch {
        /* ignore */
      }
    }
  }

  private onPointerMove(ev: PointerEvent, vp: Viewport): void {
    this.lastClient = { x: ev.clientX, y: ev.clientY }
    const cube = this.cubeLocal(ev, vp)
    if (cube && !this.down) {
      this.pipeline.viewCube.sync(vp.camera)
      const hit = this.pipeline.viewCube.hitTest(cube.x, cube.y)
      this.pipeline.viewCube.setHover(hit)
      vp.el.style.cursor = hit ? 'pointer' : ''
      this.cubeHover = hit ? vp : null
      this.core.requestRender()
      if (hit) return
    } else if (this.cubeHover) {
      this.pipeline.viewCube.setHover(null)
      this.cubeHover = null
      vp.el.style.cursor = ''
      this.core.requestRender()
    }
    if (this.hooks.isWalking() || this.viewOnly()) return
    const e = this.buildEvent(ev, vp)
    if (this.down && this.down.consumed) {
      this.host.pointerMove(e)
      this.core.notifyMotion(60)
    } else if (!this.down || this.down.button === 0) this.host.pointerMove(e)
    this.hooks.onPointerMoved(e)
  }

  private onPointerUp(ev: PointerEvent, vp: Viewport): void {
    const down = this.down
    this.down = null
    if (this.viewOnly()) {
      if (this.gated.size) setTimeout(() => this.ungate(), 0)
      this.core.requestRender()
      return
    }
    if (this.hooks.isWalking()) {
      if (this.gated.size) setTimeout(() => this.ungate(), 0)
      return
    }
    const e = this.buildEvent(ev, vp)
    let consumed = false
    if (down?.consumed) {
      consumed = this.host.pointerUp(e) || true
      try {
        vp.el.releasePointerCapture(down.pointerId)
      } catch {
        /* ignore */
      }
    } else if (down && down.button === 0 && !this.spaceHeld) consumed = this.host.pointerUp(e)
    if (consumed && down?.button === 0) this.resetInput()
    // right click without drag → context menu
    if (down && down.button === 2 && Math.abs(ev.clientX - down.x) <= DRAG_PX && Math.abs(ev.clientY - down.y) <= DRAG_PX) {
      const nodeId = this.hooks.onPickForContextMenu(vp, _ndc.set(e.ndc[0], e.ndc[1]))
      this.core.emit('contextmenu', { clientX: ev.clientX, clientY: ev.clientY, nodeId })
    }
    void consumed
    // re-enable camera-controls only after every listener of this event (incl. theirs) has run
    if (this.gated.size) setTimeout(() => this.ungate(), 0)
    this.core.requestRender()
  }

  /** Pause camera-controls for the current gesture WITHOUT stopping propagation: document-level
   *  listeners (UI popovers/tooltips closing on outside interaction) must still see the event. */
  private gate(vp: Viewport): void {
    if (this.gated.has(vp)) return
    this.gated.add(vp)
    vp.controls.enabled = false
    vp.el.style.touchAction = 'none'
  }

  private ungate(): void {
    if (this.down?.consumed) return // a consumed gesture is in progress; it releases the gate itself
    this.releaseGate()
  }

  private releaseGate(): void {
    for (const vp of this.gated) {
      vp.controls.enabled = true
      vp.el.style.touchAction = 'none'
    }
    this.gated.clear()
  }

  private onPointerLeave(vp: Viewport): void {
    if (this.cubeHover === vp) {
      this.pipeline.viewCube.setHover(null)
      this.cubeHover = null
      vp.el.style.cursor = ''
      this.core.requestRender()
    }
  }

  private onDoubleClick(ev: MouseEvent, vp: Viewport): void {
    if (ev.button !== 0 || this.cubeLocal(ev, vp) || this.viewOnly()) return
    const e = this.buildEvent(ev, vp)
    if (this.host.doubleClick(e)) {
      this.resetInput()
      return
    }
    const nodeId = this.hooks.onPickForContextMenu(vp, _ndc.set(e.ndc[0], e.ndc[1]))
    this.core.emit('dblclick', { nodeId })
  }

  /**
   * Wheel always zooms to the cursor (camera-controls dolly/zoom; pinch arrives as ctrl+wheel). With
   * the "trackpad gestures" preference on, two-finger scroll pans (ortho) / orbits (perspective) and
   * only pinch + real mouse wheels zoom. Mouse-vs-trackpad detection is heuristic (Chrome on macOS
   * emits small, irregular deltas for accelerated mouse wheels), so it is opt-in.
   */
  private onWheel(ev: WheelEvent, vp: Viewport): void {
    if (this.hooks.isWalking()) {
      ev.preventDefault()
      ev.stopImmediatePropagation()
      return
    }
    // camera-controls turns every wheel event into a dolly step of 0.95^(delta·dollySpeed); macOS mouse
    // acceleration produces huge deltaY bursts (100–600 per event) → multi-× zoom per notch. Cap the step
    // PER EVENT by setting dollySpeed just before camera-controls handles this same event.
    this.limitWheelStep(ev, vp)
    if (!this.core.store.getState().navigation.trackpadGestures) {
      this.core.notifyMotion()
      return
    }
    const legacy = (ev as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY
    const isMouseWheel = ev.deltaMode !== 0 || (legacy !== undefined ? Math.abs(legacy) >= 120 && legacy % 120 === 0 && ev.deltaX === 0 : Math.abs(ev.deltaY) >= 50 && ev.deltaX === 0)
    if (ev.ctrlKey || isMouseWheel) {
      // pinch / wheel → camera-controls dolly or zoom to cursor
      this.core.notifyMotion()
      return
    }
    ev.preventDefault()
    ev.stopImmediatePropagation()
    const c = vp.controls
    if (vp.isOrtho) {
      const wpp = vp.worldPerPixel(vp.controls.getTarget(_t, true))
      void c.truck(ev.deltaX * wpp, ev.deltaY * wpp, false)
    } else {
      void c.rotate(-ev.deltaX * 0.0035, -ev.deltaY * 0.0035, false)
      if (vp.preset !== 'perspective' && vp.preset !== 'custom') vp.preset = 'custom'
    }
    this.core.notifyMotion()
  }

  private viewOnly(): boolean {
    return this.core.store.getState().navigation.viewOnly
  }

  /** Bound the zoom per wheel event to ~6 % (pinch ~10 %) whatever the device's delta scaling. */
  private limitWheelStep(ev: WheelEvent, vp: Viewport): void {
    // mirrors camera-controls' own normalisation (osgjs-style factors)
    const factor = MAC_LIKE ? -1 : -3
    const delta = ev.deltaMode === 1 || ev.ctrlKey ? ev.deltaY / factor : ev.deltaY / (factor * 10)
    const k = Math.abs(delta)
    if (k < 1e-6) return
    const maxExponent = ev.ctrlKey ? 2 : 1.2 // 0.95^1.2 ≈ 6 % per wheel event
    vp.controls.dollySpeed = Math.min(0.9, maxExponent / k)
  }

  private isTypingTarget(ev: KeyboardEvent): boolean {
    const t = ev.target as HTMLElement | null
    if (!t) return false
    const tag = t.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable
  }

  private onKeyDown(ev: KeyboardEvent): void {
    if (this.isTypingTarget(ev)) return
    const state = this.core.store.getState()
    const printable = ev.key.length === 1 && !ev.metaKey && !ev.ctrlKey && !ev.altKey
    // While a typed value is in progress every printable key belongs to it — ahead of Space-to-pan
    // ("8' 6\""), the tool's own letter keys (C closes a line, but "2.4cm" is a length) and the app's
    // tool/command shortcuts (M, R, …), which skip prevented events: typing a value never switches
    // tools. The tool validates the text on Enter.
    if (this.vcb && state.toolInput && printable) {
      this.vcb += ev.key
      this.core.store.setState({ toolInput: { ...state.toolInput, value: this.vcb } })
      ev.preventDefault()
      return
    }
    if (ev.code === 'Space' && !ev.repeat) {
      this.spaceHeld = true
      this.applyNavigation()
      if (!this.host.isDragging) ev.preventDefault()
      return
    }
    // A pending VCB entry takes precedence over the tool's own Enter/Backspace handling.
    if (this.vcb && (ev.key === 'Enter' || ev.key === 'Backspace' || ev.key === 'Escape')) {
      if (ev.key === 'Enter') {
        const text = this.vcb
        this.vcb = ''
        this.host.input(text)
        if (state.toolInput) this.core.store.setState({ toolInput: { ...state.toolInput, value: '' } })
      } else if (ev.key === 'Backspace') {
        this.vcb = this.vcb.slice(0, -1)
        if (state.toolInput) this.core.store.setState({ toolInput: { ...state.toolInput, value: this.vcb } })
      } else {
        this.vcb = ''
        if (state.toolInput) this.core.store.setState({ toolInput: { ...state.toolInput, value: '' } })
      }
      ev.preventDefault()
      return
    }
    if (this.host.keyDown(ev)) {
      ev.preventDefault()
      return
    }
    switch (ev.key) {
      case 'Escape':
        this.hooks.onEscape()
        ev.preventDefault()
        return
      case 'Enter':
        this.hooks.onEnter()
        ev.preventDefault()
        return
      case 'Delete':
      case 'Backspace':
        if (!ev.metaKey && !ev.ctrlKey) this.hooks.onDelete()
        ev.preventDefault()
        return
    }
    // SketchUp-style numeric input: a digit (or - . = ,) starts a typed value (VCB) for the active tool;
    // the following keys are appended above.
    if (state.toolInput && printable && /[0-9\-.=,]/.test(ev.key)) {
      this.vcb = ev.key
      this.core.store.setState({ toolInput: { ...state.toolInput, value: this.vcb } })
      ev.preventDefault()
    }
  }

  private onKeyUp(ev: KeyboardEvent): void {
    if (ev.code === 'Space') {
      this.spaceHeld = false
      this.applyNavigation()
    }
  }

  /** External VCB submit (Editor.submitToolInput). */
  submitInput(text: string): void {
    this.vcb = ''
    this.host.input(text)
  }

  /** Drop a typed value that was not submitted (tool cancel / commit; tool changes reset it too). */
  resetInput(): void {
    if (!this.vcb) return
    const typed = this.vcb
    this.vcb = ''
    // clear the shown text unless the tool already replaced it (e.g. with its next step's live value)
    const input = this.core.store.getState().toolInput
    if (input?.value === typed) this.core.store.setState({ toolInput: { ...input, value: '' } })
  }

  get isSpaceHeld(): boolean {
    return this.spaceHeld
  }

  dispose(): void {
    for (const d of this.disposers) d()
    this.disposers = []
  }
}

const MAC_LIKE = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)
const _ndc = new THREE.Vector2()
const _t = new THREE.Vector3()
