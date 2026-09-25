import { makeNode, type PrimitiveShape } from '@cadsandbox/doc'
import { describe, expect, it } from 'vitest'
import { isClosedManifold, mergeVertices, meshVolume } from '../core/mesh'
import { evaluatePrimitive } from './primitive'
import { evaluateShape } from './shape'

const prim = (shape: PrimitiveShape, params: Record<string, unknown> = {}) =>
  evaluatePrimitive(makeNode({ type: 'primitive', params: { shape, ...params } }))

describe('primitives', () => {
  const closed: PrimitiveShape[] = ['box', 'sphere', 'cylinder', 'cone', 'torus', 'capsule', 'pyramid', 'wedge', 'tube', 'icosphere', 'prism']
  for (const shape of closed) {
    it(`${shape} is a closed manifold with sane bounds`, () => {
      const r = prim(shape, { width: 1, depth: 1, height: 1, radius: 0.5, radius2: 0.2 })
      expect(r.error).toBeUndefined()
      const mesh = r.parts[0]!.mesh
      const welded = mergeVertices(mesh)
      expect(isClosedManifold(welded)).toBe(true)
      expect(meshVolume(welded)).toBeGreaterThan(0)
      expect(r.bounds.min[2]).toBeCloseTo(0, 5)
      expect(r.bounds.max[2]).toBeGreaterThan(0.1)
      expect(r.edges === undefined || r.edges.length % 6 === 0).toBe(true)
    })
  }

  it('box has exact bounds and volume', () => {
    const r = prim('box', { width: 2, depth: 1, height: 0.5 })
    expect(r.bounds.min).toEqual([-1, -0.5, 0])
    expect(r.bounds.max).toEqual([1, 0.5, 0.5])
    expect(r.quantities?.volume).toBeCloseTo(1, 6)
    expect(r.edges!.length / 6).toBe(12)
  })

  it('rounded box stays manifold and shrinks volume', () => {
    const r = prim('box', { width: 1, depth: 1, height: 1, cornerRadius: 0.2 })
    const welded = mergeVertices(r.parts[0]!.mesh)
    expect(isClosedManifold(welded)).toBe(true)
    const v = meshVolume(welded)
    expect(v).toBeLessThan(1)
    expect(v).toBeGreaterThan(0.9)
    expect(r.bounds.max[0]).toBeCloseTo(0.5, 6)
    expect(r.bounds.max[2]).toBeCloseTo(1, 6)
  })

  it('partial cylinder sweep is closed', () => {
    const r = prim('cylinder', { radius: 0.5, height: 1, sweep: Math.PI / 2 })
    const welded = mergeVertices(r.parts[0]!.mesh)
    expect(isClosedManifold(welded)).toBe(true)
    expect(meshVolume(welded)).toBeCloseTo((Math.PI * 0.25) / 4, 2)
  })

  it('sphere volume approximates 4/3 π r³', () => {
    const r = prim('sphere', { radius: 0.5, segments: 64 })
    expect(r.quantities!.volume).toBeCloseTo((4 / 3) * Math.PI * 0.125, 2)
    expect(r.bounds.max[2]).toBeCloseTo(1, 6)
  })
})

describe('shapes', () => {
  it('extruded star with bevel is manifold', () => {
    const r = evaluateShape(makeNode({ type: 'shape', params: { profile: 'star', width: 1, height: 1, depth: 0.3, bevel: 0.05, bevelSegments: 4 } }))
    const welded = mergeVertices(r.parts[0]!.mesh)
    expect(isClosedManifold(welded)).toBe(true)
    expect(r.bounds.max[2]).toBeCloseTo(0.3, 6)
    expect(r.quantities!.volume).toBeGreaterThan(0)
  })
  it('ring profile has a hole and flat depth yields a face', () => {
    const r = evaluateShape(makeNode({ type: 'shape', params: { profile: 'ring', width: 1, height: 1, innerRatio: 0.5, depth: 0 } }))
    expect(r.quantities!.area).toBeCloseTo(Math.PI * 0.25 * (1 - 0.25), 1)
    expect(r.bounds.max[2]).toBe(0)
  })
  it('rounded rect extrusion respects direction', () => {
    const r = evaluateShape(makeNode({ type: 'shape', params: { profile: 'rect', width: 1, height: 0.5, cornerRadius: 0.1, depth: 0.2, direction: 'symmetric', bevel: 0 } }))
    expect(r.bounds.min[2]).toBeCloseTo(-0.1, 6)
    expect(r.bounds.max[2]).toBeCloseTo(0.1, 6)
    expect(isClosedManifold(mergeVertices(r.parts[0]!.mesh))).toBe(true)
  })
})
