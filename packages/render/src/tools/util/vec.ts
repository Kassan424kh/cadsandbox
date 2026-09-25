// Small 2D/3D vector + work-plane helpers shared by all tools. Meters, radians, Z-up.
import type { Quat, Vec2, Vec3 } from '@cadsandbox/doc'
import type { WorkPlane } from '../types'

export const TAU = Math.PI * 2
export const EPS = 1e-9

export const v2 = {
  add: (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]],
  sub: (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]],
  scale: (a: Vec2, s: number): Vec2 => [a[0] * s, a[1] * s],
  dot: (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1],
  cross: (a: Vec2, b: Vec2): number => a[0] * b[1] - a[1] * b[0],
  len: (a: Vec2): number => Math.hypot(a[0], a[1]),
  dist: (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]),
  norm: (a: Vec2): Vec2 => {
    const l = Math.hypot(a[0], a[1]) || 1
    return [a[0] / l, a[1] / l]
  },
  /** CCW perpendicular (left normal). */
  perp: (a: Vec2): Vec2 => [-a[1], a[0]],
  lerp: (a: Vec2, b: Vec2, t: number): Vec2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
  mid: (a: Vec2, b: Vec2): Vec2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
  angle: (a: Vec2): number => Math.atan2(a[1], a[0]),
  fromAngle: (ang: number, len = 1): Vec2 => [Math.cos(ang) * len, Math.sin(ang) * len],
  rotate: (a: Vec2, ang: number, about: Vec2 = [0, 0]): Vec2 => {
    const c = Math.cos(ang),
      s = Math.sin(ang)
    const x = a[0] - about[0],
      y = a[1] - about[1]
    return [about[0] + x * c - y * s, about[1] + x * s + y * c]
  },
  eq: (a: Vec2, b: Vec2, tol = 1e-6): boolean => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol,
}

export const v3 = {
  add: (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a: Vec3): number => Math.hypot(a[0], a[1], a[2]),
  dist: (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
  norm: (a: Vec3): Vec3 => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1
    return [a[0] / l, a[1] / l, a[2] / l]
  },
  lerp: (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
  mid: (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
  eq: (a: Vec3, b: Vec3, tol = 1e-6): boolean =>
    Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol,
  xy: (a: Vec3): Vec2 => [a[0], a[1]],
  of2: (a: Vec2, z = 0): Vec3 => [a[0], a[1], z],
}

/** Normalize an angle into (-π, π]. */
export function wrapAngle(a: number): number {
  a = a % TAU
  if (a > Math.PI) a -= TAU
  if (a <= -Math.PI) a += TAU
  return a
}

/** Normalize an angle into [0, 2π). */
export function positiveAngle(a: number): number {
  a = a % TAU
  return a < 0 ? a + TAU : a
}

/** Quaternion for a rotation about +Z. */
export function quatZ(angle: number): Quat {
  return [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)]
}

/** Z rotation angle of a quaternion (assumes the rotation is about Z; otherwise the projected yaw). */
export function yawOf(q: Quat): number {
  const [x, y, z, w] = q
  return Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))
}

/** Quaternion rotating +Z onto `normal` (shortest arc). */
export function quatFromZTo(normal: Vec3): Quat {
  const n = v3.norm(normal)
  const d = n[2]
  if (d > 1 - 1e-9) return [0, 0, 0, 1]
  if (d < -1 + 1e-9) return [1, 0, 0, 0] // 180° about X
  const axis = v3.cross([0, 0, 1], n)
  const s = Math.sqrt((1 + d) * 2)
  const inv = 1 / s
  return [axis[0] * inv, axis[1] * inv, axis[2] * inv, s / 2]
}

// ------------------------------------------------------------------ work plane
/** World point → (u, v) in-plane coordinates. */
export function toPlane(plane: WorkPlane, p: Vec3): Vec2 {
  const d = v3.sub(p, plane.origin)
  return [v3.dot(d, plane.u), v3.dot(d, plane.v)]
}

/** (u, v[, w]) plane coordinates → world point. */
export function fromPlane(plane: WorkPlane, uv: Vec2, w = 0): Vec3 {
  const o = plane.origin
  return [
    o[0] + plane.u[0] * uv[0] + plane.v[0] * uv[1] + plane.normal[0] * w,
    o[1] + plane.u[1] * uv[0] + plane.v[1] * uv[1] + plane.normal[1] * w,
    o[2] + plane.u[2] * uv[0] + plane.v[2] * uv[1] + plane.normal[2] * w,
  ]
}

/** Signed distance of a world point from the plane. */
export function planeDistance(plane: WorkPlane, p: Vec3): number {
  return v3.dot(v3.sub(p, plane.origin), plane.normal)
}

/** Project a world point onto the plane. */
export function projectToPlane(plane: WorkPlane, p: Vec3): Vec3 {
  return v3.sub(p, v3.scale(plane.normal, planeDistance(plane, p)))
}

/** Horizontal (XY) work plane at elevation z. */
export function planeAtZ(z: number, levelId: string | null = null): WorkPlane {
  return { origin: [0, 0, z], normal: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], levelId }
}

/** Build an orthonormal plane from an origin and a normal (u chosen stable: horizontal when possible). */
export function planeFromNormal(origin: Vec3, normal: Vec3, levelId: string | null = null): WorkPlane {
  const n = v3.norm(normal)
  let u: Vec3
  if (Math.abs(n[2]) > 0.9) u = v3.norm(v3.cross([0, 1, 0], n))
  else u = v3.norm(v3.cross([0, 0, 1], n))
  if (Math.abs(n[2]) > 0.9 && n[2] < 0) u = v3.scale(u, -1)
  const v = v3.norm(v3.cross(n, u))
  return { origin: [...origin] as Vec3, normal: n, u, v, levelId }
}

/** Ray ∩ plane, or null when parallel / behind the origin. */
export function intersectRayPlane(origin: Vec3, dir: Vec3, plane: WorkPlane): Vec3 | null {
  const denom = v3.dot(dir, plane.normal)
  if (Math.abs(denom) < 1e-12) return null
  const t = v3.dot(v3.sub(plane.origin, origin), plane.normal) / denom
  if (t < 0) return null
  return v3.add(origin, v3.scale(dir, t))
}

/** Parameter along the line (a, dir) of the point on that line closest to the ray (origin, rayDir). */
export function closestLineParamToRay(a: Vec3, dir: Vec3, origin: Vec3, rayDir: Vec3): number {
  // Solve for s (line) and t (ray) minimizing |a + s·dir − (origin + t·rayDir)|.
  const w = v3.sub(a, origin)
  const aa = v3.dot(dir, dir)
  const bb = v3.dot(dir, rayDir)
  const cc = v3.dot(rayDir, rayDir)
  const dd = v3.dot(dir, w)
  const ee = v3.dot(rayDir, w)
  const denom = aa * cc - bb * bb
  if (Math.abs(denom) < 1e-12) return 0
  return (bb * ee - cc * dd) / denom
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}

/** Round to a step (e.g. 0.05 m); step ≤ 0 returns x unchanged. */
export function roundTo(x: number, step: number): number {
  return step > 0 ? Math.round(x / step) * step : x
}

export function approx(a: number, b: number, tol = 1e-6): boolean {
  return Math.abs(a - b) <= tol
}
