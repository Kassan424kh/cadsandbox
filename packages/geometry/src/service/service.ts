// GeometryService: observes the document, schedules evaluations (worker pool or calling thread),
// caches results by content hash and batches notifications per animation frame.
import { DEFS_ROOT, invertMatrix, multiplyMatrices, type AnyNode, type CadDocument, type DocChangeEvent, type NodeBase, type NodeType } from '@cadsandbox/doc'
import type { AssetResolver, Bounds3, ComponentGeometry, GeometryResult, GeometryService, GeometryServiceOptions } from '../api'
import { transformBounds, unionBounds } from '../core/mesh'
import { defaultContext, type EvalContext } from '../evaluators/context'
import { ASYNC_TYPES, costClass, evaluateNode, evaluateNodeSync } from '../evaluators/index'
import { errorResult } from '../evaluators/result'
import { DEFAULT_CACHE_BYTES, LruCache, resultBytes } from './cache'
import { buildContext, buildWallIndex, contextKey, nearbyWalls, wallIndexEntry, type ContextInputs, type WallIndex } from './context'
import { hashString, stableStringify } from './hash'
import { WorkerPool, defaultWorkerCount, hasWorkers } from './pool'


/** Kept for compatibility — the extensions are now part of the GeometryService contract. */
export type GeometryServiceExt = GeometryService

interface Entry {
  key: string
  result: GeometryResult
  inputs: ContextInputs
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

class DepIndex {
  private byNode = new Map<string, Set<string>>()
  private byMaterial = new Map<string, Set<string>>()
  private byLevel = new Map<string, Set<string>>()
  readonly unitsUsers = new Set<string>()
  private recorded = new Map<string, ContextInputs>()
  record(id: string, inputs: ContextInputs): void {
    this.clear(id)
    this.recorded.set(id, inputs)
    for (const n of inputs.nodes) add(this.byNode, n, id)
    for (const m of inputs.materials) add(this.byMaterial, m, id)
    if (inputs.level) add(this.byLevel, inputs.level, id)
    if (inputs.units) this.unitsUsers.add(id)
  }
  clear(id: string): void {
    const prev = this.recorded.get(id)
    if (!prev) return
    for (const n of prev.nodes) this.byNode.get(n)?.delete(id)
    for (const m of prev.materials) this.byMaterial.get(m)?.delete(id)
    if (prev.level) this.byLevel.get(prev.level)?.delete(id)
    this.unitsUsers.delete(id)
    this.recorded.delete(id)
  }
  usersOfNode(id: string): ReadonlySet<string> {
    return this.byNode.get(id) ?? EMPTY
  }
  usersOfMaterial(id: string): ReadonlySet<string> {
    return this.byMaterial.get(id) ?? EMPTY
  }
  usersOfLevel(id: string): ReadonlySet<string> {
    return this.byLevel.get(id) ?? EMPTY
  }
  inputsOf(id: string): ContextInputs | undefined {
    return this.recorded.get(id)
  }
}
const EMPTY: ReadonlySet<string> = new Set()
function add(map: Map<string, Set<string>>, k: string, v: string): void {
  let s = map.get(k)
  if (!s) map.set(k, (s = new Set()))
  s.add(v)
}

export function createGeometryService(opts: GeometryServiceOptions): GeometryServiceExt {
  return new Service(opts)
}

class Service implements GeometryServiceExt {
  private doc: CadDocument
  private assets: AssetResolver
  private pool: WorkerPool | null
  private results = new Map<string, Entry>()
  private cache = new LruCache<GeometryResult>(DEFAULT_CACHE_BYTES)
  private deps = new DepIndex()
  private dirty = new Set<string>()
  private inFlight = new Map<string, { key: string }>()
  private waitingAsset = new Map<string, Set<string>>() // asset hash → node ids
  private assetBytes = new Map<string, ArrayBuffer | null>()
  private assetLoads = new Map<string, Promise<void>>()
  private consumedBy = new Map<string, string>() // operand node → boolean node
  private listeners = new Set<(changed: ReadonlySet<string>) => void>()
  private changed = new Set<string>()
  private notifyScheduled = false
  private pumpScheduled = false
  private idleWaiters: (() => void)[] = []
  private disposed = false
  private unsubscribe: () => void
  private unitsKey: string
  private evaluatedCount = 0
  private lastEvalMs = 0
  private localBusy = false
  private wallIndex: WallIndex | null = null

  constructor(opts: GeometryServiceOptions) {
    this.doc = opts.doc
    this.assets = opts.assets
    const count = opts.workers === undefined ? (hasWorkers() ? defaultWorkerCount() : 0) : Math.max(0, Math.floor(opts.workers))
    this.pool = count > 0 && hasWorkers() ? new WorkerPool(count) : null
    this.unitsKey = JSON.stringify(this.doc.meta.units)
    for (const id of this.doc.nodeIds()) this.dirty.add(id)
    this.unsubscribe = this.doc.onChange((e) => this.onDocChange(e))
    this.schedulePump()
  }

  // ------------------------------------------------------------ public API
  get(nodeId: string): GeometryResult | undefined {
    return this.results.get(nodeId)?.result
  }
  keyOf(nodeId: string): string | undefined {
    return this.results.get(nodeId)?.key
  }
  onUpdate(listener: (changed: ReadonlySet<string>) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  isConsumed(nodeId: string): boolean {
    return this.consumedBy.has(nodeId)
  }
  invalidate(nodeIds: Iterable<string>): void {
    for (const id of nodeIds) {
      if (!this.doc.hasNode(id)) continue
      this.markDirty(id)
      for (const u of this.deps.usersOfNode(id)) this.markDirty(u)
    }
    this.schedulePump()
  }
  idle(): Promise<void> {
    return new Promise((resolve) => {
      this.idleWaiters.push(resolve)
      this.checkIdle()
    })
  }
  async preview(node: AnyNode): Promise<GeometryResult> {
    return evaluateNode(node, { ...this.previewContext(node), preview: true })
  }
  previewSync(node: AnyNode): GeometryResult | null {
    if (ASYNC_TYPES.has(node.type)) return null
    return evaluateNodeSync(node, { ...this.previewContext(node), preview: true })
  }
  worldBounds(nodeIds: Iterable<string>): Bounds3 | null {
    let b: Bounds3 | null = null
    for (const id of nodeIds) {
      const r = this.results.get(id)?.result
      if (!r || !this.doc.hasNode(id)) continue
      const empty = r.bounds.min[0] === r.bounds.max[0] && r.bounds.min[1] === r.bounds.max[1] && r.bounds.min[2] === r.bounds.max[2]
      if (empty && !r.parts.length) continue
      b = unionBounds(b, transformBounds(r.bounds, this.doc.getWorldMatrix(id)))
    }
    return b
  }
  get stats(): { pending: number; evaluated: number; cacheSize: number; lastEvalMs: number } {
    return { pending: this.dirty.size + this.inFlight.size, evaluated: this.evaluatedCount, cacheSize: this.cache.size, lastEvalMs: this.lastEvalMs }
  }
  getComponentGeometry(componentId: string): ComponentGeometry[] {
    const def = this.doc.getComponent(componentId)
    if (!def || !this.doc.hasNode(def.root)) return []
    const rootInv = invertMatrix(this.doc.getWorldMatrix(def.root))
    const out: ComponentGeometry[] = []
    for (const id of [def.root, ...this.doc.getDescendants(def.root)]) {
      const r = this.results.get(id)?.result
      if (!r || this.consumedBy.has(id)) continue
      if (!r.parts.length && !r.drawing && !r.plan) continue
      out.push({ nodeId: id, result: r, matrix: multiplyMatrices(rootInv, this.doc.getWorldMatrix(id)) })
    }
    return out
  }
  dispose(): void {
    this.disposed = true
    this.unsubscribe()
    this.pool?.dispose()
    this.pool = null
    this.listeners.clear()
    this.results.clear()
    this.cache.clear()
    this.dirty.clear()
    this.inFlight.clear()
    for (const w of this.idleWaiters) w()
    this.idleWaiters = []
  }

  // ------------------------------------------------------------ change handling
  private previewContext(node: AnyNode): EvalContext {
    const ctx = defaultContext({ units: this.doc.meta.units })
    const lvl = this.doc.meta.activeLevel ? this.doc.getNode<'level'>(this.doc.meta.activeLevel) : undefined
    if (lvl) ctx.level = { height: lvl.params.height, cutHeight: lvl.params.cutHeight }
    const ids = new Set<string>()
    if (node.material) ids.add(node.material)
    const p = node.params as Record<string, unknown>
    for (const k of ['primaryMaterial', 'secondaryMaterial', 'frameMaterial', 'panelMaterial', 'glassMaterial']) if (typeof p[k] === 'string') ids.add(p[k] as string)
    if (node.type === 'wall') for (const l of (node as NodeBase<'wall'>).params.layers ?? []) if (l.material) ids.add(l.material)
    for (const id of ids) {
      const m = this.doc.getMaterial(id)
      if (m) ctx.materials[id] = { color: m.color, category: m.category, hatch: m.hatch }
    }
    return ctx
  }

  private markDirty(id: string): void {
    if (!this.doc.hasNode(id)) return
    this.dirty.add(id)
  }

  /** Nodes structurally affected by a wall's position/params (prospective join partners, auto rooms). */
  private dirtyWallNeighbourhood(id: string): void {
    const n = this.doc.getNode(id)
    if (!n || n.type !== 'wall') return
    for (const nb of nearbyWalls(this.doc, n as NodeBase<'wall'>, this.walls())) this.markDirty(nb.id)
    const levelId = this.doc.getLevelOf(id)
    if (levelId) for (const r of this.doc.nodesOfType('room')) if (r.params.auto && this.doc.getLevelOf(r.id) === levelId) this.markDirty(r.id)
  }

  private dirtyStructural(id: string): void {
    const n = this.doc.getNode(id)
    if (!n) return
    this.markDirty(id)
    for (const u of this.deps.usersOfNode(id)) this.markDirty(u)
    if (n.type === 'wall') this.dirtyWallNeighbourhood(id)
    if (n.type === 'opening' && n.parent) this.markDirty(n.parent)
    // booleans up the chain and component definitions containing this node
    for (const a of this.doc.getAncestors(id)) {
      const an = this.doc.getNode(a)
      if (an?.type === 'boolean') this.markDirty(a)
    }
    if (this.doc.isDefinitionNode(id)) {
      for (const c of this.doc.listComponents()) {
        if (c.root === id || this.doc.isAncestor(c.root, id)) for (const inst of this.doc.instancesOf(c.id)) this.markDirty(inst.id)
      }
    }
  }

  private walls(): WallIndex {
    if (!this.wallIndex) this.wallIndex = buildWallIndex(this.doc)
    return this.wallIndex
  }

  /**
   * Keep the wall index incremental: only walls whose placement, params or ancestry changed are
   * recomputed (a full rebuild per document change made every drag step O(walls)).
   */
  private updateWallIndex(e: DocChangeEvent): void {
    const idx = this.wallIndex
    if (!idx) return // built lazily on first use
    const refresh = (id: string) => {
      const n = this.doc.getNode(id)
      if (!n) idx.delete(id)
      else if (n.type === 'wall') idx.set(id, wallIndexEntry(this.doc, n as NodeBase<'wall'>))
    }
    for (const id of e.nodes.removed) idx.delete(id)
    for (const id of e.nodes.added) {
      refresh(id)
      for (const d of this.doc.getDescendants(id)) refresh(d)
    }
    for (const [id, keys] of e.nodes.updated) {
      if (!(keys.has('t') || keys.has('params') || keys.has('parent') || keys.has('order'))) continue
      const n = this.doc.getNode(id)
      if (!n) continue
      if (n.type === 'wall') refresh(id)
      // a moved / re-parented ancestor (level, group) carries every wall below it
      if (n.type !== 'wall' || keys.has('parent')) for (const d of this.doc.getDescendants(id)) refresh(d)
    }
  }

  private onDocChange(e: DocChangeEvent): void {
    if (this.disposed) return
    this.updateWallIndex(e)
    for (const id of e.nodes.removed) {
      const users = [...this.deps.usersOfNode(id)]
      this.deps.clear(id)
      this.dirty.delete(id)
      this.inFlight.delete(id)
      if (this.results.delete(id)) this.changed.add(id)
      this.releaseConsumed(id)
      for (const [operand, owner] of this.consumedBy) if (owner === id) this.consumedBy.delete(operand)
      for (const u of users) this.markDirty(u)
    }
    for (const id of e.nodes.added) {
      this.dirtyStructural(id)
      // a new node under a level may join walls: handled by dirtyStructural for walls; descendants of added groups
      for (const d of this.doc.getDescendants(id)) this.dirtyStructural(d)
    }
    for (const [id, keys] of e.nodes.updated) {
      if (!this.doc.hasNode(id)) continue
      const n = this.doc.getNode(id)!
      if (keys.has('params') || keys.has('parent') || keys.has('material') || keys.has('order')) {
        this.dirtyStructural(id)
        if (keys.has('parent') || keys.has('order')) {
          const parent = n.parent
          if (parent && this.doc.getNode(parent)?.type === 'boolean') this.markDirty(parent)
          for (const d of this.doc.getDescendants(id)) this.dirtyStructural(d)
        }
        if (n.type === 'level' && keys.has('params')) for (const u of this.deps.usersOfLevel(id)) this.markDirty(u)
      }
      if (keys.has('t')) {
        for (const u of this.deps.usersOfNode(id)) this.markDirty(u)
        if (n.type === 'wall' || n.type === 'opening' || n.type === 'room') this.markDirty(id)
        if (n.type === 'wall') this.dirtyWallNeighbourhood(id)
        for (const d of this.doc.getDescendants(id)) for (const u of this.deps.usersOfNode(d)) this.markDirty(u)
        // moving a level or group re-positions walls relative to nothing (same level) — but ancestors of
        // booleans/instances get covered through users above
      }
      if (keys.has('name') && n.type === 'room') this.markDirty(id)
      if (keys.has('meta') && (n.type === 'dimension' || n.type === 'leader' || n.type === 'room')) this.markDirty(id)
    }
    for (const m of e.materials) for (const u of this.deps.usersOfMaterial(m)) this.markDirty(u)
    if (e.meta) {
      const uk = JSON.stringify(this.doc.meta.units)
      if (uk !== this.unitsKey) {
        this.unitsKey = uk
        for (const u of this.deps.unitsUsers) this.markDirty(u)
      }
    }
    for (const c of e.components) for (const inst of this.doc.instancesOf(c)) this.markDirty(inst.id)
    if (this.changed.size) this.scheduleNotify()
    this.schedulePump()
  }

  private releaseConsumed(booleanId: string): void {
    for (const [operand, owner] of this.consumedBy) if (owner === booleanId) this.consumedBy.delete(operand)
  }

  // ------------------------------------------------------------ scheduling
  private schedulePump(): void {
    if (this.pumpScheduled || this.disposed) return
    this.pumpScheduled = true
    queueMicrotask(() => {
      this.pumpScheduled = false
      void this.pump()
    })
  }

  private isReady(inputs: ContextInputs): boolean {
    for (const d of inputs.deps) if (this.dirty.has(d) || this.inFlight.has(d)) return false
    return true
  }

  private async pump(): Promise<void> {
    if (this.disposed) return
    // dispatch as many ready jobs as the pool allows (main-thread mode: one at a time)
    const capacity = this.pool ? this.pool.idle : this.localBusy ? 0 : 1
    let dispatched = 0
    const skipped = new Set<string>()
    while (dispatched < capacity) {
      const id = this.pickCandidate(skipped)
      if (!id) break
      const started = this.start(id)
      if (started) dispatched++
      else skipped.add(id)
    }
    this.checkIdle()
  }

  private pickCandidate(skipped: Set<string>): string | null {
    let best: string | null = null
    let bestScore = Infinity
    for (const id of this.dirty) {
      if (this.inFlight.has(id) || skipped.has(id)) continue
      const n = this.doc.getNode(id)
      if (!n) {
        this.dirty.delete(id)
        continue
      }
      const score = costClass(n.type) * 10 + (this.doc.isDefinitionNode(id) ? 5 : 0) + (n.visible ? 0 : 2)
      if (score < bestScore) {
        bestScore = score
        best = id
      }
    }
    return best
  }

  /** Try to start evaluating a node. Returns false when it must wait (dependencies / assets). */
  private start(id: string): boolean {
    const node = this.doc.getNode(id) as AnyNode | undefined
    if (!node) {
      this.dirty.delete(id)
      return false
    }
    const built = buildContext(this.doc, node, (nid) => this.results.get(nid), (hash) => this.assetBytes.get(hash), this.walls())
    if (!this.isReady(built.inputs)) return false
    if (built.inputs.asset && built.ctx.asset === undefined) {
      this.requestAsset(built.inputs.asset, id)
      return false
    }
    const key = contextKey(node, built.ctx, stableStringify, hashString)
    this.dirty.delete(id)
    const cached = this.cache.get(key)
    if (cached) {
      this.commit(id, key, cached, built.inputs)
      this.schedulePump()
      return true
    }
    this.inFlight.set(id, { key })
    const t0 = now()
    const run = this.pool ? this.pool.run(node, built.ctx) : this.runLocal(node, built.ctx)
    void run
      .then(({ result, ms }) => {
        this.lastEvalMs = ms || now() - t0
        this.finishJob(id, key, result, built.inputs)
      })
      .catch((err: unknown) => {
        this.finishJob(id, key, errorResult(err instanceof Error ? err.message : String(err)), built.inputs)
      })
    return true
  }

  private async runLocal(node: AnyNode, ctx: EvalContext): Promise<{ result: GeometryResult; ms: number }> {
    this.localBusy = true
    const t0 = now()
    try {
      const result = await evaluateNode(node, ctx)
      return { result, ms: now() - t0 }
    } finally {
      this.localBusy = false
    }
  }

  private finishJob(id: string, key: string, result: GeometryResult, inputs: ContextInputs): void {
    if (this.disposed) return
    const flight = this.inFlight.get(id)
    if (flight && flight.key === key) this.inFlight.delete(id)
    this.evaluatedCount++
    this.cache.set(key, result, resultBytes(result))
    // latest-wins: a newer edit re-dirtied the node while this job ran → keep the cache, skip commit
    if (!this.dirty.has(id) && this.doc.hasNode(id)) this.commit(id, key, result, inputs)
    this.schedulePump()
  }

  private commit(id: string, key: string, result: GeometryResult, inputs: ContextInputs): void {
    const prev = this.results.get(id)
    this.results.set(id, { key, result, inputs })
    this.deps.record(id, inputs)
    const node = this.doc.getNode(id)
    if (node?.type === 'boolean') {
      this.releaseConsumed(id)
      if (!result.error) {
        for (const d of this.doc.getDescendants(id)) {
          this.consumedBy.set(d, id)
          this.changed.add(d)
        }
      } else for (const d of this.doc.getDescendants(id)) this.changed.add(d)
    }
    if (!prev || prev.key !== key || prev.result !== result) this.changed.add(id)
    this.scheduleNotify()
  }

  private requestAsset(hash: string, nodeId: string): void {
    let waiting = this.waitingAsset.get(hash)
    if (!waiting) this.waitingAsset.set(hash, (waiting = new Set()))
    waiting.add(nodeId)
    if (this.assetLoads.has(hash)) return
    const p = Promise.resolve()
      .then(() => this.assets.get(hash))
      .then(
        (bytes) => {
          this.assetBytes.set(hash, bytes ?? null)
        },
        () => {
          this.assetBytes.set(hash, null)
        },
      )
      .then(() => {
        this.assetLoads.delete(hash)
        const w = this.waitingAsset.get(hash)
        this.waitingAsset.delete(hash)
        if (w) for (const id of w) this.markDirty(id)
        this.schedulePump()
      })
    this.assetLoads.set(hash, p)
  }

  // ------------------------------------------------------------ notifications
  private scheduleNotify(): void {
    if (this.notifyScheduled || this.disposed) return
    this.notifyScheduled = true
    const flush = () => {
      this.notifyScheduled = false
      if (this.disposed) return
      const batch = this.changed
      this.changed = new Set()
      if (batch.size) {
        for (const l of this.listeners) {
          try {
            l(batch)
          } catch (err) {
            console.error('[cadsandbox/geometry] onUpdate listener failed', err)
          }
        }
      }
      this.checkIdle()
    }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(flush)
    else setTimeout(flush, 0)
  }

  private checkIdle(): void {
    if (!this.idleWaiters.length) return
    const pending = this.dirty.size + this.inFlight.size + this.waitingAsset.size
    if (pending === 0 && !this.notifyScheduled && !this.pumpScheduled) {
      const waiters = this.idleWaiters
      this.idleWaiters = []
      for (const w of waiters) w()
    } else if (pending === 0 && !this.pumpScheduled && !this.notifyScheduled) {
      // nothing pending but waiters remain: resolve on the next tick
      setTimeout(() => this.checkIdle(), 0)
    }
  }
}

export type { NodeType }
export { DEFS_ROOT }
