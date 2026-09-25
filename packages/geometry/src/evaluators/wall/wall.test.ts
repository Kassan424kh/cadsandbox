import { makeNode, type NodeBase, type WallParams } from '@cadsandbox/doc'
import { describe, expect, it } from 'vitest'
import { IDENTITY_AFFINE, polygonArea } from '../../core/math2d'
import { isClosedManifold, mergeVertices } from '../../core/mesh'
import { intersectPolygons, polygonsArea, unionPolygons } from '../../core/polygon'
import { defaultContext, type EvalContext, type NeighborWall } from '../context'
import { evaluateWall } from './index'

const wall = (id: string, a: [number, number], b: [number, number], extra: Partial<WallParams> = {}): NodeBase<'wall'> =>
  makeNode({ type: 'wall', id, params: { a, b, thickness: 0.2, height: 2.75, ...extra } })

const nb = (w: NodeBase<'wall'>): NeighborWall => ({ id: w.id, params: w.params, xf: IDENTITY_AFFINE, dz: 0 })

const pocheArea = (r: ReturnType<typeof evaluateWall>): number => {
  let a = 0
  for (const f of r.plan!.fills) if (f.pattern === 'solid') for (const p of f.polygons) a += Math.abs(polygonArea(p.outer)) - p.holes.reduce((s, h) => s + Math.abs(polygonArea(h)), 0)
  return a
}

const segs3 = (e: Float32Array | undefined): number[][] => {
  const out: number[][] = []
  if (e) for (let i = 0; i < e.length; i += 6) out.push(Array.from(e.subarray(i, i + 6)))
  return out
}
const at = (v: number, x: number) => Math.abs(v - x) < 1e-4
const hasVertical = (segs: number[][], x: number, y: number) => segs.some((s) => Math.abs(s[2]! - s[5]!) > 1 && at(s[0]!, x) && at(s[1]!, y) && at(s[3]!, x) && at(s[4]!, y))

describe('wall feature edges at joins', () => {
  it('L-join: the corner verticals are drawn, the mitre diagonal is not', () => {
    const w1 = wall('w1', [0, 0], [4, 0])
    const w2 = wall('w2', [4, 0], [4, 3])
    const s = segs3(evaluateWall(w1, defaultContext({ walls: [nb(w2)] })).edges)
    expect(hasVertical(s, 4.1, -0.1)).toBe(true) // outer corner
    expect(hasVertical(s, 3.9, 0.1)).toBe(true) // inner corner
    // no diagonal across the corner's top/bottom face
    expect(s.some((q) => Math.abs(q[2]! - q[5]!) < 1e-6 && Math.abs(Math.abs(q[3]! - q[0]!) - 0.2) < 1e-3 && Math.abs(Math.abs(q[4]! - q[1]!) - 0.2) < 1e-3)).toBe(false)
    // the top outline reaches the outer corner
    expect(s.some((q) => at(q[2]!, 2.75) && at(q[5]!, 2.75) && ((at(q[3]!, 4.1) && at(q[4]!, -0.1)) || (at(q[0]!, 4.1) && at(q[1]!, -0.1))))).toBe(true)
  })

  it('T-join: the through wall gaps its face line at the stem; nothing is drawn inside the through wall', () => {
    const w1 = wall('w1', [0, 0], [4, 0])
    const w3 = wall('w3', [2, 0], [2, 3])
    const s1 = segs3(evaluateWall(w1, defaultContext({ walls: [nb(w3)] })).edges)
    const s3 = segs3(evaluateWall(w3, defaultContext({ walls: [nb(w1)] })).edges)
    expect(s1.some((q) => at(q[1]!, 0.1) && at(q[4]!, 0.1) && Math.min(q[0]!, q[3]!) < 1.95 && Math.max(q[0]!, q[3]!) > 2.05)).toBe(false)
    expect(s3.some((q) => Math.abs(q[2]! - q[5]!) < 1e-6 && (q[1]! + q[4]!) / 2 < 0.1 - 1e-3 && (q[1]! + q[4]!) / 2 > -0.1 + 1e-3)).toBe(false)
    expect(s3.length).toBeGreaterThan(8)
    // free end of the stem keeps its full cap
    expect(hasVertical(s3, 1.9, 3)).toBe(true)
    expect(hasVertical(s3, 2.1, 3)).toBe(true)
  })

  it('free-standing wall with a door: bottom edge gaps at the door, reveal edges present', () => {
    const w = wall('w', [0, 0], [4, 0])
    const door = makeNode({ type: 'opening', id: 'd', parent: 'w', params: { kind: 'door', style: 'single', offset: 2, width: 1, height: 2.1, sill: 0, hinge: 'left', opensTo: 'left' } })
    const s = segs3(evaluateWall(w, defaultContext({ openings: [{ id: door.id, params: door.params }] })).edges)
    expect(s.length).toBeGreaterThanOrEqual(12)
    // no bottom edge crosses the door (x in 1.5..2.5) on either face
    expect(s.some((q) => at(q[2]!, 0) && at(q[5]!, 0) && Math.min(q[0]!, q[3]!) < 1.6 && Math.max(q[0]!, q[3]!) > 2.4)).toBe(false)
    // jamb verticals on the faces
    expect(hasVertical(s, 1.5, 0.1) || hasVertical(s, 1.5, -0.1)).toBe(true)
  })
})

describe('wall joins', () => {
  it('L-join miters both walls without overlap', () => {
    const w1 = wall('w1', [0, 0], [4, 0])
    const w2 = wall('w2', [4, 0], [4, 3])
    const r1 = evaluateWall(w1, defaultContext({ walls: [nb(w2)] }))
    const r2 = evaluateWall(w2, defaultContext({ walls: [nb(w1)] }))
    expect(r1.error).toBeUndefined()
    expect(r2.error).toBeUndefined()
    const a1 = pocheArea(r1), a2 = pocheArea(r2)
    expect(a1).toBeCloseTo(0.8, 5)
    expect(a2).toBeCloseTo(0.6, 5)
    const f1 = r1.plan!.fills[0]!.polygons[0]!, f2 = r2.plan!.fills[0]!.polygons[0]!
    expect(polygonsArea(intersectPolygons([f1], [f2]))).toBeLessThan(1e-6)
    expect(polygonsArea(unionPolygons([f1, f2]))).toBeCloseTo(1.4, 4)
    // no cap line at the joined end: every 'cut' segment lies on a face line (y = ±0.1 or x = 3.9 / 4.1)
    const cut = r1.plan!.lines.find((l) => l.style === 'cut')!
    for (let i = 0; i < cut.segments.length; i += 4) {
      const y0 = cut.segments[i + 1]!, y1 = cut.segments[i + 3]!
      const x0 = cut.segments[i]!, x1 = cut.segments[i + 2]!
      const onFace = (Math.abs(y0 - y1) < 1e-6 && (Math.abs(Math.abs(y0) - 0.1) < 1e-6)) || (Math.abs(x0 - x1) < 1e-6 && Math.abs(x0) < 1e-6)
      expect(onFace).toBe(true)
    }
  })

  it('T-join butts the stem into the through wall and gaps its face line', () => {
    const w1 = wall('w1', [0, 0], [4, 0])
    const w3 = wall('w3', [2, 0], [2, 3])
    const r1 = evaluateWall(w1, defaultContext({ walls: [nb(w3)] }))
    const r3 = evaluateWall(w3, defaultContext({ walls: [nb(w1)] }))
    const f1 = r1.plan!.fills[0]!.polygons[0]!, f3 = r3.plan!.fills[0]!.polygons[0]!
    expect(pocheArea(r1)).toBeCloseTo(0.8, 5)
    expect(Math.min(...f3.outer.map((p) => p[1]))).toBeCloseTo(0.1, 5)
    expect(polygonsArea(intersectPolygons([f1], [f3]))).toBeLessThan(1e-6)
    // W1's left face line (y = 0.1) must not run through the stem (x in 1.9..2.1)
    const cut = r1.plan!.lines.find((l) => l.style === 'cut')!
    for (let i = 0; i < cut.segments.length; i += 4) {
      const mx = (cut.segments[i]! + cut.segments[i + 2]!) / 2, my = (cut.segments[i + 1]! + cut.segments[i + 3]!) / 2
      if (Math.abs(my - 0.1) < 1e-6) expect(mx > 1.9 && mx < 2.1).toBe(false)
    }
  })

  it('X-crossing: exactly one wall yields its poché, union stays tiled', () => {
    const w1 = wall('w1', [0, 0], [4, 0])
    const w4 = wall('w4', [2, -2], [2, 2])
    const r1 = evaluateWall(w1, defaultContext({ walls: [nb(w4)] }))
    const r4 = evaluateWall(w4, defaultContext({ walls: [nb(w1)] }))
    const areas = [pocheArea(r1), pocheArea(r4)].sort((a, b) => a - b)
    expect(areas[1]).toBeCloseTo(0.8, 5)
    expect(areas[0]).toBeCloseTo(0.76, 5)
    expect(areas[0]! + areas[1]!).toBeCloseTo(1.56, 5)
  })

  it('collinear continuation joins without a cap line', () => {
    const w1 = wall('w1', [0, 0], [4, 0])
    const w5 = wall('w5', [4, 0], [8, 0])
    const r1 = evaluateWall(w1, defaultContext({ walls: [nb(w5)] }))
    const cut = r1.plan!.lines.find((l) => l.style === 'cut')!
    for (let i = 0; i < cut.segments.length; i += 4) {
      // no vertical segment at x = 4
      const vertical = Math.abs(cut.segments[i]! - cut.segments[i + 2]!) < 1e-6
      if (vertical) expect(Math.abs(cut.segments[i]! - 4)).toBeGreaterThan(1e-3)
    }
    expect(pocheArea(r1)).toBeCloseTo(0.8, 5)
  })
})

describe('wall body', () => {
  it('opening cuts reduce net area and volume, mesh stays closed', () => {
    const w = wall('w1', [0, 0], [4, 0])
    const door = makeNode({ type: 'opening', parent: 'w1', params: { kind: 'door', style: 'single', offset: 1, width: 0.885, height: 2.01, sill: 0 } })
    const ctx: EvalContext = defaultContext({ openings: [{ id: door.id, params: door.params }] })
    const r = evaluateWall(w, ctx)
    expect(r.error).toBeUndefined()
    const gross = 4 * 2.75
    expect(r.quantities!.grossArea).toBeCloseTo(gross, 6)
    expect(r.quantities!.netArea).toBeCloseTo(gross - 0.885 * 2.01, 6)
    expect(r.quantities!.openingArea).toBeCloseTo(0.885 * 2.01, 6)
    expect(r.quantities!.surfaceArea).toBeCloseTo(2 * (gross - 0.885 * 2.01), 6)
    expect(r.quantities!.volume).toBeCloseTo(4 * 0.2 * 2.75 - 0.885 * 2.01 * 0.2, 6)
    expect(isClosedManifold(mergeVertices(r.parts[0]!.mesh))).toBe(true)
    // the door is cut by the 1.1 m plan cut → gap: poché area shrinks by the door width × thickness
    expect(pocheArea(r)).toBeCloseTo(0.8 - 0.885 * 0.2, 4)
    const plain = evaluateWall(w, defaultContext())
    expect(plain.quantities!.netArea).toBeCloseTo(gross, 6)
    expect(isClosedManifold(mergeVertices(plain.parts[0]!.mesh))).toBe(true)
  })

  it('multi-layer walls produce one closed part per layer with layer materials and hatches', () => {
    const w = wall('w1', [0, 0], [3, 0], {
      layers: [
        { material: 'mat-plaster', thickness: 0.015, function: 'finish' },
        { material: 'mat-brick-red', thickness: 0.175, function: 'structure' },
        { material: 'mat-insulation', thickness: 0.12, function: 'insulation' },
      ],
    })
    const ctx = defaultContext({ materials: { 'mat-brick-red': { color: '#000', category: 'brick', hatch: 'brick' }, 'mat-insulation': { color: '#000', category: 'generic', hatch: 'insulation' } } })
    const r = evaluateWall(w, ctx)
    expect(r.parts.length).toBe(3)
    expect((r.parts[1]!.material as { id: string }).id).toBe('mat-brick-red')
    for (const p of r.parts) expect(isClosedManifold(mergeVertices(p.mesh))).toBe(true)
    expect(r.quantities!.thickness).toBeCloseTo(0.31, 6)
    expect(r.plan!.fills.some((f) => f.pattern === 'brick')).toBe(true)
    expect(r.plan!.fills.some((f) => f.pattern === 'insulation')).toBe(true)
    expect(r.plan!.lines.find((l) => l.style === 'thin')!.segments.length).toBeGreaterThan(8)
  })

  it('arc wall (bulge) is closed and curved', () => {
    const w = wall('w1', [0, 0], [4, 0], { bulge: 0.4 })
    const r = evaluateWall(w, defaultContext())
    expect(r.error).toBeUndefined()
    expect(isClosedManifold(mergeVertices(r.parts[0]!.mesh))).toBe(true)
    // positive bulge = CCW arc → bulges to the right of a→b (−Y), like DXF
    expect(r.bounds.min[1]).toBeLessThan(-0.5)
    expect(r.quantities!.length).toBeGreaterThan(4)
  })
})
