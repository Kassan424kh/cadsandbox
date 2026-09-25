// Curve ↔ curve intersections and parametrization for trim / extend / fillet / offset.
import type { Vec2 } from '@cadsandbox/doc'
import { arcPoint, arcSweep, type ArcDef } from './arcs'
import { lineCircleParams, lineLineParams } from './polygon'
import type { Curve } from './scene'
import { positiveAngle, v2 } from './vec'

/** Parameter of a point on a curve: segments t ∈ [0,1] (unclamped), arcs = fraction of the sweep. */
export function curveParam(c: Curve, p: Vec2): number {
  if (c.kind === 'seg') {
    const d = v2.sub(c.b, c.a)
    const l2 = v2.dot(d, d)
    return l2 < 1e-18 ? 0 : v2.dot(v2.sub(p, c.a), d) / l2
  }
  const ang = positiveAngle(v2.angle(v2.sub(p, c.arc.center)))
  let rel = ang - positiveAngle(c.arc.start)
  if (rel < -1e-9) rel += Math.PI * 2
  return rel / arcSweep(c.arc)
}

export function curvePoint(c: Curve, t: number): Vec2 {
  if (c.kind === 'seg') return v2.lerp(c.a, c.b, t)
  return arcPoint(c.arc, c.arc.start + arcSweep(c.arc) * t)
}

/** Is the (unclamped) parameter within the curve extent? */
export function onCurve(c: Curve, t: number, tol = 1e-7): boolean {
  return t >= -tol && t <= 1 + tol
}

/** Intersection points of two curves, each with its parameter on `a` (infinite line for segments when `infiniteA`). */
export function curveIntersections(a: Curve, b: Curve, infiniteA = false, infiniteB = false): { p: Vec2; ta: number; tb: number }[] {
  const out: { p: Vec2; ta: number; tb: number }[] = []
  const push = (p: Vec2) => {
    const ta = curveParam(a, p),
      tb = curveParam(b, p)
    if (!infiniteA && !onCurve(a, ta)) return
    if (!infiniteB && !onCurve(b, tb)) return
    out.push({ p, ta, tb })
  }
  if (a.kind === 'seg' && b.kind === 'seg') {
    const r = v2.sub(a.b, a.a),
      s = v2.sub(b.b, b.a)
    const tu = lineLineParams(a.a, r, b.a, s)
    if (tu) push(v2.add(a.a, v2.scale(r, tu[0])))
    return out
  }
  if (a.kind === 'seg' && b.kind === 'arc') {
    for (const t of lineCircleParams(a.a, a.b, b.arc.center, b.arc.radius)) push(v2.lerp(a.a, a.b, t))
    return out
  }
  if (a.kind === 'arc' && b.kind === 'seg') {
    for (const t of lineCircleParams(b.a, b.b, a.arc.center, a.arc.radius)) push(v2.lerp(b.a, b.b, t))
    return out
  }
  if (a.kind === 'arc' && b.kind === 'arc') {
    for (const p of circleCircle(a.arc, b.arc)) push(p)
  }
  return out
}

function circleCircle(a: ArcDef, b: ArcDef): Vec2[] {
  const d = v2.dist(a.center, b.center)
  if (d < 1e-12 || d > a.radius + b.radius + 1e-9 || d < Math.abs(a.radius - b.radius) - 1e-9) return []
  const x = (d * d - b.radius * b.radius + a.radius * a.radius) / (2 * d)
  const h2 = a.radius * a.radius - x * x
  const h = h2 > 0 ? Math.sqrt(h2) : 0
  const u = v2.norm(v2.sub(b.center, a.center))
  const m = v2.add(a.center, v2.scale(u, x))
  const n = v2.perp(u)
  if (h < 1e-9) return [m]
  return [v2.add(m, v2.scale(n, h)), v2.sub(m, v2.scale(n, h))]
}

/** Sorted, de-duplicated parameters on `target` where any of `cutters` intersects it (strictly inside (0,1)). */
export function cutParams(target: Curve, cutters: readonly Curve[], infinite = false): number[] {
  const ts: number[] = []
  for (const c of cutters) for (const hit of curveIntersections(target, c, infinite)) ts.push(hit.ta)
  ts.sort((x, y) => x - y)
  const out: number[] = []
  for (const t of ts) {
    if (!infinite && (t <= 1e-7 || t >= 1 - 1e-7)) continue
    if (!out.length || Math.abs(out[out.length - 1] - t) > 1e-7) out.push(t)
  }
  return out
}

/** Sub-curve between two parameters. */
export function subCurve(c: Curve, t0: number, t1: number): Curve {
  if (c.kind === 'seg') return { kind: 'seg', a: v2.lerp(c.a, c.b, t0), b: v2.lerp(c.a, c.b, t1) }
  const sweep = arcSweep(c.arc)
  return { kind: 'arc', arc: { center: c.arc.center, radius: c.arc.radius, start: c.arc.start + sweep * t0, end: c.arc.start + sweep * t1 } }
}

/** Parameter of the point on `c` closest to p (clamped for segments; arcs via angle). */
export function nearestParam(c: Curve, p: Vec2): number {
  const t = curveParam(c, p)
  if (c.kind === 'seg') return Math.max(0, Math.min(1, t))
  return t
}
