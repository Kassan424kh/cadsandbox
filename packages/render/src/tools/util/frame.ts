// Node placement on a work plane: builds the parent-local Transform of a node whose local XY must
// coincide with the plane (rotated by `yaw` inside the plane). Plan planes reduce to a Z rotation.
import type { Quat, Transform, Vec2, Vec3 } from '@cadsandbox/doc'
import { decomposeMatrix, multiplyQuat, normalizeQuat } from '@cadsandbox/doc'
import type { ToolContext, WorkPlane } from '../types'
import { fromPlane, quatZ, v3 } from './vec'

/** Quaternion whose rotation maps local X→u, Y→v, Z→normal. */
export function planeQuat(plane: WorkPlane): Quat {
  const u = plane.u,
    v = plane.v,
    n = plane.normal
  // Column-major rotation matrix → quaternion.
  const m00 = u[0], m01 = v[0], m02 = n[0]
  const m10 = u[1], m11 = v[1], m12 = n[1]
  const m20 = u[2], m21 = v[2], m22 = n[2]
  const trace = m00 + m11 + m22
  let q: Quat
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1)
    q = [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s]
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22)
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22)
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11)
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s]
  }
  return normalizeQuat(q)
}

export function conjugate(q: Quat): Quat {
  return [-q[0], -q[1], -q[2], q[3]]
}

export function isPlanPlane(plane: WorkPlane): boolean {
  return Math.abs(plane.normal[2]) > 1 - 1e-9 && Math.abs(plane.u[0]) > 1 - 1e-9
}

/** Transform (parent-local) placing a node at plane point `uv`, rotated by `yaw` within the plane. */
export function nodeTransformOnPlane(ctx: ToolContext, parent: string | null, plane: WorkPlane, uv: Vec2, yaw = 0): Transform {
  const world = fromPlane(plane, uv)
  const p = ctx.toLocal(parent, world)
  if (isPlanPlane(plane)) return { p, r: quatZ(yaw), s: [1, 1, 1] }
  const parentQuat = decomposeMatrix(ctx.doc.getWorldMatrix(parent)).r
  const r = normalizeQuat(multiplyQuat(conjugate(parentQuat), multiplyQuat(planeQuat(plane), quatZ(yaw))))
  return { p, r, s: [1, 1, 1] }
}

/** World points of a polygon given in plane UV. */
export function uvPolygonToWorld(plane: WorkPlane, poly: readonly Vec2[], w = 0): Vec3[] {
  return poly.map((p) => fromPlane(plane, p, w))
}

/** Length of a world vector projected on the plane normal. */
export function heightAbovePlane(plane: WorkPlane, p: Vec3): number {
  return v3.dot(v3.sub(p, plane.origin), plane.normal)
}
