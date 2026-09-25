import { describe, expect, it } from 'vitest'
import { fbm, generateProcedural, normalFromHeight, proceduralKey, valueNoise, worley } from '../src/materials/proceduralCore'
import type { ProceduralTextureKind } from '@cadsandbox/doc'

const KINDS: ProceduralTextureKind[] = ['wood', 'parquet', 'brick', 'concrete', 'tiles', 'marble', 'stone', 'plaster', 'fabric', 'metal-brushed', 'grass', 'gravel', 'noise', 'checker']

describe('procedural textures', () => {
  it('value noise tiles seamlessly and is deterministic', () => {
    expect(valueNoise(0.3, 0.7, 8, 1)).toBeCloseTo(valueNoise(8.3, 8.7, 8, 1), 9)
    expect(fbm(0.2, 0.4, 4, 4, 3)).toBe(fbm(0.2, 0.4, 4, 4, 3))
    expect(fbm(0.2, 0.4, 4, 4, 3)).not.toBe(fbm(0.2, 0.4, 4, 4, 4))
    const w = worley(0.1, 0.1, 8, 2)
    expect(w.f1).toBeLessThanOrEqual(w.f2)
  })

  it('generates every kind with valid maps at small sizes', () => {
    for (const kind of KINDS) {
      const px = generateProcedural({ kind, seed: 1, size: 16, params: {} })
      expect(px.color.length).toBe(16 * 16 * 4)
      expect(px.normal.length).toBe(16 * 16 * 4)
      expect(px.roughness.length).toBe(16 * 16 * 4)
      // alpha opaque, normals mostly pointing +Z
      expect(px.color[3]).toBe(255)
      let zSum = 0
      for (let i = 0; i < 16 * 16; i++) zSum += px.normal[i * 4 + 2]!
      expect(zSum / (16 * 16)).toBeGreaterThan(150)
    }
  })

  it('tiles seamlessly across the texture border', () => {
    const size = 32
    const px = generateProcedural({ kind: 'concrete', seed: 5, size, params: {} })
    // compare the last column with the first: difference should be small relative to random pairs
    let border = 0
    let random = 0
    for (let y = 0; y < size; y++) {
      const a = (y * size + 0) * 4
      const b = (y * size + size - 1) * 4
      border += Math.abs(px.color[a]! - px.color[b]!)
      const c = (y * size + (size >> 1)) * 4
      random += Math.abs(px.color[a]! - px.color[c]!)
    }
    expect(border).toBeLessThanOrEqual(random + size * 6)
  })

  it('derives flat normals from flat height and cache keys from params', () => {
    const flat = normalFromHeight(new Float32Array(16).fill(0.5), 4, 1)
    expect(flat[0]).toBe(128)
    expect(flat[2]).toBe(255)
    expect(proceduralKey('wood', 0, { dark: 1 }, 512)).toBe(proceduralKey('wood', 0, { dark: 1 }, 512))
    expect(proceduralKey('wood', 0, { dark: 1 }, 512)).not.toBe(proceduralKey('wood', 1, { dark: 1 }, 512))
    expect(proceduralKey('brick', 0, { a: 1, b: 'x' }, 512)).toBe(proceduralKey('brick', 0, { b: 'x', a: 1 }, 512))
  })
})
