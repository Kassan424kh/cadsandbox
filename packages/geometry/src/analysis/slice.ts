// Mesh ⨯ plane slicing → closed polylines (section caps, plan cuts).
import type { Vec2, Vec3 } from '@cadsandbox/doc'
import type { MeshBuffers } from '../api'
import { indicesOf, type Mat4Like } from '../core/mesh'

export interface Plane {
  point: Vec3
  normal: Vec3
}

/**
 * Intersect a mesh with a plane. Returns loops of 3D points (closed when the mesh is closed;
 * open chains are returned as-is). `matrix` transforms the mesh first (column-major 4×4).
 */
export function sliceMesh(mesh: MeshBuffers, plane: Plane, matrix?: Mat4Like): Vec3[][] {
  const pos = mesh.positions
  const idx = indicesOf(mesh)
  const n = pos.length / 3
  const x = new Float64Array(n), y = new Float64Array(n), z = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let px = pos[i * 3]!, py = pos[i * 3 + 1]!, pz = pos[i * 3 + 2]!
    if (matrix) {
      const m = matrix
      const tx = m[0]! * px + m[4]! * py + m[8]! * pz + m[12]!
      const ty = m[1]! * px + m[5]! * py + m[9]! * pz + m[13]!
      const tz = m[2]! * px + m[6]! * py + m[10]! * pz + m[14]!
      px = tx
      py = ty
      pz = tz
    }
    x[i] = px
    y[i] = py
    z[i] = pz
  }
  const nl = Math.hypot(plane.normal[0], plane.normal[1], plane.normal[2]) || 1
  const nx = plane.normal[0] / nl, ny = plane.normal[1] / nl, nz = plane.normal[2] / nl
  const d0 = nx * plane.point[0] + ny * plane.point[1] + nz * plane.point[2]
  const dist = new Float64Array(n)
  for (let i = 0; i < n; i++) dist[i] = nx * x[i]! + ny * y[i]! + nz * z[i]! - d0
  const segs: [Vec3, Vec3][] = []
  const cross = (a: number, b: number): Vec3 => {
    const da = dist[a]!, db = dist[b]!
    const t = da / (da - db)
    return [x[a]! + (x[b]! - x[a]!) * t, y[a]! + (y[b]! - y[a]!) * t, z[a]! + (z[b]! - z[a]!) * t]
  }
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i]!, b = idx[i + 1]!, c = idx[i + 2]!
    const sa = dist[a]! >= 0, sb = dist[b]! >= 0, sc = dist[c]! >= 0
    if (sa === sb && sb === sc) continue
    const pts: Vec3[] = []
    if (sa !== sb) pts.push(cross(a, b))
    if (sb !== sc) pts.push(cross(b, c))
    if (sc !== sa) pts.push(cross(c, a))
    if (pts.length === 2) segs.push([pts[0]!, pts[1]!])
  }
  return chainSegments(segs)
}

/** Horizontal cut at height z → 2D loops (plan cuts). */
export function sliceMeshZ(mesh: MeshBuffers, zCut: number, matrix?: Mat4Like): Vec2[][] {
  return sliceMesh(mesh, { point: [0, 0, zCut], normal: [0, 0, 1] }, matrix).map((loop) => loop.map((p) => [p[0], p[1]] as Vec2))
}

/** Chain segments into polylines by matching endpoints (quantized). */
export function chainSegments(segs: [Vec3, Vec3][], eps = 1e-6): Vec3[][] {
  const inv = 1 / eps
  const key = (p: Vec3) => `${Math.round(p[0] * inv)},${Math.round(p[1] * inv)},${Math.round(p[2] * inv)}`
  const byPoint = new Map<string, number[]>()
  segs.forEach((s, i) => {
    for (const p of s) {
      const k = key(p)
      let l = byPoint.get(k)
      if (!l) byPoint.set(k, (l = []))
      l.push(i)
    }
  })
  const used = new Uint8Array(segs.length)
  const loops: Vec3[][] = []
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue
    used[i] = 1
    const loop: Vec3[] = [segs[i]![0], segs[i]![1]]
    // extend forward
    for (const dir of [1, -1] as const) {
      let guard = 0
      while (guard++ < segs.length) {
        const end = dir === 1 ? loop[loop.length - 1]! : loop[0]!
        const cands = (byPoint.get(key(end)) ?? []).filter((j) => !used[j])
        if (!cands.length) break
        const j = cands[0]!
        used[j] = 1
        const s = segs[j]!
        const nxt = key(s[0]) === key(end) ? s[1] : s[0]
        if (key(nxt) === key(dir === 1 ? loop[0]! : loop[loop.length - 1]!)) break // closed
        if (dir === 1) loop.push(nxt)
        else loop.unshift(nxt)
      }
    }
    if (loop.length >= 2) loops.push(loop)
  }
  return loops
}
