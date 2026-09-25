// SnapshotBuilder — accumulates nodes, component definitions, materials, layers and blobs produced
// by an importer and emits a DocSnapshot (+ assets) ready for doc.insertSnapshot().
import { DEFS_ROOT, composeMatrix, makeNode, newId, transformPoint } from '@cadsandbox/doc'
import type { AnyNode, ComponentDef, LayerDef, MaterialDef, NewNode, NodeType, Transform, Vec3 } from '@cadsandbox/doc'
import type { ImportResult, ImportedAsset } from './api'
import { sha256Hex } from './util/hash'
import { asBytes } from './util/bytes'

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/** i-th key of the `fractional-indexing` integer sequence ('a0'…'az', 'b00'…'bzz', 'c000'…), so
 *  imported siblings keep their order and later inserts via generateKeyBetween() stay valid. */
export function orderKey(i: number): string {
  let head = 0
  let n = Math.max(0, Math.floor(i))
  let size = 62
  while (n >= size && head < 25) {
    n -= size
    head++
    size *= 62
  }
  let s = ''
  for (let k = 0; k <= head; k++) {
    s = DIGITS[n % 62] + s
    n = Math.floor(n / 62)
  }
  return String.fromCharCode(97 + head) + s
}

export function materialDef(p: Partial<MaterialDef> & { name: string }): MaterialDef {
  return {
    id: p.id ?? `mat-${newId()}`,
    category: 'generic',
    color: '#cccccc',
    roughness: 0.6,
    metalness: 0,
    opacity: 1,
    transmission: 0,
    ior: 1.5,
    ...p,
    builtin: false,
  }
}

export function layerDef(p: Partial<LayerDef> & { name: string }, order: number): LayerDef {
  return {
    id: p.id ?? `layer-${newId()}`,
    color: '#e6e6e6',
    visible: true,
    locked: false,
    printable: true,
    lineWeight: 0.25,
    lineType: 'continuous',
    order,
    ...p,
  }
}

type NodeInit<T extends NodeType> = Omit<NewNode<T>, 'type' | 'before'> & { parent: string | null }

/** Distance from the origin (m) beyond which imported content is re-centred (float32 GPU precision). */
const FAR = 10_000

export class SnapshotBuilder {
  readonly nodes: AnyNode[] = []
  readonly componentNodes: AnyNode[] = []
  readonly components: ComponentDef[] = []
  readonly warnings: string[] = []
  private readonly mats = new Map<string, MaterialDef>()
  private readonly matKeys = new Map<string, string>()
  private readonly assetMap = new Map<string, ImportedAsset>()
  private readonly layerMap = new Map<string, LayerDef>()
  private readonly counts = new Map<string | null, number>()
  private readonly byId = new Map<string, AnyNode>()
  private readonly min: Vec3 = [Infinity, Infinity, Infinity]
  private readonly max: Vec3 = [-Infinity, -Infinity, -Infinity]
  private readonly warned = new Set<string>()

  /** Create a node (defaults filled by the doc schema). `def` = part of a component definition. */
  add<T extends NodeType>(type: T, init: NodeInit<T>, def = false): AnyNode {
    const node = makeNode({ ...init, type } as NewNode<T>) as unknown as AnyNode
    node.order = this.nextOrder(init.parent)
    ;(def ? this.componentNodes : this.nodes).push(node)
    this.byId.set(node.id, node)
    return node
  }

  get(id: string): AnyNode | undefined {
    return this.byId.get(id)
  }

  /** New component definition (root group under DEFS_ROOT). */
  component(name: string, category?: string): { def: ComponentDef; root: AnyNode } {
    const root = this.add('group', { name, parent: DEFS_ROOT }, true)
    const def: ComponentDef = { id: `comp-${newId()}`, name, root: root.id, createdAt: Date.now() }
    if (category) def.category = category
    this.components.push(def)
    return { def, root }
  }

  /** Register a blob, returns its sha256 hash (deduplicated). */
  async asset(bytes: Uint8Array, mime: string): Promise<string> {
    const b = asBytes(bytes)
    const hash = await sha256Hex(b)
    if (!this.assetMap.has(hash)) this.assetMap.set(hash, { hash, bytes: b, mime })
    return hash
  }

  hasAsset(hash: string): boolean {
    return this.assetMap.has(hash)
  }

  /** Register a material; identical definitions (ignoring id/name) are merged. Returns its id. */
  material(def: MaterialDef): string {
    const { id: _id, name: _name, ...rest } = def
    const key = JSON.stringify(rest) + '|' + def.name
    const existing = this.matKeys.get(key)
    if (existing) return existing
    this.mats.set(def.id, def)
    this.matKeys.set(key, def.id)
    return def.id
  }

  layer(def: Partial<LayerDef> & { name: string }): string {
    for (const l of this.layerMap.values()) if (l.name === def.name) return l.id
    const l = layerDef(def, this.layerMap.size + 1)
    this.layerMap.set(l.id, l)
    return l.id
  }

  warn(message: string): void {
    if (this.warned.has(message)) return
    this.warned.add(message)
    this.warnings.push(message)
  }

  /** Grow the world-space bounds by points given in a node transform's space. */
  expand(points: Iterable<Vec3>, world?: Transform | Float64Array): void {
    const m = world ? (world instanceof Float64Array ? world : composeMatrix(world)) : null
    for (const p of points) {
      const w = m ? transformPoint(m, p) : p
      for (let k = 0; k < 3; k++) {
        if (!Number.isFinite(w[k]!)) continue
        if (w[k]! < this.min[k]!) this.min[k] = w[k]!
        if (w[k]! > this.max[k]!) this.max[k] = w[k]!
      }
    }
  }

  private nextOrder(parent: string | null): string {
    const n = this.counts.get(parent) ?? 0
    this.counts.set(parent, n + 1)
    return orderKey(n)
  }

  result(extra: Partial<ImportResult> = {}): ImportResult {
    const hasBounds = this.min[0] !== Infinity
    let bounds = hasBounds ? { min: [...this.min] as Vec3, max: [...this.max] as Vec3 } : undefined
    if (bounds) {
      const c: Vec3 = [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2, 0]
      if (Math.hypot(c[0], c[1]) > FAR) {
        // Geo-referenced content (survey grids, UTM): move to the origin, remember the offset.
        const off: Vec3 = [-Math.round(c[0]), -Math.round(c[1]), 0]
        const shift = (n: AnyNode) => {
          n.t = { ...n.t, p: [n.t.p[0] + off[0], n.t.p[1] + off[1], n.t.p[2]] }
          n.meta = { ...n.meta, importOffset: [-off[0], -off[1], 0] }
        }
        for (const n of this.nodes) {
          if (n.parent !== null) continue
          // levels may only move along Z: shift their contents instead
          if (n.type === 'level') for (const ch of this.nodes) ch.parent === n.id && shift(ch)
          else shift(n)
        }
        bounds = {
          min: [bounds.min[0] + off[0], bounds.min[1] + off[1], bounds.min[2]],
          max: [bounds.max[0] + off[0], bounds.max[1] + off[1], bounds.max[2]],
        }
        this.warn(`Content was far from the origin and has been moved by (${off[0]}, ${off[1]}) m; the original offset is stored in the root's meta.importOffset.`)
      }
    }
    const materials = [...this.mats.values()]
    const assetHashes = new Set<string>(this.assetMap.keys())
    const out: ImportResult = {
      snapshot: {
        format: 'cadsandbox/nodes@1',
        nodes: this.nodes,
        materials,
        components: this.components,
        componentNodes: this.componentNodes,
        assets: [...assetHashes],
        ...(bounds ? { bounds } : {}),
      },
      assets: [...this.assetMap.values()],
      warnings: this.warnings,
      ...extra,
    }
    if (this.layerMap.size) out.layers = [...this.layerMap.values()]
    return out
  }
}
