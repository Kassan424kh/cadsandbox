import { describe, expect, it } from 'vitest'
import type { ToolId } from '../../api'
import { PROVIDED_TOOL_IDS, createTools } from '../index'
import { MockContext } from './mockContext'

const CORE_OWNED: ToolId[] = ['select', 'pan', 'orbit', 'zoom-window', 'walk', 'place']

describe('createTools registry', () => {
  it('provides every non-core ToolId with a factory, label and consistent option specs', () => {
    const reg = createTools()
    const ids = Object.keys(reg) as ToolId[]
    expect(ids.sort()).toEqual([...PROVIDED_TOOL_IDS].sort())
    for (const core of CORE_OWNED) expect(reg[core]).toBeUndefined()
    for (const id of PROVIDED_TOOL_IDS) {
      const entry = reg[id]!
      expect(entry.label.length).toBeGreaterThan(0)
      const tool = entry.factory()
      expect(tool.id).toBe(id)
      for (const spec of entry.options ?? []) {
        expect(spec.key.length).toBeGreaterThan(0)
        expect(spec.label.length).toBeGreaterThan(0)
        if (spec.kind === 'select') expect(spec.options!.some((o) => o.value === spec.default)).toBe(true)
        if (spec.kind === 'boolean') expect(typeof spec.default).toBe('boolean')
        if (spec.kind === 'length' || spec.kind === 'number' || spec.kind === 'angle') expect(typeof spec.default).toBe('number')
      }
    }
  })

  it('every tool activates with defaults, sets a hint, survives pointer moves and deactivates cleanly', () => {
    const reg = createTools()
    for (const id of PROVIDED_TOOL_IDS) {
      const ctx = new MockContext()
      const tool = reg[id]!.factory()
      tool.activate(ctx, {})
      expect(ctx.lastHint().length, id).toBeGreaterThan(0)
      tool.onPointerMove?.({ ...ptr(1, 1) })
      tool.onPointerMove?.({ ...ptr(2, 1.5) })
      expect(tool.onCancel?.(), id).toBe(false) // nothing in progress → core exits the tool
      tool.deactivate()
      expect(ctx.preview.count, id).toBe(0)
      expect(ctx.overlay.labels.size, id).toBe(0)
      expect(ctx.lastInput(), id).toBeNull()
    }
  })
})

function ptr(x: number, y: number) {
  return {
    clientX: x * 100,
    clientY: -y * 100,
    ndc: [0, 0] as [number, number],
    button: 0,
    buttons: 0,
    shift: false,
    alt: false,
    mod: false,
    viewport: 0,
    ray: { origin: [x, y, 100] as [number, number, number], direction: [0, 0, -1] as [number, number, number] },
    pointerType: 'mouse' as const,
    native: { preventDefault() {} } as unknown as PointerEvent,
  }
}
