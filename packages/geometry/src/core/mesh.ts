// Mesh construction and topology utilities (typed arrays, no three.js).
import type { Vec3 } from '@cadsandbox/doc'
import earcut from 'earcut'
import type { Bounds3, MeshBuffers } from '../api'
import { F32Buf, U32Buf } from './buffers'

export type Mat4Like = ArrayLike<number>

export const DEFAULT_CREASE = (30 * Math.PI) / 180

export const emptyBounds = (): Bounds3 => ({ min: [0, 0, 0], max: [0, 0, 0] })

export function isEmptyBounds(b: Bounds3): boolean {
  return b.min[0] === b.max[0] && b.min[1] === b.max[1] && b.min[2] === b.max[2]
}

export function emptyMesh(): MeshBuffers {
  return { positions: new Float32Array(0), normals: new Float32Array(0), uvs: new Float32Array(0), indices: new Uint32Array(0) }
}

export function meshByteLength(m: MeshBuffers): number {
  return m.positions.byteLength + m.normals.byteLength + (m.uvs?.byteLength ?? 0) + (m.indices?.byteLength ?? 0)
}

export const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const scale3 = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
export const len3 = (a: Vec3): number => Math.hypot(a[0], a[1], a[2])
export function normalize3(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2])
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 1]
}

/** Newell normal of a planar polygon (unnormalized direction follows CCW winding). */
export function polygonNormal(pts: readonly Vec3[]): Vec3 {
  let nx = 0, ny = 0, nz = 0
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i]!
    const q = pts[(i + 1) % n]!
    nx += (p[1] - q[1]) * (p[2] + q[2])
    ny += (p[2] - q[2]) * (p[0] + q[0])
    nz += (p[0] - q[0]) * (p[1] + q[1])
  }
  return normalize3([nx, ny, nz])
}

/** Orthonormal in-plane basis (u, v) for a normal n with u × v = n. */
export function planeBasis(n: Vec3): [Vec3, Vec3] {
  const ax: Vec3 = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]
  const u = normalize3(cross3(ax, n))
  const v = normalize3(cross3(n, u))
  return [u, v]
}

export class MeshBuilder {
  private pos: F32Buf
  private nrm: F32Buf
  private uv: F32Buf
  private idx: U32Buf
  constructor(vertexHint = 256) {
    this.pos = new F32Buf(vertexHint * 3)
    this.nrm = new F32Buf(vertexHint * 3)
    this.uv = new F32Buf(vertexHint * 2)
    this.idx = new U32Buf(vertexHint * 3)
  }
  get vertexCount(): number {
    return this.pos.length / 3
  }
  get triangleCount(): number {
    return this.idx.length / 3
  }
  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u = 0, v = 0): number {
    this.pos.push3(x, y, z)
    this.nrm.push3(nx, ny, nz)
    this.uv.push2(u, v)
    return this.pos.length / 3 - 1
  }
  tri(a: number, b: number, c: number): void {
    this.idx.push3(a, b, c)
  }
  quad(a: number, b: number, c: number, d: number): void {
    this.idx.push3(a, b, c)
    this.idx.push3(a, c, d)
  }
  /** Quad whose winding is chosen so the face normal agrees with vertex a's stored normal. */
  orientedQuad(a: number, b: number, c: number, d: number): void {
    if (this.facesAlongNormal(a, b, c) || this.facesAlongNormal(a, c, d)) this.quad(a, b, c, d)
    else this.quad(a, d, c, b)
  }
  orientedTri(a: number, b: number, c: number): void {
    if (this.facesAlongNormal(a, b, c)) this.tri(a, b, c)
    else this.tri(a, c, b)
  }
  private facesAlongNormal(a: number, b: number, c: number): boolean {
    const p = this.pos.data
    const ax = p[a * 3]!, ay = p[a * 3 + 1]!, az = p[a * 3 + 2]!
    const abx = p[b * 3]! - ax, aby = p[b * 3 + 1]! - ay, abz = p[b * 3 + 2]! - az
    const acx = p[c * 3]! - ax, acy = p[c * 3 + 1]! - ay, acz = p[c * 3 + 2]! - az
    const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx
    const n = this.nrm.data
    const d = nx * n[a * 3]! + ny * n[a * 3 + 1]! + nz * n[a * 3 + 2]!
    if (d !== 0) return d > 0
    // degenerate at a: try the other corners' normals
    return nx * (n[b * 3]! + n[c * 3]!) + ny * (n[b * 3 + 1]! + n[c * 3 + 1]!) + nz * (n[b * 3 + 2]! + n[c * 3 + 2]!) >= 0
  }
  triFace(p0: Vec3, p1: Vec3, p2: Vec3): void {
    const n = normalize3(cross3(sub3(p1, p0), sub3(p2, p0)))
    const [u, v] = planeBasis(n)
    const a = this.vertex(p0[0], p0[1], p0[2], n[0], n[1], n[2], dot3(p0, u), dot3(p0, v))
    const b = this.vertex(p1[0], p1[1], p1[2], n[0], n[1], n[2], dot3(p1, u), dot3(p1, v))
    const c = this.vertex(p2[0], p2[1], p2[2], n[0], n[1], n[2], dot3(p2, u), dot3(p2, v))
    this.tri(a, b, c)
  }
  /** Flat quad, corners CCW seen from the front. */
  quadFace(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3): void {
    const n = polygonNormal([p0, p1, p2, p3])
    const [u, v] = planeBasis(n)
    const a = this.vertex(p0[0], p0[1], p0[2], n[0], n[1], n[2], dot3(p0, u), dot3(p0, v))
    const b = this.vertex(p1[0], p1[1], p1[2], n[0], n[1], n[2], dot3(p1, u), dot3(p1, v))
    const c = this.vertex(p2[0], p2[1], p2[2], n[0], n[1], n[2], dot3(p2, u), dot3(p2, v))
    const d = this.vertex(p3[0], p3[1], p3[2], n[0], n[1], n[2], dot3(p3, u), dot3(p3, v))
    this.quad(a, b, c, d)
  }
  /**
   * Planar polygon face with holes (flat shaded, duplicated vertices). `outer` must wind CCW seen
   * from the side the normal points to; when `normal` is omitted it is derived from the winding.
   * UVs are in-plane meters.
   */
  face(outer: readonly Vec3[], holes: readonly (readonly Vec3[])[] = [], normal?: Vec3): void {
    if (outer.length < 3) return
    const n = normal ?? polygonNormal(outer)
    const [u, v] = planeBasis(n)
    const total = outer.length + holes.reduce((s, h) => s + h.length, 0)
    const flat = new Float64Array(total * 2)
    const holeIdx: number[] = []
    let k = 0
    const put = (p: Vec3) => {
      flat[k++] = dot3(p, u)
      flat[k++] = dot3(p, v)
    }
    for (const p of outer) put(p)
    for (const h of holes) {
      holeIdx.push(k / 2)
      for (const p of h) put(p)
    }
    const tris = earcut(flat, holeIdx.length ? holeIdx : null, 2)
    if (!tris.length) return
    const base = this.vertexCount
    const all: readonly Vec3[] = holes.length ? outer.concat(...holes) : outer
    for (let i = 0; i < all.length; i++) {
      const p = all[i]!
      this.vertex(p[0], p[1], p[2], n[0], n[1], n[2], flat[i * 2]!, flat[i * 2 + 1]!)
    }
    for (let i = 0; i < tris.length; i += 3) {
      const a = tris[i]!, b = tris[i + 1]!, c = tris[i + 2]!
      // enforce CCW in (u,v) so the triangle faces along n
      const ax = flat[a * 2]!, ay = flat[a * 2 + 1]!
      const bx = flat[b * 2]!, by = flat[b * 2 + 1]!
      const cx = flat[c * 2]!, cy = flat[c * 2 + 1]!
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
      if (area >= 0) this.tri(base + a, base + b, base + c)
      else this.tri(base + a, base + c, base + b)
    }
  }
  /** Append a mesh, optionally transformed by a column-major 4×4. */
  append(mesh: MeshBuffers, m?: Mat4Like): void {
    const base = this.vertexCount
    const n = mesh.positions.length / 3
    const hasUv = !!mesh.uvs && mesh.uvs.length >= n * 2
    const hasN = mesh.normals.length >= n * 3
    if (!m) {
      this.pos.pushArray(mesh.positions)
      if (hasN) this.nrm.pushArray(mesh.normals)
      else for (let i = 0; i < n; i++) this.nrm.push3(0, 0, 1)
      if (hasUv) this.uv.pushArray(mesh.uvs!)
      else for (let i = 0; i < n; i++) this.uv.push2(0, 0)
    } else {
      const nm = normalMatrix3(m)
      for (let i = 0; i < n; i++) {
        const x = mesh.positions[i * 3]!, y = mesh.positions[i * 3 + 1]!, z = mesh.positions[i * 3 + 2]!
        this.pos.push3(m[0]! * x + m[4]! * y + m[8]! * z + m[12]!, m[1]! * x + m[5]! * y + m[9]! * z + m[13]!, m[2]! * x + m[6]! * y + m[10]! * z + m[14]!)
        if (hasN) {
          const nx = mesh.normals[i * 3]!, ny = mesh.normals[i * 3 + 1]!, nz = mesh.normals[i * 3 + 2]!
          const tx = nm[0] * nx + nm[3] * ny + nm[6] * nz
          const ty = nm[1] * nx + nm[4] * ny + nm[7] * nz
          const tz = nm[2] * nx + nm[5] * ny + nm[8] * nz
          const l = Math.hypot(tx, ty, tz) || 1
          this.nrm.push3(tx / l, ty / l, tz / l)
        } else this.nrm.push3(0, 0, 1)
        if (hasUv) this.uv.push2(mesh.uvs![i * 2]!, mesh.uvs![i * 2 + 1]!)
        else this.uv.push2(0, 0)
      }
    }
    if (mesh.indices) {
      const flip = m ? determinant3(m) < 0 : false
      if (!flip) this.idx.pushArray(mesh.indices, base)
      else for (let i = 0; i < mesh.indices.length; i += 3) this.idx.push3(mesh.indices[i]! + base, mesh.indices[i + 2]! + base, mesh.indices[i + 1]! + base)
    } else for (let i = 0; i < n; i += 3) this.idx.push3(base + i, base + i + 1, base + i + 2)
  }
  build(): MeshBuffers {
    return { positions: this.pos.toArray(), normals: this.nrm.toArray(), uvs: this.uv.toArray(), indices: this.idx.toArray() }
  }
}

function determinant3(m: Mat4Like): number {
  return m[0]! * (m[5]! * m[10]! - m[9]! * m[6]!) - m[4]! * (m[1]! * m[10]! - m[9]! * m[2]!) + m[8]! * (m[1]! * m[6]! - m[5]! * m[2]!)
}

/** Inverse-transpose of the upper 3×3 (column-major 9 floats). */
export function normalMatrix3(m: Mat4Like): number[] {
  const a = m[0]!, b = m[4]!, c = m[8]!
  const d = m[1]!, e = m[5]!, f = m[9]!
  const g = m[2]!, h = m[6]!, i = m[10]!
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
  if (Math.abs(det) < 1e-18) return [1, 0, 0, 0, 1, 0, 0, 0, 1]
  const s = 1 / det
  // inverse (row-major) then transpose → column-major inverse-transpose == row-major inverse
  const inv = [
    (e * i - f * h) * s, (c * h - b * i) * s, (b * f - c * e) * s,
    (f * g - d * i) * s, (a * i - c * g) * s, (c * d - a * f) * s,
    (d * h - e * g) * s, (b * g - a * h) * s, (a * e - b * d) * s,
  ]
  // inv is row-major inverse; its transpose (column-major inverse-transpose) is inv read as column-major
  return inv
}

// ------------------------------------------------------------------ bounds
export function computeBounds(positions: ArrayLike<number>): Bounds3 {
  const n = positions.length
  if (n < 3) return emptyBounds()
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity
  for (let i = 0; i < n; i += 3) {
    const x = positions[i]!, y = positions[i + 1]!, z = positions[i + 2]!
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
    if (z < z0) z0 = z
    if (z > z1) z1 = z
  }
  return { min: [x0, y0, z0], max: [x1, y1, z1] }
}

export function boundsOfPoints(points: readonly Vec3[]): Bounds3 {
  if (!points.length) return emptyBounds()
  const b: Bounds3 = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
  for (const p of points) expandBounds(b, p)
  return b
}

export function expandBounds(b: Bounds3, p: Vec3): void {
  for (let i = 0; i < 3; i++) {
    if (p[i]! < b.min[i]!) b.min[i] = p[i]!
    if (p[i]! > b.max[i]!) b.max[i] = p[i]!
  }
}

export function unionBounds(a: Bounds3 | null, b: Bounds3 | null): Bounds3 | null {
  if (!a) return b ? { min: [...b.min], max: [...b.max] } : null
  if (!b) return { min: [...a.min], max: [...a.max] }
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  }
}

export function transformBounds(b: Bounds3, m: Mat4Like): Bounds3 {
  const out: Bounds3 = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
  for (let c = 0; c < 8; c++) {
    const x = c & 1 ? b.max[0] : b.min[0]
    const y = c & 2 ? b.max[1] : b.min[1]
    const z = c & 4 ? b.max[2] : b.min[2]
    expandBounds(out, [m[0]! * x + m[4]! * y + m[8]! * z + m[12]!, m[1]! * x + m[5]! * y + m[9]! * z + m[13]!, m[2]! * x + m[6]! * y + m[10]! * z + m[14]!])
  }
  return out
}

export function boundsOfMeshes(meshes: readonly MeshBuffers[]): Bounds3 {
  let b: Bounds3 | null = null
  for (const m of meshes) if (m.positions.length) b = unionBounds(b, computeBounds(m.positions))
  return b ?? emptyBounds()
}

// ------------------------------------------------------------------ transforms & merging
export function transformMesh(mesh: MeshBuffers, m: Mat4Like): MeshBuffers {
  const mb = new MeshBuilder(mesh.positions.length / 3)
  mb.append(mesh, m)
  return mb.build()
}

export function mergeMeshes(meshes: readonly MeshBuffers[]): MeshBuffers {
  if (meshes.length === 1) return meshes[0]!
  const mb = new MeshBuilder(meshes.reduce((s, m) => s + m.positions.length / 3, 0))
  for (const m of meshes) mb.append(m)
  return mb.build()
}

export function flipMesh(mesh: MeshBuffers): MeshBuffers {
  const normals = mesh.normals.slice()
  for (let i = 0; i < normals.length; i++) normals[i] = -normals[i]!
  const idx = indicesOf(mesh).slice()
  for (let i = 0; i < idx.length; i += 3) {
    const t = idx[i + 1]!
    idx[i + 1] = idx[i + 2]!
    idx[i + 2] = t
  }
  return { positions: mesh.positions, normals, uvs: mesh.uvs, indices: idx }
}

export function indicesOf(mesh: MeshBuffers): Uint32Array {
  if (mesh.indices) return mesh.indices
  const n = mesh.positions.length / 3
  const idx = new Uint32Array(n)
  for (let i = 0; i < n; i++) idx[i] = i
  return idx
}

/** Map every vertex to a canonical index by quantized position. Returns remap[vertex] = weldedIndex. */
export function weldIndex(positions: ArrayLike<number>, tolerance = 1e-6): { remap: Uint32Array; count: number; rep: Uint32Array } {
  const n = positions.length / 3
  const remap = new Uint32Array(n)
  const reps: number[] = []
  const map = new Map<string, number>()
  const inv = 1 / tolerance
  for (let i = 0; i < n; i++) {
    const key = `${Math.round(positions[i * 3]! * inv)},${Math.round(positions[i * 3 + 1]! * inv)},${Math.round(positions[i * 3 + 2]! * inv)}`
    let w = map.get(key)
    if (w === undefined) {
      w = reps.length
      map.set(key, w)
      reps.push(i)
    }
    remap[i] = w
  }
  return { remap, count: reps.length, rep: Uint32Array.from(reps) }
}

/** Weld coincident vertices (positions only decide identity), drop degenerate triangles. */
export function mergeVertices(mesh: MeshBuffers, tolerance = 1e-6): MeshBuffers {
  const { remap, count, rep } = weldIndex(mesh.positions, tolerance)
  const positions = new Float32Array(count * 3)
  const normals = new Float32Array(count * 3)
  const hasUv = !!mesh.uvs && mesh.uvs.length >= (mesh.positions.length / 3) * 2
  const uvs = hasUv ? new Float32Array(count * 2) : undefined
  for (let w = 0; w < count; w++) {
    const i = rep[w]!
    positions[w * 3] = mesh.positions[i * 3]!
    positions[w * 3 + 1] = mesh.positions[i * 3 + 1]!
    positions[w * 3 + 2] = mesh.positions[i * 3 + 2]!
    if (mesh.normals.length >= (i + 1) * 3) {
      normals[w * 3] = mesh.normals[i * 3]!
      normals[w * 3 + 1] = mesh.normals[i * 3 + 1]!
      normals[w * 3 + 2] = mesh.normals[i * 3 + 2]!
    }
    if (uvs) {
      uvs[w * 2] = mesh.uvs![i * 2]!
      uvs[w * 2 + 1] = mesh.uvs![i * 2 + 1]!
    }
  }
  const src = indicesOf(mesh)
  const idx = new U32Buf(src.length)
  for (let i = 0; i < src.length; i += 3) {
    const a = remap[src[i]!]!, b = remap[src[i + 1]!]!, c = remap[src[i + 2]!]!
    if (a !== b && b !== c && a !== c) idx.push3(a, b, c)
  }
  return { positions, normals, uvs, indices: idx.toArray() }
}

// ------------------------------------------------------------------ normals & edges
/** Area-weighted (unnormalized) face normals, 3 floats per triangle. */
export function faceNormals(positions: ArrayLike<number>, idx: ArrayLike<number>): Float32Array {
  const nt = idx.length / 3
  const fn = new Float32Array(nt * 3)
  for (let t = 0; t < nt; t++) {
    const a = idx[t * 3]! * 3, b = idx[t * 3 + 1]! * 3, c = idx[t * 3 + 2]! * 3
    const abx = positions[b]! - positions[a]!, aby = positions[b + 1]! - positions[a + 1]!, abz = positions[b + 2]! - positions[a + 2]!
    const acx = positions[c]! - positions[a]!, acy = positions[c + 1]! - positions[a + 1]!, acz = positions[c + 2]! - positions[a + 2]!
    // area-weighted (not normalized) — weighting improves smoothing quality
    fn[t * 3] = aby * acz - abz * acy
    fn[t * 3 + 1] = abz * acx - abx * acz
    fn[t * 3 + 2] = abx * acy - aby * acx
  }
  return fn
}

/**
 * Recompute normals with creases: a corner's normal averages the normals of the adjacent faces
 * (around the welded vertex) whose angle to the corner's own face is below `creaseAngle`.
 * Output vertices are split per distinct (position, normal, uv).
 */
export function computeCreasedNormals(mesh: MeshBuffers, creaseAngle = DEFAULT_CREASE, weldTolerance = 1e-6): MeshBuffers {
  const pos = mesh.positions
  const idx = indicesOf(mesh)
  const nt = idx.length / 3
  if (!nt) return mesh
  const { remap, count } = weldIndex(pos, weldTolerance)
  const fn = faceNormals(pos, idx)
  // adjacency: welded vertex → faces
  const faceCount = new Uint32Array(count + 1)
  for (let i = 0; i < idx.length; i++) faceCount[remap[idx[i]!]! + 1]++
  for (let i = 0; i < count; i++) faceCount[i + 1]! += faceCount[i]!
  const faceList = new Uint32Array(idx.length)
  const fill = faceCount.slice(0, count)
  for (let i = 0; i < idx.length; i++) {
    const w = remap[idx[i]!]!
    faceList[fill[w]!++] = (i / 3) | 0
  }
  const cosCrease = Math.cos(creaseAngle)
  const hasUv = !!mesh.uvs && mesh.uvs.length >= (pos.length / 3) * 2
  const outPos = new F32Buf(idx.length * 3)
  const outNrm = new F32Buf(idx.length * 3)
  const outUv = new F32Buf(idx.length * 2)
  const outIdx = new U32Buf(idx.length)
  const dedupe = new Map<string, number>()
  for (let t = 0; t < nt; t++) {
    const fx = fn[t * 3]!, fy = fn[t * 3 + 1]!, fz = fn[t * 3 + 2]!
    const fl = Math.hypot(fx, fy, fz) || 1
    const ux = fx / fl, uy = fy / fl, uz = fz / fl
    for (let k = 0; k < 3; k++) {
      const vi = idx[t * 3 + k]!
      const w = remap[vi]!
      let nx = 0, ny = 0, nz = 0
      for (let f = faceCount[w]!; f < faceCount[w + 1]!; f++) {
        const g = faceList[f]!
        const gx = fn[g * 3]!, gy = fn[g * 3 + 1]!, gz = fn[g * 3 + 2]!
        const gl = Math.hypot(gx, gy, gz)
        if (gl < 1e-20) continue
        const d = (gx * ux + gy * uy + gz * uz) / gl
        if (d >= cosCrease - 1e-9) {
          nx += gx
          ny += gy
          nz += gz
        }
      }
      const l = Math.hypot(nx, ny, nz)
      if (l < 1e-20) {
        nx = ux
        ny = uy
        nz = uz
      } else {
        nx /= l
        ny /= l
        nz /= l
      }
      const u = hasUv ? mesh.uvs![vi * 2]! : 0
      const v = hasUv ? mesh.uvs![vi * 2 + 1]! : 0
      const key = `${w}|${(nx * 1000) | 0},${(ny * 1000) | 0},${(nz * 1000) | 0}|${u.toFixed(4)},${v.toFixed(4)}`
      let out = dedupe.get(key)
      if (out === undefined) {
        out = outPos.length / 3
        dedupe.set(key, out)
        outPos.push3(pos[vi * 3]!, pos[vi * 3 + 1]!, pos[vi * 3 + 2]!)
        outNrm.push3(nx, ny, nz)
        outUv.push2(u, v)
      }
      outIdx.pushArray([out])
    }
  }
  return { positions: outPos.toArray(), normals: outNrm.toArray(), uvs: outUv.toArray(), indices: outIdx.toArray() }
}

/** Feature edges (boundary edges and creases ≥ angle) as 3D segment pairs. */
export function computeFeatureEdges(mesh: MeshBuffers, angle = DEFAULT_CREASE, weldTolerance = 1e-6): Float32Array {
  const pos = mesh.positions
  const idx = indicesOf(mesh)
  const nt = idx.length / 3
  if (!nt) return new Float32Array(0)
  const { remap, count } = weldIndex(pos, weldTolerance)
  const fn = faceNormals(pos, idx)
  const cosA = Math.cos(angle)
  const N = count
  // edge key → first face (or -1 when resolved). Stores face index + 1 so 0 means empty.
  const first = new Map<number, number>()
  const out = new F32Buf(nt * 2)
  const emit = (a: number, b: number) => {
    // use original vertex positions of the first occurrence (welded rep is within tolerance anyway)
    out.push3(pos[a * 3]!, pos[a * 3 + 1]!, pos[a * 3 + 2]!)
    out.push3(pos[b * 3]!, pos[b * 3 + 1]!, pos[b * 3 + 2]!)
  }
  const pending = new Map<number, [number, number]>()
  for (let t = 0; t < nt; t++) {
    for (let k = 0; k < 3; k++) {
      const va = idx[t * 3 + k]!, vb = idx[t * 3 + ((k + 1) % 3)]!
      const a = remap[va]!, b = remap[vb]!
      if (a === b) continue
      const key = a < b ? a * N + b : b * N + a
      const f = first.get(key)
      if (f === undefined) {
        first.set(key, t)
        pending.set(key, [va, vb])
      } else if (f >= 0) {
        const ax = fn[f * 3]!, ay = fn[f * 3 + 1]!, az = fn[f * 3 + 2]!
        const bx = fn[t * 3]!, by = fn[t * 3 + 1]!, bz = fn[t * 3 + 2]!
        const la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz)
        const d = la > 1e-20 && lb > 1e-20 ? (ax * bx + ay * by + az * bz) / (la * lb) : 1
        if (d < cosA) emit(va, vb)
        first.set(key, -1)
        pending.delete(key)
      }
      // third+ face on the same edge (non-manifold): ignore
    }
  }
  for (const [, [va, vb]] of pending) emit(va, vb)
  return out.toArray()
}

/** True when every edge is shared by exactly two oppositely oriented triangles (after welding). */
export function isClosedManifold(mesh: MeshBuffers, weldTolerance = 1e-6): boolean {
  const idx = indicesOf(mesh)
  if (idx.length < 12) return false
  const { remap, count } = weldIndex(mesh.positions, weldTolerance)
  const N = count
  const dir = new Map<number, number>()
  for (let i = 0; i < idx.length; i += 3) {
    const a = remap[idx[i]!]!, b = remap[idx[i + 1]!]!, c = remap[idx[i + 2]!]!
    if (a === b || b === c || a === c) return false
    for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
      const key = p * N + q
      if (dir.has(key)) return false
      dir.set(key, 1)
    }
  }
  for (const key of dir.keys()) {
    const p = Math.floor(key / N)
    const q = key - p * N
    if (!dir.has(q * N + p)) return false
  }
  return true
}

/** Signed volume (positive for outward-facing closed meshes). */
export function meshVolume(mesh: MeshBuffers): number {
  const p = mesh.positions
  const idx = indicesOf(mesh)
  let v = 0
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i]! * 3, b = idx[i + 1]! * 3, c = idx[i + 2]! * 3
    v +=
      p[a]! * (p[b + 1]! * p[c + 2]! - p[b + 2]! * p[c + 1]!) -
      p[a + 1]! * (p[b]! * p[c + 2]! - p[b + 2]! * p[c]!) +
      p[a + 2]! * (p[b]! * p[c + 1]! - p[b + 1]! * p[c]!)
  }
  return v / 6
}

export function meshSurfaceArea(mesh: MeshBuffers): number {
  const p = mesh.positions
  const idx = indicesOf(mesh)
  let area = 0
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i]! * 3, b = idx[i + 1]! * 3, c = idx[i + 2]! * 3
    const abx = p[b]! - p[a]!, aby = p[b + 1]! - p[a + 1]!, abz = p[b + 2]! - p[a + 2]!
    const acx = p[c]! - p[a]!, acy = p[c + 1]! - p[a + 1]!, acz = p[c + 2]! - p[a + 2]!
    area += 0.5 * Math.hypot(aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx)
  }
  return area
}
