// Deterministic, seamless procedural texture synthesis for every ProceduralTextureKind.
// Pure TypeScript (no DOM) so it runs identically in a worker or on the main thread.
// Output: sRGB color RGBA8, tangent-space normal RGBA8 (from a height field) and roughness RGBA8.
import type { ProceduralTextureKind } from '@cadsandbox/doc'

export interface ProceduralParams {
  kind: ProceduralTextureKind
  seed: number
  size: number
  params: Record<string, number | string>
}

export interface ProceduralPixels {
  size: number
  color: Uint8ClampedArray
  normal: Uint8ClampedArray
  roughness: Uint8ClampedArray
  /** Base roughness multiplier applied by the material (0..1) */
  roughnessScale: number
}

// ------------------------------------------------------------------ noise
function hash2(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 982451653) | 0
  h = (h ^ (h >>> 13)) * 1274126177
  h = h ^ (h >>> 16)
  return (h >>> 0) / 4294967296
}

const smooth = (t: number) => t * t * (3 - 2 * t)

/** Tileable value noise with integer period (samples wrap). x,y in lattice units. */
export function valueNoise(x: number, y: number, period: number, seed: number): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = smooth(x - x0)
  const fy = smooth(y - y0)
  const p = Math.max(1, period)
  const ix0 = ((x0 % p) + p) % p
  const iy0 = ((y0 % p) + p) % p
  const ix1 = (ix0 + 1) % p
  const iy1 = (iy0 + 1) % p
  const a = hash2(ix0, iy0, seed)
  const b = hash2(ix1, iy0, seed)
  const c = hash2(ix0, iy1, seed)
  const d = hash2(ix1, iy1, seed)
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
}

/** Fractal noise in [0,1], u,v ∈ [0,1) tileable. */
export function fbm(u: number, v: number, octaves: number, baseFreq: number, seed: number, gain = 0.5, lacunarity = 2): number {
  let amp = 1
  let sum = 0
  let norm = 0
  let freq = baseFreq
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(u * freq, v * freq, freq, seed + i * 17) * amp
    norm += amp
    amp *= gain
    freq *= lacunarity
  }
  return sum / norm
}

/** Tileable cellular (Worley) noise: returns distance to nearest feature point and cell id. */
export function worley(u: number, v: number, cells: number, seed: number): { f1: number; f2: number; id: number } {
  const x = u * cells
  const y = v * cells
  const cx = Math.floor(x)
  const cy = Math.floor(y)
  let f1 = Infinity
  let f2 = Infinity
  let id = 0
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const gx = cx + i
      const gy = cy + j
      const wx = ((gx % cells) + cells) % cells
      const wy = ((gy % cells) + cells) % cells
      const px = gx + hash2(wx, wy, seed)
      const py = gy + hash2(wx, wy, seed + 101)
      const d = (px - x) * (px - x) + (py - y) * (py - y)
      if (d < f1) {
        f2 = f1
        f1 = d
        id = wx * 7919 + wy
      } else if (d < f2) f2 = d
    }
  }
  return { f1: Math.sqrt(f1), f2: Math.sqrt(f2), id }
}

// ------------------------------------------------------------------ color helpers
type RGB = [number, number, number]

export function parseHex(c: string | number | undefined, fallback: RGB): RGB {
  if (typeof c === 'number') return [(c >> 16) & 255, (c >> 8) & 255, c & 255]
  if (!c || typeof c !== 'string') return fallback
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim())
  if (!m) return fallback
  const v = parseInt(m[1]!, 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const scale = (a: RGB, s: number): RGB => [a[0] * s, a[1] * s, a[2] * s]
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

// ------------------------------------------------------------------ generators
interface Field {
  color: (u: number, v: number) => RGB
  height: (u: number, v: number) => number
  roughness?: (u: number, v: number) => number
  normalStrength: number
  roughnessScale: number
}

function num(p: Record<string, number | string>, key: string, def: number): number {
  const v = p[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : def
}

function planks(u: number, v: number, cols: number, rows: number, seed: number, offsetRows: boolean): { id: number; lu: number; lv: number; gap: number } {
  const y = v * rows
  const row = Math.floor(y)
  const shift = offsetRows ? hash2(row, 0, seed) : 0
  const x = u * cols + shift
  const col = Math.floor(x)
  const lu = x - col
  const lv = y - row
  const gapW = 0.02
  const gap = Math.min(lu, 1 - lu, (lv * cols) / rows, ((1 - lv) * cols) / rows) < gapW ? 1 : 0
  return { id: (((col % cols) + cols) % cols) * 131 + ((row % rows) + rows) % rows, lu, lv, gap }
}

function makeField(kind: ProceduralTextureKind, seed: number, p: Record<string, number | string>): Field {
  const dark = num(p, 'dark', 0) > 0
  switch (kind) {
    case 'wood': {
      const base: RGB = parseHex(p.color as string, dark ? [90, 62, 42] : [181, 138, 90])
      const grainCol = scale(base, 0.62)
      const grain = (u: number, v: number) => {
        const warp = fbm(u, v, 3, 4, seed) * 0.35
        const rings = Math.abs(Math.sin((v * 2 + warp + fbm(u * 0.5, v, 2, 3, seed + 5) * 0.6) * Math.PI * 9))
        const fine = fbm(u, v * 40, 3, 32, seed + 9)
        return clamp01(rings * 0.7 + fine * 0.3)
      }
      return {
        color: (u, v) => mix(base, grainCol, Math.pow(grain(u, v), 1.6) * 0.9),
        height: (u, v) => grain(u, v),
        roughness: (u, v) => 0.45 + grain(u, v) * 0.35,
        normalStrength: 0.35,
        roughnessScale: 1,
      }
    }
    case 'parquet': {
      const base: RGB = parseHex(p.color as string, [192, 148, 102])
      const cols = 2,
        rows = 8
      return {
        color: (u, v) => {
          const pl = planks(u, v, cols, rows, seed, true)
          if (pl.gap) return scale(base, 0.35)
          const shade = 0.78 + hash2(pl.id, 3, seed) * 0.4
          const g = fbm(pl.lu * 0.25 + hash2(pl.id, 7, seed), v * 6, 3, 24, seed + pl.id) * 0.25
          return scale(base, shade - g)
        },
        height: (u, v) => {
          const pl = planks(u, v, cols, rows, seed, true)
          return pl.gap ? 0 : 0.85 + hash2(pl.id, 5, seed) * 0.15
        },
        roughness: (u, v) => (planks(u, v, cols, rows, seed, true).gap ? 0.9 : 0.4),
        normalStrength: 0.9,
        roughnessScale: 1,
      }
    }
    case 'brick': {
      const brick: RGB = parseHex(p.color as string, [154, 74, 54])
      const mortar: RGB = parseHex(p.mortar as string, [190, 182, 170])
      const cols = 4,
        rows = 8
      const cell = (u: number, v: number) => {
        const y = v * rows
        const row = Math.floor(y)
        const x = u * cols + (row % 2 ? 0.5 : 0)
        const col = Math.floor(x)
        const lu = x - col
        const lv = y - row
        const mx = 0.045,
          my = 0.09
        const isMortar = lu < mx || lu > 1 - mx || lv < my || lv > 1 - my
        return { id: ((col % cols) + cols) % cols + row * 17, lu, lv, isMortar }
      }
      return {
        color: (u, v) => {
          const c = cell(u, v)
          if (c.isMortar) return scale(mortar, 0.9 + fbm(u, v, 3, 32, seed) * 0.2)
          const var1 = 0.75 + hash2(c.id, 11, seed) * 0.45
          const speck = fbm(u, v, 3, 64, seed + 3) * 0.2
          return scale(brick, var1 - speck)
        },
        height: (u, v) => {
          const c = cell(u, v)
          return c.isMortar ? 0.1 : 0.7 + fbm(u, v, 2, 48, seed) * 0.3
        },
        roughness: (u, v) => (cell(u, v).isMortar ? 0.95 : 0.8),
        normalStrength: 1.2,
        roughnessScale: 1,
      }
    }
    case 'concrete': {
      const base: RGB = parseHex(p.color as string, [168, 162, 158])
      return {
        color: (u, v) => {
          const m = fbm(u, v, 5, 4, seed)
          const pores = worley(u, v, 48, seed + 4)
          const pore = pores.f1 < 0.12 ? 1 - pores.f1 / 0.12 : 0
          return scale(base, 0.85 + m * 0.3 - pore * 0.3)
        },
        height: (u, v) => {
          const pores = worley(u, v, 48, seed + 4)
          const pore = pores.f1 < 0.12 ? 1 - pores.f1 / 0.12 : 0
          return 0.9 - pore * 0.6 + fbm(u, v, 3, 64, seed) * 0.1
        },
        roughness: (u, v) => 0.75 + fbm(u, v, 3, 16, seed + 8) * 0.2,
        normalStrength: 0.6,
        roughnessScale: 1,
      }
    }
    case 'tiles': {
      const tile: RGB = parseHex(p.color as string, [248, 250, 252])
      const grout: RGB = parseHex(p.grout as string, [176, 172, 168])
      const n = Math.max(1, Math.round(num(p, 'count', 4)))
      const cell = (u: number, v: number) => {
        const x = u * n,
          y = v * n
        const lu = x - Math.floor(x),
          lv = y - Math.floor(y)
        const g = 0.035
        return { id: Math.floor(x) + Math.floor(y) * 31, isGrout: lu < g || lu > 1 - g || lv < g || lv > 1 - g, lu, lv }
      }
      return {
        color: (u, v) => {
          const c = cell(u, v)
          if (c.isGrout) return grout
          return scale(tile, 0.93 + hash2(c.id, 2, seed) * 0.07 + fbm(u, v, 3, 24, seed) * 0.04)
        },
        height: (u, v) => (cell(u, v).isGrout ? 0.2 : 1),
        roughness: (u, v) => (cell(u, v).isGrout ? 0.95 : 0.2),
        normalStrength: 0.8,
        roughnessScale: 1,
      }
    }
    case 'marble': {
      const base: RGB = parseHex(p.color as string, [238, 236, 232])
      const vein: RGB = parseHex(p.vein as string, [120, 118, 122])
      const veins = (u: number, v: number) => {
        const w = fbm(u, v, 5, 3, seed) * 6
        const s = Math.abs(Math.sin((u * 3 + v * 1.5 + w) * Math.PI))
        return Math.pow(1 - s, 8) * (0.6 + fbm(u, v, 3, 12, seed + 2) * 0.4)
      }
      return {
        color: (u, v) => mix(base, vein, clamp01(veins(u, v) * 0.9 + fbm(u, v, 4, 8, seed + 6) * 0.08)),
        height: (u, v) => 1 - veins(u, v) * 0.15,
        roughness: (u, v) => 0.12 + veins(u, v) * 0.2,
        normalStrength: 0.15,
        roughnessScale: 1,
      }
    }
    case 'stone': {
      const base: RGB = parseHex(p.color as string, dark ? [63, 63, 70] : [163, 158, 147])
      const joint = scale(base, 0.5)
      return {
        color: (u, v) => {
          const w = worley(u, v, 6, seed)
          const edge = w.f2 - w.f1
          const shade = 0.75 + hash2(w.id, 1, seed) * 0.4
          const grain = fbm(u, v, 4, 24, seed + w.id) * 0.2
          if (edge < 0.06) return mix(joint, base, edge / 0.06)
          return scale(base, shade - grain)
        },
        height: (u, v) => {
          const w = worley(u, v, 6, seed)
          const edge = w.f2 - w.f1
          return Math.min(1, edge / 0.12) * 0.8 + 0.2 - fbm(u, v, 3, 32, seed) * 0.1
        },
        roughness: () => 0.8,
        normalStrength: 1.1,
        roughnessScale: 1,
      }
    }
    case 'plaster': {
      const base: RGB = parseHex(p.color as string, [239, 236, 230])
      return {
        color: (u, v) => scale(base, 0.96 + fbm(u, v, 4, 8, seed) * 0.06),
        height: (u, v) => 0.5 + fbm(u, v, 4, 24, seed + 1) * 0.5,
        roughness: (u, v) => 0.85 + fbm(u, v, 2, 8, seed) * 0.1,
        normalStrength: 0.3,
        roughnessScale: 1,
      }
    }
    case 'fabric': {
      const base: RGB = parseHex(p.color as string, [139, 143, 150])
      const threads = 48
      const weave = (u: number, v: number) => {
        const a = Math.sin(u * threads * Math.PI * 2)
        const b = Math.sin(v * threads * Math.PI * 2)
        const over = Math.floor(u * threads) + Math.floor(v * threads)
        const w = over % 2 === 0 ? a : b
        return 0.5 + 0.5 * w
      }
      return {
        color: (u, v) => scale(base, 0.8 + weave(u, v) * 0.3 + fbm(u, v, 3, 6, seed) * 0.08),
        height: (u, v) => weave(u, v),
        roughness: () => 0.95,
        normalStrength: 0.5,
        roughnessScale: 1,
      }
    }
    case 'metal-brushed': {
      const base: RGB = parseHex(p.color as string, [180, 180, 188])
      const streak = (u: number, v: number) => fbm(u * 0.02, v, 4, 256, seed) * 0.7 + fbm(u, v, 2, 4, seed + 3) * 0.3
      return {
        color: (u, v) => scale(base, 0.85 + streak(u, v) * 0.3),
        height: (u, v) => streak(u, v),
        roughness: (u, v) => 0.25 + streak(u, v) * 0.25,
        normalStrength: 0.25,
        roughnessScale: 1,
      }
    }
    case 'grass': {
      const base: RGB = parseHex(p.color as string, [77, 124, 50])
      const dry: RGB = [138, 140, 60]
      return {
        color: (u, v) => {
          const blades = fbm(u, v, 5, 32, seed) * 0.6 + fbm(u, v, 2, 128, seed + 7) * 0.4
          const patch = fbm(u, v, 3, 3, seed + 11)
          return scale(mix(base, dry, patch * 0.35), 0.6 + blades * 0.7)
        },
        height: (u, v) => fbm(u, v, 4, 64, seed),
        roughness: () => 1,
        normalStrength: 0.6,
        roughnessScale: 1,
      }
    }
    case 'gravel': {
      const base: RGB = parseHex(p.color as string, [155, 149, 139])
      return {
        color: (u, v) => {
          const w = worley(u, v, 24, seed)
          const shade = 0.7 + hash2(w.id, 1, seed) * 0.5
          const dome = clamp01(1 - w.f1 / 0.55)
          return scale(base, shade * (0.75 + dome * 0.35))
        },
        height: (u, v) => {
          const w = worley(u, v, 24, seed)
          return Math.sqrt(clamp01(1 - w.f1 / 0.6))
        },
        roughness: () => 0.9,
        normalStrength: 1.3,
        roughnessScale: 1,
      }
    }
    case 'noise': {
      const base: RGB = parseHex(p.color as string, [200, 200, 200])
      return {
        color: (u, v) => scale(base, 0.6 + fbm(u, v, 5, num(p, 'scale', 4), seed) * 0.6),
        height: (u, v) => fbm(u, v, 5, num(p, 'scale', 4), seed),
        roughness: () => 0.7,
        normalStrength: 0.5,
        roughnessScale: 1,
      }
    }
    case 'checker': {
      const a: RGB = parseHex(p.color as string, [240, 240, 240])
      const b: RGB = parseHex(p.color2 as string, [40, 40, 44])
      const n = Math.max(1, Math.round(num(p, 'count', 8)))
      return {
        color: (u, v) => ((Math.floor(u * n) + Math.floor(v * n)) % 2 === 0 ? a : b),
        height: () => 1,
        roughness: () => 0.6,
        normalStrength: 0,
        roughnessScale: 1,
      }
    }
  }
}

/** Synthesize all maps for a texture description. */
export function generateProcedural(desc: ProceduralParams): ProceduralPixels {
  const size = desc.size
  const field = makeField(desc.kind, desc.seed, desc.params)
  const color = new Uint8ClampedArray(size * size * 4)
  const rough = new Uint8ClampedArray(size * size * 4)
  const height = new Float32Array(size * size)
  const inv = 1 / size
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv
      const i = y * size + x
      const c = field.color(u, v)
      color[i * 4] = c[0]
      color[i * 4 + 1] = c[1]
      color[i * 4 + 2] = c[2]
      color[i * 4 + 3] = 255
      height[i] = field.height(u, v)
      const r = field.roughness ? field.roughness(u, v) : 0.7
      const rv = Math.round(clamp01(r) * 255)
      rough[i * 4] = rv
      rough[i * 4 + 1] = rv
      rough[i * 4 + 2] = rv
      rough[i * 4 + 3] = 255
    }
  }
  const normal = normalFromHeight(height, size, field.normalStrength)
  return { size, color, normal, roughness: rough, roughnessScale: field.roughnessScale }
}

/** Sobel-filtered tangent-space normal map from a tileable height field. */
export function normalFromHeight(height: Float32Array, size: number, strength: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4)
  const at = (x: number, y: number) => height[(((y % size) + size) % size) * size + (((x % size) + size) % size)]!
  const s = strength * size * 0.02
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1))
      const dy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1))
      let nx = -dx * s
      let ny = -dy * s
      let nz = 1
      const l = Math.hypot(nx, ny, nz) || 1
      nx /= l
      ny /= l
      nz /= l
      const i = (y * size + x) * 4
      out[i] = (nx * 0.5 + 0.5) * 255
      out[i + 1] = (ny * 0.5 + 0.5) * 255
      out[i + 2] = (nz * 0.5 + 0.5) * 255
      out[i + 3] = 255
    }
  }
  return out
}

export function proceduralKey(kind: ProceduralTextureKind, seed: number, params: Record<string, number | string> | undefined, size: number): string {
  const ps = params ? Object.keys(params).sort().map((k) => `${k}=${String(params[k])}`).join('&') : ''
  return `${kind}|${seed}|${size}|${ps}`
}
