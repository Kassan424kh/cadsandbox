// Mesh helpers for vectorize: world-space meshes, plane slicing (→ 2D segments), feature edges.
import type { Mat4, Vec2, Vec3 } from '@cadsandbox/doc'
import type { MeshBuffers } from '@cadsandbox/geometry'
import type { Seg2 } from '../util/polygon'

export interface WorldMesh {
  /** xyz triples in world space */
  positions: Float64Array
  /** triangle indices (always present; generated for non-indexed meshes) */
  indices: Uint32Array
}

export interface ViewFrame {
  origin: Vec3
  /** In-plane right axis */
  u: Vec3
  /** In-plane up axis */
  v: Vec3
  /** View direction (into the drawing; depth increases along it) */
  dir: Vec3
}

export function toWorldMesh(mesh: MeshBuffers, m: Mat4): WorldMesh {
  const n = mesh.positions.length / 3
  const out = new Float64Array(n * 3)
  for (let i = 0; i < n; i++) {
    const x = mesh.positions[i * 3],
      y = mesh.positions[i * 3 + 1],
      z = mesh.positions[i * 3 + 2]
    out[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12]
    out[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13]
    out[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14]
  }
  let indices: Uint32Array
  if (mesh.indices) indices = mesh.indices
  else {
    indices = new Uint32Array(n)
    for (let i = 0; i < n; i++) indices[i] = i
  }
  return { positions: out, indices }
}

/** Project a world point into the frame: [u, v, depth]. */
export function projectPoint(frame: ViewFrame, p: Vec3): [number, number, number] {
  const dx = p[0] - frame.origin[0],
    dy = p[1] - frame.origin[1],
    dz = p[2] - frame.origin[2]
  return [
    dx * frame.u[0] + dy * frame.u[1] + dz * frame.u[2],
    dx * frame.v[0] + dy * frame.v[1] + dz * frame.v[2],
    dx * frame.dir[0] + dy * frame.dir[1] + dz * frame.dir[2],
  ]
}

/** Segments (frame u,v) where the mesh crosses the frame plane (depth = 0). */
export function sliceMesh(mesh: WorldMesh, frame: ViewFrame): Seg2[] {
  const out: Seg2[] = []
  const P = mesh.positions
  const I = mesh.indices
  const proj = (i: number) => projectPoint(frame, [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]])
  for (let t = 0; t + 2 < I.length; t += 3) {
    const a = proj(I[t]),
      b = proj(I[t + 1]),
      c = proj(I[t + 2])
    const pts: Vec2[] = []
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, a],
    ] as [number[], number[]][]) {
      const dp = p[2],
        dq = q[2]
      if ((dp < 0 && dq < 0) || (dp > 0 && dq > 0)) continue
      if (dp === 0 && dq === 0) continue
      const s = dp / (dp - dq)
      if (!Number.isFinite(s)) continue
      pts.push([p[0] + (q[0] - p[0]) * s, p[1] + (q[1] - p[1]) * s])
    }
    if (pts.length >= 2) {
      const [p0, p1] = pts
      if (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > 1e-9) out.push({ a: p0, b: p1 })
    }
  }
  return out
}

/** Feature edges (crease > `creaseDeg` or boundary) of a world mesh as xyz pairs. */
export function featureEdges(mesh: WorldMesh, creaseDeg = 30): Float64Array {
  const P = mesh.positions
  const I = mesh.indices
  const triCount = Math.floor(I.length / 3)
  const normals = new Float64Array(triCount * 3)
  const key = (i: number) => `${Math.round(P[i * 3] * 1e5)},${Math.round(P[i * 3 + 1] * 1e5)},${Math.round(P[i * 3 + 2] * 1e5)}`
  // merge coincident vertices so edges shared across duplicated vertices are detected
  const vid = new Map<string, number>()
  const remap = new Int32Array(P.length / 3)
  for (let i = 0; i < remap.length; i++) {
    const k = key(i)
    let id = vid.get(k)
    if (id === undefined) vid.set(k, (id = i))
    remap[i] = id
  }
  const edges = new Map<string, { a: number; b: number; tris: number[] }>()
  for (let t = 0; t < triCount; t++) {
    const i0 = I[t * 3],
      i1 = I[t * 3 + 1],
      i2 = I[t * 3 + 2]
    const ax = P[i1 * 3] - P[i0 * 3],
      ay = P[i1 * 3 + 1] - P[i0 * 3 + 1],
      az = P[i1 * 3 + 2] - P[i0 * 3 + 2]
    const bx = P[i2 * 3] - P[i0 * 3],
      by = P[i2 * 3 + 1] - P[i0 * 3 + 1],
      bz = P[i2 * 3 + 2] - P[i0 * 3 + 2]
    let nx = ay * bz - az * by,
      ny = az * bx - ax * bz,
      nz = ax * by - ay * bx
    const l = Math.hypot(nx, ny, nz) || 1
    nx /= l
    ny /= l
    nz /= l
    normals[t * 3] = nx
    normals[t * 3 + 1] = ny
    normals[t * 3 + 2] = nz
    const vs = [remap[i0], remap[i1], remap[i2]]
    for (let e = 0; e < 3; e++) {
      const a = vs[e],
        b = vs[(e + 1) % 3]
      if (a === b) continue
      const k = a < b ? `${a}-${b}` : `${b}-${a}`
      const rec = edges.get(k)
      if (rec) rec.tris.push(t)
      else edges.set(k, { a, b, tris: [t] })
    }
  }
  const cosLimit = Math.cos((creaseDeg * Math.PI) / 180)
  const out: number[] = []
  for (const e of edges.values()) {
    let keep = e.tris.length !== 2
    if (!keep) {
      const [t0, t1] = e.tris
      const d = normals[t0 * 3] * normals[t1 * 3] + normals[t0 * 3 + 1] * normals[t1 * 3 + 1] + normals[t0 * 3 + 2] * normals[t1 * 3 + 2]
      keep = d < cosLimit
    }
    if (keep) out.push(P[e.a * 3], P[e.a * 3 + 1], P[e.a * 3 + 2], P[e.b * 3], P[e.b * 3 + 1], P[e.b * 3 + 2])
  }
  return new Float64Array(out)
}

/** Transform local edge pairs (xyz xyz …) into world space. */
export function transformEdges(edges: ArrayLike<number>, m: Mat4): Float64Array {
  const out = new Float64Array(edges.length)
  for (let i = 0; i + 2 < edges.length; i += 3) {
    const x = edges[i],
      y = edges[i + 1],
      z = edges[i + 2]
    out[i] = m[0] * x + m[4] * y + m[8] * z + m[12]
    out[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13]
    out[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14]
  }
  return out
}

/** Axis-aligned box mesh (local, base at z=0, centered in XY) — used as a fallback for primitives without results. */
export function boxMesh(w: number, d: number, h: number, z0 = 0): MeshBuffers {
  const x = w / 2,
    y = d / 2
  const v = [
    [-x, -y, z0], [x, -y, z0], [x, y, z0], [-x, y, z0],
    [-x, -y, z0 + h], [x, -y, z0 + h], [x, y, z0 + h], [-x, y, z0 + h],
  ]
  const faces = [
    [0, 2, 1], [0, 3, 2], // bottom
    [4, 5, 6], [4, 6, 7], // top
    [0, 1, 5], [0, 5, 4], // front (−y)
    [1, 2, 6], [1, 6, 5], // right (+x)
    [2, 3, 7], [2, 7, 6], // back (+y)
    [3, 0, 4], [3, 4, 7], // left (−x)
  ]
  const positions = new Float32Array(v.flat())
  const indices = new Uint32Array(faces.flat())
  const normals = new Float32Array(positions.length)
  return { positions, normals, indices }
}
