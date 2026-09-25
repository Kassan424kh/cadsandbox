// Wall frame: centerline curve (line or arc) with wall coordinates (s along, o across, z up).
import type { Vec2, WallLayer, WallParams } from '@cadsandbox/doc'
import { GEOM_EPS, TAU, arcFromBulge, arcSegments, dist2, lineIntersection, normalize2, perp2, sub2, type Affine2, applyAffine } from '../../core/math2d'

export interface FaceCurve {
  kind: 'line' | 'arc'
  /** line: origin + direction (unit) */
  p: Vec2
  d: Vec2
  /** arc: center + signed radius orientation */
  c: Vec2
  r: number
}

export interface LayerBand {
  index: number
  material: string | null
  /** offsets relative to the centerline (left positive): oL > oR */
  oL: number
  oR: number
  thickness: number
  function: WallLayer['function']
}

export class WallFrame {
  readonly kind: 'line' | 'arc'
  /** centerline start / direction / left normal (line) */
  readonly A: Vec2
  readonly d: Vec2
  readonly n: Vec2
  /** arc data (centerline radius R, start angle, signed sweep) */
  readonly c: Vec2
  readonly R: number
  readonly th0: number
  readonly sweep: number
  /** +1 for CCW arcs (left side toward the center), -1 for CW */
  readonly sgn: 1 | -1
  /** centerline length */
  readonly L: number
  readonly t: number
  readonly z0: number
  readonly z1: number
  readonly layers: LayerBand[]
  /** length of the user-drawn (justification) curve — opening offsets are measured along it */
  readonly Lref: number

  constructor(readonly params: WallParams, nodeMaterial: string | null) {
    const layersIn = (params.layers ?? []).filter((l) => l.thickness > 1e-6)
    const t = layersIn.length ? layersIn.reduce((s, l) => s + l.thickness, 0) : Math.max(1e-4, params.thickness)
    this.t = t
    const oc = params.justification === 'left' ? -t / 2 : params.justification === 'right' ? t / 2 : 0
    const a = params.a, b = params.b
    const arc = arcFromBulge(a, b, params.bulge ?? 0)
    if (arc && Math.abs(arc.sweep) > 1e-6) {
      this.kind = 'arc'
      this.sgn = arc.sweep > 0 ? 1 : -1
      this.c = arc.center
      this.th0 = arc.a0
      this.sweep = arc.sweep
      this.Lref = arc.radius * Math.abs(arc.sweep)
      // offset centerline: left of a CCW arc is toward the center
      this.R = Math.max(1e-4, arc.radius - this.sgn * oc)
      this.L = this.R * Math.abs(arc.sweep)
      this.A = this.point(0, 0)
      this.d = this.tangent(0)
      this.n = perp2(this.d)
    } else {
      this.kind = 'line'
      const dir = normalize2(sub2(b, a))
      const nn = perp2(dir)
      this.d = dir
      this.n = nn
      this.A = [a[0] + nn[0] * oc, a[1] + nn[1] * oc]
      this.L = Math.max(GEOM_EPS, dist2(a, b))
      this.Lref = this.L
      this.c = [0, 0]
      this.R = 0
      this.th0 = 0
      this.sweep = 0
      this.sgn = 1
    }
    this.z0 = params.baseOffset ?? 0
    this.z1 = this.z0 + Math.max(1e-4, params.height)
    // layers from the left face to the right face
    const bands: LayerBand[] = []
    if (layersIn.length) {
      let o = t / 2
      layersIn.forEach((l, i) => {
        bands.push({ index: i, material: l.material ?? null, oL: o, oR: o - l.thickness, thickness: l.thickness, function: l.function })
        o -= l.thickness
      })
    } else bands.push({ index: 0, material: nodeMaterial, oL: t / 2, oR: -t / 2, thickness: t, function: 'structure' })
    this.layers = bands
  }

  /** Point at arc length s along the centerline, offset o to the left. */
  point(s: number, o: number): Vec2 {
    if (this.kind === 'line') return [this.A[0] + this.d[0] * s + this.n[0] * o, this.A[1] + this.d[1] * s + this.n[1] * o]
    const th = this.th0 + (this.sweep * s) / this.L
    const rho = this.R - this.sgn * o
    return [this.c[0] + Math.cos(th) * rho, this.c[1] + Math.sin(th) * rho]
  }

  tangent(s: number): Vec2 {
    if (this.kind === 'line') return this.d
    const th = this.th0 + (this.sweep * s) / this.L
    return [-Math.sin(th) * this.sgn, Math.cos(th) * this.sgn]
  }

  /** Left normal at s. */
  normal(s: number): Vec2 {
    return perp2(this.tangent(s))
  }

  /** Wall coordinates of a point (s may fall outside [0, L]). */
  toWall(p: Vec2): [number, number] {
    if (this.kind === 'line') {
      const dx = p[0] - this.A[0], dy = p[1] - this.A[1]
      return [dx * this.d[0] + dy * this.d[1], dx * this.n[0] + dy * this.n[1]]
    }
    const dx = p[0] - this.c[0], dy = p[1] - this.c[1]
    let dth = Math.atan2(dy, dx) - this.th0
    // unwrap relative to the sweep direction into (-π, π] around the arc
    dth = ((dth + Math.PI) % TAU + TAU) % TAU - Math.PI
    if (this.sweep < 0) dth = -dth
    // dth now measured in the sweep direction; map beyond the end consistently
    const s = (dth / Math.abs(this.sweep)) * this.L
    const rho = Math.hypot(dx, dy)
    return [s, (this.R - rho) * this.sgn]
  }

  /** Convert a reference-curve offset (as drawn) into a centerline arc-length parameter. */
  sFromRef(offset: number): number {
    return this.Lref > 0 ? (offset / this.Lref) * this.L : offset
  }

  /** The curve of the face at offset o. */
  face(o: number): FaceCurve {
    if (this.kind === 'line') return { kind: 'line', p: this.point(0, o), d: this.d, c: [0, 0], r: 0 }
    return { kind: 'arc', p: [0, 0], d: [0, 0], c: this.c, r: this.R - this.sgn * o }
  }

  /** Sample the face at offset o between s0 and s1 (inclusive ends). */
  sample(o: number, s0: number, s1: number, tol = 0.002): Vec2[] {
    if (this.kind === 'line' || Math.abs(s1 - s0) < GEOM_EPS) return [this.point(s0, o), this.point(s1, o)]
    const rho = Math.abs(this.R - this.sgn * o)
    const n = arcSegments(rho, (Math.abs(this.sweep) * Math.abs(s1 - s0)) / this.L, tol, 2)
    const out: Vec2[] = new Array(n + 1)
    for (let i = 0; i <= n; i++) out[i] = this.point(s0 + ((s1 - s0) * i) / n, o)
    return out
  }

  /** Outgoing frame at an end: point on the centerline and unit direction pointing away from the body. */
  endFrame(end: 'a' | 'b'): { p: Vec2; u: Vec2; s: number } {
    if (end === 'a') {
      const t = this.tangent(0)
      return { p: this.point(0, 0), u: [-t[0], -t[1]], s: 0 }
    }
    return { p: this.point(this.L, 0), u: this.tangent(this.L), s: this.L }
  }
}

/** Map a neighbour wall's params into the evaluated wall's local frame (rigid/uniform transforms). */
export function transformWallParams(p: WallParams, xf: Affine2): WallParams {
  const det = xf[0] * xf[3] - xf[1] * xf[2]
  const scale = Math.sqrt(Math.abs(det)) || 1
  const a = applyAffine(xf, p.a)
  const b = applyAffine(xf, p.b)
  const flipped = det < 0
  return {
    ...p,
    a,
    b,
    bulge: p.bulge ? (flipped ? -p.bulge : p.bulge) : p.bulge,
    thickness: p.thickness * scale,
    justification: flipped ? (p.justification === 'left' ? 'right' : p.justification === 'right' ? 'left' : 'center') : p.justification,
    layers: p.layers?.map((l) => ({ ...l, thickness: l.thickness * scale })),
  }
}

/** Intersection of two face curves, choosing the solution nearest to `hint`. */
export function intersectFaces(fa: FaceCurve, fb: FaceCurve, hint: Vec2): Vec2 | null {
  if (fa.kind === 'line' && fb.kind === 'line') return lineIntersection(fa.p, fa.d, fb.p, fb.d)
  if (fa.kind === 'arc' && fb.kind === 'arc') {
    const sols = circleCircle(fa.c, Math.abs(fa.r), fb.c, Math.abs(fb.r))
    return nearest(sols, hint)
  }
  const line = fa.kind === 'line' ? fa : fb
  const arc = fa.kind === 'arc' ? fa : fb
  return nearest(lineCircle(line.p, line.d, arc.c, Math.abs(arc.r)), hint)
}

function nearest(sols: Vec2[], hint: Vec2): Vec2 | null {
  let best: Vec2 | null = null
  let bd = Infinity
  for (const s of sols) {
    const d = dist2(s, hint)
    if (d < bd) {
      bd = d
      best = s
    }
  }
  return best
}

function lineCircle(p: Vec2, d: Vec2, c: Vec2, r: number): Vec2[] {
  const fx = p[0] - c[0], fy = p[1] - c[1]
  const b = 2 * (fx * d[0] + fy * d[1])
  const cc = fx * fx + fy * fy - r * r
  const disc = b * b - 4 * cc
  if (disc < 0) return []
  const sq = Math.sqrt(disc)
  const t1 = (-b - sq) / 2, t2 = (-b + sq) / 2
  return [[p[0] + d[0] * t1, p[1] + d[1] * t1], [p[0] + d[0] * t2, p[1] + d[1] * t2]]
}

function circleCircle(c0: Vec2, r0: number, c1: Vec2, r1: number): Vec2[] {
  const dx = c1[0] - c0[0], dy = c1[1] - c0[1]
  const d = Math.hypot(dx, dy)
  if (d < 1e-12 || d > r0 + r1 + 1e-9 || d < Math.abs(r0 - r1) - 1e-9) return []
  const a = (r0 * r0 - r1 * r1 + d * d) / (2 * d)
  const h = Math.sqrt(Math.max(0, r0 * r0 - a * a))
  const mx = c0[0] + (a * dx) / d, my = c0[1] + (a * dy) / d
  return [[mx + (h * dy) / d, my - (h * dx) / d], [mx - (h * dy) / d, my + (h * dx) / d]]
}
