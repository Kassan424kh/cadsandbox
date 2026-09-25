// Geometry worker entry: evaluates nodes and posts results with transferred buffers.
import { evaluateNode } from '../evaluators/index'
import { errorResult } from '../evaluators/result'
import { resultTransferables, type WorkerRequest, type WorkerResponse } from './protocol'

const scope = self as unknown as { onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null; postMessage(msg: WorkerResponse, transfer?: Transferable[]): void }

scope.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data
  if (!msg || msg.type !== 'eval') return
  const t0 = performance.now()
  let result
  try {
    result = await evaluateNode(msg.node, msg.ctx)
  } catch (err) {
    result = errorResult(err instanceof Error ? err.message : String(err))
  }
  const response: WorkerResponse = { type: 'result', id: msg.id, result, ms: performance.now() - t0 }
  try {
    scope.postMessage(response, resultTransferables(result))
  } catch {
    // transfer failed (shared buffers): fall back to a structured-clone copy
    scope.postMessage(response)
  }
}
