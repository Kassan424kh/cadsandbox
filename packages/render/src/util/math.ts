// Small math helpers bridging @cadsandbox/doc tuples and three.js objects. Hot-path friendly:
// every function accepting an `out` parameter writes into it without allocating.
import * as THREE from 'three'
import type { Mat4 } from '@cadsandbox/doc'
import type { Quat, Transform, Vec2, Vec3 } from '@cadsandbox/doc'

export const EPS = 1e-9
export const TAU = Math.PI * 2
export const DEG = Math.PI / 180

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
export const roundTo = (v: number, step: number): number => (step > 0 ? Math.round(v / step) * step : v)
export const approxEq = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps

export function toV3(v: Vec3, out: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
  return out.set(v[0], v[1], v[2])
}

export function fromV3(v: THREE.Vector3): Vec3 {
  return [v.x, v.y, v.z]
}

export function toV2(v: Vec2, out: THREE.Vector2 = new THREE.Vector2()): THREE.Vector2 {
  return out.set(v[0], v[1])
}

export function toQuat(q: Quat, out: THREE.Quaternion = new THREE.Quaternion()): THREE.Quaternion {
  return out.set(q[0], q[1], q[2], q[3])
}

export function fromQuat(q: THREE.Quaternion): Quat {
  return [q.x, q.y, q.z, q.w]
}

/** Column-major float64 matrix (doc) → three Matrix4. */
export function mat4FromDoc(m: Mat4 | ArrayLike<number>, out: THREE.Matrix4 = new THREE.Matrix4()): THREE.Matrix4 {
  const e = out.elements
  for (let i = 0; i < 16; i++) e[i] = m[i]!
  return out
}

export function matrixFromTransform(t: Transform, out: THREE.Matrix4 = new THREE.Matrix4()): THREE.Matrix4 {
  return out.compose(_p.set(t.p[0], t.p[1], t.p[2]), _q.set(t.r[0], t.r[1], t.r[2], t.r[3]), _s.set(t.s[0], t.s[1], t.s[2]))
}

export function transformFromMatrix(m: THREE.Matrix4): Transform {
  m.decompose(_p, _q, _s)
  return { p: [_p.x, _p.y, _p.z], r: [_q.x, _q.y, _q.z, _q.w], s: [_s.x, _s.y, _s.z] }
}

export function vecAdd(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
export function vecSub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
export function vecScale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s]
}
export function vecDot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
export function vecCross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
export function vecLen(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2])
}
export function vecDist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}
export function vecNorm(a: Vec3): Vec3 {
  const l = vecLen(a) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}
export function vecLerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
}
export function vecEq(a: Vec3, b: Vec3, eps = 1e-9): boolean {
  return Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps && Math.abs(a[2] - b[2]) <= eps
}

/** Any vector perpendicular to n (unit). */
export function perpendicular(n: Vec3): Vec3 {
  const ax = Math.abs(n[0]),
    ay = Math.abs(n[1]),
    az = Math.abs(n[2])
  const ref: Vec3 = ax <= ay && ax <= az ? [1, 0, 0] : ay <= az ? [0, 1, 0] : [0, 0, 1]
  return vecNorm(vecCross(ref, n))
}

export function box3FromBounds(b: { min: Vec3; max: Vec3 }, out: THREE.Box3 = new THREE.Box3()): THREE.Box3 {
  out.min.set(b.min[0], b.min[1], b.min[2])
  out.max.set(b.max[0], b.max[1], b.max[2])
  return out
}

export function boundsFromBox3(b: THREE.Box3): { min: Vec3; max: Vec3 } {
  return { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] }
}

/** Ray/plane intersection; returns null when parallel or behind the origin (unless allowBehind). */
export function intersectRayPlane(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  planeOrigin: THREE.Vector3,
  planeNormal: THREE.Vector3,
  out: THREE.Vector3,
  allowBehind = false,
): THREE.Vector3 | null {
  const denom = planeNormal.dot(dir)
  if (Math.abs(denom) < 1e-12) return null
  const t = _tmp.copy(planeOrigin).sub(origin).dot(planeNormal) / denom
  if (t < 0 && !allowBehind) return null
  return out.copy(dir).multiplyScalar(t).add(origin)
}

/** Closest point on the line (p, d) to the ray (o, r): returns the parameter along the line. */
export function closestParamLineToRay(p: THREE.Vector3, d: THREE.Vector3, o: THREE.Vector3, r: THREE.Vector3): number {
  // Solve for s minimizing |p + s d - (o + t r)|
  const w0 = _tmp.copy(p).sub(o)
  const a = d.dot(d)
  const b = d.dot(r)
  const c = r.dot(r)
  const d0 = d.dot(w0)
  const e = r.dot(w0)
  const den = a * c - b * b
  if (Math.abs(den) < 1e-12) return 0
  return (b * e - c * d0) / den
}

export function normalizeAngle(a: number): number {
  a = a % TAU
  if (a < 0) a += TAU
  return a
}

export function shortestAngleDelta(from: number, to: number): number {
  let d = (to - from) % TAU
  if (d > Math.PI) d -= TAU
  if (d < -Math.PI) d += TAU
  return d
}

const _p = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _s = new THREE.Vector3()
const _tmp = new THREE.Vector3()
