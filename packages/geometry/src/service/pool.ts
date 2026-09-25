// Worker pool: one job per worker at a time, transferable buffers, crash recovery.
import type { EvalContext } from '../evaluators/context'
import type { AnyNode } from '@cadsandbox/doc'
import type { GeometryResult } from '../api'
import { contextTransferables, type WorkerRequest, type WorkerResponse } from '../worker/protocol'

interface Slot {
  worker: Worker
  busy: boolean
  pending: { id: number; resolve: (r: { result: GeometryResult; ms: number }) => void; reject: (e: Error) => void } | null
}

export const hasWorkers = (): boolean => typeof Worker !== 'undefined'

export function defaultWorkerCount(): number {
  const hc = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4
  return Math.max(1, Math.min(8, hc - 1))
}

export class WorkerPool {
  private slots: Slot[] = []
  private nextId = 1
  private disposed = false
  constructor(count: number) {
    for (let i = 0; i < count; i++) this.slots.push(this.spawn())
  }
  get size(): number {
    return this.slots.length
  }
  get idle(): number {
    return this.slots.filter((s) => !s.busy).length
  }
  private spawn(): Slot {
    const worker = new Worker(new URL('../worker/geometry.worker.ts', import.meta.url), { type: 'module' })
    const slot: Slot = { worker, busy: false, pending: null }
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data
      const p = slot.pending
      if (!p || !msg || msg.id !== p.id) return
      slot.pending = null
      slot.busy = false
      if (msg.type === 'result') p.resolve({ result: msg.result, ms: msg.ms })
      else p.reject(new Error(msg.message))
    }
    worker.onerror = (ev) => {
      const p = slot.pending
      slot.pending = null
      slot.busy = false
      if (p) p.reject(new Error(ev.message || 'geometry worker crashed'))
      // replace the crashed worker
      if (!this.disposed) {
        try {
          worker.terminate()
        } catch {
          /* ignore */
        }
        const i = this.slots.indexOf(slot)
        if (i >= 0) this.slots[i] = this.spawn()
      }
    }
    return slot
  }
  /** Run on an idle worker; callers must check `idle > 0` first. */
  run(node: AnyNode, ctx: EvalContext): Promise<{ result: GeometryResult; ms: number }> {
    const slot = this.slots.find((s) => !s.busy)
    if (!slot) return Promise.reject(new Error('no idle worker'))
    const id = this.nextId++
    slot.busy = true
    const req: WorkerRequest = { type: 'eval', id, node, ctx }
    return new Promise((resolve, reject) => {
      slot.pending = { id, resolve, reject }
      try {
        slot.worker.postMessage(req, contextTransferables(ctx))
      } catch {
        try {
          slot.worker.postMessage(req)
        } catch (e) {
          slot.pending = null
          slot.busy = false
          reject(e instanceof Error ? e : new Error(String(e)))
        }
      }
    })
  }
  dispose(): void {
    this.disposed = true
    for (const s of this.slots) {
      s.pending?.reject(new Error('disposed'))
      s.worker.terminate()
    }
    this.slots = []
  }
}
