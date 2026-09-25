// Pure snapping geometry (unit-tested): plane projection, grid, polar/ortho, perpendicular,
// segment closest points and 2D/3D segment intersections. Everything in meters, world space.
import type { Vec2, Vec3 } from '@cadsandbox/doc'
import type { WorkPlane } from '../tools/types'
import { vecAdd, vecCross, vecDot, vecLen, vecNorm, vecScale, vecSub } from '../util/math'

export function makePlane(origin: Vec3, normal: Vec3, uHint?: Vec3, levelId: string | null = null): WorkPlane {
  const n = vecNorm(normal)
  let u = uHint ? vecSub(uHint, vecScale(n, vecDot(uHint, n))) : null
  if (!u || vecLen(u) < 1e-9) {
    const ref: Vec3 = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0]
    u = vecCross(ref, n)
    // for horizontal planes prefer u = +X
    if (Math.abs(n[2]) >= 0.9) u = [1, 0, 0]
  }
  u = vecNorm(u)
  const v = vecNorm(vecCross(n, u))
  return { origin, normal: n, u, v, levelId }
}

/** Plane-local (u, v) coordinates of a world point. */
export function planeUV(plane: WorkPlane, p: Vec3): Vec2 {
  const d = vecSub(p, plane.origin)
  return [vecDot(d, plane.u), vecDot(d, plane.v)]
}

export function planePoint(plane: WorkPlane, uv: Vec2, offset = 0): Vec3 {
  return vecAdd(vecAdd(vecAdd(plane.origin, vecScale(plane.u, uv[0])), vecScale(plane.v, uv[1])), vecScale(plane.normal, offset))
}

/** Orthogonal projection onto the plane. */
export function projectToPlane(plane: WorkPlane, p: Vec3): Vec3 {
  const d = vecDot(vecSub(p, plane.origin), plane.normal)
  return vecSub(p, vecScale(plane.normal, d))
}

export function rayPlane(origin: Vec3, dir: Vec3, plane: WorkPlane, allowBehind = false): Vec3 | null {
  const denom = vecDot(plane.normal, dir)
  if (Math.abs(denom) < 1e-12) return null
  const t = vecDot(vecSub(plane.origin, origin), plane.normal) / denom
  if (t < 0 && !allowBehind) return null
  return vecAdd(origin, vecScale(dir, t))
}

/** Snap to the grid of the plane (grid aligned with plane u/v through plane origin). */
export function snapToGrid(plane: WorkPlane, p: Vec3, step: number): Vec3 {
  if (step <= 0) return p
  const uv = planeUV(plane, p)
  return planePoint(plane, [Math.round(uv[0] / step) * step, Math.round(uv[1] / step) * step], vecDot(vecSub(p, plane.origin), plane.normal))
}

/** Constrain `p` so that the direction from → p is a multiple of `stepRad` within the plane. */
export function polarSnap(plane: WorkPlane, from: Vec3, p: Vec3, stepRad: number): { point: Vec3; angle: number } | null {
  const a = planeUV(plane, from)
  const b = planeUV(plane, p)
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = Math.hypot(dx, dy)
  if (len < 1e-9 || stepRad <= 0) return null
  const ang = Math.atan2(dy, dx)
  const snapped = Math.round(ang / stepRad) * stepRad
  const uv: Vec2 = [a[0] + Math.cos(snapped) * len, a[1] + Math.sin(snapped) * len]
  return { point: planePoint(plane, uv, vecDot(vecSub(p, plane.origin), plane.normal)), angle: snapped }
}

/** Ortho lock: axis-aligned (plane u or v) from `from`. */
export function orthoSnap(plane: WorkPlane, from: Vec3, p: Vec3): { point: Vec3; axis: 'u' | 'v' } {
  const a = planeUV(plane, from)
  const b = planeUV(plane, p)
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const h = vecDot(vecSub(p, plane.origin), plane.normal)
  if (Math.abs(dx) >= Math.abs(dy)) return { point: planePoint(plane, [b[0], a[1]], h), axis: 'u' }
  return { point: planePoint(plane, [a[0], b[1]], h), axis: 'v' }
}

/** Closest point on segment ab to p; returns point and parameter t∈[0,1]. */
export function closestPointOnSegment(p: Vec3, a: Vec3, b: Vec3): { point: Vec3; t: number; dist: number } {
  const ab = vecSub(b, a)
  const l2 = vecDot(ab, ab)
  let t = l2 > 0 ? vecDot(vecSub(p, a), ab) / l2 : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const point = vecAdd(a, vecScale(ab, t))
  return { point, t, dist: vecLen(vecSub(p, point)) }
}

/** Foot of the perpendicular from `from` onto the infinite line through a-b (null if degenerate). */
export function perpendicularFoot(from: Vec3, a: Vec3, b: Vec3): Vec3 | null {
  const ab = vecSub(b, a)
  const l2 = vecDot(ab, ab)
  if (l2 < 1e-18) return null
  const t = vecDot(vecSub(from, a), ab) / l2
  return vecAdd(a, vecScale(ab, t))
}

/** Point on the line (a→b, extended) closest to p — used for extension snapping. */
export function closestPointOnLine(p: Vec3, a: Vec3, b: Vec3): { point: Vec3; t: number } | null {
  const ab = vecSub(b, a)
  const l2 = vecDot(ab, ab)
  if (l2 < 1e-18) return null
  const t = vecDot(vecSub(p, a), ab) / l2
  return { point: vecAdd(a, vecScale(ab, t)), t }
}

/** Intersection of 2D segments (p1,p2) and (p3,p4); `extend` allows intersections beyond the ends. */
export function intersectSegments2D(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2, extend = false): Vec2 | null {
  const d1x = p2[0] - p1[0]
  const d1y = p2[1] - p1[1]
  const d2x = p4[0] - p3[0]
  const d2y = p4[1] - p3[1]
  const den = d1x * d2y - d1y * d2x
  if (Math.abs(den) < 1e-12) return null
  const t = ((p3[0] - p1[0]) * d2y - (p3[1] - p1[1]) * d2x) / den
  const u = ((p3[0] - p1[0]) * d1y - (p3[1] - p1[1]) * d1x) / den
  if (!extend && (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9)) return null
  return [p1[0] + t * d1x, p1[1] + t * d1y]
}

/** Closest points between two 3D segments; reports an intersection when they (nearly) touch. */
export function segmentsClosest(a0: Vec3, a1: Vec3, b0: Vec3, b1: Vec3): { pa: Vec3; pb: Vec3; dist: number } {
  const u = vecSub(a1, a0)
  const v = vecSub(b1, b0)
  const w = vecSub(a0, b0)
  const a = vecDot(u, u)
  const b = vecDot(u, v)
  const c = vecDot(v, v)
  const d = vecDot(u, w)
  const e = vecDot(v, w)
  const D = a * c - b * b
  let sN: number, sD = D, tN: number, tD = D
  if (D < 1e-12) {
    sN = 0
    sD = 1
    tN = e
    tD = c
  } else {
    sN = b * e - c * d
    tN = a * e - b * d
    if (sN < 0) {
      sN = 0
      tN = e
      tD = c
    } else if (sN > sD) {
      sN = sD
      tN = e + b
      tD = c
    }
  }
  if (tN < 0) {
    tN = 0
    if (-d < 0) sN = 0
    else if (-d > a) sN = sD
    else {
      sN = -d
      sD = a
    }
  } else if (tN > tD) {
    tN = tD
    if (-d + b < 0) sN = 0
    else if (-d + b > a) sN = sD
    else {
      sN = -d + b
      sD = a
    }
  }
  const sc = Math.abs(sN) < 1e-12 ? 0 : sN / sD
  const tc = Math.abs(tN) < 1e-12 ? 0 : tN / tD
  const pa = vecAdd(a0, vecScale(u, sc))
  const pb = vecAdd(b0, vecScale(v, tc))
  return { pa, pb, dist: vecLen(vecSub(pa, pb)) }
}

/** World axis a direction is (nearly) parallel to, for coloring inference guides. */
export function axisOf(dir: Vec3, tolerance = 0.02): 'x' | 'y' | 'z' | 'custom' {
  const n = vecNorm(dir)
  const ax = Math.abs(n[0]),
    ay = Math.abs(n[1]),
    az = Math.abs(n[2])
  if (ax > 1 - tolerance) return 'x'
  if (ay > 1 - tolerance) return 'y'
  if (az > 1 - tolerance) return 'z'
  return 'custom'
}

/** Nice grid step for a given world-per-pixel so that grid cells stay ≥ minPx apart. */
export function adaptiveGridStep(base: number, subdivisions: number, worldPerPixel: number, minPx = 8): number {
  let step = base / Math.max(1, subdivisions)
  const minWorld = worldPerPixel * minPx
  while (step < minWorld) step *= subdivisions > 1 ? subdivisions : 10
  return step
}
