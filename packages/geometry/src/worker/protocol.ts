// Main thread ⇄ geometry worker messages.
import type { AnyNode } from '@cadsandbox/doc'
import type { GeometryResult } from '../api'
import type { EvalContext } from '../evaluators/context'

export interface EvalRequest {
  type: 'eval'
  id: number
  node: AnyNode
  ctx: EvalContext
}

export type WorkerRequest = EvalRequest

export interface EvalResponse {
  type: 'result'
  id: number
  result: GeometryResult
  /** evaluation time in the worker (ms) */
  ms: number
}

export interface ErrorResponse {
  type: 'error'
  id: number
  message: string
}

export type WorkerResponse = EvalResponse | ErrorResponse

/** Collect distinct ArrayBuffers of a result for zero-copy transfer. */
export function resultTransferables(r: GeometryResult): ArrayBuffer[] {
  const set = new Set<ArrayBufferLike>()
  const add = (a: ArrayBufferView | undefined) => {
    if (a && a.buffer instanceof ArrayBuffer && !(a.buffer as { detached?: boolean }).detached) set.add(a.buffer)
  }
  for (const p of r.parts) {
    add(p.mesh.positions)
    add(p.mesh.normals)
    add(p.mesh.uvs)
    add(p.mesh.indices)
  }
  add(r.edges)
  add(r.wire)
  for (const d of [r.drawing, r.plan]) {
    if (!d) continue
    for (const l of d.lines) add(l.segments)
    for (const f of d.fills) add(f.triangles)
  }
  return [...set] as ArrayBuffer[]
}

/** Distinct ArrayBuffers of a context (operand meshes, asset bytes). */
export function contextTransferables(ctx: EvalContext): ArrayBuffer[] {
  const set = new Set<ArrayBuffer>()
  for (const op of ctx.operands ?? []) {
    for (const s of op.solids) {
      const m = s.mesh
      for (const a of [m.positions, m.normals, m.uvs, m.indices]) if (a && a.buffer instanceof ArrayBuffer) set.add(a.buffer)
    }
  }
  // ctx.asset is NOT transferred: it is the service's cached asset buffer (assetBytes), and a transfer
  // detaches it — the next evaluation of that mesh (e.g. after a crease-angle edit) then fails with
  // "An ArrayBuffer is detached and could not be cloned". Structured clone copies it instead.
  return [...set]
}
