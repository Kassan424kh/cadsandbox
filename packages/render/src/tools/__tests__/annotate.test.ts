import { describe, expect, it } from 'vitest'
import { autoDimensionWalls } from '../annotate/autoDimension'
import { CalibrateTool, calibratedImagePatch } from '../annotate/calibrate'
import { ChainDimensionTool } from '../annotate/chain'
import { CloudTool, cloudOutline } from '../annotate/cloud'
import { GridTool, letterLabel, nextGridLabel } from '../annotate/grid'
import { LevelmarkTool } from '../annotate/levelmark'
import { MARKUP_LAYER_ID, MarkupTool, simplifyStroke, smoothStroke } from '../annotate/markup'
import { MockContext, activate, addWallLoop, click, drag, key, move } from './mockContext'

describe('annotate.grid', () => {
  it('labels: letters A…Z, AA… and numbers, skipping used ones', () => {
    expect([0, 1, 25, 26, 27].map(letterLabel)).toEqual(['A', 'B', 'Z', 'AA', 'AB'])
    expect(nextGridLabel(['A', 'B'], 'letter')).toBe('C')
    expect(nextGridLabel(['1', '3'], 'number')).toBe('2')
    expect(nextGridLabel([], 'number')).toBe('1')
  })

  it('single mode: two clicks create one axis; vertical axes get letters, horizontal ones numbers', () => {
    const ctx = new MockContext()
    const tool = activate(new GridTool(), ctx)
    click(tool, 0, 0)
    click(tool, 0, 8)
    click(tool, 5, 0)
    click(tool, 5, 8)
    click(tool, -1, 0)
    click(tool, 9, 0)
    const grid = ctx.nodesOfType('gridline')
    expect(grid).toHaveLength(3)
    expect(grid[0].params.a).toEqual([0, 0])
    expect(grid[0].params.b).toEqual([0, 8])
    expect(grid.map((g) => g.params.label)).toEqual(['A', 'B', '1'])
    expect(grid[0].params.bubble).toBe('start')
    expect(grid.every((g) => g.parent === ctx.levelId && g.layer === 'layer-anno')).toBe(true)
    expect(ctx.preview.count).toBe(0)
  })

  it('rect mode: one click lays out a labelled grid with overhang', () => {
    const ctx = new MockContext()
    const tool = activate(new GridTool(), ctx, { mode: 'rect', countX: 3, spacingX: 5, countY: 2, spacingY: 4, overhang: 1, bubble: 'both' })
    move(tool, 1, 1)
    expect(ctx.preview.count).toBeGreaterThan(0)
    click(tool, 0, 0)
    const grid = ctx.nodesOfType('gridline')
    expect(grid).toHaveLength(5)
    expect(grid.map((g) => g.params.label)).toEqual(['A', 'B', 'C', '1', '2'])
    expect(grid[0].params.a).toEqual([0, -1])
    expect(grid[0].params.b).toEqual([0, 5])
    expect(grid[3].params.a).toEqual([-1, 0])
    expect(grid[3].params.b).toEqual([11, 0])
    expect(grid.every((g) => g.params.bubble === 'both')).toBe(true)
    expect(ctx.doc.canUndo()).toBe(true)
    ctx.doc.undo()
    expect(ctx.nodesOfType('gridline')).toHaveLength(0)
  })
})

describe('annotate.chain', () => {
  it('collects stations, Enter switches to placement, click sets the offset', () => {
    const ctx = new MockContext()
    const tool = activate(new ChainDimensionTool(), ctx)
    click(tool, 0, 0)
    click(tool, 2, 0)
    click(tool, 5, 0)
    key(tool, 'Enter')
    expect(ctx.lastHint()).toMatch(/place/i)
    move(tool, 2.5, -1)
    expect(ctx.preview.drawings.size).toBe(1)
    expect(ctx.lastInput()?.label).toBe('Offset')
    click(tool, 2.5, -1)
    const dims = ctx.nodesOfType('dimension')
    expect(dims).toHaveLength(1)
    expect(dims[0].params.kind).toBe('chain')
    expect(dims[0].params.points).toHaveLength(3)
    expect(dims[0].params.offset).toBeCloseTo(-1)
    expect(dims[0].layer).toBe('layer-dims')
    expect(ctx.preview.count).toBe(0)
    expect(tool.onCancel?.()).toBe(false)
  })

  it('typed offset keeps the pointer side; Esc during placement returns to the stations', () => {
    const ctx = new MockContext()
    const tool = activate(new ChainDimensionTool(), ctx, { axis: 'x' })
    click(tool, 0, 0)
    click(tool, 3, 0.2)
    key(tool, 'Enter')
    expect(tool.onCancel?.()).toBe(true) // back to collecting
    click(tool, 6, 0)
    key(tool, 'Enter')
    move(tool, 3, 2)
    tool.onInput?.('0.8 m') // VCB input is in doc units (mm by default) unless a unit is typed
    const d = ctx.nodesOfType('dimension')[0]
    expect(d.params.points).toHaveLength(3)
    expect(d.params.offset).toBeCloseTo(0.8)
    expect(d.params.axis).toBe('x')
  })
})

describe('annotate.levelmark', () => {
  it('places a height marker at the clicked point with variant and prefix', () => {
    const ctx = new MockContext()
    const tool = activate(new LevelmarkTool(), ctx, { variant: 'section', prefix: 'OKFF' })
    move(tool, 1, 2)
    expect(ctx.preview.nodes.size).toBe(1)
    click(tool, 1, 2)
    const marks = ctx.nodesOfType('levelmark')
    expect(marks).toHaveLength(1)
    expect(marks[0].t.p[0]).toBeCloseTo(1)
    expect(marks[0].t.p[1]).toBeCloseTo(2)
    expect(marks[0].params).toEqual({ variant: 'section', prefix: 'OKFF' })
    expect(marks[0].parent).toBe(ctx.levelId)
    expect(ctx.preview.count).toBe(0)
  })
})

describe('annotate.cloud & markup', () => {
  it('cloudOutline bulges outward for both orientations', () => {
    const ccw = cloudOutline([[0, 0], [4, 0], [4, 4], [0, 4]], 2, 0.5)
    expect(ccw.points).toHaveLength(8)
    expect(ccw.bulges.every((b) => b === 0.5)).toBe(true)
    const cw = cloudOutline([[0, 0], [0, 4], [4, 4], [4, 0]], 2, 0.5)
    expect(cw.bulges.every((b) => b === -0.5)).toBe(true)
  })

  it('cloud tool closes on C and writes a scalloped polyline on the red Markup layer', () => {
    const ctx = new MockContext()
    const tool = activate(new CloudTool(), ctx, { arcLength: 1 })
    click(tool, 0, 0)
    click(tool, 3, 0)
    click(tool, 3, 2)
    move(tool, 0, 2)
    click(tool, 0, 2)
    key(tool, 'c')
    const pl = ctx.nodesOfType('polyline')
    expect(pl).toHaveLength(1)
    expect(pl[0].params.closed).toBe(true)
    expect(pl[0].params.points).toHaveLength(10)
    expect(pl[0].params.bulges).toHaveLength(10)
    expect(pl[0].layer).toBe(MARKUP_LAYER_ID)
    expect(ctx.doc.getLayer(MARKUP_LAYER_ID)?.color).toBe('#ef4444')
    expect(pl[0].color).toBe('#ef4444')
  })

  it('markup pen smooths and simplifies a dragged stroke into an open polyline', () => {
    expect(smoothStroke([[0, 0], [1, 0], [1, 1]], 1)).toHaveLength(6)
    expect(simplifyStroke([[0, 0], [1, 0.001], [2, 0], [3, 0]], 0.01)).toEqual([[0, 0], [3, 0]])
    const ctx = new MockContext()
    ctx.wpp = 0.001
    const tool = activate(new MarkupTool(), ctx, { smoothing: 1 })
    drag(tool, [0, 0], [3, 1], 12)
    const pl = ctx.nodesOfType('polyline')
    expect(pl).toHaveLength(1)
    expect(pl[0].params.closed).toBe(false)
    expect(pl[0].params.points.length).toBeGreaterThanOrEqual(2)
    expect(pl[0].layer).toBe(MARKUP_LAYER_ID)
    expect(ctx.preview.count).toBe(0)
    expect(tool.onCancel?.()).toBe(false)
  })
})

describe('annotate.calibrate', () => {
  it('rescales an image about the first point from a typed real distance', () => {
    const ctx = new MockContext()
    const [img] = ctx.doc.addNodes([{ type: 'image', parent: ctx.levelId, params: { asset: 'x', width: 2, height: 1, opacity: 1 }, meta: { image: { pixels: [200, 100], metersPerPixel: 0.01 } } }])
    const tool = activate(new CalibrateTool(), ctx)
    ctx.queuePick({ nodeId: img, point: [0, 0, 0], normal: null })
    click(tool, 0, 0)
    click(tool, 1, 0)
    expect(ctx.lastInput()?.label).toMatch(/distance/i)
    tool.onInput?.('2 m')
    const node = ctx.doc.getNode<'image'>(img)!
    expect(node.params.width).toBeCloseTo(4)
    expect(node.params.height).toBeCloseTo(2)
    expect((node.meta.image as { metersPerPixel: number }).metersPerPixel).toBeCloseTo(0.02)
    expect(ctx.notifications.some((n) => n.level === 'success')).toBe(true)
    expect(tool.onCancel?.()).toBe(false)
  })

  it('calibratedImagePatch keeps the anchor point fixed', () => {
    const node = { t: { p: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }, params: { asset: '', width: 2, height: 1, opacity: 1 }, meta: {} } as unknown as Parameters<typeof calibratedImagePatch>[0]
    const patch = calibratedImagePatch(node, [1, 0], 2)
    expect(patch.t?.p).toEqual([-1, 0, 0])
    expect(patch.params).toEqual({ width: 4, height: 2 })
  })
})

describe('autoDimensionWalls', () => {
  it('creates exterior chains with opening stations and overall dimensions', () => {
    const ctx = new MockContext()
    const walls = addWallLoop(ctx, 0, 0, 10, 6, 0.3)
    ctx.doc.addNodes([{ type: 'opening', parent: walls[0], params: { kind: 'door', style: 'single', offset: 3, width: 1, height: 2.1, sill: 0 } }])
    const nodes = autoDimensionWalls(ctx.doc, ctx.levelId!)
    // south: chain + overall; north/west/east: chains only (two stations each)
    expect(nodes).toHaveLength(5)
    const south = nodes.find((n) => n.name === 'Chain South')!
    expect(south.params?.kind).toBe('chain')
    expect(south.params?.axis).toBe('x')
    expect(south.params?.points?.map((p) => Math.round(p[0] * 1000) / 1000)).toEqual([0, 2.5, 3.5, 10])
    expect(south.params?.points?.every((p) => Math.abs(p[1] + 0.15) < 1e-9)).toBe(true)
    expect(south.params?.offset).toBeCloseTo(-1)
    expect(south.params?.refs?.[0]).toEqual({ node: walls[0], anchor: 'a' })
    expect(south.params?.refs?.[1]).toEqual({ node: '', anchor: '' })
    const overall = nodes.find((n) => n.name === 'Overall South')!
    expect(overall.params?.points).toHaveLength(2)
    expect(overall.params?.offset).toBeCloseTo(-1.7)
    const west = nodes.find((n) => n.name === 'Chain West')!
    expect(west.params?.axis).toBe('y')
    expect(west.params?.offset).toBeCloseTo(1)
    expect(nodes.every((n) => n.parent === ctx.levelId && n.layer === 'layer-dims')).toBe(true)
    // commits as regular dimension nodes
    const ids = ctx.doc.addNodes(nodes)
    expect(ctx.nodesOfType('dimension')).toHaveLength(ids.length)
  })

  it('returns nothing without walls and adds interior chains only for walls with openings', () => {
    const ctx = new MockContext()
    expect(autoDimensionWalls(ctx.doc, ctx.levelId!)).toEqual([])
    addWallLoop(ctx, 0, 0, 10, 6, 0.3)
    const [inner] = ctx.doc.addNodes([{ type: 'wall', parent: ctx.levelId, params: { a: [5, 0], b: [5, 6], thickness: 0.115, height: 2.75, baseOffset: 0, justification: 'center' } }])
    expect(autoDimensionWalls(ctx.doc, ctx.levelId!, { exterior: false, interior: true })).toHaveLength(0)
    ctx.doc.addNodes([{ type: 'opening', parent: inner, params: { kind: 'door', style: 'single', offset: 2, width: 0.885, height: 2.1, sill: 0 } }])
    const interior = autoDimensionWalls(ctx.doc, ctx.levelId!, { exterior: false, interior: true })
    expect(interior).toHaveLength(1)
    expect(interior[0].params?.points).toHaveLength(4)
  })
})
