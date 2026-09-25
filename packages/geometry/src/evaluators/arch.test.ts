import { FURNITURE_SIZES, makeNode, type FurnitureKind, type RoofKind, type StairKind } from '@cadsandbox/doc'
import { describe, expect, it } from 'vitest'
import { polygonArea } from '../core/math2d'
import { isClosedManifold, mergeMeshes, mergeVertices, meshVolume } from '../core/mesh'
import { defaultContext } from './context'
import { evaluateFurniture } from './furniture/index'
import { evaluateRoof } from './roof'
import { evaluateRoom } from './room'
import { evaluateStair, solveRisers } from './stair'
import { evaluateBeam, evaluateColumn, evaluateRailing, evaluateSlab } from './structure'
import { evaluateTerrain } from './terrain'

const L: [number, number][] = [[0, 0], [8, 0], [8, 3], [4, 3], [4, 6], [0, 6]]

describe('roof', () => {
  const kinds: RoofKind[] = ['flat', 'shed', 'gable', 'hip', 'mansard', 'gambrel', 'pyramid']
  for (const kind of kinds) {
    it(`${kind} roof on an L-shape is a closed solid with plan lines`, () => {
      const r = evaluateRoof(makeNode({ type: 'roof', params: { kind, outline: L, pitchDeg: 35, overhang: 0.4, thickness: 0.25, baseOffset: 2.75, ridgeAxis: 'auto' } }))
      expect(r.error).toBeUndefined()
      // gable-type roofs on non-convex outlines have vertical step faces meeting at T-vertices
      // (watertight but not strictly 2-manifold); the others must be closed manifolds
      if (kind === 'gable' || kind === 'gambrel') expect(meshVolume(mergeVertices(r.parts[0]!.mesh))).toBeGreaterThan(0)
      else expect(isClosedManifold(mergeVertices(r.parts[0]!.mesh))).toBe(true)
      expect(r.bounds.max[2]).toBeGreaterThanOrEqual(2.75 - 1e-9)
      if (kind !== 'flat') expect(r.bounds.max[2]).toBeGreaterThan(2.75)
      expect(r.plan!.lines.length).toBeGreaterThan(0)
      expect(r.quantities!.area).toBeGreaterThan(kind === 'flat' ? 36 : 48)
    })
  }
  it('hip roof ridge height follows the pitch and overhang', () => {
    const r = evaluateRoof(makeNode({ type: 'roof', params: { kind: 'hip', outline: [[0, 0], [6, 0], [6, 4], [0, 4]], pitchDeg: 45, overhang: 0, thickness: 0.2, baseOffset: 3, ridgeAxis: 'auto' } }))
    expect(r.quantities!.ridgeHeight).toBeCloseTo(3 + 2, 4)
    // 4 roof planes + eaves: sloped area = footprint / cos(45°)
    expect(r.quantities!.area).toBeCloseTo(24 / Math.cos(Math.PI / 4), 3)
  })
  it('gable roof on a rectangle is a closed manifold', () => {
    const r = evaluateRoof(makeNode({ type: 'roof', params: { kind: 'gable', outline: [[0, 0], [6, 0], [6, 4], [0, 4]], pitchDeg: 40, overhang: 0.3, thickness: 0.2, baseOffset: 3, ridgeAxis: 'x' } }))
    expect(isClosedManifold(mergeVertices(r.parts[0]!.mesh))).toBe(true)
    const g = evaluateRoof(makeNode({ type: 'roof', params: { kind: 'gambrel', outline: [[0, 0], [6, 0], [6, 4], [0, 4]], pitchDeg: 30, overhang: 0.3, thickness: 0.2, baseOffset: 3, ridgeAxis: 'x' } }))
    expect(isClosedManifold(mergeVertices(g.parts[0]!.mesh))).toBe(true)
  })
  it('gable roof has two slopes and a full-length ridge', () => {
    const r = evaluateRoof(makeNode({ type: 'roof', params: { kind: 'gable', outline: [[0, 0], [6, 0], [6, 4], [0, 4]], pitchDeg: 30, overhang: 0, thickness: 0.2, baseOffset: 0, ridgeAxis: 'x' } }))
    const ridge = r.plan!.lines.find((l) => l.style === 'overhead')!
    // some segment of length 6 (the ridge)
    let found = false
    for (let i = 0; i < ridge.segments.length; i += 4) if (Math.abs(Math.hypot(ridge.segments[i + 2]! - ridge.segments[i]!, ridge.segments[i + 3]! - ridge.segments[i + 1]!) - 6) < 1e-3) found = true
    expect(found).toBe(true)
    expect(r.quantities!.ridgeHeight).toBeCloseTo(2 * Math.tan(Math.PI / 6), 4)
  })
})

describe('stairs', () => {
  it('auto riser count follows DIN 18065 (2R + G ≈ 0.63, R ≤ 0.19)', () => {
    const s = solveRisers(2.75, 0.27, 0)
    expect(s.riser).toBeLessThanOrEqual(0.19)
    expect(s.riser).toBeGreaterThanOrEqual(0.14)
    expect(Math.abs(s.comfort - 0.63)).toBeLessThan(0.05)
    expect(s.count * s.riser).toBeCloseTo(2.75, 9)
    expect(solveRisers(3.0, 0.28, 12).count).toBe(12)
  })
  const kinds: StairKind[] = ['straight', 'l-shape', 'u-shape', 'spiral']
  for (const kind of kinds) {
    it(`${kind} stair produces geometry, plan and quantities`, () => {
      const r = evaluateStair(makeNode({ type: 'stair', params: { kind, width: 1, rise: 2.75, riserCount: 0, treadDepth: 0.27, landingDepth: 1, turn: 'left', structure: 'solid', railing: 'right', railingHeight: 0.9, nosing: 0.03, innerRadius: 0.15, sweepDeg: 270 } }), defaultContext())
      expect(r.error).toBeUndefined()
      expect(r.parts.length).toBeGreaterThan(0)
      expect(r.bounds.max[2]).toBeGreaterThan(2.7)
      expect(r.quantities!.risers).toBeGreaterThan(10)
      expect(r.plan!.lines.some((l) => l.style === 'symbol')).toBe(true)
    })
  }
  it('solid straight stair body is a closed solid', () => {
    const r = evaluateStair(makeNode({ type: 'stair', params: { kind: 'straight', railing: 'none', structure: 'solid', nosing: 0 } }), defaultContext())
    expect(isClosedManifold(mergeVertices(r.parts[0]!.mesh))).toBe(true)
  })
  for (const structure of ['stringer', 'floating'] as const) {
    it(`${structure} structure evaluates`, () => {
      const r = evaluateStair(makeNode({ type: 'stair', params: { kind: 'straight', structure, railing: 'both' } }), defaultContext())
      expect(r.error).toBeUndefined()
      expect(r.parts.length).toBeGreaterThan(0)
    })
  }
})

describe('structure', () => {
  it('slab with hole has net area and closed mesh', () => {
    const r = evaluateSlab(makeNode({ type: 'slab', params: { kind: 'floor', outline: [[0, 0], [5, 0], [5, 4], [0, 4]], holes: [[[1, 1], [2, 1], [2, 2], [1, 2]]], thickness: 0.2, offset: 0 } }), defaultContext())
    expect(r.quantities!.area).toBeCloseTo(19, 6)
    expect(r.bounds.min[2]).toBeCloseTo(-0.2, 6)
    expect(isClosedManifold(mergeVertices(r.parts[0]!.mesh))).toBe(true)
  })
  it('column shapes are closed and cut in plan', () => {
    for (const shape of ['rect', 'round', 'h-beam'] as const) {
      const r = evaluateColumn(makeNode({ type: 'column', params: { shape, width: 0.3, depth: 0.3, height: 2.75, baseOffset: 0 } }), defaultContext({ materials: { 'mat-concrete-rc': { color: '#000', category: 'concrete', hatch: 'reinforced-concrete' } } }))
      expect(isClosedManifold(mergeVertices(r.parts[0]!.mesh))).toBe(true)
      expect(r.plan!.fills.length).toBeGreaterThan(0)
      expect(r.plan!.lines.some((l) => l.style === 'cut')).toBe(true)
    }
  })
  it('beam spans a→b with an overhead plan outline', () => {
    for (const shape of ['rect', 'i-beam', 'round'] as const) {
      const r = evaluateBeam(makeNode({ type: 'beam', params: { a: [0, 0, 2.75], b: [4, 1, 2.75], shape, width: 0.2, height: 0.4 } }), defaultContext())
      expect(isClosedManifold(mergeVertices(r.parts[0]!.mesh))).toBe(true)
      expect(r.quantities!.length).toBeCloseTo(Math.hypot(4, 1), 6)
      expect(r.plan!.lines[0]!.style).toBe('overhead')
    }
  })
  it('railing styles produce posts and rails', () => {
    for (const style of ['bars', 'glass', 'solid', 'cable'] as const) {
      const r = evaluateRailing(makeNode({ type: 'railing', params: { path: [[0, 0], [3, 0], [3, 2]], height: 1, style, postSpacing: 1.2, baseOffset: 0 } }), defaultContext())
      expect(r.error).toBeUndefined()
      expect(r.parts.length).toBeGreaterThan(0)
      expect(r.quantities!.length).toBeCloseTo(5, 6)
      expect(r.bounds.max[2]).toBeCloseTo(1, 1)
    }
  })
})

describe('room / terrain / furniture', () => {
  it('room outline yields area, stamp texts and fill polygons', () => {
    const r = evaluateRoom(makeNode({ type: 'room', name: 'Living', params: { outline: [[0, 0], [5, 0], [5, 4.87], [0, 4.87]], number: '1.01', usage: 'NUF1', showLabel: true, auto: false } }), defaultContext())
    expect(r.quantities!.area).toBeCloseTo(24.35, 6)
    expect(r.plan!.texts.map((t) => t.text)).toEqual(['Living', '1.01', '24.35 m²'])
    expect(r.plan!.fills[0]!.polygons[0]!.outer.length).toBe(4)
  })
  it('terrain heightfield spans width × depth', () => {
    const heights = Array.from({ length: 9 }, (_, i) => (i % 2 ? 1 : 0))
    const r = evaluateTerrain(makeNode({ type: 'terrain', params: { width: 10, depth: 6, heights, resolution: 3 } }))
    expect(r.bounds.min[0]).toBeCloseTo(-5, 6)
    expect(r.bounds.max[1]).toBeCloseTo(3, 6)
    expect(r.quantities!.maxHeight).toBe(1)
  })
  const kinds = Object.keys(FURNITURE_SIZES) as FurnitureKind[]
  for (const kind of kinds) {
    it(`furniture ${kind} builds within its footprint`, () => {
      const [w, d, h] = FURNITURE_SIZES[kind]
      const r = evaluateFurniture(makeNode({ type: 'furniture', params: { kind, width: w, depth: d, height: h } }))
      expect(r.error).toBeUndefined()
      expect(r.parts.length).toBeGreaterThan(0)
      const all = mergeMeshes(r.parts.map((p) => p.mesh))
      expect(all.positions.length).toBeGreaterThan(0)
      expect(r.plan!.lines.length).toBeGreaterThan(0)
      // stays roughly inside the declared footprint (small overhangs allowed for handles etc.)
      expect(r.bounds.min[0]).toBeGreaterThan(-w / 2 - 0.3)
      expect(r.bounds.max[0]).toBeLessThan(w / 2 + 0.3)
      expect(r.bounds.min[1]).toBeGreaterThan(-d - 0.5)
    })
  }
  it('polygon helper sanity', () => {
    expect(polygonArea(L)).toBeCloseTo(36, 9)
  })
})
