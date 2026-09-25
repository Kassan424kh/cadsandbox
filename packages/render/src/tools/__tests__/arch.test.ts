import { describe, expect, it } from 'vitest'
import { BeamTool } from '../arch/beam'
import { ColumnTool } from '../arch/column'
import { OpeningTool } from '../arch/opening'
import { RailingTool } from '../arch/railing'
import { RoofTool } from '../arch/roof'
import { RoomTool } from '../arch/room'
import { SlabTool } from '../arch/slab'
import { StairTool } from '../arch/stair'
import { WallTool } from '../arch/wall'
import { MockContext, activate, addWallLoop, click, key, move } from './mockContext'

describe('arch.wall', () => {
  it('chain creates N walls sharing endpoints in one undo step, closes with C', () => {
    const ctx = new MockContext()
    const tool = activate(new WallTool(), ctx, { thickness: 0.3 })
    click(tool, 0, 0)
    click(tool, 6, 0)
    click(tool, 6, 4)
    click(tool, 0, 4)
    key(tool, 'c')
    const walls = ctx.nodesOfType('wall')
    expect(walls).toHaveLength(4)
    for (let i = 0; i < 4; i++) expect(walls[i].params.b).toEqual(walls[(i + 1) % 4].params.a)
    expect(walls[0].params.thickness).toBeCloseTo(0.3)
    expect(walls[0].params.height).toBeCloseTo(3) // level height
    expect(walls[0].layer).toBe('layer-walls')
    expect(walls.every((w) => w.parent === ctx.levelId)).toBe(true)
    ctx.doc.undo()
    expect(ctx.nodesOfType('wall')).toHaveLength(0)
  })

  it('snaps to existing wall ends and applies presets with layers', () => {
    const ctx = new MockContext()
    ctx.doc.addNode({ type: 'wall', parent: ctx.levelId, params: { a: [0, 0], b: [4, 0], thickness: 0.24, height: 2.75, baseOffset: 0, justification: 'center' } })
    const tool = activate(new WallTool(), ctx, { preset: 'ext-365-masonry' })
    click(tool, 4.03, 0.02) // near the existing end → snapped
    move(tool, 4, 3)
    tool.onInput?.('3000')
    key(tool, 'Enter')
    const walls = ctx.nodesOfType('wall')
    expect(walls).toHaveLength(2)
    const w = walls[1]
    expect(w.params.a).toEqual([4, 0])
    expect(w.params.b[1]).toBeCloseTo(3)
    expect(w.params.thickness).toBeCloseTo(0.365)
    expect(w.params.layers).toHaveLength(4)
    expect(w.params.exterior).toBe(true)
  })

  it('rectangle mode creates 4 walls from 2 clicks', () => {
    const ctx = new MockContext()
    const tool = activate(new WallTool(), ctx, { mode: 'rectangle' })
    click(tool, 0, 0)
    click(tool, 5, 3)
    expect(ctx.nodesOfType('wall')).toHaveLength(4)
    expect(ctx.preview.count).toBe(0)
  })
})

describe('arch.door / window', () => {
  it('places a door as a child of the hovered wall with a 5 cm snapped offset and labels', () => {
    const ctx = new MockContext()
    const [wallId] = addWallLoop(ctx, 0, 0, 6, 4)
    const tool = activate(new OpeningTool('door'), ctx)
    move(tool, 2.03, 0.05) // on the bottom wall (a=(0,0) → b=(6,0)), pointer on the left (+Y) side
    expect(ctx.overlay.texts().length).toBeGreaterThanOrEqual(2)
    expect(ctx.preview.polygons.size).toBe(1)
    expect(ctx.lastInput()?.label).toBe('From end')
    key(tool, 'Tab') // flip hinge
    key(tool, ' ') // flip swing side
    click(tool, 2.03, 0.05)
    const doors = ctx.nodesOfType('opening')
    expect(doors).toHaveLength(1)
    const d = doors[0]
    expect(d.parent).toBe(wallId)
    expect(d.params.kind).toBe('door')
    // edge snapped to 5 cm: offset − w/2 = round(2.03 − 0.4425, 0.05) = 1.6 → offset 2.0425
    expect(d.params.offset).toBeCloseTo(1.6 + 0.4425)
    expect(d.params.hinge).toBe('right')
    expect(d.params.opensTo).toBe('right')
    expect(d.params.width).toBeCloseTo(0.885)
    expect(d.layer).toBe('layer-openings')
  })

  it('typed distance places the opening edge from the nearer wall end; window has a sill', () => {
    const ctx = new MockContext()
    addWallLoop(ctx, 0, 0, 6, 4)
    const tool = activate(new OpeningTool('window'), ctx, { width: 1.0, sill: 0.85 })
    move(tool, 5.0, 0.0)
    tool.onInput?.('500') // 0.5 m from the wall END (b) to the window edge
    const w = ctx.nodesOfType('opening')[0]
    expect(w.params.kind).toBe('window')
    expect(w.params.offset).toBeCloseTo(6 - 0.5 - 0.5)
    expect(w.params.sill).toBeCloseTo(0.85)
    expect(w.params.style).toBe('casement')
  })

  it('does nothing when no wall is hovered', () => {
    const ctx = new MockContext()
    const tool = activate(new OpeningTool('opening'), ctx)
    click(tool, 1, 1)
    expect(ctx.nodesOfType('opening')).toHaveLength(0)
    expect(ctx.notifications.length).toBe(1)
  })
})

describe('arch.slab / roof / room', () => {
  it('slab from a click inside the wall loop uses the outer faces; room uses the inner faces', () => {
    const ctx = new MockContext()
    addWallLoop(ctx, 0, 0, 6, 4, 0.3)
    const slab = activate(new SlabTool(), ctx, { thickness: 0.25 })
    move(slab, 3, 2)
    expect(ctx.preview.polygons.size).toBe(1)
    click(slab, 3, 2)
    const s = ctx.nodesOfType('slab')[0]
    expect(s.params.outline).toHaveLength(4)
    const xs = s.params.outline.map((p) => p[0])
    expect(Math.min(...xs)).toBeCloseTo(-0.15)
    expect(Math.max(...xs)).toBeCloseTo(6.15)
    expect(s.params.thickness).toBeCloseTo(0.25)

    const room = activate(new RoomTool(), ctx, { usage: 'NUF2' })
    click(room, 3, 2)
    const r = ctx.nodesOfType('room')[0]
    expect(r.params.auto).toBe(true)
    expect(r.params.number).toBe('0.01')
    expect(r.params.usage).toBe('NUF2')
    const rx = r.params.outline.map((p) => p[0])
    expect(Math.min(...rx)).toBeCloseTo(0.15)
    expect(Math.max(...rx)).toBeCloseTo(5.85)
    click(room, 3, 2)
    expect(ctx.nodesOfType('room')[1].params.number).toBe('0.02')
  })

  it('room detection handles a partition wall (two rooms)', () => {
    const ctx = new MockContext()
    addWallLoop(ctx, 0, 0, 6, 4, 0.2)
    ctx.doc.addNode({ type: 'wall', parent: ctx.levelId, params: { a: [3, 0], b: [3, 4], thickness: 0.1, height: 2.75, baseOffset: 0, justification: 'center' } })
    const room = activate(new RoomTool(), ctx)
    click(room, 1, 1)
    const r = ctx.nodesOfType('room')[0]
    const xs = r.params.outline.map((p) => p[0])
    expect(Math.min(...xs)).toBeCloseTo(0.1)
    expect(Math.max(...xs)).toBeCloseTo(2.95)
  })

  it('polygon mode draws the outline; roof gets the level height as eave', () => {
    const ctx = new MockContext()
    const roof = activate(new RoofTool(), ctx, { mode: 'polygon', kind: 'hip' })
    click(roof, 0, 0)
    click(roof, 8, 0)
    click(roof, 8, 5)
    click(roof, 0, 5)
    key(roof, 'c')
    const r = ctx.nodesOfType('roof')[0]
    expect(r.params.kind).toBe('hip')
    expect(r.params.outline).toHaveLength(4)
    expect(r.params.baseOffset).toBeCloseTo(3)
    expect(r.params.pitchDeg).toBe(35)
  })
})

describe('arch.stair / column / beam / railing', () => {
  it('stair: start + end click set direction and tread depth from the run length', () => {
    const ctx = new MockContext()
    const tool = activate(new StairTool(), ctx)
    click(tool, 1, 1)
    move(tool, 1, 4)
    expect(ctx.preview.polygons.size).toBe(1)
    click(tool, 1, 4.6)
    const s = ctx.nodesOfType('stair')[0]
    expect(s.t.p[0]).toBeCloseTo(1)
    expect(s.params.rise).toBeCloseTo(3)
    expect(s.params.riserCount).toBeGreaterThanOrEqual(16)
    expect(s.params.treadDepth).toBeCloseTo(3.6 / (s.params.riserCount - 1), 3)
    // climbs along +Y → no rotation needed
    expect(Math.abs(s.t.r[2])).toBeLessThan(1e-6)
  })

  it('column grid places count × count columns at level height', () => {
    const ctx = new MockContext()
    const tool = activate(new ColumnTool(), ctx, { countX: 2, countY: 3, spacingX: 4, spacingY: 5, shape: 'round' })
    click(tool, 1, 1)
    const cols = ctx.nodesOfType('column')
    expect(cols).toHaveLength(6)
    expect(cols[0].params.height).toBeCloseTo(3)
    expect(cols[0].layer).toBe('layer-structure')
    expect(cols.some((c) => Math.abs(c.t.p[0] - 5) < 1e-9 && Math.abs(c.t.p[1] - 11) < 1e-9)).toBe(true)
  })

  it('beam spans two points at the level height', () => {
    const ctx = new MockContext()
    const tool = activate(new BeamTool(), ctx)
    click(tool, 0, 0)
    click(tool, 4, 0)
    const b = ctx.nodesOfType('beam')[0]
    expect(b.params.a).toEqual([0, 0, 3])
    expect(b.params.b[0]).toBeCloseTo(4)
    expect(b.layer).toBe('layer-structure')
  })

  it('railing follows a polyline', () => {
    const ctx = new MockContext()
    const tool = activate(new RailingTool(), ctx, { style: 'glass' })
    click(tool, 0, 0)
    click(tool, 2, 0)
    click(tool, 2, 2)
    key(tool, 'Enter')
    const r = ctx.nodesOfType('railing')[0]
    expect(r.params.path).toHaveLength(3)
    expect(r.params.style).toBe('glass')
  })
})
