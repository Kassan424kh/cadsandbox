import { describe, expect, it } from 'vitest'
import { ArcTool } from '../draw/arc'
import { CircleTool } from '../draw/circle'
import { HatchTool } from '../draw/hatch'
import { LineTool } from '../draw/line'
import { PenTool } from '../draw/pen'
import { PolylineTool } from '../draw/polyline'
import { RectTool } from '../draw/rect'
import { SplineTool } from '../draw/spline'
import { TextTool } from '../draw/text'
import { MockContext, activate, addWallLoop, click, dblclick, drag, key, move } from './mockContext'

describe('draw.line', () => {
  it('creates one line node per segment as one undo step and supports Backspace + Enter', () => {
    const ctx = new MockContext()
    const tool = activate(new LineTool(), ctx)
    click(tool, 0, 0)
    click(tool, 2, 0)
    click(tool, 2, 2)
    click(tool, 5, 5) // will be undone
    key(tool, 'Backspace')
    expect(ctx.lastInput()).toBeTruthy()
    key(tool, 'Enter')
    const lines = ctx.nodesOfType('line')
    expect(lines).toHaveLength(2)
    expect(lines[0].params.a).toEqual([0, 0])
    expect(lines[0].params.b).toEqual([2, 0])
    expect(lines[1].params.b).toEqual([2, 2])
    expect(lines.every((l) => l.parent === ctx.levelId)).toBe(true)
    expect(ctx.doc.canUndo()).toBe(true)
    ctx.doc.undo()
    expect(ctx.nodesOfType('line')).toHaveLength(0)
    expect(ctx.created()).toHaveLength(2)
  })

  it('accepts typed length along the pointer direction and length<angle', () => {
    const ctx = new MockContext()
    const tool = activate(new LineTool(), ctx)
    click(tool, 0, 0)
    move(tool, 1, 0)
    tool.onInput?.('2000') // doc units mm → 2 m along +X
    tool.onInput?.('1000<90')
    key(tool, 'Enter')
    const lines = ctx.nodesOfType('line')
    expect(lines).toHaveLength(2)
    expect(lines[0].params.b[0]).toBeCloseTo(2)
    expect(lines[1].params.b[0]).toBeCloseTo(2)
    expect(lines[1].params.b[1]).toBeCloseTo(1)
  })

  it('Esc with pending points commits the chain, Esc when idle is not consumed', () => {
    const ctx = new MockContext()
    const tool = activate(new LineTool(), ctx)
    expect(tool.onCancel?.()).toBe(false)
    click(tool, 0, 0)
    click(tool, 1, 0)
    expect(tool.onCancel?.()).toBe(true)
    expect(ctx.nodesOfType('line')).toHaveLength(1)
    expect(ctx.preview.count).toBe(0)
  })
})

describe('draw.polyline', () => {
  it('closes with C and stores tangent arc bulges', () => {
    const ctx = new MockContext()
    const tool = activate(new PolylineTool(), ctx)
    click(tool, 0, 0)
    click(tool, 2, 0)
    key(tool, 'a') // arc mode
    click(tool, 3, 1)
    key(tool, 'a')
    click(tool, 0, 3)
    key(tool, 'c')
    const pl = ctx.nodesOfType('polyline')[0]
    expect(pl.params.closed).toBe(true)
    expect(pl.params.points).toHaveLength(4)
    expect(pl.params.bulges).toHaveLength(4)
    expect(pl.params.bulges![0]).toBe(0)
    expect(pl.params.bulges![1]).toBeCloseTo(Math.tan(Math.PI / 8))
    expect(pl.params.bulges![3]).toBe(0)
  })

  it('double click finishes an open polyline', () => {
    const ctx = new MockContext()
    const tool = activate(new PolylineTool(), ctx)
    click(tool, 0, 0)
    click(tool, 1, 0)
    click(tool, 1, 1)
    dblclick(tool, 1, 1)
    const pl = ctx.nodesOfType('polyline')[0]
    expect(pl.params.closed).toBe(false)
    expect(pl.params.points).toHaveLength(3)
    expect(pl.params.bulges).toBeUndefined()
  })
})

describe('draw.rect / circle / arc', () => {
  it('2-point rect is centered with width/height; typed w;h works', () => {
    const ctx = new MockContext()
    const tool = activate(new RectTool(), ctx, { cornerRadius: 0.05 })
    click(tool, 1, 1)
    click(tool, 4, 3)
    const r = ctx.nodesOfType('rect')[0]
    expect(r.t.p[0]).toBeCloseTo(2.5)
    expect(r.t.p[1]).toBeCloseTo(2)
    expect(r.params.width).toBeCloseTo(3)
    expect(r.params.height).toBeCloseTo(2)
    expect(r.params.cornerRadius).toBeCloseTo(0.05)
    click(tool, 0, 0)
    move(tool, 1, 1)
    tool.onInput?.('1000;500')
    const r2 = ctx.nodesOfType('rect')[1]
    expect(r2.params.width).toBeCloseTo(1)
    expect(r2.params.height).toBeCloseTo(0.5)
  })

  it('3-point rect is rotated', () => {
    const ctx = new MockContext()
    const tool = activate(new RectTool(), ctx, { mode: '3-point' })
    click(tool, 0, 0)
    click(tool, 2, 2)
    click(tool, 1, 3)
    const r = ctx.nodesOfType('rect')[0]
    expect(r.params.width).toBeCloseTo(Math.SQRT2 * 2)
    expect(r.params.height).toBeCloseTo(Math.SQRT2)
    expect(Math.abs(r.t.r[2])).toBeCloseTo(Math.sin(Math.PI / 8))
  })

  it('circle by center + typed radius, 3-point circle', () => {
    const ctx = new MockContext()
    const tool = activate(new CircleTool(), ctx)
    click(tool, 1, 1)
    move(tool, 3, 1)
    tool.onInput?.('750')
    const c = ctx.nodesOfType('circle')[0]
    expect(c.t.p[0]).toBeCloseTo(1)
    expect(c.params.radius).toBeCloseTo(0.75)
    tool.onOptions?.({ mode: '3-point' })
    click(tool, 1, 0)
    click(tool, 0, 1)
    click(tool, -1, 0)
    const c2 = ctx.nodesOfType('circle')[1]
    expect(c2.t.p[0]).toBeCloseTo(0)
    expect(c2.params.radius).toBeCloseTo(1)
  })

  it('3-point arc is stored CCW at its center', () => {
    const ctx = new MockContext()
    const tool = activate(new ArcTool(), ctx)
    click(tool, -1, 0)
    click(tool, 0, 1)
    click(tool, 1, 0)
    const a = ctx.nodesOfType('arc')[0]
    expect(a.t.p[0]).toBeCloseTo(0)
    expect(a.params.radius).toBeCloseTo(1)
    expect(a.params.start).toBeCloseTo(0)
    expect(a.params.end).toBeCloseTo(Math.PI)
  })
})

describe('draw.spline / pen', () => {
  it('spline creates a smooth path through the points', () => {
    const ctx = new MockContext()
    const tool = activate(new SplineTool(), ctx)
    click(tool, 0, 0)
    click(tool, 1, 1)
    click(tool, 2, 0)
    key(tool, 'Enter')
    const s = ctx.nodesOfType('spline')[0]
    const c = s.params.path.contours[0]
    expect(c.points).toHaveLength(3)
    expect(c.points[1].hi).toBeDefined()
    expect(c.points[1].ho).toBeDefined()
    expect(c.closed).toBe(false)
  })

  it('pen: click corners, drag a handle, close on the first point → extruded shape', () => {
    const ctx = new MockContext()
    const tool = activate(new PenTool(), ctx, { depth: 0.3 })
    click(tool, 0, 0)
    click(tool, 2, 0)
    drag(tool, [2, 2], [3, 2]) // smooth anchor with handles
    click(tool, 0, 2)
    click(tool, 0.02, 0.02) // near the first anchor → close
    const shapes = ctx.nodesOfType('shape')
    expect(shapes).toHaveLength(1)
    const sh = shapes[0]
    expect(sh.params.profile).toBe('path')
    expect(sh.params.depth).toBeCloseTo(0.3)
    expect(sh.params.path!.contours[0].closed).toBe(true)
    expect(sh.params.path!.contours[0].points).toHaveLength(4)
    expect(sh.params.path!.contours[0].points[2].ho).toBeDefined()
    expect(sh.t.p[0]).toBeGreaterThan(0.9)
    expect(sh.params.width).toBeGreaterThan(1.9)
  })

  it('pen: Enter finishes an open path as a spline', () => {
    const ctx = new MockContext()
    const tool = activate(new PenTool(), ctx)
    click(tool, 0, 0)
    click(tool, 1, 0)
    key(tool, 'Enter')
    expect(ctx.nodesOfType('spline')).toHaveLength(1)
    expect(ctx.nodesOfType('shape')).toHaveLength(0)
  })
})

describe('draw.hatch / text', () => {
  it('hatch fills the region enclosed by lines and walls (islands become holes)', () => {
    const ctx = new MockContext()
    addWallLoop(ctx, 0, 0, 6, 4)
    ctx.doc.addNode({ type: 'rect', parent: ctx.levelId, t: { p: [3, 2, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }, params: { width: 1, height: 1 } })
    const tool = activate(new HatchTool(), ctx, { pattern: 'concrete' })
    move(tool, 1, 1)
    expect(ctx.preview.polygons.size).toBe(1)
    click(tool, 1, 1)
    const h = ctx.nodesOfType('hatch')[0]
    expect(h).toBeTruthy()
    expect(h.params.pattern).toBe('concrete')
    expect(h.layer).toBe('layer-hatch')
    expect(h.params.holes).toHaveLength(1)
    // inner wall faces: 6−0.24 by 4−0.24
    const xs = h.params.boundary.map((p) => p[0])
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(5.76)
  })

  it('text creates a node from the prompt', async () => {
    const ctx = new MockContext()
    ctx.overlay.promptResponses.push('Kitchen')
    const tool = activate(new TextTool(), ctx, { size: 0.2 })
    click(tool, 1, 2)
    await Promise.resolve()
    const t = ctx.nodesOfType('text')[0]
    expect(t.params.text).toBe('Kitchen')
    expect(t.params.size).toBeCloseTo(0.2)
    expect(t.t.p[0]).toBeCloseTo(1)
    expect(t.layer).toBe('layer-anno')
  })
})
