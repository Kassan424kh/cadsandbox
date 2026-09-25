// Blender-like wireframes: the facet topology of a mesh (rings, segments, every face boundary)
// without the triangle diagonals of planar quads/polygons. Segment pairs [x,y,z, x,y,z, …], node-local.
import type { Vec3 } from '@cadsandbox/doc'
import type { MeshBuffers } from '../api'
import { F32Buf } from './buffers'
import { faceNormals, indicesOf, weldIndex } from './mesh'

/** Two triangles whose normals differ by less than this are one flat face: their shared edge is a diagonal. */
export const WIRE_COPLANAR = (1 * Math.PI) / 180

/**
 * Clean wireframe of a triangle mesh: vertices are welded by position (normal/UV splits ignored),
 * every triangle edge is kept except edges shared by two coplanar triangles (within `coplanar`),
 * which are the diagonals of planar quads and the interior triangulation of flat polygons. Boundary
 * edges and creases always survive; degenerate (zero-area) triangles contribute nothing.
 */
export function computeCleanWireframe(mesh: MeshBuffers, coplanar = WIRE_COPLANAR, weldTolerance = 1e-6): Float32Array {
  const pos = mesh.positions
  const idx = indicesOf(mesh)
  const nt = idx.length / 3
  if (!nt) return new Float32Array(0)
  const { remap, count, rep } = weldIndex(pos, weldTolerance)
  const fn = faceNormals(pos, idx)
  const cosA = Math.cos(coplanar)
  const N = count
  // edge key → first face + 1; -1 once the second face decided the edge's fate
  const first = new Map<number, number>()
  const out = new F32Buf(nt * 6)
  const emit = (a: number, b: number) => {
    const ra = rep[a]! * 3, rb = rep[b]! * 3
    out.push3(pos[ra]!, pos[ra + 1]!, pos[ra + 2]!)
    out.push3(pos[rb]!, pos[rb + 1]!, pos[rb + 2]!)
  }
  for (let t = 0; t < nt; t++) {
    const nx = fn[t * 3]!, ny = fn[t * 3 + 1]!, nz = fn[t * 3 + 2]!
    const l2 = nx * nx + ny * ny + nz * nz
    if (l2 < 1e-24) continue // degenerate: no edges of its own
    for (let k = 0; k < 3; k++) {
      const a = remap[idx[t * 3 + k]!]!, b = remap[idx[t * 3 + ((k + 1) % 3)]!]!
      if (a === b) continue
      const key = a < b ? a * N + b : b * N + a
      const f = first.get(key)
      if (f === undefined) first.set(key, t + 1)
      else if (f > 0) {
        const g = f - 1
        const gx = fn[g * 3]!, gy = fn[g * 3 + 1]!, gz = fn[g * 3 + 2]!
        const d = (nx * gx + ny * gy + nz * gz) / Math.sqrt(l2 * (gx * gx + gy * gy + gz * gz))
        if (d < cosA) emit(a, b)
        first.set(key, -1)
      }
      // third+ triangle on the same edge (non-manifold): already decided
    }
  }
  for (const [key, f] of first) {
    if (f <= 0) continue
    const a = Math.floor(key / N)
    emit(a, key - a * N)
  }
  return out.toArray()
}

/**
 * Wire of a lattice surface (loft/sweep/terrain grids): `rows[r][i]` are the surface samples;
 * ring lines connect consecutive samples of a row, longitudinal lines connect the same sample index
 * of consecutive rows. Rows/rings wrap when the surface is closed in that direction.
 */
export function latticeWire(rows: readonly (readonly Vec3[])[], wrapRing: boolean, wrapRows: boolean): Float32Array {
  const R = rows.length
  if (!R) return new Float32Array(0)
  const M = rows.reduce((m, r) => Math.min(m, r.length), Infinity)
  if (!Number.isFinite(M) || M < 2) return new Float32Array(0)
  const out = new F32Buf(R * M * 12)
  const seg = (p: Vec3, q: Vec3) => {
    out.push3(p[0], p[1], p[2])
    out.push3(q[0], q[1], q[2])
  }
  for (let r = 0; r < R; r++) {
    const row = rows[r]!
    for (let i = 0; i < (wrapRing ? M : M - 1); i++) seg(row[i]!, row[(i + 1) % M]!)
  }
  for (let r = 0; r < (wrapRows ? R : R - 1); r++) {
    const a = rows[r]!, b = rows[(r + 1) % R]!
    for (let i = 0; i < M; i++) seg(a[i]!, b[i]!)
  }
  return out.toArray()
}
