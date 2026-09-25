// CadDocument — the CRDT source of truth for one design file.
//
// Every read returns plain JSON snapshots (cached, treat as IMMUTABLE — they are frozen in dev).
// Every write goes through a Yjs transaction tagged LOCAL_ORIGIN so it is undoable per user and
// syncs to collaborators. Change events are batched per transaction via `onChange`.
import * as Y from 'yjs'
import { generateKeyBetween } from 'fractional-indexing'
import { nanoid } from 'nanoid'
import {
  BUILTIN_MATERIAL_MAP,
  BUILTIN_MATERIALS,
  DEFAULT_LAYER_ID,
  DEFAULT_PARAMS,
  OPENING_DEFAULTS,
  WINDOW_DEFAULTS,
  defaultLayers,
  defaultMeta,
  SCHEMA_VERSION,
} from './defaults'
import {
  cloneTransform,
  composeMatrix,
  decomposeMatrix,
  identityTransform,
  invertMatrix,
  mat4Identity,
  multiplyMatrices,
  transformPoint,
  translationMatrix,
  type Mat4,
} from './math'
import type {
  AnyNode,
  CommentDef,
  CommentReply,
  ComponentDef,
  DocMeta,
  DocSnapshot,
  LayerDef,
  MaterialDef,
  NewNode,
  NodeBase,
  NodeParamsMap,
  NodeType,
  SheetDef,
  Transform,
  Vec3,
  ViewDef,
} from './types'
import { DEFS_ROOT } from './types'

/** Origin for local, undoable edits. */
export const LOCAL_ORIGIN = 'cadsandbox:local'
/** Origin for local edits that must NOT enter the undo stack (e.g. derived/auto updates). */
export const SILENT_ORIGIN = 'cadsandbox:silent'

export const newId = (): string => nanoid(12)

export type NodeKey = keyof NodeBase | 'params'

export interface DocChangeEvent {
  nodes: {
    added: Set<string>
    removed: Set<string>
    /** node id → changed top-level keys ('t', 'name', 'params', …) */
    updated: Map<string, Set<NodeKey>>
    /** node id → changed param keys (subset of updated where 'params' changed) */
    params: Map<string, Set<string>>
  }
  materials: Set<string>
  layers: boolean
  meta: boolean
  views: boolean
  sheets: boolean
  components: Set<string>
  comments: boolean
  /** true when the transaction originated in this client (incl. undo/redo) */
  local: boolean
  undoRedo: boolean
  origin: unknown
}

export type NodePatch<T extends NodeType = NodeType> = Partial<Omit<NodeBase<T>, 'id' | 'type' | 'params'>> & {
  params?: Partial<NodeParamsMap[T]>
}

export interface DocJSON {
  format: 'cadsandbox/doc@1'
  meta: DocMeta
  nodes: AnyNode[]
  materials: MaterialDef[]
  layers: LayerDef[]
  views: ViewDef[]
  sheets: SheetDef[]
  components: ComponentDef[]
  comments: CommentDef[]
}

const DEV = !!(import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    for (const v of Object.values(o as object)) deepFreeze(v)
  }
  return o
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false
    return true
  }
  if (Array.isArray(b)) return false
  const ka = Object.keys(a as object)
  const kb = Object.keys(b as object)
  if (ka.length !== kb.length) return false
  for (const k of ka) if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false
  return true
}

const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v))

function safeKeyBetween(a: string | null | undefined, b: string | null | undefined): string {
  try {
    if (a && b && a >= b) return generateKeyBetween(a, null)
    return generateKeyBetween(a ?? null, b ?? null)
  } catch {
    return generateKeyBetween(a ?? null, null)
  }
}

type YNode = Y.Map<unknown>

function emptyEvent(): Omit<DocChangeEvent, 'local' | 'undoRedo' | 'origin'> {
  return {
    nodes: { added: new Set(), removed: new Set(), updated: new Map(), params: new Map() },
    materials: new Set(),
    layers: false,
    meta: false,
    views: false,
    sheets: false,
    components: new Set(),
    comments: false,
  }
}

/** Build a complete node from partial input, filling defaults. */
export function makeNode<T extends NodeType>(input: NewNode<T>, id = input.id ?? newId()): NodeBase<T> {
  let base = DEFAULT_PARAMS[input.type] as NodeParamsMap[T]
  if (input.type === 'opening') {
    const kind = (input.params as Partial<NodeParamsMap['opening']> | undefined)?.kind
    if (kind === 'window') base = { ...base, ...WINDOW_DEFAULTS } as NodeParamsMap[T]
    else if (kind === 'opening') base = { ...base, ...OPENING_DEFAULTS } as NodeParamsMap[T]
  }
  return {
    id,
    type: input.type,
    name: input.name ?? defaultName(input.type),
    parent: input.parent ?? null,
    order: input.order ?? '',
    visible: input.visible ?? true,
    locked: input.locked ?? false,
    t: input.t ? cloneTransform(input.t) : identityTransform(),
    material: input.material ?? null,
    color: input.color ?? null,
    layer: input.layer ?? null,
    meta: clone(input.meta ?? {}),
    params: { ...clone(base), ...clone(input.params ?? {}) } as NodeParamsMap[T],
  }
}

const TYPE_NAMES: Partial<Record<NodeType, string>> = {
  primitive: 'Object',
  shape: 'Shape',
  polyline: 'Polyline',
  opening: 'Opening',
  furniture: 'Furniture',
}

export function defaultName(type: NodeType): string {
  return TYPE_NAMES[type] ?? type.charAt(0).toUpperCase() + type.slice(1)
}

function nodeToY(node: AnyNode): YNode {
  const m = new Y.Map<unknown>()
  for (const [k, v] of Object.entries(node)) {
    if (v === undefined) continue
    if (k === 'params') {
      const pm = new Y.Map<unknown>()
      for (const [pk, pv] of Object.entries(v as object)) if (pv !== undefined) pm.set(pk, clone(pv))
      m.set('params', pm)
    } else m.set(k, clone(v))
  }
  return m
}

export class CadDocument {
  readonly ydoc: Y.Doc
  readonly metaMap: Y.Map<unknown>
  readonly nodesMap: Y.Map<YNode>
  readonly materialsMap: Y.Map<MaterialDef>
  readonly layersMap: Y.Map<LayerDef>
  readonly viewsMap: Y.Map<ViewDef>
  readonly sheetsMap: Y.Map<SheetDef>
  readonly componentsMap: Y.Map<ComponentDef>
  readonly commentsMap: Y.Map<CommentDef>
  readonly undoManager: Y.UndoManager

  private nodeCache = new Map<string, AnyNode>()
  private parentOf = new Map<string, string | null>()
  private childIndex = new Map<string | null, Set<string>>()
  private sortedChildren = new Map<string | null, string[]>()
  private metaCache: DocMeta | null = null
  private pending = emptyEvent()
  private dirty = false
  private listeners = new Set<(e: DocChangeEvent) => void>()
  private disposers: (() => void)[] = []

  constructor(ydoc: Y.Doc = new Y.Doc()) {
    this.ydoc = ydoc
    this.metaMap = ydoc.getMap('meta')
    this.nodesMap = ydoc.getMap('nodes')
    this.materialsMap = ydoc.getMap('materials')
    this.layersMap = ydoc.getMap('layers')
    this.viewsMap = ydoc.getMap('views')
    this.sheetsMap = ydoc.getMap('sheets')
    this.componentsMap = ydoc.getMap('components')
    this.commentsMap = ydoc.getMap('comments')

    this.undoManager = new Y.UndoManager(
      [this.metaMap, this.nodesMap, this.materialsMap, this.layersMap, this.componentsMap, this.sheetsMap],
      { trackedOrigins: new Set([LOCAL_ORIGIN]), captureTimeout: 500 },
    )

    this.nodesMap.forEach((_, id) => this.indexAdd(id))
    this.installObservers()
  }

  /** Create a brand-new document with defaults (meta, layers, one ground level). */
  static create(name = 'Untitled', opts: { withLevel?: boolean } = {}): CadDocument {
    const doc = new CadDocument()
    doc.initialize(name, opts)
    return doc
  }

  /** Fill defaults into an empty doc. Only call for NEW files (never on load — avoids collab races). */
  initialize(name = 'Untitled', opts: { withLevel?: boolean } = {}): void {
    this.ydoc.transact(() => {
      const meta = defaultMeta(name)
      for (const [k, v] of Object.entries(meta)) if (!this.metaMap.has(k)) this.metaMap.set(k, v)
      if (this.layersMap.size === 0) for (const l of defaultLayers()) this.layersMap.set(l.id, l)
      if (opts.withLevel && this.nodesOfType('level').length === 0) {
        const lvl = makeNode({ type: 'level', name: 'Ground Floor', params: { height: 3, cutHeight: 1.1, number: 0 } })
        lvl.order = safeKeyBetween(null, null)
        this.nodesMap.set(lvl.id, nodeToY(lvl))
        this.metaMap.set('activeLevel', lvl.id)
      }
    }, SILENT_ORIGIN)
    this.undoManager.clear()
  }

  // ================================================================== events
  onChange(listener: (e: DocChangeEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private installObservers(): void {
    const onNodes = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
      for (const ev of events) {
        if (ev.target === this.nodesMap) {
          ev.changes.keys.forEach((change, key) => {
            if (change.action === 'add') this.onAdded(key)
            else if (change.action === 'delete') this.onRemoved(key)
            else {
              this.onRemoved(key)
              this.onAdded(key)
            }
          })
          continue
        }
        const path = ev.path
        const id = path[0] as string
        if (!this.nodesMap.has(id)) continue
        if (path.length === 1) {
          this.onUpdated(id, (ev as Y.YMapEvent<unknown>).keysChanged as Set<NodeKey>)
        } else if (path[1] === 'params') {
          this.onUpdated(id, new Set<NodeKey>(['params']))
          let ps = this.pending.nodes.params.get(id)
          if (!ps) this.pending.nodes.params.set(id, (ps = new Set()))
          if (path.length === 2) for (const k of (ev as Y.YMapEvent<unknown>).keysChanged) ps.add(k)
          else ps.add(String(path[2]))
        }
      }
    }
    this.nodesMap.observeDeep(onNodes)
    this.disposers.push(() => this.nodesMap.unobserveDeep(onNodes))

    const simple = (map: Y.Map<unknown>, fn: (keys: Set<string>) => void) => {
      const h = (ev: Y.YMapEvent<unknown>) => {
        this.dirty = true
        fn(ev.keysChanged)
      }
      map.observe(h)
      this.disposers.push(() => map.unobserve(h))
    }
    simple(this.metaMap, () => {
      this.metaCache = null
      this.pending.meta = true
    })
    simple(this.materialsMap as Y.Map<unknown>, (k) => k.forEach((x) => this.pending.materials.add(x)))
    simple(this.layersMap as Y.Map<unknown>, () => (this.pending.layers = true))
    simple(this.viewsMap as Y.Map<unknown>, () => (this.pending.views = true))
    simple(this.sheetsMap as Y.Map<unknown>, () => (this.pending.sheets = true))
    simple(this.componentsMap as Y.Map<unknown>, (k) => k.forEach((x) => this.pending.components.add(x)))
    simple(this.commentsMap as Y.Map<unknown>, () => (this.pending.comments = true))

    const after = (tr: Y.Transaction) => {
      if (!this.dirty) return
      const e: DocChangeEvent = {
        ...this.pending,
        local: tr.local,
        undoRedo: tr.origin instanceof Y.UndoManager,
        origin: tr.origin,
      }
      this.pending = emptyEvent()
      this.dirty = false
      for (const l of this.listeners) {
        try {
          l(e)
        } catch (err) {
          console.error('[cadsandbox/doc] change listener failed', err)
        }
      }
    }
    this.ydoc.on('afterTransaction', after)
    this.disposers.push(() => this.ydoc.off('afterTransaction', after))
  }

  private indexAdd(id: string): void {
    const y = this.nodesMap.get(id)
    if (!y) return
    const parent = (y.get('parent') as string | null) ?? null
    this.parentOf.set(id, parent)
    let set = this.childIndex.get(parent)
    if (!set) this.childIndex.set(parent, (set = new Set()))
    set.add(id)
    this.sortedChildren.delete(parent)
  }

  private indexRemove(id: string): void {
    if (!this.parentOf.has(id)) return
    const parent = this.parentOf.get(id) ?? null
    this.childIndex.get(parent)?.delete(id)
    this.sortedChildren.delete(parent)
    this.parentOf.delete(id)
  }

  private onAdded(id: string): void {
    this.dirty = true
    this.nodeCache.delete(id)
    this.indexAdd(id)
    if (this.pending.nodes.removed.delete(id)) this.markUpdated(id, ['t', 'params', 'parent', 'order', 'name'])
    else this.pending.nodes.added.add(id)
  }

  private onRemoved(id: string): void {
    this.dirty = true
    this.nodeCache.delete(id)
    this.indexRemove(id)
    if (!this.pending.nodes.added.delete(id)) this.pending.nodes.removed.add(id)
    this.pending.nodes.updated.delete(id)
    this.pending.nodes.params.delete(id)
  }

  private onUpdated(id: string, keys: Iterable<NodeKey>): void {
    this.dirty = true
    this.nodeCache.delete(id)
    const ks = [...keys]
    if (ks.includes('parent')) {
      this.indexRemove(id)
      this.indexAdd(id)
    } else if (ks.includes('order')) {
      this.sortedChildren.delete(this.parentOf.get(id) ?? null)
    }
    if (!this.pending.nodes.added.has(id)) this.markUpdated(id, ks)
  }

  private markUpdated(id: string, keys: Iterable<NodeKey>): void {
    let s = this.pending.nodes.updated.get(id)
    if (!s) this.pending.nodes.updated.set(id, (s = new Set()))
    for (const k of keys) s.add(k)
  }

  // ================================================================== transactions & undo
  transact<R>(fn: () => R, origin: unknown = LOCAL_ORIGIN): R {
    let result!: R
    this.ydoc.transact(() => {
      result = fn()
    }, origin)
    return result
  }
  undo(): void {
    this.undoManager.undo()
  }
  redo(): void {
    this.undoManager.redo()
  }
  canUndo(): boolean {
    return this.undoManager.canUndo()
  }
  canRedo(): boolean {
    return this.undoManager.canRedo()
  }
  /** Start a new undo step (call at the beginning/end of drags). */
  stopCapturing(): void {
    this.undoManager.stopCapturing()
  }

  // ================================================================== meta
  get meta(): DocMeta {
    if (!this.metaCache) {
      const m = { ...defaultMeta(), ...(this.metaMap.toJSON() as Partial<DocMeta>) } as DocMeta
      this.metaCache = DEV ? deepFreeze(m) : m
    }
    return this.metaCache
  }
  setMeta(patch: Partial<DocMeta>): void {
    this.transact(() => {
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) continue
        if (!deepEqual(this.metaMap.get(k), v)) this.metaMap.set(k, clone(v))
      }
    })
  }

  // ================================================================== node reads
  hasNode(id: string | null | undefined): boolean {
    return !!id && this.nodesMap.has(id)
  }

  getNode<T extends NodeType = NodeType>(id: string | null | undefined): NodeBase<T> | undefined {
    if (!id) return undefined
    let n = this.nodeCache.get(id)
    if (!n) {
      const y = this.nodesMap.get(id)
      if (!y) return undefined
      const obj: Record<string, unknown> = {}
      y.forEach((v, k) => {
        obj[k] = v instanceof Y.Map ? v.toJSON() : v
      })
      obj.id = id
      n = (DEV ? deepFreeze(obj) : obj) as unknown as AnyNode
      this.nodeCache.set(id, n)
    }
    return n as unknown as NodeBase<T>
  }

  /** Sorted child ids (by fractional order, then id). */
  getChildren(parent: string | null): readonly string[] {
    let s = this.sortedChildren.get(parent)
    if (!s) {
      const ids = [...(this.childIndex.get(parent) ?? [])]
      const ord = new Map(ids.map((id) => [id, (this.nodesMap.get(id)?.get('order') as string) ?? '']))
      ids.sort((a, b) => {
        const oa = ord.get(a)!,
          ob = ord.get(b)!
        return oa < ob ? -1 : oa > ob ? 1 : a < b ? -1 : a > b ? 1 : 0
      })
      this.sortedChildren.set(parent, (s = ids))
    }
    return s
  }

  getParent(id: string): string | null {
    return this.parentOf.get(id) ?? null
  }

  getAncestors(id: string): string[] {
    const out: string[] = []
    let p = this.parentOf.get(id) ?? null
    const guard = new Set<string>()
    while (p && p !== DEFS_ROOT && !guard.has(p)) {
      guard.add(p)
      out.push(p)
      p = this.parentOf.get(p) ?? null
    }
    return out
  }

  /** All descendants (depth-first, excluding id itself). */
  getDescendants(id: string): string[] {
    const out: string[] = []
    const stack = [...this.getChildren(id)].reverse()
    while (stack.length) {
      const c = stack.pop()!
      out.push(c)
      const kids = this.getChildren(c)
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!)
    }
    return out
  }

  isAncestor(ancestor: string, id: string): boolean {
    return this.getAncestors(id).includes(ancestor)
  }

  /** True for nodes stored under DEFS_ROOT (component definitions). */
  isDefinitionNode(id: string): boolean {
    let p: string | null = id
    const guard = new Set<string>()
    while (p && !guard.has(p)) {
      guard.add(p)
      const parent: string | null = this.parentOf.get(p) ?? null
      if (parent === DEFS_ROOT) return true
      p = parent
    }
    return false
  }

  nodeIds(): string[] {
    return [...this.nodesMap.keys()]
  }

  allNodes(): AnyNode[] {
    const out: AnyNode[] = []
    for (const id of this.nodesMap.keys()) out.push(this.getNode(id) as AnyNode)
    return out
  }

  findNodes(pred: (n: AnyNode) => boolean): AnyNode[] {
    return this.allNodes().filter(pred)
  }

  nodesOfType<T extends NodeType>(type: T): NodeBase<T>[] {
    const out: NodeBase<T>[] = []
    for (const [id, y] of this.nodesMap) if (y.get('type') === type) out.push(this.getNode<T>(id)!)
    return out
  }

  /** Nearest ancestor (or self) of type 'level'. */
  getLevelOf(id: string): string | null {
    if (this.nodesMap.get(id)?.get('type') === 'level') return id
    for (const a of this.getAncestors(id)) if (this.nodesMap.get(a)?.get('type') === 'level') return a
    return null
  }

  levels(): NodeBase<'level'>[] {
    return this.nodesOfType('level').sort((a, b) => a.t.p[2] - b.t.p[2])
  }

  getWorldMatrix(id: string | null): Mat4 {
    if (!id || id === DEFS_ROOT) return mat4Identity()
    const chain: string[] = [id, ...this.getAncestors(id)]
    let m = mat4Identity()
    for (let i = chain.length - 1; i >= 0; i--) {
      const n = this.getNode(chain[i])
      if (n) m = multiplyMatrices(m, composeMatrix(n.t))
    }
    return m
  }

  getWorldPosition(id: string): Vec3 {
    return transformPoint(this.getWorldMatrix(id), [0, 0, 0])
  }

  /** Visible = node + all ancestors visible, and its layer visible. */
  isEffectivelyVisible(id: string): boolean {
    const n = this.getNode(id)
    if (!n || !n.visible) return false
    const layer = this.getLayer(n.layer ?? DEFAULT_LAYER_ID)
    if (layer && !layer.visible) return false
    for (const a of this.getAncestors(id)) if (!this.getNode(a)?.visible) return false
    return true
  }

  isEffectivelyLocked(id: string): boolean {
    const n = this.getNode(id)
    if (!n) return true
    if (n.locked) return true
    const layer = this.getLayer(n.layer ?? DEFAULT_LAYER_ID)
    if (layer?.locked) return true
    for (const a of this.getAncestors(id)) if (this.getNode(a)?.locked) return true
    return false
  }

  /** Remove ids whose ancestor is also in the list. */
  topLevel(ids: Iterable<string>): string[] {
    const set = new Set(ids)
    return [...set].filter((id) => this.hasNode(id) && !this.getAncestors(id).some((a) => set.has(a)))
  }

  // ================================================================== node writes
  private orderAfterLast(parent: string | null): string {
    const kids = this.getChildren(parent)
    const last = kids.length ? (this.nodesMap.get(kids[kids.length - 1]!)?.get('order') as string) : null
    return safeKeyBetween(last, null)
  }

  private orderBefore(parent: string | null, before: string | null | undefined): string {
    if (!before) return this.orderAfterLast(parent)
    const kids = this.getChildren(parent)
    const idx = kids.indexOf(before)
    if (idx < 0) return this.orderAfterLast(parent)
    const prev = idx > 0 ? (this.nodesMap.get(kids[idx - 1]!)?.get('order') as string) : null
    const next = this.nodesMap.get(before)?.get('order') as string
    return safeKeyBetween(prev, next)
  }

  addNode<T extends NodeType>(input: NewNode<T>): string {
    return this.addNodes([input])[0]!
  }

  addNodes(inputs: NewNode[]): string[] {
    return this.transact(() => {
      const ids: string[] = []
      for (const input of inputs) {
        const node = makeNode(input) as AnyNode
        if (node.parent && !this.hasNode(node.parent) && node.parent !== DEFS_ROOT) node.parent = null
        node.order = input.order ?? this.orderBefore(node.parent, input.before)
        this.nodesMap.set(node.id, nodeToY(node))
        // keep the child index current inside the transaction so following inserts order correctly
        this.indexAdd(node.id)
        ids.push(node.id)
      }
      return ids
    })
  }

  updateNode<T extends NodeType>(id: string, patch: NodePatch<T>): void {
    this.transact(() => this.applyPatch(id, patch as NodePatch))
  }

  updateNodes(patches: { id: string; patch: NodePatch }[]): void {
    this.transact(() => {
      for (const { id, patch } of patches) this.applyPatch(id, patch)
    })
  }

  private applyPatch(id: string, patch: NodePatch): void {
    const y = this.nodesMap.get(id)
    if (!y) return
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'id' || k === 'type' || v === undefined) continue
      if (k === 'params') {
        let pm = y.get('params') as Y.Map<unknown> | undefined
        if (!pm) y.set('params', (pm = new Y.Map()))
        for (const [pk, pv] of Object.entries(v as object)) {
          if (pv === undefined) {
            if (pm.has(pk)) pm.delete(pk)
          } else if (!deepEqual(pm.get(pk), pv)) pm.set(pk, clone(pv))
        }
      } else if (k === 'parent') {
        const parent = v as string | null
        if (parent === id || (parent && parent !== DEFS_ROOT && this.isAncestor(id, parent))) continue
        if (y.get('parent') !== parent) {
          y.set('parent', parent)
          if (patch.order === undefined) y.set('order', this.orderAfterLast(parent))
        }
      } else if (!deepEqual(y.get(k), v)) y.set(k, clone(v))
    }
  }

  setTransform(id: string, t: Transform): void {
    this.updateNode(id, { t })
  }

  setTransforms(entries: Iterable<[string, Transform]>): void {
    this.transact(() => {
      for (const [id, t] of entries) this.applyPatch(id, { t })
    })
  }

  setParams<T extends NodeType>(id: string, params: Partial<NodeParamsMap[T]>): void {
    this.updateNode<T>(id, { params })
  }

  /** Delete nodes and their descendants. Component defs whose root is deleted are removed too. */
  deleteNodes(ids: Iterable<string>): void {
    const all = new Set<string>()
    for (const id of ids) {
      if (!this.hasNode(id)) continue
      all.add(id)
      for (const d of this.getDescendants(id)) all.add(d)
    }
    if (!all.size) return
    this.transact(() => {
      for (const id of all) this.nodesMap.delete(id)
      for (const [cid, def] of this.componentsMap) if (all.has(def.root)) this.componentsMap.delete(cid)
    })
  }

  /** Re-parent nodes, optionally keeping their world placement. */
  moveNodes(ids: string[], parent: string | null, before: string | null = null, keepWorld = true): void {
    const valid = this.topLevel(ids).filter((id) => id !== parent && !(parent && this.isAncestor(id, parent)))
    if (!valid.length) return
    this.transact(() => {
      const parentInv = invertMatrix(this.getWorldMatrix(parent))
      const kids = this.getChildren(parent).filter((k) => !valid.includes(k))
      const beforeIdx = before ? kids.indexOf(before) : -1
      let prev = beforeIdx > 0 ? (this.getNode(kids[beforeIdx - 1]!)?.order ?? null) : beforeIdx === 0 ? null : kids.length ? (this.getNode(kids[kids.length - 1]!)?.order ?? null) : null
      const next = beforeIdx >= 0 ? (this.getNode(before!)?.order ?? null) : null
      for (const id of valid) {
        const order = safeKeyBetween(prev, next)
        prev = order
        const patch: NodePatch = { parent, order }
        if (keepWorld) patch.t = decomposeMatrix(multiplyMatrices(parentInv, this.getWorldMatrix(id)))
        const y = this.nodesMap.get(id)!
        y.set('parent', parent)
        y.set('order', order)
        if (patch.t) y.set('t', patch.t)
        this.indexRemove(id)
        this.indexAdd(id)
      }
    })
  }

  /** Deep-copy nodes. `offset` is a world-space translation applied to the copies. Returns new root ids. */
  duplicateNodes(ids: string[], offset: Vec3 = [0, 0, 0]): string[] {
    const roots = this.topLevel(ids)
    if (!roots.length) return []
    return this.transact(() => {
      const remap = new Map<string, string>()
      for (const r of roots) {
        remap.set(r, newId())
        for (const d of this.getDescendants(r)) remap.set(d, newId())
      }
      const out: string[] = []
      for (const r of roots) {
        const src = this.getNode(r)!
        const parent = src.parent
        const siblings = this.getChildren(parent)
        const next = siblings[siblings.indexOf(r) + 1]
        const copy = structuredClone(src) as AnyNode
        copy.id = remap.get(r)!
        copy.order = safeKeyBetween(src.order, next ? this.getNode(next)!.order : null)
        if (offset[0] || offset[1] || offset[2]) {
          const world = multiplyMatrices(translationMatrix(offset), this.getWorldMatrix(r))
          copy.t = decomposeMatrix(multiplyMatrices(invertMatrix(this.getWorldMatrix(parent)), world))
        }
        this.remapRefs(copy, remap)
        this.nodesMap.set(copy.id, nodeToY(copy))
        this.indexAdd(copy.id)
        out.push(copy.id)
        for (const d of this.getDescendants(r)) {
          const dn = structuredClone(this.getNode(d)!) as AnyNode
          dn.id = remap.get(d)!
          dn.parent = remap.get(dn.parent!) ?? dn.parent
          this.remapRefs(dn, remap)
          this.nodesMap.set(dn.id, nodeToY(dn))
        }
      }
      return out
    })
  }

  private remapRefs(n: AnyNode, remap: Map<string, string>): void {
    if (n.type === 'dimension' && n.params.refs) {
      n.params.refs = n.params.refs.map((r) => ({ ...r, node: remap.get(r.node) ?? r.node }))
    }
  }

  /** Group nodes under a new group (placed at their average world position). Returns group id. */
  groupNodes(ids: string[], name = 'Group'): string | null {
    const roots = this.topLevel(ids)
    if (!roots.length) return null
    return this.transact(() => {
      const parents = new Set(roots.map((r) => this.getParent(r)))
      const parent = parents.size === 1 ? [...parents][0]! : null
      const center: Vec3 = [0, 0, 0]
      for (const r of roots) {
        const p = this.getWorldPosition(r)
        center[0] += p[0] / roots.length
        center[1] += p[1] / roots.length
        center[2] += p[2] / roots.length
      }
      const local = transformPoint(invertMatrix(this.getWorldMatrix(parent)), center)
      const first = this.getChildren(parent).find((c) => roots.includes(c)) ?? null
      const gid = this.addNode({ type: 'group', name, parent, before: first, t: { p: local, r: [0, 0, 0, 1], s: [1, 1, 1] } })
      this.moveNodes(roots, gid, null, true)
      return gid
    })
  }

  /** Dissolve a group, keeping children in place. Returns the freed child ids. */
  ungroup(groupId: string): string[] {
    const g = this.getNode(groupId)
    if (!g || (g.type !== 'group' && g.type !== 'boolean')) return []
    return this.transact(() => {
      const kids = [...this.getChildren(groupId)]
      const siblings = this.getChildren(g.parent)
      const next = siblings[siblings.indexOf(groupId) + 1] ?? null
      this.moveNodes(kids, g.parent, next, true)
      this.nodesMap.delete(groupId)
      return kids
    })
  }

  // ================================================================== materials
  getMaterial(id: string | null | undefined): MaterialDef | undefined {
    if (!id) return undefined
    return this.materialsMap.get(id) ?? BUILTIN_MATERIAL_MAP.get(id)
  }
  /** Built-ins first, then document materials. */
  listMaterials(): MaterialDef[] {
    return [...BUILTIN_MATERIALS, ...this.materialsMap.values()]
  }
  docMaterials(): MaterialDef[] {
    return [...this.materialsMap.values()]
  }
  addMaterial(def: Partial<MaterialDef> & { name: string }): string {
    const base = BUILTIN_MATERIAL_MAP.get('mat-default')!
    const id = def.id ?? `mat-${newId()}`
    this.transact(() => this.materialsMap.set(id, { ...base, ...clone(def), id, builtin: false }))
    return id
  }
  updateMaterial(id: string, patch: Partial<MaterialDef>): void {
    const cur = this.materialsMap.get(id)
    if (!cur) return
    const next = { ...cur, ...clone(patch), id }
    if (!deepEqual(cur, next)) this.transact(() => this.materialsMap.set(id, next))
  }
  removeMaterial(id: string): void {
    if (this.materialsMap.has(id)) this.transact(() => this.materialsMap.delete(id))
  }

  // ================================================================== layers
  getLayer(id: string): LayerDef | undefined {
    return this.layersMap.get(id)
  }
  listLayers(): LayerDef[] {
    return [...this.layersMap.values()].sort((a, b) => a.order - b.order)
  }
  addLayer(def: Partial<LayerDef> & { name: string }): string {
    const id = def.id ?? `layer-${newId()}`
    const order = Math.max(0, ...this.listLayers().map((l) => l.order)) + 1
    this.transact(() =>
      this.layersMap.set(id, {
        color: '#e6e6e6',
        visible: true,
        locked: false,
        printable: true,
        lineWeight: 0.25,
        lineType: 'continuous',
        order,
        ...clone(def),
        id,
      }),
    )
    return id
  }
  updateLayer(id: string, patch: Partial<LayerDef>): void {
    const cur = this.layersMap.get(id)
    if (cur) this.transact(() => this.layersMap.set(id, { ...cur, ...clone(patch), id }))
  }
  removeLayer(id: string): void {
    if (id === DEFAULT_LAYER_ID || !this.layersMap.has(id)) return
    this.transact(() => {
      for (const [nid, y] of this.nodesMap) if (y.get('layer') === id) this.applyPatch(nid, { layer: null })
      this.layersMap.delete(id)
    })
  }

  // ================================================================== views / sheets / comments
  listViews(): ViewDef[] {
    return [...this.viewsMap.values()].sort((a, b) => a.createdAt - b.createdAt)
  }
  saveView(view: Omit<ViewDef, 'id' | 'createdAt'> & { id?: string }): string {
    const id = view.id ?? newId()
    this.transact(() => this.viewsMap.set(id, { ...clone(view), id, createdAt: Date.now() }))
    return id
  }
  removeView(id: string): void {
    this.transact(() => this.viewsMap.delete(id))
  }

  listSheets(): SheetDef[] {
    return [...this.sheetsMap.values()].sort((a, b) => a.order - b.order)
  }
  getSheet(id: string): SheetDef | undefined {
    return this.sheetsMap.get(id)
  }
  putSheet(sheet: Omit<SheetDef, 'id' | 'order'> & { id?: string; order?: number }): string {
    const id = sheet.id ?? newId()
    const order = sheet.order ?? this.listSheets().length
    this.transact(() => this.sheetsMap.set(id, { ...clone(sheet), id, order }))
    return id
  }
  removeSheet(id: string): void {
    this.transact(() => this.sheetsMap.delete(id))
  }

  listComments(): CommentDef[] {
    return [...this.commentsMap.values()].sort((a, b) => a.createdAt - b.createdAt)
  }
  addComment(c: Omit<CommentDef, 'id' | 'createdAt' | 'resolved' | 'replies'>): string {
    const id = newId()
    this.transact(() => this.commentsMap.set(id, { ...clone(c), id, createdAt: Date.now(), resolved: false, replies: [] }), SILENT_ORIGIN)
    return id
  }
  updateComment(id: string, patch: Partial<Pick<CommentDef, 'text' | 'resolved' | 'anchor'>>): void {
    const cur = this.commentsMap.get(id)
    if (cur) this.transact(() => this.commentsMap.set(id, { ...cur, ...clone(patch) }), SILENT_ORIGIN)
  }
  addReply(commentId: string, reply: Omit<CommentReply, 'id' | 'createdAt'>): void {
    const cur = this.commentsMap.get(commentId)
    if (!cur) return
    const r: CommentReply = { ...clone(reply), id: newId(), createdAt: Date.now() }
    this.transact(() => this.commentsMap.set(commentId, { ...cur, replies: [...cur.replies, r] }), SILENT_ORIGIN)
  }
  removeComment(id: string): void {
    this.transact(() => this.commentsMap.delete(id), SILENT_ORIGIN)
  }

  // ================================================================== components
  getComponent(id: string): ComponentDef | undefined {
    return this.componentsMap.get(id)
  }
  listComponents(): ComponentDef[] {
    return [...this.componentsMap.values()].sort((a, b) => a.createdAt - b.createdAt)
  }
  instancesOf(componentId: string): NodeBase<'instance'>[] {
    return this.nodesOfType('instance').filter((n) => n.params.component === componentId)
  }

  /** Turn nodes into a reusable component; replaces them by one instance at the same place. */
  createComponent(ids: string[], name: string, pivot?: Vec3): { componentId: string; instanceId: string } | null {
    const roots = this.topLevel(ids)
    if (!roots.length) return null
    return this.transact(() => {
      const parents = new Set(roots.map((r) => this.getParent(r)))
      const parent = parents.size === 1 ? [...parents][0]! : null
      const origin = pivot ?? this.getWorldPosition(roots[0]!)
      const componentId = newId()
      const rootId = this.addNode({ type: 'group', name, parent: DEFS_ROOT, t: { p: origin, r: [0, 0, 0, 1], s: [1, 1, 1] } })
      const first = this.getChildren(parent).find((c) => roots.includes(c)) ?? null
      const local = transformPoint(invertMatrix(this.getWorldMatrix(parent)), origin)
      const instanceId = this.addNode({
        type: 'instance',
        name,
        parent,
        before: first,
        params: { component: componentId },
        t: { p: local, r: [0, 0, 0, 1], s: [1, 1, 1] },
      })
      this.moveNodes(roots, rootId, null, true)
      // definition root sits at the origin; children keep their offset from the pivot
      this.applyPatch(rootId, { t: identityTransform() })
      for (const c of this.getChildren(rootId)) {
        const n = this.getNode(c)!
        this.applyPatch(c, { t: { ...n.t, p: [n.t.p[0] - origin[0], n.t.p[1] - origin[1], n.t.p[2] - origin[2]] } })
      }
      this.componentsMap.set(componentId, { id: componentId, name, root: rootId, createdAt: Date.now() })
      return { componentId, instanceId }
    })
  }

  /** Replace an instance by an editable copy of its definition. Returns new root ids. */
  explodeInstance(instanceId: string): string[] {
    const inst = this.getNode<'instance'>(instanceId)
    const def = inst && this.getComponent(inst.params.component)
    if (!inst || !def) return []
    return this.transact(() => {
      const kids = [...this.getChildren(def.root)]
      const copies = this.duplicateNodes(kids)
      const g = this.addNode({ type: 'group', name: inst.name, parent: inst.parent, t: inst.t, before: instanceId })
      this.moveNodes(copies, g, null, false)
      this.nodesMap.delete(instanceId)
      return [g]
    })
  }

  removeComponent(componentId: string): void {
    const def = this.getComponent(componentId)
    if (!def) return
    this.transact(() => {
      this.deleteNodes([def.root, ...this.instancesOf(componentId).map((i) => i.id)])
      this.componentsMap.delete(componentId)
    })
  }

  // ================================================================== snapshots
  /** Serialize nodes (with descendants, used materials, components and asset refs). Roots are stored
   *  in WORLD space with parent = null. */
  snapshot(ids: string[]): DocSnapshot {
    const roots = this.topLevel(ids)
    const nodes: AnyNode[] = []
    const matIds = new Set<string>()
    const compIds = new Set<string>()
    const assets = new Set<string>()
    const visit = (n: AnyNode) => {
      collectRefs(n, matIds, compIds, assets)
    }
    for (const r of roots) {
      const n = structuredClone(this.getNode(r)!) as AnyNode
      n.parent = null
      n.t = decomposeMatrix(this.getWorldMatrix(r))
      nodes.push(n)
      visit(n)
      for (const d of this.getDescendants(r)) {
        const dn = structuredClone(this.getNode(d)!) as AnyNode
        nodes.push(dn)
        visit(dn)
      }
    }
    // components, recursively (definitions may contain instances)
    const components: ComponentDef[] = []
    const componentNodes: AnyNode[] = []
    const seen = new Set<string>()
    const queue = [...compIds]
    while (queue.length) {
      const cid = queue.pop()!
      if (seen.has(cid)) continue
      seen.add(cid)
      const def = this.getComponent(cid)
      if (!def) continue
      components.push(structuredClone(def))
      for (const id of [def.root, ...this.getDescendants(def.root)]) {
        const dn = structuredClone(this.getNode(id)!) as AnyNode
        componentNodes.push(dn)
        const inner = new Set<string>()
        collectRefs(dn, matIds, inner, assets)
        for (const c of inner) if (!seen.has(c)) queue.push(c)
      }
    }
    const materials: MaterialDef[] = []
    for (const id of matIds) {
      const m = this.materialsMap.get(id)
      if (m) {
        materials.push(structuredClone(m))
        for (const ref of Object.values(m.maps ?? {})) if (ref && 'asset' in ref) assets.add(ref.asset)
      }
    }
    return { format: 'cadsandbox/nodes@1', nodes, materials, components, componentNodes, assets: [...assets] }
  }

  /** Insert a snapshot. Roots are converted from world space into `parent`'s space, then moved by
   *  `offset` (world). Returns new root ids. */
  insertSnapshot(snap: DocSnapshot, opts: { parent?: string | null; offset?: Vec3; before?: string | null } = {}): string[] {
    if (snap.format !== 'cadsandbox/nodes@1') throw new Error('Unsupported snapshot format')
    const parent = opts.parent && this.hasNode(opts.parent) ? opts.parent : null
    return this.transact(() => {
      for (const m of snap.materials) if (!this.materialsMap.has(m.id) && !BUILTIN_MATERIAL_MAP.has(m.id)) this.materialsMap.set(m.id, structuredClone(m))
      // components: reuse existing definitions with the same id, otherwise insert with fresh node ids
      for (const def of snap.components) {
        if (this.componentsMap.has(def.id)) continue
        const own = snap.componentNodes.filter((n) => n.id === def.root || isUnder(n, def.root, snap.componentNodes))
        const remap = new Map(own.map((n) => [n.id, newId()]))
        for (const n of own) {
          const c = structuredClone(n) as AnyNode
          c.id = remap.get(n.id)!
          c.parent = n.id === def.root ? DEFS_ROOT : (remap.get(n.parent!) ?? DEFS_ROOT)
          this.nodesMap.set(c.id, nodeToY(c))
          this.indexAdd(c.id)
        }
        this.componentsMap.set(def.id, { ...structuredClone(def), root: remap.get(def.root)! })
      }
      const remap = new Map(snap.nodes.map((n) => [n.id, newId()]))
      const parentInv = invertMatrix(this.getWorldMatrix(parent))
      const off = opts.offset ?? [0, 0, 0]
      const roots: string[] = []
      for (const n of snap.nodes) {
        const c = structuredClone(n) as AnyNode
        c.id = remap.get(n.id)!
        if (n.parent === null) {
          c.parent = parent
          c.order = this.orderBefore(parent, opts.before)
          const world = multiplyMatrices(translationMatrix(off), composeMatrix(n.t))
          c.t = decomposeMatrix(multiplyMatrices(parentInv, world))
          roots.push(c.id)
        } else c.parent = remap.get(n.parent) ?? parent
        this.remapRefs(c, remap)
        this.nodesMap.set(c.id, nodeToY(c))
        this.indexAdd(c.id)
      }
      return roots
    })
  }

  // ================================================================== serialization
  encodeState(): Uint8Array {
    return Y.encodeStateAsUpdate(this.ydoc)
  }
  applyUpdate(update: Uint8Array, origin: unknown = 'remote'): void {
    Y.applyUpdate(this.ydoc, update, origin)
  }

  toJSON(): DocJSON {
    return {
      format: 'cadsandbox/doc@1',
      meta: structuredClone(this.meta),
      nodes: this.allNodes().map((n) => structuredClone(n)),
      materials: this.docMaterials().map((m) => structuredClone(m)),
      layers: this.listLayers().map((l) => structuredClone(l)),
      views: this.listViews().map((v) => structuredClone(v)),
      sheets: this.listSheets().map((s) => structuredClone(s)),
      components: this.listComponents().map((c) => structuredClone(c)),
      comments: this.listComments().map((c) => structuredClone(c)),
    }
  }

  static fromJSON(json: DocJSON, ydoc = new Y.Doc()): CadDocument {
    if (json.format !== 'cadsandbox/doc@1') throw new Error('Unsupported document format')
    const doc = new CadDocument(ydoc)
    doc.ydoc.transact(() => {
      for (const [k, v] of Object.entries({ ...json.meta, schema: SCHEMA_VERSION })) doc.metaMap.set(k, v)
      for (const n of json.nodes) doc.nodesMap.set(n.id, nodeToY(n))
      for (const m of json.materials) doc.materialsMap.set(m.id, m)
      for (const l of json.layers) doc.layersMap.set(l.id, l)
      for (const v of json.views) doc.viewsMap.set(v.id, v)
      for (const s of json.sheets) doc.sheetsMap.set(s.id, s)
      for (const c of json.components) doc.componentsMap.set(c.id, c)
      for (const c of json.comments) doc.commentsMap.set(c.id, c)
    }, SILENT_ORIGIN)
    doc.undoManager.clear()
    return doc
  }

  destroy(): void {
    for (const d of this.disposers) d()
    this.disposers = []
    this.listeners.clear()
    this.undoManager.destroy()
  }
}

function isUnder(n: AnyNode, rootId: string, all: AnyNode[]): boolean {
  const byId = new Map(all.map((x) => [x.id, x]))
  let p = n.parent
  const guard = new Set<string>()
  while (p && !guard.has(p)) {
    if (p === rootId) return true
    guard.add(p)
    p = byId.get(p)?.parent ?? null
  }
  return false
}

/** Collect material / component / asset references of one node. */
export function collectRefs(n: AnyNode, materials: Set<string>, components: Set<string>, assets: Set<string>): void {
  if (n.material) materials.add(n.material)
  switch (n.type) {
    case 'instance':
      if (n.params.component) components.add(n.params.component)
      break
    case 'mesh':
      if (n.params.asset) assets.add(n.params.asset)
      break
    case 'image':
      if (n.params.asset) assets.add(n.params.asset)
      break
    case 'opening':
      for (const k of ['frameMaterial', 'panelMaterial', 'glassMaterial'] as const) {
        const m = n.params[k]
        if (m) materials.add(m)
      }
      break
    case 'wall':
      for (const l of n.params.layers ?? []) if (l.material) materials.add(l.material)
      break
    case 'room':
      if (n.params.floorFinish) materials.add(n.params.floorFinish)
      break
    case 'furniture':
      if (n.params.primaryMaterial) materials.add(n.params.primaryMaterial)
      if (n.params.secondaryMaterial) materials.add(n.params.secondaryMaterial)
      break
  }
}
