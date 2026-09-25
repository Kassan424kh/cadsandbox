// Hatch pattern definitions (AutoCAD .pat semantics, acadiso units) and pattern-line clipping for
// vector output (PDF). DXF embeds the same definitions, so CAD apps render them even when the
// pattern name is not in their acad(iso).pat.
//
// HatchParams.scale follows the geometry engine: a model-space multiplier of its 0.1 m base unit
// (ANSI31 lines 0.1 m apart at scale 1). One pattern unit therefore spans PATTERN_UNIT_M meters at
// scale 1, so ANSI31's 3.175-unit spacing lands exactly on 0.1 m.
import type { HatchPattern, Vec2 } from '@cadsandbox/doc'

/** Meters per .pat unit at hatch scale 1 (ANSI31: 3.175 units → 0.1 m, the engine's HATCH_UNIT). */
export const PATTERN_UNIT_M = 0.1 / 3.175

export interface PatFamily {
  /** line angle, degrees */
  angle: number
  base: [number, number]
  /** offset between successive lines, in the line's own frame (along, across) */
  offset: [number, number]
  /** dash lengths: >0 dash, <0 gap, 0 dot; empty = continuous */
  dashes: number[]
}
export interface PatDef {
  dxf: string
  families: PatFamily[]
}

const f = (angle: number, base: [number, number], offset: [number, number], dashes: number[] = []): PatFamily => ({ angle, base, offset, dashes })
const IN = 25.4

export const PATTERNS: Record<Exclude<HatchPattern, 'none' | 'solid'>, PatDef> = {
  ansi31: { dxf: 'ANSI31', families: [f(45, [0, 0], [0, 3.175])] },
  ansi32: { dxf: 'ANSI32', families: [f(45, [0, 0], [0, 9.525]), f(45, [4.490128, 0], [0, 9.525])] },
  ansi37: { dxf: 'ANSI37', families: [f(45, [0, 0], [0, 3.175]), f(135, [0, 0], [0, 3.175])] },
  concrete: { dxf: 'AR-CONC', families: [f(45, [0, 0], [3, 5], [0.8, -5]), f(135, [1.5, 0.5], [3, 5], [0.8, -5]), f(0, [0.7, 1.9], [2.2, 3.1], [0, -4.4])] },
  'reinforced-concrete': { dxf: 'STAHLBETON', families: [f(45, [0, 0], [0, 2]), f(135, [0, 0], [0, 2])] },
  brick: { dxf: 'BRICK', families: [f(45, [0, 0], [0, 2])] },
  masonry: { dxf: 'MASONRY', families: [f(45, [0, 0], [0, 3])] },
  insulation: { dxf: 'INSUL', families: [f(0, [0, 0], [0, 0.375 * IN]), f(0, [0, 0.125 * IN], [0, 0.375 * IN], [0.125 * IN, -0.125 * IN]), f(0, [0, 0.25 * IN], [0, 0.375 * IN], [0.125 * IN, -0.125 * IN])] },
  earth: {
    dxf: 'EARTH',
    families: [
      f(0, [0, 0], [0.25 * IN, 0.25 * IN], [0.25 * IN, -0.25 * IN]),
      f(0, [0, 0.09375 * IN], [0.25 * IN, 0.25 * IN], [0.25 * IN, -0.25 * IN]),
      f(0, [0, 0.1875 * IN], [0.25 * IN, 0.25 * IN], [0.25 * IN, -0.25 * IN]),
      f(90, [0.03125 * IN, 0.21875 * IN], [0.25 * IN, 0.25 * IN], [0.25 * IN, -0.25 * IN]),
      f(90, [0.125 * IN, 0.21875 * IN], [0.25 * IN, 0.25 * IN], [0.25 * IN, -0.25 * IN]),
      f(90, [0.21875 * IN, 0.21875 * IN], [0.25 * IN, 0.25 * IN], [0.25 * IN, -0.25 * IN]),
    ],
  },
  gravel: { dxf: 'GRAVEL', families: [f(0, [0, 0], [1.6, 2.4], [0, -3.2]), f(60, [0.8, 0.6], [2.2, 2.9], [0.6, -3.6])] },
  sand: { dxf: 'AR-SAND', families: [f(0, [0, 0], [0.8, 1.2], [0, -1.6]), f(37, [0.4, 0.3], [1.1, 1.5], [0, -1.9])] },
  wood: { dxf: 'WOOD', families: [f(0, [0, 0], [0, 1.5], [12, -2, 4, -2])] },
  timber: { dxf: 'TIMBER', families: [f(45, [0, 0], [0, 6]), f(135, [0, 0], [0, 6])] },
  steel: { dxf: 'STEEL', families: [f(45, [0, 0], [0, 0.125 * IN]), f(45, [0, 0.0625 * IN], [0, 0.125 * IN])] },
  glass: { dxf: 'GLASS', families: [f(45, [0, 0], [0, 5], [2, -3])] },
  tiles: { dxf: 'NET', families: [f(0, [0, 0], [0, 6.35]), f(90, [0, 0], [0, 6.35])] },
  grid: { dxf: 'NET', families: [f(0, [0, 0], [0, 3.175]), f(90, [0, 0], [0, 3.175])] },
  grass: { dxf: 'GRASS', families: [f(90, [0, 0], [2.5, 4.3], [1.5, -2.8]), f(60, [0.5, 0], [2.5, 4.3], [1.2, -3.1]), f(120, [-0.5, 0], [2.5, 4.3], [1.2, -3.1])] },
  water: { dxf: 'WATER', families: [f(0, [0, 0], [3, 2.5], [5, -2, 1, -2])] },
  dots: { dxf: 'DOTS', families: [f(0, [0, 0], [0, 0.03125 * IN], [0, -0.0625 * IN])] },
}

export function patternDef(p: HatchPattern): PatDef | null {
  return p === 'none' || p === 'solid' ? null : (PATTERNS[p] ?? PATTERNS.ansi31)
}

/** A family transformed by hatch angle (rad) and scale: world line angle, base, offset vector, dashes. */
export function transformFamily(fam: PatFamily, scale: number, angle: number): { angle: number; base: Vec2; offset: Vec2; dashes: number[] } {
  const a = (fam.angle * Math.PI) / 180 + angle
  const c = Math.cos(angle),
    s = Math.sin(angle)
  const base: Vec2 = [(fam.base[0] * c - fam.base[1] * s) * scale, (fam.base[0] * s + fam.base[1] * c) * scale]
  // offset is expressed in the line's frame (along, across)
  const ca = Math.cos(a),
    sa = Math.sin(a)
  const offset: Vec2 = [(fam.offset[0] * ca - fam.offset[1] * sa) * scale, (fam.offset[0] * sa + fam.offset[1] * ca) * scale]
  return { angle: a, base, offset, dashes: fam.dashes.map((d) => d * scale) }
}

/**
 * Pattern line segments clipped to a polygon with holes (even-odd), in the polygon's coordinates.
 * `scale` converts pattern millimeters into those coordinates. Dots become segments of `dot` length.
 */
export function hatchSegments(outer: Vec2[], holes: Vec2[][], def: PatDef, scale: number, angle: number, dot = 0.15, maxLines = 4000): [Vec2, Vec2][] {
  const rings = [outer, ...holes].filter((r) => r.length >= 3)
  if (!rings.length) return []
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity
  for (const r of rings)
    for (const p of r) {
      x0 = Math.min(x0, p[0])
      y0 = Math.min(y0, p[1])
      x1 = Math.max(x1, p[0])
      y1 = Math.max(y1, p[1])
    }
  const out: [Vec2, Vec2][] = []
  for (const fam of def.families) {
    const t = transformFamily(fam, scale, angle)
    const u: Vec2 = [Math.cos(t.angle), Math.sin(t.angle)]
    const n: Vec2 = [-u[1], u[0]]
    const step = t.offset[0] * n[0] + t.offset[1] * n[1] // perpendicular spacing
    if (Math.abs(step) < 1e-9) continue
    const shift = t.offset[0] * u[0] + t.offset[1] * u[1] // along-line stagger per line
    // perpendicular extent of the bbox relative to the base point
    const corners: Vec2[] = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ]
    const proj = corners.map((c) => (c[0] - t.base[0]) * n[0] + (c[1] - t.base[1]) * n[1])
    let k0 = Math.floor(Math.min(...proj) / step),
      k1 = Math.ceil(Math.max(...proj) / step)
    if (k0 > k1) [k0, k1] = [k1, k0]
    if (k1 - k0 > maxLines) continue
    const period = t.dashes.reduce((s, d) => s + Math.abs(d), 0)
    for (let k = k0; k <= k1; k++) {
      const o: Vec2 = [t.base[0] + t.offset[0] * k, t.base[1] + t.offset[1] * k]
      // intersections of the line o + s·u with all ring edges
      const hits: number[] = []
      for (const r of rings) {
        for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
          const a = r[j]!,
            b = r[i]!
          const da = (a[0] - o[0]) * n[0] + (a[1] - o[1]) * n[1]
          const db = (b[0] - o[0]) * n[0] + (b[1] - o[1]) * n[1]
          if ((da > 0) === (db > 0)) continue
          const w = da / (da - db)
          const px = a[0] + (b[0] - a[0]) * w,
            py = a[1] + (b[1] - a[1]) * w
          hits.push((px - o[0]) * u[0] + (py - o[1]) * u[1])
        }
      }
      hits.sort((p, q) => p - q)
      for (let h = 0; h + 1 < hits.length; h += 2) {
        const s0 = hits[h]!,
          s1 = hits[h + 1]!
        if (!period) {
          out.push([
            [o[0] + u[0] * s0, o[1] + u[1] * s0],
            [o[0] + u[0] * s1, o[1] + u[1] * s1],
          ])
          continue
        }
        // walk the dash pattern (phase from the family base, shifted per line)
        const phase = shift * k
        let s = s0 - ((((s0 - phase) % period) + period) % period)
        let guard = 0
        while (s < s1 && guard++ < 100000) {
          for (const d of t.dashes) {
            const len = Math.abs(d)
            if (d >= 0) {
              const a = Math.max(s, s0),
                b = Math.min(s + (d === 0 ? dot : len), s1)
              if (b > a) out.push([
                [o[0] + u[0] * a, o[1] + u[1] * a],
                [o[0] + u[0] * b, o[1] + u[1] * b],
              ])
            }
            s += len
            if (s >= s1) break
          }
        }
      }
    }
  }
  return out
}
