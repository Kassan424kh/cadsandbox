// manifold-3d loader (lazy, shared) and MeshBuffers ⇄ Manifold conversion.
// The .wasm is bundled by Vite (`?url`) so no third-party host is ever contacted; under Node
// (vitest) the emscripten glue finds the file next to the JS module on its own.
import Module from 'manifold-3d'
import type { Manifold, ManifoldToplevel, Mesh } from 'manifold-3d'
import wasmUrl from 'manifold-3d/manifold.wasm?url'
import type { MeshBuffers } from '../api'
import { F32Buf } from '../core/buffers'
import { DEFAULT_CREASE, computeCreasedNormals, mergeVertices, type Mat4Like } from '../core/mesh'

let instance: Promise<ManifoldToplevel> | null = null

const isNode = (): boolean => {
  const g = globalThis as { process?: { versions?: { node?: string } } }
  return typeof g.process?.versions?.node === 'string'
}

export function getManifold(): Promise<ManifoldToplevel> {
  if (!instance) {
    instance = (isNode() ? Module() : Module({ locateFile: () => wasmUrl })).then((w) => {
      w.setup()
      return w
    })
    instance.catch(() => {
      instance = null
    })
  }
  return instance
}

export type ManifoldResult = { ok: true; manifold: Manifold } | { ok: false; error: string }

/** Weld and convert a render mesh (optionally transformed) into a Manifold; reports non-manifold input. */
export function meshToManifold(w: ManifoldToplevel, mesh: MeshBuffers, matrix?: Mat4Like): ManifoldResult {
  const welded = mergeVertices(mesh, 1e-6)
  const n = welded.positions.length / 3
  if (n < 4 || !welded.indices || welded.indices.length < 12) return { ok: false, error: 'operand has no volume' }
  let positions = welded.positions
  if (matrix) {
    positions = new Float32Array(n * 3)
    const m = matrix
    for (let i = 0; i < n; i++) {
      const x = welded.positions[i * 3]!, y = welded.positions[i * 3 + 1]!, z = welded.positions[i * 3 + 2]!
      positions[i * 3] = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!
      positions[i * 3 + 1] = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!
      positions[i * 3 + 2] = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!
    }
  }
  let indices = welded.indices
  if (matrix && determinant(matrix) < 0) {
    indices = indices.slice()
    for (let i = 0; i < indices.length; i += 3) {
      const t = indices[i + 1]!
      indices[i + 1] = indices[i + 2]!
      indices[i + 2] = t
    }
  }
  const mm: Mesh = new w.Mesh({ numProp: 3, vertProperties: positions, triVerts: indices })
  mm.merge()
  const manifold = w.Manifold.ofMesh(mm)
  const status = manifold.status()
  if (status !== 'NoError') {
    manifold.delete()
    return { ok: false, error: status === 'NotManifold' ? 'operand is not a closed solid' : `manifold: ${status}` }
  }
  return { ok: true, manifold }
}

function determinant(m: Mat4Like): number {
  return m[0]! * (m[5]! * m[10]! - m[9]! * m[6]!) - m[4]! * (m[1]! * m[10]! - m[9]! * m[2]!) + m[8]! * (m[1]! * m[6]! - m[5]! * m[2]!)
}

export interface ManifoldRun {
  originalID: number
  mesh: MeshBuffers
}

/** Convert a Manifold back to render meshes, one per original-ID run (keeps operand materials). */
export function manifoldToMeshes(m: Manifold, crease = DEFAULT_CREASE): ManifoldRun[] {
  const mesh = m.getMesh()
  const numProp = mesh.numProp
  const nv = mesh.vertProperties.length / numProp
  const positions = new Float32Array(nv * 3)
  for (let i = 0; i < nv; i++) {
    positions[i * 3] = mesh.vertProperties[i * numProp]!
    positions[i * 3 + 1] = mesh.vertProperties[i * numProp + 1]!
    positions[i * 3 + 2] = mesh.vertProperties[i * numProp + 2]!
  }
  const runs: ManifoldRun[] = []
  const runIndex = mesh.runIndex
  const runIds = mesh.runOriginalID
  const nRuns = runIds ? runIds.length : 0
  const groups = new Map<number, number[]>()
  if (nRuns > 1 && runIndex) {
    for (let r = 0; r < nRuns; r++) {
      const start = runIndex[r]!, end = runIndex[r + 1] ?? mesh.triVerts.length
      const id = runIds![r]!
      let g = groups.get(id)
      if (!g) groups.set(id, (g = []))
      for (let k = start; k < end; k++) g.push(mesh.triVerts[k]!)
    }
  } else groups.set(nRuns ? runIds![0]! : 0, Array.from(mesh.triVerts))
  for (const [id, tris] of groups) {
    if (!tris.length) continue
    const sub: MeshBuffers = { positions, normals: new Float32Array(0), indices: Uint32Array.from(tris) }
    const withNormals = computeCreasedNormals(sub, crease)
    runs.push({ originalID: id, mesh: boxUVs(withNormals) })
  }
  return runs
}

/** Meter-scale UVs by dominant-axis planar projection (box mapping) for meshes without UVs. */
export function boxUVs(mesh: MeshBuffers): MeshBuffers {
  const n = mesh.positions.length / 3
  const uv = new F32Buf(n * 2)
  for (let i = 0; i < n; i++) {
    const nx = Math.abs(mesh.normals[i * 3] ?? 0), ny = Math.abs(mesh.normals[i * 3 + 1] ?? 0), nz = Math.abs(mesh.normals[i * 3 + 2] ?? 1)
    const x = mesh.positions[i * 3]!, y = mesh.positions[i * 3 + 1]!, z = mesh.positions[i * 3 + 2]!
    if (nz >= nx && nz >= ny) uv.push2(x, y)
    else if (nx >= ny) uv.push2(y, z)
    else uv.push2(x, z)
  }
  return { ...mesh, uvs: uv.toArray() }
}
