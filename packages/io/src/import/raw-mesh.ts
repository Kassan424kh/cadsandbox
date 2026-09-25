// Raw triangle data (world coordinates, meters, Z-up) → 'mesh' node with a CSBM blob. Used by the
// STEP/IGES/BREP, 3DM and IFC importers. Vertices are re-centred on the node origin so every part
// gets a sensible pivot, and the offset lives in the (float64) node transform.
import type { AnyNode, Transform, Vec3 } from '@cadsandbox/doc'
import type { SnapshotBuilder } from '../builder'
import { CSBM_MIME, encodeCSBM, positionBounds } from '../csbm'

export interface RawMesh {
  positions: ArrayLike<number>
  normals?: ArrayLike<number> | null
  uvs?: ArrayLike<number> | null
  indices?: ArrayLike<number> | null
}

export interface RawMeshNode {
  name: string
  parent: string | null
  material?: string | null
  color?: string | null
  layer?: string | null
  visible?: boolean
  meta?: Record<string, unknown>
  /** Pivot of the node in world space (default: bounds center). */
  pivot?: Vec3
  /** Node transform in parent space: supply when the parent is not at the world origin. */
  transform?: Transform
  def?: boolean
}

/** Smooth vertex normals from indexed triangles (area-weighted). */
export function computeNormals(positions: ArrayLike<number>, indices: ArrayLike<number> | null | undefined): Float32Array {
  const n = new Float32Array(positions.length)
  const tri = indices ? indices.length / 3 : positions.length / 9
  for (let t = 0; t < tri; t++) {
    const a = indices ? indices[t * 3]! : t * 3,
      b = indices ? indices[t * 3 + 1]! : t * 3 + 1,
      c = indices ? indices[t * 3 + 2]! : t * 3 + 2
    const ax = positions[a * 3]!,
      ay = positions[a * 3 + 1]!,
      az = positions[a * 3 + 2]!
    const ux = positions[b * 3]! - ax,
      uy = positions[b * 3 + 1]! - ay,
      uz = positions[b * 3 + 2]! - az
    const vx = positions[c * 3]! - ax,
      vy = positions[c * 3 + 1]! - ay,
      vz = positions[c * 3 + 2]! - az
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx
    for (const v of [a, b, c]) {
      n[v * 3] = n[v * 3]! + nx
      n[v * 3 + 1] = n[v * 3 + 1]! + ny
      n[v * 3 + 2] = n[v * 3 + 2]! + nz
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i]!, n[i + 1]!, n[i + 2]!) || 1
    n[i] = n[i]! / l
    n[i + 1] = n[i + 1]! / l
    n[i + 2] = n[i + 2]! / l
  }
  return n
}

/** Keep only the triangles `tris` (triangle indices) of an indexed mesh, compacting the vertices. */
export function subMesh(m: RawMesh, tris: Iterable<number>): RawMesh {
  const idx = m.indices
  const remap = new Map<number, number>()
  const out: number[] = []
  for (const t of tris) {
    for (let k = 0; k < 3; k++) {
      const v = idx ? idx[t * 3 + k]! : t * 3 + k
      let r = remap.get(v)
      if (r === undefined) remap.set(v, (r = remap.size))
      out.push(r)
    }
  }
  const n = remap.size
  const pos = new Float64Array(n * 3)
  const nor = m.normals ? new Float32Array(n * 3) : null
  const uv = m.uvs ? new Float32Array(n * 2) : null
  for (const [src, dst] of remap) {
    for (let k = 0; k < 3; k++) pos[dst * 3 + k] = m.positions[src * 3 + k]!
    if (nor) for (let k = 0; k < 3; k++) nor[dst * 3 + k] = m.normals![src * 3 + k]!
    if (uv) for (let k = 0; k < 2; k++) uv[dst * 2 + k] = m.uvs![src * 2 + k]!
  }
  return { positions: pos, normals: nor, uvs: uv, indices: Uint32Array.from(out) }
}

/** Add a mesh node for world-space triangles. Returns null for empty meshes. */
export async function addRawMesh(b: SnapshotBuilder, m: RawMesh, o: RawMeshNode): Promise<AnyNode | null> {
  const count = m.positions.length / 3
  if (!count || (m.indices && m.indices.length < 3)) return null
  const world = positionBounds(m.positions)
  const pivot: Vec3 = o.pivot ?? [(world.min[0] + world.max[0]) / 2, (world.min[1] + world.max[1]) / 2, (world.min[2] + world.max[2]) / 2]
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    positions[i * 3] = m.positions[i * 3]! - pivot[0]
    positions[i * 3 + 1] = m.positions[i * 3 + 1]! - pivot[1]
    positions[i * 3 + 2] = m.positions[i * 3 + 2]! - pivot[2]
  }
  const normals = m.normals && m.normals.length === count * 3 ? Float32Array.from(m.normals) : computeNormals(m.positions, m.indices)
  const mesh = {
    positions,
    normals,
    ...(m.uvs && m.uvs.length === count * 2 ? { uvs: Float32Array.from(m.uvs) } : {}),
    ...(m.indices ? { indices: Uint32Array.from(m.indices) } : {}),
  }
  const hash = await b.asset(encodeCSBM(mesh), CSBM_MIME)
  const t: Transform = o.transform ?? { p: pivot, r: [0, 0, 0, 1], s: [1, 1, 1] }
  const node = b.add(
    'mesh',
    {
      name: o.name,
      parent: o.parent,
      t,
      material: o.material ?? null,
      color: o.color ?? null,
      layer: o.layer ?? null,
      visible: o.visible ?? true,
      meta: o.meta ?? {},
      params: { asset: hash, bounds: positionBounds(positions) },
    },
    o.def ?? false,
  )
  if (!o.def) b.expand([world.min, world.max])
  return node
}

export const rgbHex = (r: number, g: number, b: number): string =>
  '#' +
  [r, g, b]
    .map((v) =>
      Math.round(Math.min(1, Math.max(0, v)) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
