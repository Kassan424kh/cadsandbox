// Minimal float64 transform math (column-major 4×4, same layout as three.js Matrix4.elements).
// Kept dependency-free so the document model runs anywhere (workers, server, tests).
import type { Quat, Transform, Vec2, Vec3 } from './types'

export type Mat4 = Float64Array

export const IDENTITY_TRANSFORM: Readonly<Transform> = Object.freeze({
  p: [0, 0, 0] as Vec3,
  r: [0, 0, 0, 1] as Quat,
  s: [1, 1, 1] as Vec3,
})

export function identityTransform(): Transform {
  return { p: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }
}

export function cloneTransform(t: Transform): Transform {
  return { p: [...t.p] as Vec3, r: [...t.r] as Quat, s: [...t.s] as Vec3 }
}

export function mat4Identity(): Mat4 {
  const m = new Float64Array(16)
  m[0] = m[5] = m[10] = m[15] = 1
  return m
}

export function composeMatrix(t: Transform, out: Mat4 = new Float64Array(16)): Mat4 {
  const [x, y, z, w] = t.r
  const [sx, sy, sz] = t.s
  const x2 = x + x,
    y2 = y + y,
    z2 = z + z
  const xx = x * x2,
    xy = x * y2,
    xz = x * z2
  const yy = y * y2,
    yz = y * z2,
    zz = z * z2
  const wx = w * x2,
    wy = w * y2,
    wz = w * z2
  out[0] = (1 - (yy + zz)) * sx
  out[1] = (xy + wz) * sx
  out[2] = (xz - wy) * sx
  out[3] = 0
  out[4] = (xy - wz) * sy
  out[5] = (1 - (xx + zz)) * sy
  out[6] = (yz + wx) * sy
  out[7] = 0
  out[8] = (xz + wy) * sz
  out[9] = (yz - wx) * sz
  out[10] = (1 - (xx + yy)) * sz
  out[11] = 0
  out[12] = t.p[0]
  out[13] = t.p[1]
  out[14] = t.p[2]
  out[15] = 1
  return out
}

export function multiplyMatrices(a: Mat4, b: Mat4, out: Mat4 = new Float64Array(16)): Mat4 {
  const a11 = a[0]!, a12 = a[4]!, a13 = a[8]!, a14 = a[12]!
  const a21 = a[1]!, a22 = a[5]!, a23 = a[9]!, a24 = a[13]!
  const a31 = a[2]!, a32 = a[6]!, a33 = a[10]!, a34 = a[14]!
  const a41 = a[3]!, a42 = a[7]!, a43 = a[11]!, a44 = a[15]!
  const b11 = b[0]!, b12 = b[4]!, b13 = b[8]!, b14 = b[12]!
  const b21 = b[1]!, b22 = b[5]!, b23 = b[9]!, b24 = b[13]!
  const b31 = b[2]!, b32 = b[6]!, b33 = b[10]!, b34 = b[14]!
  const b41 = b[3]!, b42 = b[7]!, b43 = b[11]!, b44 = b[15]!
  out[0] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41
  out[4] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42
  out[8] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43
  out[12] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44
  out[1] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41
  out[5] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42
  out[9] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43
  out[13] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44
  out[2] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41
  out[6] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42
  out[10] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43
  out[14] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44
  out[3] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41
  out[7] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42
  out[11] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43
  out[15] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44
  return out
}

export function invertMatrix(m: Mat4, out: Mat4 = new Float64Array(16)): Mat4 {
  const n11 = m[0]!, n21 = m[1]!, n31 = m[2]!, n41 = m[3]!
  const n12 = m[4]!, n22 = m[5]!, n32 = m[6]!, n42 = m[7]!
  const n13 = m[8]!, n23 = m[9]!, n33 = m[10]!, n43 = m[11]!
  const n14 = m[12]!, n24 = m[13]!, n34 = m[14]!, n44 = m[15]!
  const t11 = n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44
  const t12 = n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44
  const t13 = n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44
  const t14 = n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34
  const det = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14
  if (det === 0) return mat4Identity()
  const d = 1 / det
  out[0] = t11 * d
  out[1] = (n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) * d
  out[2] = (n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) * d
  out[3] = (n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) * d
  out[4] = t12 * d
  out[5] = (n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) * d
  out[6] = (n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) * d
  out[7] = (n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) * d
  out[8] = t13 * d
  out[9] = (n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) * d
  out[10] = (n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) * d
  out[11] = (n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) * d
  out[12] = t14 * d
  out[13] = (n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) * d
  out[14] = (n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) * d
  out[15] = (n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) * d
  return out
}

/** Decompose an affine matrix into position/rotation/scale (shear is dropped). */
export function decomposeMatrix(m: Mat4): Transform {
  let sx = Math.hypot(m[0]!, m[1]!, m[2]!)
  const sy = Math.hypot(m[4]!, m[5]!, m[6]!)
  const sz = Math.hypot(m[8]!, m[9]!, m[10]!)
  const det =
    m[0]! * (m[5]! * m[10]! - m[9]! * m[6]!) -
    m[4]! * (m[1]! * m[10]! - m[9]! * m[2]!) +
    m[8]! * (m[1]! * m[6]! - m[5]! * m[2]!)
  if (det < 0) sx = -sx
  const isx = sx ? 1 / sx : 0,
    isy = sy ? 1 / sy : 0,
    isz = sz ? 1 / sz : 0
  const m11 = m[0]! * isx, m12 = m[4]! * isy, m13 = m[8]! * isz
  const m21 = m[1]! * isx, m22 = m[5]! * isy, m23 = m[9]! * isz
  const m31 = m[2]! * isx, m32 = m[6]! * isy, m33 = m[10]! * isz
  const trace = m11 + m22 + m33
  let x: number, y: number, z: number, w: number
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1)
    w = 0.25 / s
    x = (m32 - m23) * s
    y = (m13 - m31) * s
    z = (m21 - m12) * s
  } else if (m11 > m22 && m11 > m33) {
    const s = 2 * Math.sqrt(1 + m11 - m22 - m33)
    w = (m32 - m23) / s
    x = 0.25 * s
    y = (m12 + m21) / s
    z = (m13 + m31) / s
  } else if (m22 > m33) {
    const s = 2 * Math.sqrt(1 + m22 - m11 - m33)
    w = (m13 - m31) / s
    x = (m12 + m21) / s
    y = 0.25 * s
    z = (m23 + m32) / s
  } else {
    const s = 2 * Math.sqrt(1 + m33 - m11 - m22)
    w = (m21 - m12) / s
    x = (m13 + m31) / s
    y = (m23 + m32) / s
    z = 0.25 * s
  }
  return { p: [m[12]!, m[13]!, m[14]!], r: normalizeQuat([x, y, z, w]), s: [sx, sy, sz] }
}

export function transformPoint(m: Mat4, v: Vec3): Vec3 {
  const [x, y, z] = v
  const w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]! || 1
  return [
    (m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) / w,
    (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) / w,
    (m[2]! * x + m[6]! * y + m[10]! * z + m[14]!) / w,
  ]
}

export function transformDirection(m: Mat4, v: Vec3): Vec3 {
  const [x, y, z] = v
  const r: Vec3 = [m[0]! * x + m[4]! * y + m[8]! * z, m[1]! * x + m[5]! * y + m[9]! * z, m[2]! * x + m[6]! * y + m[10]! * z]
  const l = Math.hypot(r[0], r[1], r[2]) || 1
  return [r[0] / l, r[1] / l, r[2] / l]
}

export function translationMatrix(v: Vec3): Mat4 {
  const m = mat4Identity()
  m[12] = v[0]
  m[13] = v[1]
  m[14] = v[2]
  return m
}

// ---------------------------------------------------------------- quaternions
export function normalizeQuat(q: Quat): Quat {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]
}

export function multiplyQuat(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a
  const [bx, by, bz, bw] = b
  return [
    ax * bw + aw * bx + ay * bz - az * by,
    ay * bw + aw * by + az * bx - ax * bz,
    az * bw + aw * bz + ax * by - ay * bx,
    aw * bw - ax * bx - ay * by - az * bz,
  ]
}

export function quatFromAxisAngle(axis: Vec3, angle: number): Quat {
  const l = Math.hypot(axis[0], axis[1], axis[2]) || 1
  const s = Math.sin(angle / 2) / l
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)]
}

/** Euler XYZ (radians) → quaternion (three.js 'XYZ' order). */
export function quatFromEuler(x: number, y: number, z: number): Quat {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2)
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2)
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ]
}

/** Quaternion → Euler XYZ (radians). */
export function eulerFromQuat(q: Quat): Vec3 {
  const [x, y, z, w] = q
  const m11 = 1 - 2 * (y * y + z * z), m12 = 2 * (x * y - w * z), m13 = 2 * (x * z + w * y)
  const m22 = 1 - 2 * (x * x + z * z), m23 = 2 * (y * z - w * x)
  const m32 = 2 * (y * z + w * x), m33 = 1 - 2 * (x * x + y * y)
  const ey = Math.asin(Math.max(-1, Math.min(1, m13)))
  if (Math.abs(m13) < 0.9999999) return [Math.atan2(-m23, m33), ey, Math.atan2(-m12, m11)]
  return [Math.atan2(m32, m22), ey, 0]
}

export function rotateVec3(q: Quat, v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q
  const [vx, vy, vz] = v
  const tx = 2 * (qy * vz - qz * vy)
  const ty = 2 * (qz * vx - qx * vz)
  const tz = 2 * (qx * vy - qy * vx)
  return [vx + qw * tx + qy * tz - qz * ty, vy + qw * ty + qz * tx - qx * tz, vz + qw * tz + qx * ty - qy * tx]
}

// ---------------------------------------------------------------- 2D helpers
export function polygonArea(pts: readonly Vec2[]): number {
  let a = 0
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i]!, q = pts[(i + 1) % n]!
    a += p[0] * q[1] - q[0] * p[1]
  }
  return a / 2
}

export function polygonPerimeter(pts: readonly Vec2[], closed = true): number {
  let l = 0
  const n = pts.length
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const p = pts[i]!, q = pts[(i + 1) % n]!
    l += Math.hypot(q[0] - p[0], q[1] - p[1])
  }
  return l
}

export const vec3 = {
  add: (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s],
  len: (a: Vec3) => Math.hypot(a[0], a[1], a[2]),
  dist: (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
}
