// Wall plan symbology: poché (solid + material hatch per layer), heavy cut lines with gaps at
// openings, layer interfaces, and above/below-cut representations.
import type { HatchPattern } from '@cadsandbox/doc'
import type { Drawing2D } from '../../api'
import { DrawingBuilder } from '../../core/drawing'
import { hatchSegments } from '../../core/hatch'
import { clipSegmentsAgainst, differencePolygons, nestRings, type PolyWithHoles, type Ring } from '../../core/polygon'
import type { EvalContext } from '../context'
import type { WallFrame } from './frame'
import { endParam, type WallSolve } from './joins'
import { bandRing, cutRing, type OpeningCut } from './mesh'

export function hatchScaleFor(thickness: number): number {
  return Math.max(0.25, Math.min(1, thickness * 4))
}

export function buildWallPlan(f: WallFrame, solve: WallSolve, cuts: OpeningCut[], ctx: EvalContext): Drawing2D {
  const d = new DrawingBuilder()
  const cutZ = ctx.level.cutHeight
  const clip: PolyWithHoles[] = solve.neighborFootprints.map((r) => ({ outer: r, holes: [] }))
  const clipped = (segs: ArrayLike<number>): Float32Array => (clip.length ? clipSegmentsAgainst(segs, clip, false, 1e-4) : Float32Array.from(segs as ArrayLike<number>))
  const outline = (style: 'visible' | 'overhead') => {
    const segs: number[] = []
    const fp = solve.footprint
    for (let i = 0; i < fp.length; i++) {
      const a = fp[i]!, b = fp[(i + 1) % fp.length]!
      segs.push(a[0], a[1], b[0], b[1])
    }
    d.segments(style, clipped(segs))
  }
  if (f.z1 <= cutZ + 1e-6) {
    outline('visible')
    return d.build()
  }
  if (f.z0 >= cutZ - 1e-6) {
    outline('overhead')
    return d.build()
  }
  // openings intersected by the cut plane → gaps
  const gaps = cuts.filter((c) => c.z0 < cutZ && c.z1 > cutZ).sort((p, q) => p.s0 - q.s0)
  const half = f.t / 2
  const gapRings: Ring[] = gaps.map((c) => cutRing(f, -half - 0.001, half + 0.001, c.s0, c.s1))
  const sub: Ring[] = [...gapRings, ...solve.subtractPlan]
  // poché per layer
  for (const band of f.layers) {
    const sA_L = endParam(f, solve.a, band.oL), sA_R = endParam(f, solve.a, band.oR)
    const sB_L = endParam(f, solve.b, band.oL), sB_R = endParam(f, solve.b, band.oR)
    const ring = bandRing(f, band, sA_R, sB_R, sB_L, sA_L)
    const polys = sub.length ? differencePolygons([ring], sub) : nestRings([ring])
    if (!polys.length) continue
    d.fill(polys, 'solid')
    const mat = band.material ? ctx.materials[band.material] : undefined
    const hatch: HatchPattern | undefined = mat?.hatch
    if (hatch && hatch !== 'none' && hatch !== 'solid') {
      const scale = hatchScaleFor(band.thickness)
      d.fill(polys, hatch, { scale })
      d.segments('thin', hatchSegments(polys, hatch, scale, 0))
    }
  }
  // heavy cut lines: outer faces split at gaps
  const faceLines = (o: number, sA: number, sB: number, style: 'cut' | 'thin') => {
    const segs: number[] = []
    let s = sA
    for (const g of gaps) {
      if (g.s0 > s) pushPolyline(segs, f.sample(o, s, g.s0))
      s = Math.max(s, g.s1)
    }
    if (sB > s) pushPolyline(segs, f.sample(o, s, sB))
    d.segments(style, clipped(segs))
  }
  faceLines(half, solve.a.sL, solve.b.sL, 'cut')
  faceLines(-half, solve.a.sR, solve.b.sR, 'cut')
  for (let i = 0; i < f.layers.length - 1; i++) {
    const o = f.layers[i]!.oR
    faceLines(o, endParam(f, solve.a, o), endParam(f, solve.b, o), 'thin')
  }
  // jambs at gaps and free-end caps
  const capSegs: number[] = []
  for (const g of gaps) {
    for (const s of [g.s0, g.s1]) {
      const pr = f.point(s, -half), pl = f.point(s, half)
      capSegs.push(pr[0], pr[1], pl[0], pl[1])
    }
  }
  for (const e of [solve.a, solve.b]) {
    if (e.kind === 'free') {
      const pr = f.point(e.sR, -half), pl = f.point(e.sL, half)
      capSegs.push(pr[0], pr[1], pl[0], pl[1])
    } else if (e.kind === 'node' && !e.miteredL && !e.miteredR) {
      // plain cap at a node join (collinear continuation): draw only the exposed step
      const pr = f.point(e.sR, -half), pl = f.point(e.sL, half)
      const exposed = clipSegmentsAgainst([pr[0], pr[1], pl[0], pl[1]], clip, false, 2e-3)
      for (let i = 0; i < exposed.length; i++) capSegs.push(exposed[i]!)
    }
  }
  d.segments('cut', clipped(capSegs))
  return d.build()
}

function pushPolyline(segs: number[], pts: readonly (readonly [number, number])[]): void {
  for (let i = 0; i < pts.length - 1; i++) segs.push(pts[i]![0], pts[i]![1], pts[i + 1]![0], pts[i + 1]![1])
}
