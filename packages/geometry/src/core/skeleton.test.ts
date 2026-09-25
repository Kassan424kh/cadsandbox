import { describe, expect, it } from 'vitest'
import { polygonArea } from './math2d'
import { findRegion, planarFaces } from './planar'
import { straightSkeleton } from './skeleton'

describe('straight skeleton', () => {
  it('rectangle hip: ridge of length L-W at time W/2, 4 faces covering the area', () => {
    const sk = straightSkeleton([[0, 0], [6, 0], [6, 4], [0, 4]])
    expect(sk.maxTime).toBeCloseTo(2, 6)
    const ridge = sk.arcs.filter((a) => a.ta > 1e-6 && a.tb > 1e-6 && Math.hypot(a.a[0] - a.b[0], a.a[1] - a.b[1]) > 1e-6)
    expect(ridge.length).toBe(1)
    expect(Math.hypot(ridge[0]!.a[0] - ridge[0]!.b[0], ridge[0]!.a[1] - ridge[0]!.b[1])).toBeCloseTo(2, 5)
    expect(sk.faces.length).toBe(4)
    const area = sk.faces.reduce((s, f) => s + Math.abs(polygonArea(f.points)), 0)
    expect(area).toBeCloseTo(24, 4)
    for (const f of sk.faces) for (const t of f.times) expect(t).toBeLessThanOrEqual(2 + 1e-6)
  })
  it('L-shape hip has 6 faces tiling the polygon', () => {
    const L: [number, number][] = [[0, 0], [8, 0], [8, 3], [4, 3], [4, 6], [0, 6]]
    const sk = straightSkeleton(L)
    expect(sk.faces.length).toBe(6)
    const area = sk.faces.reduce((s, f) => s + Math.abs(polygonArea(f.points)), 0)
    expect(area).toBeCloseTo(Math.abs(polygonArea(L)), 4)
    expect(sk.maxTime).toBeCloseTo(2, 4) // the 4 m wide wing sets the ridge height
  })
  it('gable (static short edges) produces two slope faces meeting at a ridge', () => {
    const sk = straightSkeleton([[0, 0], [6, 0], [6, 4], [0, 4]], [1, 0, 1, 0])
    expect(sk.maxTime).toBeCloseTo(2, 6)
    expect(sk.faces.length).toBe(2)
    const area = sk.faces.reduce((s, f) => s + Math.abs(polygonArea(f.points)), 0)
    expect(area).toBeCloseTo(24, 4)
    const ridge = sk.arcs.find((a) => a.ta > 1 && a.tb > 1 && Math.hypot(a.a[0] - a.b[0], a.a[1] - a.b[1]) > 1)
    expect(ridge).toBeTruthy()
    expect(Math.hypot(ridge!.a[0] - ridge!.b[0], ridge!.a[1] - ridge!.b[1])).toBeCloseTo(6, 4)
  })
  it('irregular pentagon skeleton tiles the polygon', () => {
    const P: [number, number][] = [[0, 0], [5, -1], [7, 3], [3, 6], [-1, 3]]
    const sk = straightSkeleton(P)
    const area = sk.faces.reduce((s, f) => s + Math.abs(polygonArea(f.points)), 0)
    expect(area).toBeCloseTo(Math.abs(polygonArea(P)), 3)
    expect(sk.faces.length).toBe(5)
  })
})

describe('planar faces / findRegion', () => {
  it('finds the room around a point in a segment soup with a crossing and an island', () => {
    const segs: [[number, number], [number, number]][] = [
      [[0, 0], [10, 0]], [[10, 0], [10, 6]], [[10, 6], [0, 6]], [[0, 6], [0, 0]],
      [[5, -1], [5, 7]], // crossing partition
      [[1, 1], [2, 1]], [[2, 1], [2, 2]], [[2, 2], [1, 2]], [[1, 2], [1, 1]], // island (column)
    ]
    const g = planarFaces(segs)
    expect(g.faces.length).toBe(3) // two rooms + island interior
    const r = findRegion(segs, [3, 3])
    expect(r).toBeTruthy()
    expect(Math.abs(polygonArea(r!.outer))).toBeCloseTo(30, 6)
    expect(r!.holes.length).toBe(1)
    expect(findRegion(segs, [20, 20])).toBeNull()
  })
})
