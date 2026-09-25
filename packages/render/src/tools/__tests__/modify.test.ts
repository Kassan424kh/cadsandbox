import { describe, expect, it } from 'vitest'
import type { Vec2 } from '@cadsandbox/doc'
import { CommentTool } from '../annotate/comment'
import { DimensionTool } from '../annotate/dimension'
import { LeaderTool } from '../annotate/leader'
import { AngleTool, AreaTool, DistanceTool } from '../measure/measure'
import { ArrayTool } from '../modify/array'
import { FilletTool } from '../modify/fillet'
import { MirrorTool } from '../modify/mirror'
import { OffsetTool } from '../modify/offset'
import { PushPullTool } from '../modify/pushpull'
import { ExtendTool, TrimTool } from '../modify/trim'
import { SectionTool } from '../section/section'
import { MockContext, activate, addWallLoop, click, drag, key, move } from './mockContext'

const line = (ctx: MockContext, a: Vec2, b: Vec2) => ctx.doc.addNode({ type: 'line', parent: ctx.levelId, params: { a, b } })

describe('measure', () => {
  it('distance publishes value + deltas to the editor store', () => {
    const ctx = new MockContext()
    const tool = activate(new DistanceTool(), ctx)
    click(tool, 0, 0)
    move(tool, 3, 4)
    expect(ctx.lastInput()?.label).toBe('Length')
    click(tool, 3, 4)
    const m = ctx.editor.getState().measure!
    expect(m.kind).toBe('distance')
    expect(m.value).toBeCloseTo(5)
    expect(m.delta).toEqual([3, 4, 0])
    expect(ctx.overlay.texts().some((t) => t.includes('ΔX'))).toBe(true)
    expect(ctx.nodesOfType('line')).toHaveLength(0)
  })
  it('area and angle', () => {
    const ctx = new MockContext()
    const area = activate(new AreaTool(), ctx)
    click(area, 0, 0)
    click(area, 4, 0)
    click(area, 4, 3)
    click(area, 0, 3)
    key(area, 'Enter')
    expect(ctx.editor.getState().measure?.value).toBeCloseTo(12)
    const ang = activate(new AngleTool(), ctx)
    click(ang, 0, 0)
    click(ang, 1, 0)
    click(ang, 0, 1)
    expect(ctx.editor.getState().measure?.value).toBeCloseTo(Math.PI / 2)
  })
})

describe('annotate', () => {
  it('aligned dimension: 2 points + offset click', () => {
    const ctx = new MockContext()
    const tool = activate(new DimensionTool(), ctx)
    click(tool, 0, 0)
    click(tool, 4, 0)
    move(tool, 2, 1)
    expect(ctx.preview.drawings.size).toBe(1)
    click(tool, 2, 1)
    const d = ctx.nodesOfType('dimension')[0]
    expect(d.params.kind).toBe('aligned')
    expect(d.params.points[1][0]).toBeCloseTo(4)
    expect(d.params.offset).toBeCloseTo(1)
    expect(d.layer).toBe('layer-dims')
  })
  it('clicking a wall face auto-dimensions it (associative refs)', () => {
    const ctx = new MockContext()
    addWallLoop(ctx, 0, 0, 6, 4)
    const tool = activate(new DimensionTool(), ctx, { kind: 'linear' })
    click(tool, 3, 0.05) // bottom wall, left (+Y) face
    click(tool, 3, -1)
    const d = ctx.nodesOfType('dimension')[0]
    expect(d.params.points[0][1]).toBeCloseTo(0.12)
    expect(Math.abs(d.params.points[1][0] - d.params.points[0][0])).toBeCloseTo(6)
    expect(d.params.refs).toHaveLength(2)
    expect(d.params.axis).toBe('x')
  })
  it('leader prompts for text; comment emits commentRequest and returns to select', async () => {
    const ctx = new MockContext()
    ctx.overlay.promptResponses.push('Check level')
    const leader = activate(new LeaderTool(), ctx)
    click(leader, 0, 0)
    click(leader, 1, 1)
    key(leader, 'Enter')
    await Promise.resolve()
    const l = ctx.nodesOfType('leader')[0]
    expect(l.params.text).toBe('Check level')
    expect(l.params.points).toHaveLength(2)
    const comment = activate(new CommentTool(), ctx)
    click(comment, 2, 2)
    const ev = ctx.events.find((e) => e.event === 'commentRequest')
    expect(ev).toBeTruthy()
    expect((ev!.payload as { point: number[] }).point[0]).toBeCloseTo(2)
    expect(ctx.toolSwitches.at(-1)?.tool).toBe('select')
  })
})

describe('modify.pushpull', () => {
  it('drags the top face of a shape and updates its depth', () => {
    const ctx = new MockContext()
    const id = ctx.doc.addNode({ type: 'shape', parent: ctx.levelId, t: { p: [2, 2, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }, params: { profile: 'rect', width: 1, height: 1, depth: 0.5 } })
    const tool = activate(new PushPullTool(), ctx)
    move(tool, 2, 2)
    expect(ctx.overlay.texts().some((t) => t.includes('depth'))).toBe(true)
    // drag: the mock ray is vertical (looking down), so move the pointer while the ray origin rises
    tool.onPointerDown?.({ ...ptrAt(2, 2), button: 0 })
    tool.onPointerMove?.({ ...ptrAt(2, 2), ray: { origin: [2, 2.3, 100], direction: [0, 0, -1] }, buttons: 1 })
    expect(ctx.preview.nodes.size).toBe(1)
    tool.onInput?.('400')
    expect(ctx.node<'shape'>(id)!.params.depth).toBeCloseTo(0.9)
  })
  it('converts a closed rect into an extruded shape', () => {
    const ctx = new MockContext()
    ctx.doc.addNode({ type: 'rect', parent: ctx.levelId, t: { p: [1, 1, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }, params: { width: 2, height: 1 } })
    const tool = activate(new PushPullTool(), ctx)
    // the mock picks the rect edge when hovering its outline
    move(tool, 2, 1)
    tool.onPointerDown?.(ptrAt(2, 1))
    tool.onInput?.('1000')
    expect(ctx.nodesOfType('rect')).toHaveLength(0)
    const sh = ctx.nodesOfType('shape')[0]
    expect(sh.params.profile).toBe('rect')
    expect(sh.params.depth).toBeCloseTo(1)
    expect(sh.params.width).toBeCloseTo(2)
    expect(ctx.doc.canUndo()).toBe(true)
  })
  it('wall top face changes height; slab bottom changes thickness', () => {
    const ctx = new MockContext()
    const [w] = addWallLoop(ctx, 0, 0, 6, 4)
    const tool = activate(new PushPullTool(), ctx)
    move(tool, 3, 0)
    tool.onPointerDown?.(ptrAt(3, 0))
    tool.onInput?.('250')
    expect(ctx.node<'wall'>(w)!.params.height).toBeCloseTo(3)
    const slab = ctx.doc.addNode({ type: 'slab', parent: ctx.levelId, params: { kind: 'floor', outline: [[10, 10], [14, 10], [14, 13], [10, 13]], thickness: 0.2, offset: 0 } })
    ctx.queuePick({ nodeId: slab, point: [12, 11, -0.2], normal: [0, 0, -1], face: { normal: [0, 0, -1], point: [12, 11, -0.2] } })
    ctx.queuePick({ nodeId: slab, point: [12, 11, -0.2], normal: [0, 0, -1], face: { normal: [0, 0, -1], point: [12, 11, -0.2] } })
    move(tool, 12, 11)
    tool.onPointerDown?.(ptrAt(12, 11))
    tool.onInput?.('100')
    expect(ctx.node<'slab'>(slab)!.params.thickness).toBeCloseTo(0.3)
  })
})

describe('modify.offset / trim / extend / fillet', () => {
  it('offsets a rect outward by a typed distance', () => {
    const ctx = new MockContext()
    ctx.doc.addNode({ type: 'rect', parent: ctx.levelId, t: { p: [2, 2, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }, params: { width: 2, height: 2 } })
    const tool = activate(new OffsetTool(), ctx)
    click(tool, 3, 2) // right edge
    move(tool, 4, 2) // outside
    tool.onInput?.('500')
    const rects = ctx.nodesOfType('rect')
    expect(rects).toHaveLength(2)
    expect(rects[1].params.width).toBeCloseTo(3)
    expect(rects[1].params.height).toBeCloseTo(3)
  })
  it('offsets a line to the pointer side', () => {
    const ctx = new MockContext()
    line(ctx, [0, 0], [4, 0])
    const tool = activate(new OffsetTool(), ctx)
    click(tool, 2, 0)
    click(tool, 2, 0.75)
    const lines = ctx.nodesOfType('line')
    expect(lines).toHaveLength(2)
    expect(lines[1].params.a[1]).toBeCloseTo(0.75)
  })
  it('trim splits a line at two crossing lines and removes the middle', () => {
    const ctx = new MockContext()
    const target = line(ctx, [0, 0], [6, 0])
    line(ctx, [2, -1], [2, 1])
    line(ctx, [4, -1], [4, 1])
    const tool = activate(new TrimTool(), ctx)
    move(tool, 3, 0)
    expect(ctx.preview.lineSets.size).toBe(1)
    click(tool, 3, 0)
    const lines = ctx.nodesOfType('line').filter((l) => Math.abs(l.params.a[1]) < 1e-9 && Math.abs(l.params.b[1]) < 1e-9)
    expect(lines).toHaveLength(2)
    const t = ctx.node<'line'>(target)!
    expect(t.params.b[0]).toBeCloseTo(2)
    const other = lines.find((l) => l.id !== target)!
    expect(other.params.a[0]).toBeCloseTo(4)
    expect(other.params.b[0]).toBeCloseTo(6)
  })
  it('trim shortens an end portion and deletes untouched objects', () => {
    const ctx = new MockContext()
    const target = line(ctx, [0, 0], [6, 0])
    line(ctx, [2, -1], [2, 1])
    const tool = activate(new TrimTool(), ctx)
    click(tool, 1, 0)
    expect(ctx.node<'line'>(target)!.params.a[0]).toBeCloseTo(2)
    const lonely = line(ctx, [10, 10], [12, 10])
    click(tool, 11, 10)
    expect(ctx.doc.hasNode(lonely)).toBe(false)
  })
  it('extend grows a line to the next boundary', () => {
    const ctx = new MockContext()
    const target = line(ctx, [0, 0], [2, 0])
    line(ctx, [5, -1], [5, 1])
    const tool = activate(new ExtendTool(), ctx)
    click(tool, 1.8, 0)
    expect(ctx.node<'line'>(target)!.params.b[0]).toBeCloseTo(5)
  })
  it('fillet rounds the corner between two lines with an arc', () => {
    const ctx = new MockContext()
    const l1 = line(ctx, [0, 0], [4, 0])
    const l2 = line(ctx, [4, 0], [4, 4])
    const tool = activate(new FilletTool(), ctx, { radius: 1 })
    click(tool, 1, 0)
    click(tool, 4, 3)
    expect(ctx.node<'line'>(l1)!.params.b[0]).toBeCloseTo(3)
    expect(ctx.node<'line'>(l2)!.params.a[1]).toBeCloseTo(1)
    const arc = ctx.nodesOfType('arc')[0]
    expect(arc.t.p[0]).toBeCloseTo(3)
    expect(arc.t.p[1]).toBeCloseTo(1)
    expect(arc.params.radius).toBeCloseTo(1)
    expect(arc.params.end - arc.params.start).toBeCloseTo(Math.PI / 2)
  })
  it('fillet with radius 0 closes a gap (sharp corner)', () => {
    const ctx = new MockContext()
    const l1 = line(ctx, [0, 0], [3, 0])
    const l2 = line(ctx, [4, 1], [4, 4])
    const tool = activate(new FilletTool(), ctx, { radius: 0 })
    click(tool, 1, 0)
    click(tool, 4, 3)
    expect(ctx.node<'line'>(l1)!.params.b).toEqual([4, 0])
    expect(ctx.node<'line'>(l2)!.params.a).toEqual([4, 0])
  })
})

describe('modify.mirror / array', () => {
  it('mirrors walls (with openings) across an axis and keeps the original', () => {
    const ctx = new MockContext()
    const w = ctx.doc.addNode({ type: 'wall', parent: ctx.levelId, params: { a: [0, 0], b: [4, 0], thickness: 0.24, height: 2.75, baseOffset: 0, justification: 'left' } })
    ctx.doc.addNode({ type: 'opening', parent: w, params: { kind: 'door', offset: 1, width: 0.9, height: 2, sill: 0, frameWidth: 0.06, frameDepth: 0, hinge: 'left', opensTo: 'left', style: 'single' } })
    ctx.select([w])
    const tool = activate(new MirrorTool(), ctx)
    click(tool, 0, 2)
    move(tool, 4, 2)
    expect(ctx.preview.nodes.size).toBe(1)
    click(tool, 4, 2)
    const walls = ctx.nodesOfType('wall')
    expect(walls).toHaveLength(2)
    const m = walls.find((x) => x.id !== w)!
    expect(m.params.a[1]).toBeCloseTo(4)
    expect(m.params.b[1]).toBeCloseTo(4)
    expect(m.params.justification).toBe('right')
    const door = ctx.nodesOfType('opening').find((o) => o.parent === m.id)!
    expect(door.params.hinge).toBe('right')
    expect(door.params.opensTo).toBe('right')
  })
  it('mirrors a rotated rect (position + orientation)', () => {
    const ctx = new MockContext()
    const yaw = Math.PI / 6
    const r = ctx.doc.addNode({ type: 'rect', parent: ctx.levelId, t: { p: [2, 1, 0], r: [0, 0, Math.sin(yaw / 2), Math.cos(yaw / 2)], s: [1, 1, 1] }, params: { width: 2, height: 1 } })
    ctx.select([r])
    const tool = activate(new MirrorTool(), ctx, { keepOriginal: false })
    click(tool, 0, 0)
    click(tool, 0, 1) // mirror across the Y axis
    const rects = ctx.nodesOfType('rect')
    expect(rects).toHaveLength(1)
    expect(rects[0].t.p[0]).toBeCloseTo(-2)
    expect(rects[0].t.p[1]).toBeCloseTo(1)
    const yaw2 = 2 * Math.atan2(rects[0].t.r[2], rects[0].t.r[3])
    expect(Math.abs(Math.abs(yaw2) - (Math.PI - yaw))).toBeLessThan(1e-6)
  })
  it('linear array copies with spacing from two clicks; polar array rotates about a center', () => {
    const ctx = new MockContext()
    const c = ctx.doc.addNode({ type: 'column', parent: ctx.levelId, t: { p: [1, 1, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }, params: { shape: 'rect', width: 0.3, depth: 0.3, height: 3, baseOffset: 0 } })
    ctx.select([c])
    const tool = activate(new ArrayTool(), ctx, { count: 4 })
    click(tool, 1, 1)
    move(tool, 3, 1)
    expect(ctx.preview.nodes.size).toBe(3)
    click(tool, 3, 1)
    const cols = ctx.nodesOfType('column')
    expect(cols).toHaveLength(4)
    expect(cols.map((k) => k.t.p[0]).sort((a, b) => a - b)).toEqual([1, 3, 5, 7])
    ctx.select([c])
    const polar = activate(new ArrayTool(), ctx, { mode: 'polar', count: 4, angleDeg: 360 })
    click(polar, 1, 3) // center 2 m above the column
    const all = ctx.nodesOfType('column')
    expect(all).toHaveLength(7)
    expect(all.some((k) => Math.abs(k.t.p[0] - 3) < 1e-6 && Math.abs(k.t.p[1] - 3) < 1e-6)).toBe(true)
    expect(all.some((k) => Math.abs(k.t.p[0] - 1) < 1e-6 && Math.abs(k.t.p[1] - 5) < 1e-6)).toBe(true)
  })
  it('array as instances creates a component and instance nodes', () => {
    const ctx = new MockContext()
    const c = ctx.doc.addNode({ type: 'primitive', parent: ctx.levelId, t: { p: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }, params: { shape: 'box' } })
    ctx.select([c])
    const tool = activate(new ArrayTool(), ctx, { count: 3, spacing: 2, result: 'instances' })
    click(tool, 0, 0)
    expect(ctx.nodesOfType('instance')).toHaveLength(3)
    expect(ctx.doc.listComponents()).toHaveLength(1)
  })
})

describe('section', () => {
  it('plan view: 2 clicks + side click creates a labelled section looking toward the side', () => {
    const ctx = new MockContext()
    const tool = activate(new SectionTool(), ctx, { depth: 5 })
    click(tool, 0, 2)
    click(tool, 6, 2)
    move(tool, 3, 4)
    expect(ctx.overlay.texts()).toContain('A')
    click(tool, 3, 4) // looks toward +Y → clipped (+normal) side is −Y
    const s = ctx.nodesOfType('section')[0]
    expect(s.parent).toBeNull()
    expect(s.params.label).toBe('A')
    expect(s.params.depth).toBe(5)
    expect(s.t.p[0]).toBeCloseTo(3)
    // local +Z (normal) should be −Y in world
    const q = s.t.r
    const nz = [2 * (q[0] * q[2] + q[3] * q[1]), 2 * (q[1] * q[2] - q[3] * q[0]), 1 - 2 * (q[0] * q[0] + q[1] * q[1])]
    expect(nz[1]).toBeCloseTo(-1)
    expect((s.meta as { extent: { length: number } }).extent.length).toBeCloseTo(6)
    expect(ctx.toolSwitches.at(-1)?.tool).toBe('select')
    activate(new SectionTool(), ctx)
    expect(ctx.lastHint()).toContain('Section')
  })
})

function ptrAt(x: number, y: number) {
  return {
    clientX: x * 100,
    clientY: -y * 100,
    ndc: [0, 0] as [number, number],
    button: 0,
    buttons: 1,
    shift: false,
    alt: false,
    mod: false,
    viewport: 0,
    ray: { origin: [x, y, 100] as [number, number, number], direction: [0, 0, -1] as [number, number, number] },
    pointerType: 'mouse' as const,
    native: { preventDefault() {} } as unknown as PointerEvent,
  }
}

void drag
