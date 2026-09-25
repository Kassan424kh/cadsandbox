import { describe, expect, it } from 'vitest'
import { SpatialHash } from '../src/snapping/spatialHash'

describe('SpatialHash', () => {
  it('stores, queries and replaces points per node', () => {
    const h = new SpatialHash(0.5)
    h.set('a', [
      { p: [0, 0, 0], kind: 'endpoint', nodeId: 'a' },
      { p: [1, 0, 0], kind: 'endpoint', nodeId: 'a' },
      { p: [0.5, 0, 0], kind: 'midpoint', nodeId: 'a' },
    ])
    h.set('b', [{ p: [0.1, 0.1, 0], kind: 'center', nodeId: 'b' }])
    expect(h.size).toBe(4)
    const near = h.query([0, 0, 0], 0.2)
    expect(near.map((p) => p.nodeId).sort()).toEqual(['a', 'b'])
    expect(h.query([0, 0, 0], 0.2, new Set(['b'])).length).toBe(1)
    expect(h.query([10, 10, 10], 0.5).length).toBe(0)
    h.set('a', [{ p: [5, 5, 5], kind: 'endpoint', nodeId: 'a' }])
    expect(h.size).toBe(2)
    expect(h.query([0.5, 0, 0], 0.1).length).toBe(0)
    h.remove('b')
    expect(h.size).toBe(1)
    expect(h.has('b')).toBe(false)
  })

  it('handles cell boundaries and negative coordinates', () => {
    const h = new SpatialHash(1)
    h.set('n', [{ p: [-0.001, -0.001, 0], kind: 'vertex', nodeId: 'n' }])
    expect(h.query([0.001, 0.001, 0], 0.01).length).toBe(1)
  })
})
