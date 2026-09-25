// Imported / baked meshes: CSBM blob codec and the `mesh` node evaluator.
import type { NodeBase } from '@cadsandbox/doc'
import { CSBM_MAGIC, type GeometryResult, type MeshBuffers } from '../api'
import { DEFAULT_CREASE, computeCreasedNormals, computeFeatureEdges, indicesOf } from '../core/mesh'
import type { EvalContext } from './context'
import { errorResult, finish, snap } from './result'

export const CSBM_VERSION = 1
const F_NORMALS = 1, F_UVS = 2, F_INDICES = 4
const HEADER = 20

/** Encode a mesh as a CSBM blob (little-endian, 4-byte aligned). */
export function encodeCSBM(mesh: MeshBuffers): Uint8Array {
  const n = mesh.positions.length / 3
  const hasN = mesh.normals.length === n * 3 && n > 0
  const hasUv = !!mesh.uvs && mesh.uvs.length === n * 2 && n > 0
  const idx = mesh.indices
  const m = idx ? idx.length : 0
  const flags = (hasN ? F_NORMALS : 0) | (hasUv ? F_UVS : 0) | (idx ? F_INDICES : 0)
  const bytes = HEADER + n * 12 + (hasN ? n * 12 : 0) + (hasUv ? n * 8 : 0) + m * 4
  const buf = new ArrayBuffer(bytes)
  const dv = new DataView(buf)
  dv.setUint32(0, CSBM_MAGIC, true)
  dv.setUint32(4, CSBM_VERSION, true)
  dv.setUint32(8, flags, true)
  dv.setUint32(12, n, true)
  dv.setUint32(16, m, true)
  let off = HEADER
  new Float32Array(buf, off, n * 3).set(mesh.positions)
  off += n * 12
  if (hasN) {
    new Float32Array(buf, off, n * 3).set(mesh.normals)
    off += n * 12
  }
  if (hasUv) {
    new Float32Array(buf, off, n * 2).set(mesh.uvs!)
    off += n * 8
  }
  if (idx) new Uint32Array(buf, off, m).set(idx)
  return new Uint8Array(buf)
}

/** Decode a CSBM blob. Throws on malformed input. Returned arrays are copies (safe to transfer). */
export function decodeCSBM(input: ArrayBuffer | Uint8Array): MeshBuffers {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (u8.byteLength < HEADER) throw new Error('CSBM: truncated header')
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  if (dv.getUint32(0, true) !== CSBM_MAGIC) throw new Error('CSBM: bad magic')
  const version = dv.getUint32(4, true)
  if (version !== CSBM_VERSION) throw new Error(`CSBM: unsupported version ${version}`)
  const flags = dv.getUint32(8, true)
  const n = dv.getUint32(12, true)
  const m = dv.getUint32(16, true)
  const expected = HEADER + n * 12 + (flags & F_NORMALS ? n * 12 : 0) + (flags & F_UVS ? n * 8 : 0) + (flags & F_INDICES ? m * 4 : 0)
  if (u8.byteLength < expected) throw new Error('CSBM: truncated payload')
  // copy through an aligned buffer (the input may be unaligned)
  const aligned = u8.byteOffset % 4 === 0 ? u8.buffer : u8.slice().buffer
  const base = u8.byteOffset % 4 === 0 ? u8.byteOffset : 0
  let off = base + HEADER
  const positions = new Float32Array(aligned, off, n * 3).slice()
  off += n * 12
  let normals = new Float32Array(0)
  if (flags & F_NORMALS) {
    normals = new Float32Array(aligned, off, n * 3).slice()
    off += n * 12
  }
  let uvs: Float32Array | undefined
  if (flags & F_UVS) {
    uvs = new Float32Array(aligned, off, n * 2).slice()
    off += n * 8
  }
  let indices: Uint32Array | undefined
  if (flags & F_INDICES) indices = new Uint32Array(aligned, off, m).slice()
  return { positions, normals, uvs, indices }
}

function inlineMesh(inline: NonNullable<NodeBase<'mesh'>['params']['inline']>): MeshBuffers {
  const positions = Float32Array.from(inline.positions)
  const n = positions.length / 3
  return {
    positions,
    normals: inline.normals && inline.normals.length === n * 3 ? Float32Array.from(inline.normals) : new Float32Array(0),
    uvs: inline.uvs && inline.uvs.length === n * 2 ? Float32Array.from(inline.uvs) : undefined,
    indices: inline.indices ? Uint32Array.from(inline.indices) : undefined,
  }
}

export function evaluateMesh(node: NodeBase<'mesh'>, ctx: EvalContext): GeometryResult {
  const p = node.params
  let mesh: MeshBuffers | null = null
  try {
    if (p.asset) {
      if (!ctx.asset) {
        const res = errorResult(ctx.asset === null ? 'Mesh blob unavailable' : 'Mesh blob not loaded')
        if (p.bounds) res.bounds = { min: [...p.bounds.min], max: [...p.bounds.max] }
        return res
      }
      mesh = decodeCSBM(ctx.asset)
    } else if (p.inline && p.inline.positions.length >= 9) mesh = inlineMesh(p.inline)
  } catch (e) {
    return errorResult(e instanceof Error ? e.message : String(e))
  }
  if (!mesh) return errorResult('Mesh has no geometry')
  const n = mesh.positions.length / 3
  // validate indices
  const idx = indicesOf(mesh)
  for (let i = 0; i < idx.length; i++) if (idx[i]! >= n) return errorResult('Mesh indices out of range')
  const crease = p.creaseAngle ?? DEFAULT_CREASE
  const needNormals = mesh.normals.length !== n * 3 || p.creaseAngle !== undefined
  const shaded = needNormals ? computeCreasedNormals({ ...mesh, indices: idx }, crease) : mesh
  const edges = computeFeatureEdges({ ...mesh, indices: idx }, Math.max(crease, DEFAULT_CREASE))
  return finish([{ mesh: shaded, material: 'node', castShadow: true, receiveShadow: true }], {
    edges,
    snaps: [snap('insertion', 0, 0, 0)],
    quantities: { triangles: idx.length / 3, vertices: n },
  })
}
