import { describe, expect, it } from 'vitest'
import { arcFrom3Points, arcFromBulge, bulgeFromArc, flattenPolyline, tangentBulge } from '../util/arcs'
import { parseVcb } from '../util/input'
import { buildPlanarGraph, findRegion, outerBoundaryAt } from '../util/planar'
import { chainSegments, insetLoop, offsetPolyline, pointInPolygon, triangulate } from '../util/polygon'
import { MockContext } from './mockContext'

describe('arcs', () => {
  it('3-point arc is CCW and passes through the mid point', () => {
    const arc = arcFrom3Points([1, 0], [0, 1], [-1, 0])!
    expect(arc.center[0]).toBeCloseTo(0)
    expect(arc.center[1]).toBeCloseTo(0)
    expect(arc.radius).toBeCloseTo(1)
    expect(arc.start).toBeCloseTo(0)
    expect(arc.end).toBeCloseTo(Math.PI)
  })
  it('bulge round-trips', () => {
    const arc = arcFrom3Points([0, 0], [1, 1], [2, 0])!
    const bulge = bulgeFromArc([0, 0], [2, 0], arc)
    const back = arcFromBulge([0, 0], [2, 0], bulge)!
    expect(back.center[0]).toBeCloseTo(arc.center[0])
    expect(back.center[1]).toBeCloseTo(arc.center[1])
    expect(back.radius).toBeCloseTo(arc.radius)
    // CW half circle above the chord: negative bulge, magnitude 1
    expect(bulge).toBeCloseTo(-1)
  })
  it('tangent bulge gives a quarter circle', () => {
    const b = tangentBulge([0, 0], [1, 1], [1, 0])
    expect(b).toBeCloseTo(Math.tan(Math.PI / 8))
    const pts = flattenPolyline([[0, 0], [1, 1]], [b], false)
    expect(pts.length).toBeGreaterThan(3)
    expect(pts[pts.length - 1]).toEqual([1, 1])
  })
})

describe('polygon', () => {
  it('offsets a CCW square outward', () => {
    const out = offsetPolyline([[0, 0], [2, 0], [2, 2], [0, 2]], 0.5, true)
    expect(out[0][0]).toBeCloseTo(-0.5)
    expect(out[0][1]).toBeCloseTo(-0.5)
    expect(out[2][0]).toBeCloseTo(2.5)
  })
  it('offsets an open polyline to the left', () => {
    const out = offsetPolyline([[0, 0], [2, 0]], 0.5, false)
    expect(out[0][1]).toBeCloseTo(0.5)
    expect(out[1][1]).toBeCloseTo(0.5)
  })
  it('insets a loop edge-wise', () => {
    const out = insetLoop([[0, 0], [4, 0], [4, 4], [0, 4]], [0.1, 0.2, 0.1, 0.2])
    expect(out[0][0]).toBeCloseTo(0.2)
    expect(out[0][1]).toBeCloseTo(0.1)
    expect(out[2][0]).toBeCloseTo(3.8)
    expect(out[2][1]).toBeCloseTo(3.9)
  })
  it('triangulates a concave polygon', () => {
    const tris = triangulate([[0, 0], [4, 0], [4, 4], [2, 1], [0, 4]])
    expect(tris.length / 6).toBe(3)
  })
  it('chains segments into a loop', () => {
    const { loops, open } = chainSegments([
      { a: [0, 0], b: [1, 0] },
      { a: [1, 1], b: [0, 1] },
      { a: [1, 0], b: [1, 1] },
      { a: [0, 1], b: [0, 0] },
    ])
    expect(loops).toHaveLength(1)
    expect(loops[0]).toHaveLength(4)
    expect(open).toHaveLength(0)
  })
})

describe('planar graph', () => {
  const square = (x0: number, y0: number, x1: number, y1: number, ref: string) => [
    { a: [x0, y0] as [number, number], b: [x1, y0] as [number, number], ref: `${ref}0` },
    { a: [x1, y0] as [number, number], b: [x1, y1] as [number, number], ref: `${ref}1` },
    { a: [x1, y1] as [number, number], b: [x0, y1] as [number, number], ref: `${ref}2` },
    { a: [x0, y1] as [number, number], b: [x0, y0] as [number, number], ref: `${ref}3` },
  ]
  it('finds two rooms split by a partition', () => {
    const segs = [...square(0, 0, 6, 4, 'w'), { a: [3, 0] as [number, number], b: [3, 4] as [number, number], ref: 'p' }]
    const g = buildPlanarGraph(segs)
    expect(g.faces).toHaveLength(2)
    const r = findRegion(segs, [1, 1])!
    expect(r.face.area).toBeCloseTo(12)
    expect(pointInPolygon([1, 1], r.outline)).toBe(true)
    expect(r.edges.some((e) => e.ref === 'p')).toBe(true)
    const outer = outerBoundaryAt(g, [1, 1])!
    expect(outer.area).toBeCloseTo(24)
  })
  it('handles T-junctions and dangling walls', () => {
    const segs = [...square(0, 0, 6, 4, 'w'), { a: [3, 0] as [number, number], b: [3, 2] as [number, number], ref: 'd' }]
    const g = buildPlanarGraph(segs)
    expect(g.faces).toHaveLength(1)
    expect(g.faces[0].area).toBeCloseTo(24)
  })
  it('reports islands as holes', () => {
    const segs = [...square(0, 0, 6, 6, 'o'), ...square(2, 2, 3, 3, 'i')]
    const r = findRegion(segs, [1, 1])!
    expect(r.holes).toHaveLength(1)
    expect(r.face.area).toBeCloseTo(36)
    const inner = findRegion(segs, [2.5, 2.5])!
    expect(inner.face.area).toBeCloseTo(1)
    expect(inner.holes).toHaveLength(0)
  })
})

describe('vcb parsing', () => {
  const ctx = new MockContext()
  it('parses lengths in doc units (mm)', () => {
    expect(parseVcb('2400', ctx)).toEqual({ kind: 'length', value: 2.4 })
    expect(parseVcb('2,5', ctx)).toEqual({ kind: 'length', value: 0.0025 })
  })
  it('parses polar and delta forms', () => {
    const p = parseVcb('2400<45', ctx)
    expect(p?.kind).toBe('polar')
    if (p?.kind === 'polar') expect(p.angle).toBeCloseTo(Math.PI / 4)
    const q = parseVcb('2.4m, 90', ctx)
    expect(q?.kind).toBe('polar')
    const d = parseVcb('1200;800', ctx)
    expect(d).toEqual({ kind: 'delta', dx: 1.2, dy: 0.8, dz: 0 })
  })
})
