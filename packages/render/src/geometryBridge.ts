// The geometry engine is implemented concurrently. Everything beyond the api.ts contract
// (createGeometryService, encodeCSBM) is resolved at runtime so the editor keeps working —
// degraded — while those exports land. Nothing here touches the geometry package's files.
import * as geometryModule from '@cadsandbox/geometry'
import type { Bounds3, CreateGeometryService, GeometryResult, GeometryService, MeshBuffers } from '@cadsandbox/geometry'
import type { AnyNode, CadDocument } from '@cadsandbox/doc'
import type { EditorAssets } from './api'

const mod = geometryModule as unknown as Record<string, unknown>

export function resolveCreateGeometryService(): CreateGeometryService | null {
  const fn = mod.createGeometryService
  return typeof fn === 'function' ? (fn as CreateGeometryService) : null
}

/** CSBM encoder — prefers the geometry package's implementation when exported. */
export function encodeCSBM(mesh: MeshBuffers): Uint8Array {
  const fn = mod.encodeCSBM
  if (typeof fn === 'function') return (fn as (m: MeshBuffers) => Uint8Array)(mesh)
  return encodeCSBMLocal(mesh)
}

/** Local encoder following the documented layout (header + f32/u32 payloads, 4-byte aligned). */
export function encodeCSBMLocal(mesh: MeshBuffers): Uint8Array {
  const n = mesh.positions.length / 3
  const hasN = !!mesh.normals && mesh.normals.length === n * 3
  const hasUV = !!mesh.uvs && mesh.uvs.length === n * 2
  const hasIdx = !!mesh.indices && mesh.indices.length > 0
  const flags = (hasN ? 1 : 0) | (hasUV ? 2 : 0) | (hasIdx ? 4 : 0)
  const idxCount = hasIdx ? mesh.indices!.length : 0
  const bytes = 20 + n * 12 + (hasN ? n * 12 : 0) + (hasUV ? n * 8 : 0) + idxCount * 4
  const buf = new ArrayBuffer(bytes)
  const dv = new DataView(buf)
  dv.setUint8(0, 0x43) // C
  dv.setUint8(1, 0x53) // S
  dv.setUint8(2, 0x42) // B
  dv.setUint8(3, 0x4d) // M
  dv.setUint32(4, 1, true)
  dv.setUint32(8, flags, true)
  dv.setUint32(12, n, true)
  dv.setUint32(16, idxCount, true)
  let off = 20
  new Float32Array(buf, off, n * 3).set(mesh.positions)
  off += n * 12
  if (hasN) {
    new Float32Array(buf, off, n * 3).set(mesh.normals)
    off += n * 12
  }
  if (hasUV) {
    new Float32Array(buf, off, n * 2).set(mesh.uvs!)
    off += n * 8
  }
  if (hasIdx) new Uint32Array(buf, off, idxCount).set(mesh.indices!)
  return new Uint8Array(buf)
}

/** Inert service used when the geometry package has not shipped `createGeometryService` yet. */
export function createNullGeometryService(doc: CadDocument): GeometryService {
  const listeners = new Set<(changed: ReadonlySet<string>) => void>()
  const stats = { pending: 0, evaluated: 0, cacheSize: 0, lastEvalMs: 0 }
  void doc
  return {
    get: () => undefined,
    onUpdate(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    isConsumed: () => false,
    invalidate: () => {},
    idle: () => Promise.resolve(),
    preview: (node: AnyNode) => Promise.resolve(emptyResult(node)),
    previewSync: () => null,
    worldBounds: () => null,
    stats,
    getComponentGeometry: () => [],
    keyOf: () => undefined,
    dispose: () => listeners.clear(),
  }
}

function emptyResult(_node: AnyNode): GeometryResult {
  const b: Bounds3 = { min: [0, 0, 0], max: [0, 0, 0] }
  return { parts: [], bounds: b, error: 'geometry engine unavailable' }
}

export function createGeometryForEditor(doc: CadDocument, assets: EditorAssets): { service: GeometryService; owned: boolean; degraded: boolean } {
  const create = resolveCreateGeometryService()
  if (create) {
    try {
      return { service: create({ doc, assets }), owned: true, degraded: false }
    } catch (err) {
      console.error('[cadsandbox/render] createGeometryService failed; running without geometry', err)
    }
  } else {
    console.warn('[cadsandbox/render] @cadsandbox/geometry does not export createGeometryService yet — rendering without geometry')
  }
  return { service: createNullGeometryService(doc), owned: true, degraded: true }
}
