// 2D vector / curve helpers shared by all evaluators. Meters, XY plane, CCW positive.
import type { Vec2, Vec3 } from '@cadsandbox/doc'

export const TAU = Math.PI * 2
export const EPS = 1e-9
/** Geometric coincidence tolerance (meters) used for welding / join detection. */
export const GEOM_EPS = 1e-6

export const v2 = (x: number, y: number): Vec2 => [x, y]
export const add2 = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]]
export const sub2 = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]]
export const scale2 = (a: Vec2, s: number): Vec2 => [a[0] * s, a[1] * s]
export const dot2 = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1]
export const cross2 = (a: Vec2, b: Vec2): number => a[0] * b[1] - a[1] * b[0]
export const len2 = (a: Vec2): number => Math.hypot(a[0], a[1])
export const dist2 = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1])
export const lerp2 = (a: Vec2, b: Vec2, t: number): Vec2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
export const mid2 = (a: Vec2, b: Vec2): Vec2 => [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5]
/** Left-hand normal (rotate +90°). */
export const perp2 = (a: Vec2): Vec2 => [-a[1], a[0]]
export const angleOf = (a: Vec2): number => Math.atan2(a[1], a[0])
export const fromAngle = (t: number, r = 1): Vec2 => [Math.cos(t) * r, Math.sin(t) * r]
export const eq2 = (a: Vec2, b: Vec2, eps = GEOM_EPS): boolean => Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps

export function normalize2(a: Vec2): Vec2 {
  const l = Math.hypot(a[0], a[1])
  return l > EPS ? [a[0] / l, a[1] / l] : [1, 0]
}

export function rotate2(a: Vec2, angle: number): Vec2 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return [a[0] * c - a[1] * s, a[0] * s + a[1] * c]
}

/** Normalize an angle into [0, 2π). */
export function wrapAngle(t: number): number {
  t %= TAU
  return t < 0 ? t + TAU : t
}

/** Signed angle from a to b in (-π, π]. */
export function angleBetween(a: Vec2, b: Vec2): number {
  return Math.atan2(cross2(a, b), dot2(a, b))
}

/** Intersection of infinite lines p + t·d and q + u·e. Returns [t, u] or null when parallel. */
export function lineLineParams(p: Vec2, d: Vec2, q: Vec2, e: Vec2): [number, number] | null {
  const den = cross2(d, e)
  if (Math.abs(den) < 1e-12) return null
  const w: Vec2 = [q[0] - p[0], q[1] - p[1]]
  return [cross2(w, e) / den, cross2(w, d) / den]
}

export function lineIntersection(p: Vec2, d: Vec2, q: Vec2, e: Vec2): Vec2 | null {
  const r = lineLineParams(p, d, q, e)
  return r ? [p[0] + d[0] * r[0], p[1] + d[1] * r[0]] : null
}

/** Segment a-b vs c-d proper intersection parameters (both within [0,1]) or null. */
export function segmentIntersection(a: Vec2, b: Vec2, c: Vec2, d: Vec2, eps = 1e-9): { t: number; u: number; p: Vec2 } | null {
  const r = lineLineParams(a, sub2(b, a), c, sub2(d, c))
  if (!r) return null
  const [t, u] = r
  if (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps) return null
  return { t, u, p: lerp2(a, b, t) }
}

/** Closest-point parameter of p on the infinite line a→b (0 at a, 1 at b). */
export function projectParam(a: Vec2, b: Vec2, p: Vec2): number {
  const d = sub2(b, a)
  const l2 = dot2(d, d)
  return l2 > 0 ? dot2(sub2(p, a), d) / l2 : 0
}

export function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const t = Math.max(0, Math.min(1, projectParam(a, b, p)))
  return dist2(p, lerp2(a, b, t))
}

/** Signed distance of p from the line a→b (positive on the left). */
export function signedLineDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const d = normalize2(sub2(b, a))
  return cross2(d, sub2(p, a))
}

// ------------------------------------------------------------------ polygons
export function polygonArea(pts: readonly Vec2[]): number {
  let a = 0
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i]!
    const q = pts[(i + 1) % n]!
    a += p[0] * q[1] - q[0] * p[1]
  }
  return a * 0.5
}

export const isCCW = (pts: readonly Vec2[]): boolean => polygonArea(pts) > 0

export function ensureCCW(pts: Vec2[]): Vec2[] {
  return polygonArea(pts) < 0 ? pts.slice().reverse() : pts
}
export function ensureCW(pts: Vec2[]): Vec2[] {
  return polygonArea(pts) > 0 ? pts.slice().reverse() : pts
}

export function polygonCentroid(pts: readonly Vec2[]): Vec2 {
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i]!
    const q = pts[(i + 1) % n]!
    const w = p[0] * q[1] - q[0] * p[1]
    a += w
    cx += (p[0] + q[0]) * w
    cy += (p[1] + q[1]) * w
  }
  if (Math.abs(a) < 1e-12) {
    let sx = 0
    let sy = 0
    for (const p of pts) {
      sx += p[0]
      sy += p[1]
    }
    return pts.length ? [sx / pts.length, sy / pts.length] : [0, 0]
  }
  return [cx / (3 * a), cy / (3 * a)]
}

export function polygonPerimeter(pts: readonly Vec2[], closed = true): number {
  let l = 0
  const n = pts.length
  for (let i = 0; i < (closed ? n : n - 1); i++) l += dist2(pts[i]!, pts[(i + 1) % n]!)
  return l
}

export interface Bounds2 {
  min: Vec2
  max: Vec2
}

export function bounds2(pts: readonly Vec2[]): Bounds2 {
  const min: Vec2 = [Infinity, Infinity]
  const max: Vec2 = [-Infinity, -Infinity]
  for (const p of pts) {
    if (p[0] < min[0]) min[0] = p[0]
    if (p[1] < min[1]) min[1] = p[1]
    if (p[0] > max[0]) max[0] = p[0]
    if (p[1] > max[1]) max[1] = p[1]
  }
  return { min, max }
}

/** Ray-casting point in polygon (boundary counts as inside). */
export function pointInPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false
  const x = p[0]
  const y = p[1]
  for (let i = 0, n = poly.length, j = n - 1; i < n; j = i++) {
    const a = poly[i]!
    const b = poly[j]!
    if (a[1] > y !== b[1] > y) {
      const xi = ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]
      if (x < xi) inside = !inside
    }
  }
  return inside
}

export function pointInPolygonWithHoles(p: Vec2, outer: readonly Vec2[], holes: readonly (readonly Vec2[])[] = []): boolean {
  if (!pointInPolygon(p, outer)) return false
  for (const h of holes) if (pointInPolygon(p, h)) return false
  return true
}

/** Remove consecutive duplicates and collinear vertices. */
export function cleanPolygon(pts: readonly Vec2[], eps = GEOM_EPS): Vec2[] {
  const out: Vec2[] = []
  for (const p of pts) if (!out.length || !eq2(out[out.length - 1]!, p, eps)) out.push(p)
  while (out.length > 1 && eq2(out[0]!, out[out.length - 1]!, eps)) out.pop()
  if (out.length < 3) return out
  const res: Vec2[] = []
  for (let i = 0; i < out.length; i++) {
    const a = out[(i + out.length - 1) % out.length]!
    const b = out[i]!
    const c = out[(i + 1) % out.length]!
    const cr = cross2(sub2(b, a), sub2(c, b))
    if (Math.abs(cr) > eps * eps * 10 || dot2(sub2(b, a), sub2(c, b)) < 0) res.push(b)
  }
  return res.length >= 3 ? res : out
}

/** Andrew's monotone chain convex hull (CCW). */
export function convexHull(points: readonly Vec2[]): Vec2[] {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (pts.length < 3) return pts
  const lower: Vec2[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross2(sub2(lower[lower.length - 1]!, lower[lower.length - 2]!), sub2(p, lower[lower.length - 2]!)) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: Vec2[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!
    while (upper.length >= 2 && cross2(sub2(upper[upper.length - 1]!, upper[upper.length - 2]!), sub2(p, upper[upper.length - 2]!)) <= 0) upper.pop()
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

export interface OBB {
  center: Vec2
  /** unit direction of the long side */
  axis: Vec2
  /** half extents along axis / perpendicular */
  halfLength: number
  halfWidth: number
}

/** Minimum-area oriented bounding box (rotating calipers over hull edges). */
export function orientedBoundingBox(points: readonly Vec2[]): OBB {
  const hull = convexHull(points)
  if (hull.length < 2) {
    const c = hull[0] ?? [0, 0]
    return { center: c, axis: [1, 0], halfLength: 0, halfWidth: 0 }
  }
  let best: OBB | null = null
  let bestArea = Infinity
  for (let i = 0; i < hull.length; i++) {
    const d = normalize2(sub2(hull[(i + 1) % hull.length]!, hull[i]!))
    const n = perp2(d)
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity
    for (const p of hull) {
      const u = dot2(p, d)
      const v = dot2(p, n)
      if (u < minU) minU = u
      if (u > maxU) maxU = u
      if (v < minV) minV = v
      if (v > maxV) maxV = v
    }
    const area = (maxU - minU) * (maxV - minV)
    if (area < bestArea) {
      bestArea = area
      const cu = (minU + maxU) / 2
      const cv = (minV + maxV) / 2
      const long = maxU - minU >= maxV - minV
      best = {
        center: [d[0] * cu + n[0] * cv, d[1] * cu + n[1] * cv],
        axis: long ? d : n,
        halfLength: (long ? maxU - minU : maxV - minV) / 2,
        halfWidth: (long ? maxV - minV : maxU - minU) / 2,
      }
    }
  }
  return best!
}

// ------------------------------------------------------------------ arcs
export interface Arc {
  center: Vec2
  radius: number
  /** start angle (rad) */
  a0: number
  /** signed sweep (rad); positive = CCW */
  sweep: number
}

/** Arc through a→b with DXF bulge = tan(θ/4); positive bulge = CCW. */
export function arcFromBulge(a: Vec2, b: Vec2, bulge: number): Arc | null {
  if (Math.abs(bulge) < 1e-9) return null
  const theta = 4 * Math.atan(bulge)
  const chord = dist2(a, b)
  if (chord < EPS) return null
  const radius = chord / (2 * Math.sin(Math.abs(theta) / 2))
  const m = mid2(a, b)
  const d = normalize2(sub2(b, a))
  const n = perp2(d)
  // sagitta direction: for CCW (bulge>0) the center lies to the left of the chord when |θ| < π
  const h = Math.sqrt(Math.max(0, radius * radius - (chord * chord) / 4)) * (Math.abs(theta) > Math.PI ? -1 : 1)
  const sign = bulge > 0 ? 1 : -1
  const center: Vec2 = [m[0] + n[0] * h * sign, m[1] + n[1] * h * sign]
  const a0 = Math.atan2(a[1] - center[1], a[0] - center[0])
  return { center, radius, a0, sweep: theta }
}

export function arcPoint(arc: Arc, t: number): Vec2 {
  const ang = arc.a0 + arc.sweep * t
  return [arc.center[0] + Math.cos(ang) * arc.radius, arc.center[1] + Math.sin(ang) * arc.radius]
}

/** Segment count for an arc of given radius/sweep so the chord error stays below `tol`. */
export function arcSegments(radius: number, sweep: number, tol = 0.002, min = 4, max = 256): number {
  const r = Math.abs(radius)
  if (r <= tol) return min
  const step = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tol / r)))
  return Math.max(min, Math.min(max, Math.ceil(Math.abs(sweep) / Math.max(step, 1e-3))))
}

/** Tessellate an arc into points (includes both ends). */
export function tessellateArc(arc: Arc, segments = arcSegments(arc.radius, arc.sweep)): Vec2[] {
  const out: Vec2[] = new Array(segments + 1)
  for (let i = 0; i <= segments; i++) out[i] = arcPoint(arc, i / segments)
  return out
}

export function circlePoints(center: Vec2, radius: number, segments: number, start = 0): Vec2[] {
  const out: Vec2[] = new Array(segments)
  for (let i = 0; i < segments; i++) {
    const t = start + (i / segments) * TAU
    out[i] = [center[0] + Math.cos(t) * radius, center[1] + Math.sin(t) * radius]
  }
  return out
}

/** Expand a polyline with per-vertex DXF bulges into a dense polyline. */
export function expandBulges(points: readonly Vec2[], bulges: readonly number[] | undefined, closed: boolean, tol = 0.002): Vec2[] {
  if (!bulges || !bulges.some((b) => Math.abs(b) > 1e-9)) return points.slice()
  const n = points.length
  const out: Vec2[] = []
  const segs = closed ? n : n - 1
  for (let i = 0; i < segs; i++) {
    const a = points[i]!
    const b = points[(i + 1) % n]!
    const arc = arcFromBulge(a, b, bulges[i] ?? 0)
    if (!arc) {
      out.push(a)
      continue
    }
    const pts = tessellateArc(arc, arcSegments(arc.radius, arc.sweep, tol))
    for (let k = 0; k < pts.length - 1; k++) out.push(pts[k]!)
  }
  if (!closed) out.push(points[n - 1]!)
  return out
}

// ------------------------------------------------------------------ curves
/** Adaptive flattening of a cubic Bézier (appends points after p0, including p3). */
export function flattenCubic(p0: Vec2, c0: Vec2, c1: Vec2, p3: Vec2, out: Vec2[], tol = 0.001): void {
  // flatness estimate: max distance of control points from the chord
  const dd = Math.max(pointSegmentDistance(c0, p0, p3), pointSegmentDistance(c1, p0, p3))
  const chord = dist2(p0, p3)
  const n = Math.max(1, Math.min(64, Math.ceil(Math.sqrt((dd / Math.max(tol, 1e-6)) * 0.75) + chord / 0.5)))
  for (let i = 1; i <= n; i++) {
    const t = i / n
    const mt = 1 - t
    const a = mt * mt * mt
    const b = 3 * mt * mt * t
    const c = 3 * mt * t * t
    const d = t * t * t
    out.push([a * p0[0] + b * c0[0] + c * c1[0] + d * p3[0], a * p0[1] + b * c0[1] + c * c1[1] + d * p3[1]])
  }
}

export function flattenQuadratic(p0: Vec2, c: Vec2, p2: Vec2, out: Vec2[], tol = 0.001): void {
  const c0: Vec2 = [p0[0] + (2 / 3) * (c[0] - p0[0]), p0[1] + (2 / 3) * (c[1] - p0[1])]
  const c1: Vec2 = [p2[0] + (2 / 3) * (c[0] - p2[0]), p2[1] + (2 / 3) * (c[1] - p2[1])]
  flattenCubic(p0, c0, c1, p2, out, tol)
}

/** Catmull-Rom interpolation of a polyline (open or closed), `sub` samples per span. */
export function catmullRom(points: readonly Vec2[], sub: number, closed: boolean): Vec2[] {
  const n = points.length
  if (n < 3 || sub <= 1) return points.slice()
  const out: Vec2[] = []
  const get = (i: number) => (closed ? points[((i % n) + n) % n]! : points[Math.max(0, Math.min(n - 1, i))]!)
  const spans = closed ? n : n - 1
  for (let i = 0; i < spans; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2)
    for (let k = 0; k < sub; k++) {
      const t = k / sub
      const t2 = t * t
      const t3 = t2 * t
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ])
    }
  }
  if (!closed) out.push(points[n - 1]!)
  return out
}

/** Resample a polyline to `count` points equally spaced by arc length. */
export function resamplePolyline(points: readonly Vec2[], count: number, closed: boolean): Vec2[] {
  const n = points.length
  if (n === 0) return []
  const total = polygonPerimeter(points, closed)
  if (total < EPS || n === 1) return Array.from({ length: count }, () => [points[0]![0], points[0]![1]] as Vec2)
  const segs = closed ? n : n - 1
  const step = total / (closed ? count : count - 1)
  const out: Vec2[] = []
  let si = 0
  let acc = 0
  let segLen = dist2(points[0]!, points[1 % n]!)
  for (let i = 0; i < count; i++) {
    const target = Math.min(total, i * step)
    while (si < segs - 1 && acc + segLen < target - 1e-12) {
      acc += segLen
      si++
      segLen = dist2(points[si]!, points[(si + 1) % n]!)
    }
    const t = segLen > EPS ? Math.max(0, Math.min(1, (target - acc) / segLen)) : 0
    out.push(lerp2(points[si]!, points[(si + 1) % n]!, t))
  }
  return out
}

/** 2D affine transform [a b c d tx ty] applied as x' = a·x + c·y + tx, y' = b·x + d·y + ty. */
export type Affine2 = [number, number, number, number, number, number]

export const IDENTITY_AFFINE: Affine2 = [1, 0, 0, 1, 0, 0]

export function applyAffine(m: Affine2, p: Vec2): Vec2 {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]]
}

export function affineIsIdentity(m: Affine2, eps = 1e-12): boolean {
  return Math.abs(m[0] - 1) < eps && Math.abs(m[1]) < eps && Math.abs(m[2]) < eps && Math.abs(m[3] - 1) < eps && Math.abs(m[4]) < eps && Math.abs(m[5]) < eps
}

/** Extract the XY part of a column-major 4×4 as a 2D affine (valid for planar transforms). */
export function affineFromMat4(m: ArrayLike<number>): Affine2 {
  return [m[0]!, m[1]!, m[4]!, m[5]!, m[12]!, m[13]!]
}

export const to3 = (p: Vec2, z = 0): Vec3 => [p[0], p[1], z]
