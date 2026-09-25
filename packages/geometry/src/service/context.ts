// Builds the plain-data EvalContext for a node from the document (+ already evaluated results) and
// records which other nodes / materials / levels the result depends on.
import {
  TYPE_DEFAULT_MATERIAL,
  composeMatrix,
  invertMatrix,
  multiplyMatrices,
  transformPoint,
  type AnyNode,
  type CadDocument,
  type Mat4,
  type NodeBase,
  type Vec3,
} from '@cadsandbox/doc'
import type { Bounds3, GeometryResult, SnapKind } from '../api'
import { affineFromMat4 } from '../core/math2d'
import { transformBounds, transformMesh, unionBounds } from '../core/mesh'
import type { EvalContext, MaterialInfo, NeighborWall, OpeningRef, OperandGeometry, OperandSolid } from '../evaluators/context'
import { WallFrame, transformWallParams } from '../evaluators/wall/frame'
import { rawFootprint } from '../evaluators/wall/joins'

export interface ContextInputs {
  /** nodes whose params / transform / existence affect the result */
  nodes: Set<string>
  materials: Set<string>
  level: string | null
  units: boolean
  /** nodes whose RESULTS must be evaluated first */
  deps: string[]
  /** asset that must be loaded before evaluation (undefined = none) */
  asset?: string
}

export interface BuiltContext {
  ctx: EvalContext
  inputs: ContextInputs
}

export type ResultLookup = (id: string) => { key: string; result: GeometryResult } | undefined
export type AssetLookup = (hash: string) => ArrayBuffer | null | undefined

const ARCH_LEVEL_TYPES = new Set(['wall', 'opening', 'slab', 'roof', 'stair', 'column', 'beam', 'railing', 'room'])

function materialInfo(doc: CadDocument, id: string): MaterialInfo | undefined {
  const m = doc.getMaterial(id)
  return m ? { color: m.color, category: m.category, hatch: m.hatch } : undefined
}

export interface WallIndexEntry {
  id: string
  level: string | null
  isDefinition: boolean
  world: Mat4
  /** raw footprint bbox in world XY */
  min: [number, number]
  max: [number, number]
  thickness: number
}

/** Per-wall placement data shared by all context builds of one pass (O(n) instead of O(n²)). */
export type WallIndex = Map<string, WallIndexEntry>

export function buildWallIndex(doc: CadDocument): WallIndex {
  const index: WallIndex = new Map()
  for (const w of doc.nodesOfType('wall')) index.set(w.id, wallIndexEntry(doc, w))
  return index
}

/** Placement entry of one wall (world footprint bbox); the service refreshes entries incrementally. */
export function wallIndexEntry(doc: CadDocument, w: NodeBase<'wall'>): WallIndexEntry {
  const world = doc.getWorldMatrix(w.id)
  const xf = affineFromMat4(world)
  const params = transformWallParams(w.params, xf)
  const fp = rawFootprint(new WallFrame(params, null))
  const b = bboxOf(fp)
  return { id: w.id, level: doc.getLevelOf(w.id), isDefinition: doc.isDefinitionNode(w.id), world, min: b.min, max: b.max, thickness: params.thickness }
}

/** Walls on the same level as `wall`, within join reach, expressed in the wall's local frame. */
export function nearbyWalls(doc: CadDocument, wall: NodeBase<'wall'>, index?: WallIndex | NodeBase<'wall'>[]): NeighborWall[] {
  const idx: WallIndex = index instanceof Map ? index : buildWallIndex(doc)
  const me = idx.get(wall.id)
  if (!me) return []
  const inv = invertMatrix(me.world)
  const reach = me.thickness + 0.1
  const out: NeighborWall[] = []
  for (const e of idx.values()) {
    if (e.id === wall.id || e.level !== me.level || e.isDefinition !== me.isDefinition) continue
    const r = reach + e.thickness
    if (e.min[0] > me.max[0] + r || e.max[0] < me.min[0] - r || e.min[1] > me.max[1] + r || e.max[1] < me.min[1] - r) continue
    const w = doc.getNode<'wall'>(e.id)
    if (!w) continue
    const m = multiplyMatrices(inv, e.world)
    out.push({ id: e.id, params: w.params, xf: affineFromMat4(m), dz: m[14]! })
  }
  return out
}

function bboxOf(pts: readonly [number, number][]): { min: [number, number]; max: [number, number] } {
  const min: [number, number] = [Infinity, Infinity], max: [number, number] = [-Infinity, -Infinity]
  for (const p of pts) {
    if (p[0] < min[0]) min[0] = p[0]
    if (p[1] < min[1]) min[1] = p[1]
    if (p[0] > max[0]) max[0] = p[0]
    if (p[1] > max[1]) max[1] = p[1]
  }
  return { min, max }
}

/** Resolve an associative dimension anchor to a world point. */
function resolveAnchor(doc: CadDocument, ref: { node: string; anchor: string }, lookup: ResultLookup): Vec3 | null {
  const n = doc.getNode(ref.node)
  if (!n) return null
  const world = doc.getWorldMatrix(n.id)
  const p = n.params as Record<string, unknown>
  const a = ref.anchor
  if (a === 'origin' || a === '') return transformPoint(world, [0, 0, 0])
  if ((a === 'a' || a === 'b') && Array.isArray(p[a])) {
    const v = p[a] as number[]
    return transformPoint(world, [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0])
  }
  const res = lookup(n.id)?.result
  if (!res) return null
  if (a === 'center') {
    const b = transformBounds(res.bounds, world)
    return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2]
  }
  const m = /^([a-z]+):(\d+)$/.exec(a)
  if (m && res.snaps) {
    const kind = m[1] as SnapKind | 'snap'
    const idx = Number(m[2])
    const list = kind === 'snap' ? res.snaps : res.snaps.filter((s) => s.kind === kind)
    const s = list[idx]
    return s ? transformPoint(world, s.p) : null
  }
  return null
}

export function buildContext(doc: CadDocument, node: AnyNode, lookup: ResultLookup, assets: AssetLookup, wallIndex?: WallIndex): BuiltContext {
  const inputs: ContextInputs = { nodes: new Set(), materials: new Set(), level: null, units: false, deps: [] }
  const levelId = doc.getLevelOf(node.id)
  const level = levelId ? doc.getNode<'level'>(levelId) : undefined
  const ctx: EvalContext = {
    units: doc.meta.units,
    level: { height: level?.params.height ?? 3, cutHeight: level?.params.cutHeight ?? 1.1 },
    materials: {},
  }
  if (ARCH_LEVEL_TYPES.has(node.type) && levelId) {
    inputs.level = levelId
    // plan cut height relative to the node's own frame (nodes are usually placed in level space)
    const refId = node.type === 'opening' && node.parent && doc.getNode(node.parent)?.type === 'wall' ? node.parent : node.id
    const dz = doc.getWorldMatrix(refId)[14]! - doc.getWorldMatrix(levelId)[14]!
    ctx.level = { height: ctx.level.height, cutHeight: ctx.level.cutHeight - dz }
  }
  const addMaterial = (id: string | null | undefined) => {
    if (!id) return
    inputs.materials.add(id)
    const info = materialInfo(doc, id)
    if (info) ctx.materials[id] = info
  }
  addMaterial(node.material ?? TYPE_DEFAULT_MATERIAL[node.type])
  switch (node.type) {
    case 'wall': {
      const w = node as NodeBase<'wall'>
      for (const l of w.params.layers ?? []) addMaterial(l.material)
      const walls = nearbyWalls(doc, w, wallIndex)
      ctx.walls = walls
      for (const nb of walls) inputs.nodes.add(nb.id)
      const openings: OpeningRef[] = []
      for (const cid of doc.getChildren(w.id)) {
        const c = doc.getNode(cid)
        if (c?.type === 'opening') {
          openings.push({ id: c.id, params: (c as NodeBase<'opening'>).params })
          inputs.nodes.add(c.id)
        }
      }
      ctx.openings = openings
      break
    }
    case 'opening': {
      const o = node as NodeBase<'opening'>
      addMaterial(o.params.frameMaterial)
      addMaterial(o.params.panelMaterial)
      addMaterial(o.params.glassMaterial)
      const parent = o.parent ? doc.getNode(o.parent) : undefined
      if (parent?.type === 'wall') {
        const toLocal = multiplyMatrices(invertMatrix(doc.getWorldMatrix(o.id)), doc.getWorldMatrix(parent.id))
        const index = doc.getChildren(parent.id).filter((c) => doc.getNode(c)?.type === 'opening').indexOf(o.id)
        ctx.host = { wall: (parent as NodeBase<'wall'>).params, toLocal: Array.from(toLocal), openingIndex: Math.max(0, index) }
        inputs.nodes.add(parent.id)
      }
      break
    }
    case 'boolean': {
      const inv = invertMatrix(doc.getWorldMatrix(node.id))
      const operands: OperandGeometry[] = []
      for (const cid of doc.getChildren(node.id)) {
        const solids: OperandSolid[] = []
        const keys: string[] = []
        for (const id of [cid, ...doc.getDescendants(cid)]) {
          inputs.nodes.add(id)
          inputs.deps.push(id)
          const r = lookup(id)
          const n = doc.getNode(id)
          if (!r || !n) continue
          keys.push(r.key)
          if (!r.result.parts.length || r.result.error) continue
          const rel: Mat4 = multiplyMatrices(inv, doc.getWorldMatrix(id))
          keys.push(Array.from(rel).map((v) => v.toFixed(6)).join(','))
          for (const part of r.result.parts) {
            if (!part.mesh.positions.length) continue
            const material = part.material === 'node' ? (n.material ?? null) : part.material.id
            solids.push({ mesh: transformMesh(part.mesh, rel), material })
          }
        }
        operands.push({ nodeId: cid, key: keys.join('|'), solids })
      }
      ctx.operands = operands
      break
    }
    case 'instance': {
      const def = doc.getComponent((node as NodeBase<'instance'>).params.component)
      if (def && doc.hasNode(def.root)) {
        const rootInv = invertMatrix(doc.getWorldMatrix(def.root))
        let bounds: Bounds3 | null = null
        for (const id of [def.root, ...doc.getDescendants(def.root)]) {
          inputs.nodes.add(id)
          inputs.deps.push(id)
          const r = lookup(id)?.result
          if (!r || (!r.parts.length && !r.drawing && !r.plan && !r.snaps)) continue
          const rel = multiplyMatrices(rootInv, doc.getWorldMatrix(id))
          bounds = unionBounds(bounds, transformBounds(r.bounds, rel))
        }
        ctx.definitionBounds = bounds
      } else ctx.definitionBounds = null
      break
    }
    case 'room': {
      const r = node as NodeBase<'room'>
      inputs.units = true
      addMaterial(r.params.floorFinish)
      if (r.params.auto && levelId) {
        const inv = invertMatrix(doc.getWorldMatrix(r.id))
        const walls: NeighborWall[] = []
        for (const w of doc.nodesOfType('wall')) {
          if (doc.getLevelOf(w.id) !== levelId || doc.isDefinitionNode(w.id)) continue
          const m = multiplyMatrices(inv, doc.getWorldMatrix(w.id))
          walls.push({ id: w.id, params: w.params, xf: affineFromMat4(m), dz: m[14]! })
          inputs.nodes.add(w.id)
        }
        ctx.levelWalls = walls
      }
      break
    }
    case 'dimension': {
      const d = node as NodeBase<'dimension'>
      inputs.units = true
      if (d.params.refs?.length) {
        const inv = invertMatrix(doc.getWorldMatrix(d.id))
        ctx.anchors = d.params.refs.map((ref) => {
          if (!ref || ref.node === d.id || !doc.hasNode(ref.node)) return null
          inputs.nodes.add(ref.node)
          inputs.deps.push(ref.node)
          const wp = resolveAnchor(doc, ref, lookup)
          return wp ? transformPoint(inv, wp) : null
        })
      }
      break
    }
    case 'leader':
    case 'scalebar':
      inputs.units = true
      break
    case 'levelmark': {
      // Height markers display the node's WORLD elevation → re-evaluate with units and when the level moves.
      inputs.units = true
      ctx.elevation = doc.getWorldMatrix(node.id)[14]!
      if (levelId) {
        inputs.nodes.add(levelId)
        inputs.deps.push(levelId)
      }
      break
    }
    case 'furniture': {
      const f = node as NodeBase<'furniture'>
      addMaterial(f.params.primaryMaterial)
      addMaterial(f.params.secondaryMaterial)
      break
    }
    case 'mesh': {
      const hash = (node as NodeBase<'mesh'>).params.asset
      if (hash) {
        inputs.asset = hash
        const bytes = assets(hash)
        ctx.asset = bytes === undefined ? undefined : bytes
      }
      break
    }
    default:
      break
  }
  // definition nodes never join with scene walls and vice versa (handled in nearbyWalls)
  return { ctx, inputs }
}

/** Key describing everything an evaluation depends on (node recipe + context). */
export function contextKey(node: AnyNode, ctx: EvalContext, stableStringify: (v: unknown) => string, hash: (s: string) => string): string {
  const meta = node.meta as Record<string, unknown>
  const relevantMeta = { textSize: meta.textSize, terminator: meta.terminator }
  const ctxForKey = {
    ...ctx,
    operands: ctx.operands?.map((o) => ({ nodeId: o.nodeId, key: o.key })),
    asset: ctx.asset === undefined ? undefined : ctx.asset === null ? 'missing' : `bytes:${ctx.asset.byteLength}`,
  }
  const idPart = node.type === 'wall' ? node.id : ''
  return hash(`${node.type}|${idPart}|${node.material ?? ''}|${node.type === 'room' ? node.name : ''}|${stableStringify(node.params)}|${stableStringify(relevantMeta)}|${stableStringify(ctxForKey)}`)
}

export { composeMatrix }
