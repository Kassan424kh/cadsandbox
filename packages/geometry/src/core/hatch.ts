// Hatch pattern generation: line families / scattered symbols clipped exactly to polygons with holes.
// Pattern origin is the local origin so adjacent regions align. Base unit U = 0.1 m × scale.
import type { HatchPattern, Vec2 } from '@cadsandbox/doc'
import { SegBuf } from './buffers'
import { TAU, orientedBoundingBox, polygonArea } from './math2d'
import { clipSegmentsAgainst, pointInPolys, polysBounds, type PolyWithHoles } from './polygon'

export const HATCH_UNIT = 0.1

interface LineFamily {
  /** degrees, relative to the pattern angle */
  angle: number
  /** × U */
  spacing: number
  /** × U, shift along the family normal */
  offset?: number
  /** dash/gap lengths × U (even count) */
  dash?: number[]
  /** × U, dash phase shift per successive line */
  stagger?: number
}

const LINE_PATTERNS: Partial<Record<HatchPattern, LineFamily[]>> = {
  ansi31: [{ angle: 45, spacing: 1 }],
  ansi32: [{ angle: 45, spacing: 1.5 }, { angle: 45, spacing: 1.5, offset: 0.375 }],
  ansi37: [{ angle: 45, spacing: 1 }, { angle: 135, spacing: 1 }],
  steel: [{ angle: 45, spacing: 0.6 }],
  glass: [{ angle: 45, spacing: 2.5 }, { angle: 45, spacing: 2.5, offset: 0.25 }],
  'reinforced-concrete': [{ angle: 45, spacing: 1 }],
  grid: [{ angle: 0, spacing: 1 }, { angle: 90, spacing: 1 }],
  tiles: [{ angle: 0, spacing: 1.5 }, { angle: 90, spacing: 3, dash: [1.5, 1.5], stagger: 1.5 }],
  brick: [{ angle: 0, spacing: 0.6 }, { angle: 90, spacing: 1.25, dash: [0.6, 0.6], stagger: 0.6 }],
  masonry: [{ angle: 0, spacing: 1.0 }, { angle: 90, spacing: 2.5, dash: [1, 1], stagger: 1 }],
  earth: [
    { angle: 45, spacing: 0.4, dash: [1.2, 1.2], stagger: 0 },
    { angle: 135, spacing: 0.4, dash: [1.2, 1.2], stagger: 0, offset: 0.2 },
  ],
  timber: [{ angle: 45, spacing: 0.8 }],
}

/** Small deterministic PRNG (mulberry32) so scattered patterns are stable across evaluations. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const cellSeed = (ix: number, iy: number, salt: number): number => (((ix * 73856093) ^ (iy * 19349663) ^ (salt * 83492791)) >>> 0) || 1

function lineFamilies(out: SegBuf, families: LineFamily[], polys: PolyWithHoles[], U: number, angle: number): void {
  const b = polysBounds(polys)
  const corners: Vec2[] = [b.min, [b.max[0], b.min[1]], b.max, [b.min[0], b.max[1]]]
  for (const f of families) {
    const a = angle + (f.angle * Math.PI) / 180
    const dx = Math.cos(a), dy = Math.sin(a)
    const nx = -dy, ny = dx
    let dMin = Infinity, dMax = -Infinity, nMin = Infinity, nMax = -Infinity
    for (const c of corners) {
      const d = c[0] * dx + c[1] * dy
      const n = c[0] * nx + c[1] * ny
      if (d < dMin) dMin = d
      if (d > dMax) dMax = d
      if (n < nMin) nMin = n
      if (n > nMax) nMax = n
    }
    const spacing = f.spacing * U
    const offset = (f.offset ?? 0) * U
    const k0 = Math.floor((nMin - offset) / spacing)
    const k1 = Math.ceil((nMax - offset) / spacing)
    if (k1 - k0 > 20000) continue // pathological scale: skip rather than hang
    const dash = f.dash?.map((v) => v * U)
    const period = dash ? dash.reduce((s, v) => s + v, 0) : 0
    for (let k = k0; k <= k1; k++) {
      const n = k * spacing + offset
      const ox = nx * n, oy = ny * n
      if (!dash || period <= 0) {
        out.seg(ox + dx * dMin, oy + dy * dMin, ox + dx * dMax, oy + dy * dMax)
        continue
      }
      const phase = ((f.stagger ?? 0) * U * k) % period
      let s = Math.floor((dMin - phase) / period) * period + phase
      while (s < dMax) {
        let p = s
        for (let i = 0; i < dash.length; i += 2) {
          const on = dash[i]!
          const off = dash[i + 1] ?? 0
          const a0 = Math.max(p, dMin)
          const a1 = Math.min(p + on, dMax)
          if (a1 > a0) out.seg(ox + dx * a0, oy + dy * a0, ox + dx * a1, oy + dy * a1)
          p += on + off
        }
        s += period
      }
    }
  }
}

/** Visit cells of size `cell` covering the polygons; `fn` receives a seeded RNG per cell. */
function scatter(polys: PolyWithHoles[], cell: number, salt: number, fn: (cx: number, cy: number, r: () => number) => void): void {
  const b = polysBounds(polys)
  const ix0 = Math.floor(b.min[0] / cell), ix1 = Math.ceil(b.max[0] / cell)
  const iy0 = Math.floor(b.min[1] / cell), iy1 = Math.ceil(b.max[1] / cell)
  if ((ix1 - ix0) * (iy1 - iy0) > 250000) return
  for (let iy = iy0; iy < iy1; iy++) for (let ix = ix0; ix < ix1; ix++) fn(ix * cell, iy * cell, rng(cellSeed(ix, iy, salt)))
}

function dot(out: SegBuf, x: number, y: number, size: number): void {
  out.seg(x - size, y, x + size, y)
  out.seg(x, y - size, x, y + size)
}

function smallPolygon(out: SegBuf, cx: number, cy: number, r: number, sides: number, rot: number, rnd: () => number): void {
  let px = 0, py = 0, fx = 0, fy = 0
  for (let i = 0; i <= sides; i++) {
    const t = rot + (TAU * i) / sides
    const rr = i === sides ? undefined : r * (0.7 + rnd() * 0.5)
    const x = i === sides ? fx : cx + Math.cos(t) * rr!
    const y = i === sides ? fy : cy + Math.sin(t) * rr!
    if (i === 0) {
      fx = x
      fy = y
    } else out.seg(px, py, x, y)
    px = x
    py = y
  }
}

function wavyLines(out: SegBuf, polys: PolyWithHoles[], U: number, angle: number, spacing: number, amplitude: number, wavelength: number, dashLen = 0): void {
  const b = polysBounds(polys)
  const corners: Vec2[] = [b.min, [b.max[0], b.min[1]], b.max, [b.min[0], b.max[1]]]
  const dx = Math.cos(angle), dy = Math.sin(angle), nx = -dy, ny = dx
  let dMin = Infinity, dMax = -Infinity, nMin = Infinity, nMax = -Infinity
  for (const c of corners) {
    const d = c[0] * dx + c[1] * dy, n = c[0] * nx + c[1] * ny
    dMin = Math.min(dMin, d)
    dMax = Math.max(dMax, d)
    nMin = Math.min(nMin, n)
    nMax = Math.max(nMax, n)
  }
  const step = wavelength / 10
  const k0 = Math.floor(nMin / spacing), k1 = Math.ceil(nMax / spacing)
  if ((k1 - k0) * ((dMax - dMin) / step) > 400000) return
  for (let k = k0; k <= k1; k++) {
    const n = k * spacing
    const phase = (k % 2) * Math.PI
    for (let s = dMin; s < dMax; s += step) {
      if (dashLen > 0 && Math.floor((s + (k % 2) * dashLen) / dashLen) % 2 === 1) continue
      const s1 = Math.min(dMax, s + step)
      const w0 = n + amplitude * Math.sin((TAU * s) / wavelength + phase)
      const w1 = n + amplitude * Math.sin((TAU * s1) / wavelength + phase)
      out.seg(dx * s + nx * w0, dy * s + ny * w0, dx * s1 + nx * w1, dy * s1 + ny * w1)
    }
  }
}

/** Zig-zag batt insulation along the region's long axis, one or more rows. */
function insulation(out: SegBuf, polys: PolyWithHoles[], U: number): void {
  const main = polys.reduce((a, b) => (Math.abs(polygonArea(b.outer)) > Math.abs(polygonArea(a.outer)) ? b : a))
  const obb = orientedBoundingBox(main.outer)
  const width = obb.halfWidth * 2
  const rowH = Math.min(width, 3 * U)
  const rows = Math.max(1, Math.round(width / rowH))
  const h = width / rows
  const ax = obb.axis, nx = -ax[1], ny = ax[0]
  const period = h * 1.2
  const len = obb.halfLength * 2
  if (len / period > 20000) return
  for (let r = 0; r < rows; r++) {
    const base = -obb.halfWidth + r * h
    const lo = base + h * 0.08, hi = base + h * 0.92
    let s = -obb.halfLength
    let up = false
    let px = obb.center[0] + ax[0] * s + nx * lo, py = obb.center[1] + ax[1] * s + ny * lo
    while (s < obb.halfLength) {
      s = Math.min(obb.halfLength, s + period / 2)
      up = !up
      const w = up ? hi : lo
      const x = obb.center[0] + ax[0] * s + nx * w, y = obb.center[1] + ax[1] * s + ny * w
      out.seg(px, py, x, y)
      px = x
      py = y
    }
  }
}

/**
 * Generate hatch segments for `pattern` inside `polys` (outer CCW, holes CW). `scale` multiplies
 * the base unit (0.1 m); `angle` rotates line patterns (radians).
 */
export function hatchSegments(polys: readonly PolyWithHoles[], pattern: HatchPattern, scale = 1, angle = 0): Float32Array {
  const valid = polys.filter((p) => p.outer.length >= 3)
  if (!valid.length || pattern === 'none' || pattern === 'solid') return new Float32Array(0)
  const U = HATCH_UNIT * Math.max(0.01, scale || 1)
  const raw = new SegBuf(256)
  const families = LINE_PATTERNS[pattern]
  if (families) lineFamilies(raw, families, valid, U, angle)
  switch (pattern) {
    case 'concrete':
    case 'reinforced-concrete':
      scatter(valid, U, 11, (cx, cy, r) => {
        for (let i = 0; i < 5; i++) {
          const x = cx + r() * U, y = cy + r() * U
          if (pointInPolys([x, y], valid)) dot(raw, x, y, U * 0.03)
        }
        if (r() < 0.5) {
          const x = cx + r() * U, y = cy + r() * U
          if (pointInPolys([x, y], valid)) smallPolygon(raw, x, y, U * (0.12 + r() * 0.1), 3, r() * TAU, r)
        }
      })
      break
    case 'gravel':
      scatter(valid, U, 23, (cx, cy, r) => {
        for (let i = 0; i < 2; i++) {
          const x = cx + r() * U, y = cy + r() * U
          if (pointInPolys([x, y], valid)) smallPolygon(raw, x, y, U * (0.15 + r() * 0.15), 5 + Math.floor(r() * 3), r() * TAU, r)
        }
      })
      break
    case 'sand':
      scatter(valid, U, 37, (cx, cy, r) => {
        for (let i = 0; i < 10; i++) {
          const x = cx + r() * U, y = cy + r() * U
          if (pointInPolys([x, y], valid)) dot(raw, x, y, U * 0.02)
        }
      })
      break
    case 'dots':
      lineFamilies(raw, [{ angle: 0, spacing: 0.4, dash: [0.05, 0.35], stagger: 0.2 }], valid, U, angle)
      break
    case 'grass':
      scatter(valid, U, 41, (cx, cy, r) => {
        for (let i = 0; i < 2; i++) {
          const x = cx + r() * U, y = cy + r() * U
          if (!pointInPolys([x, y], valid)) continue
          const h = U * (0.25 + r() * 0.15)
          raw.seg(x, y, x - h * 0.4, y + h)
          raw.seg(x, y, x + h * 0.1, y + h * 1.1)
          raw.seg(x, y, x + h * 0.5, y + h * 0.8)
        }
      })
      break
    case 'water':
      wavyLines(raw, valid, U, angle, U * 1.2, U * 0.15, U * 2.5, U * 2.5)
      break
    case 'wood':
      wavyLines(raw, valid, U, angle + orientedBoundingBoxAngle(valid), U * 0.5, U * 0.07, U * 6)
      break
    case 'timber': {
      // diagonal hatch (family above) + annual-ring arcs at the centroid of each polygon
      for (const p of valid) {
        const obb = orientedBoundingBox(p.outer)
        const c = obb.center
        for (let k = 1; k <= 3; k++) {
          const rr = obb.halfWidth * (k / 3.5)
          const segs = 24
          for (let i = 0; i < segs; i++) {
            const a0 = (TAU * i) / segs, a1 = (TAU * (i + 1)) / segs
            raw.seg(c[0] + Math.cos(a0) * rr * 1.6, c[1] + Math.sin(a0) * rr, c[0] + Math.cos(a1) * rr * 1.6, c[1] + Math.sin(a1) * rr)
          }
        }
      }
      break
    }
    case 'insulation':
      insulation(raw, valid, U)
      break
    default:
      break
  }
  if (!raw.count) return new Float32Array(0)
  return clipSegmentsAgainst(raw.toArray(), valid, true)
}

function orientedBoundingBoxAngle(polys: readonly PolyWithHoles[]): number {
  const main = polys.reduce((a, b) => (Math.abs(polygonArea(b.outer)) > Math.abs(polygonArea(a.outer)) ? b : a))
  const obb = orientedBoundingBox(main.outer)
  return Math.atan2(obb.axis[1], obb.axis[0])
}

export const ALL_HATCH_PATTERNS: readonly HatchPattern[] = [
  'none', 'solid', 'ansi31', 'ansi32', 'ansi37', 'concrete', 'reinforced-concrete', 'brick', 'masonry', 'insulation',
  'earth', 'gravel', 'sand', 'wood', 'timber', 'steel', 'glass', 'tiles', 'grass', 'water', 'dots', 'grid',
]
