import { makeNode, type PrimitiveShape, type Vec3 } from '@cadsandbox/doc'
import { describe, expect, it } from 'vitest'
import { evaluatePrimitive } from '../evaluators/primitive'
import { evaluateTerrain } from '../evaluators/terrain'
import { MeshBuilder } from './mesh'
import { computeCleanWireframe, latticeWire } from './wire'

const prim = (shape: PrimitiveShape, params: Record<string, unknown> = {}) => evaluatePrimitive(makeNode({ type: 'primitive', params: { shape, ...params } }))

/** Segments as canonical strings (endpoints sorted) → duplicates collapse. */
const segKeys = (w: Float32Array): Set<string> => {
  const keys = new Set<string>()
  const pt = (i: number) => `${w[i]!.toFixed(5)},${w[i + 1]!.toFixed(5)},${w[i + 2]!.toFixed(5)}`
  for (let i = 0; i < w.length; i += 6) {
    const a = pt(i), b = pt(i + 3)
    keys.add(a < b ? `${a}|${b}` : `${b}|${a}`)
  }
  return keys
}

const distinct = (values: number[], eps = 1e-5): number => {
  const sorted = [...values].sort((a, b) => a - b)
  let n = 0
  for (let i = 0; i < sorted.length; i++) if (i === 0 || sorted[i]! - sorted[i - 1]! > eps) n++
  return n
}

describe('computeCleanWireframe', () => {
  it('box → exactly its 12 edges (no face diagonals)', () => {
    const r = prim('box', { width: 1, depth: 2, height: 3 })
    expect(r.wire).toBeDefined()
    expect(r.wire!.length / 6).toBe(12)
    expect(segKeys(r.wire!).size).toBe(12)
    // every segment is axis-aligned
    for (let i = 0; i < r.wire!.length; i += 6) {
      const axes = [0, 1, 2].filter((k) => Math.abs(r.wire![i + k]! - r.wire![i + 3 + k]!) > 1e-6)
      expect(axes.length).toBe(1)
    }
  })

  it('UV sphere → rings + meridians, no quad diagonals', () => {
    const r = prim('sphere', { radius: 0.5 })
    const w = r.wire!
    let horizontal = 0, meridional = 0
    const azimuths: number[] = [], levels: number[] = []
    for (let i = 0; i < w.length; i += 6) {
      const z0 = w[i + 2]!, z1 = w[i + 5]!
      const a0 = Math.atan2(w[i + 1]!, w[i]!), a1 = Math.atan2(w[i + 4]!, w[i + 3]!)
      const r0 = Math.hypot(w[i]!, w[i + 1]!), r1 = Math.hypot(w[i + 3]!, w[i + 4]!)
      levels.push(z0, z1)
      if (Math.abs(z0 - z1) < 1e-6) {
        horizontal++
        azimuths.push(a0)
      } else {
        // meridian: same azimuth (poles have no azimuth)
        if (r0 > 1e-6 && r1 > 1e-6) expect(Math.abs(Math.atan2(Math.sin(a0 - a1), Math.cos(a0 - a1)))).toBeLessThan(1e-5)
        meridional++
      }
    }
    const S = distinct(azimuths), R = distinct(levels)
    expect(S).toBeGreaterThanOrEqual(24)
    expect(horizontal).toBe(S * (R - 2)) // every non-pole latitude is a full ring
    expect(meridional).toBe(S * (R - 1)) // every meridian runs pole to pole
    expect(segKeys(w).size).toBe(w.length / 6)
  })

  it('cylinder → two rims + one line per segment; cap fans vanish', () => {
    const r = prim('cylinder', { radius: 0.5, height: 1, segments: 32 })
    const w = r.wire!
    let rims = 0, verticals = 0
    for (let i = 0; i < w.length; i += 6) {
      if (Math.abs(w[i + 2]! - w[i + 5]!) < 1e-6) rims++
      else verticals++
    }
    expect(rims).toBe(2 * verticals)
    expect(verticals).toBeGreaterThanOrEqual(24)
    // no segment touches the cap centers (fan interiors dropped)
    for (let i = 0; i < w.length; i += 6) {
      expect(Math.hypot(w[i]!, w[i + 1]!)).toBeGreaterThan(0.4)
      expect(Math.hypot(w[i + 3]!, w[i + 4]!)).toBeGreaterThan(0.4)
    }
  })

  it('flat L-shaped polygon → only its outline', () => {
    const mb = new MeshBuilder()
    const outer: Vec3[] = [[0, 0, 0], [2, 0, 0], [2, 1, 0], [1, 1, 0], [1, 2, 0], [0, 2, 0]]
    mb.face(outer, [], [0, 0, 1])
    const mesh = mb.build()
    expect(mesh.indices!.length / 3).toBe(4) // triangulated with interior edges
    const w = computeCleanWireframe(mesh)
    expect(w.length / 6).toBe(6)
    const keys = segKeys(w)
    for (let i = 0; i < outer.length; i++) {
      const a = outer[i]!, b = outer[(i + 1) % outer.length]!
      const k = (p: Vec3) => `${p[0].toFixed(5)},${p[1].toFixed(5)},${p[2].toFixed(5)}`
      const ka = k(a), kb = k(b)
      expect(keys.has(ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`)).toBe(true)
    }
  })

  it('welds normal/UV-split vertices and keeps creases', () => {
    // two quads meeting at 90° with duplicated vertices along the shared edge
    const mb = new MeshBuilder()
    mb.quadFace([0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0])
    mb.quadFace([0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1])
    const w = computeCleanWireframe(mb.build())
    expect(segKeys(w).size).toBe(7) // 4 + 4 − shared edge counted once
  })

  it('terrain emits grid lines instead of triangle diagonals', () => {
    const r = evaluateTerrain(makeNode({ type: 'terrain', params: { width: 2, depth: 2, resolution: 3, heights: [0, 0.1, 0, 0.2, 0.3, 0.1, 0, 0.1, 0] } }))
    expect(r.wire!.length / 6).toBe(12) // 3 rows × 2 + 3 columns × 2
    for (let i = 0; i < r.wire!.length; i += 6) {
      const dx = Math.abs(r.wire![i]! - r.wire![i + 3]!), dy = Math.abs(r.wire![i + 1]! - r.wire![i + 4]!)
      expect(Math.min(dx, dy)).toBeLessThan(1e-6) // axis-aligned in plan
    }
  })
})

describe('latticeWire', () => {
  it('wraps rings and rows on demand', () => {
    const rows: Vec3[][] = [
      [[0, 0, 0], [1, 0, 0], [1, 1, 0]],
      [[0, 0, 1], [1, 0, 1], [1, 1, 1]],
    ]
    expect(latticeWire(rows, false, false).length / 6).toBe(2 * 2 + 3)
    expect(latticeWire(rows, true, false).length / 6).toBe(2 * 3 + 3)
    expect(latticeWire(rows, true, true).length / 6).toBe(2 * 3 + 6)
  })
})
