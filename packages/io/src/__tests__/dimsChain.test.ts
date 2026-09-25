import { describe, expect, it } from 'vitest'
import { chainDimGeometry } from '../export/dimsChain'

const fmt = (m: number) => `${Math.round(m * 1000)}`

describe('chainDimGeometry', () => {
  it('splits a chain into one dimension per interval on a shared line', () => {
    const geoms = chainDimGeometry([[0, 0], [4, 0.2], [1.5, -0.1]], -1, 'x', fmt, 0.2)
    expect(geoms).toHaveLength(2)
    expect(geoms.map((g) => g.measured)).toEqual([1.5, 2.5])
    expect(geoms.map((g) => g.kind)).toEqual(['linear', 'linear'])
  })
  it('needs at least two distinct stations', () => {
    expect(chainDimGeometry([[0, 0]], 1, undefined, fmt, 0.2)).toEqual([])
    expect(chainDimGeometry([[0, 0], [0, 0]], 1, undefined, fmt, 0.2)).toEqual([])
  })
})
