// MeshBatcher — merges static node parts into THREE.BatchedMesh objects (one per material + shadow
// flags), feature edges into one multi-draw line batch and wireframe-mode lines into another (drawn
// twice: crisp in front of surfaces, faint behind them). Per-instance matrices and visibility keep
// every node individually movable/hideable while the whole scene renders in a few draw calls.
// Owners keep their standalone meshes (BVH picking, caps, outlines of pulled-out nodes) — only the
// GPU copy lives here.
import * as THREE from 'three'
import type { MaterialDef, RenderMode } from '@cadsandbox/doc'
import type { MaterialCache } from '../materials/materials'

/** Parts above this many vertices stay standalone (huge imports/terrains would bloat the shared buffers). */
export const BATCH_MAX_VERTICES = 250_000
const MIN_VERTICES = 1 << 16
const MIN_INSTANCES = 128
/** Extra space reserved per geometry so re-evaluations (walls with openings, joins) update in place. */
const SLACK = 1.25

export interface BatchHandle {
  /** false once removed (stale references from re-entrant updates are ignored). */
  active: boolean
  group: BatchGroup
  geometryId: number
  instanceId: number
}

export interface BatchGroup {
  key: string
  mesh: THREE.BatchedMesh
  matId: string
  def: MaterialDef
  tint: string | null
  opacity: number | undefined
  castShadow: boolean
  receiveShadow: boolean
  /** Live geometries. */
  count: number
  /** Reserved vertices/indices of geometries deleted since the last optimize() (fragmentation). */
  wastedVertices: number
  wastedIndices: number
}

/** BatchedMesh drawn as GL_LINES: three picks the draw mode from the object flags, the multi-draw path from isBatchedMesh. */
class BatchedLineSegments extends THREE.BatchedMesh {
  constructor(maxInstances: number, maxVertices: number, material: THREE.Material) {
    super(maxInstances, maxVertices, 0, material)
    const self = this as unknown as { isMesh: boolean; isLine: boolean; isLineSegments: boolean; type: string }
    self.isMesh = false
    self.isLine = true
    self.isLineSegments = true
    self.type = 'BatchedLineSegments'
    this.frustumCulled = false
    this.sortObjects = false
    this.castShadow = false
    this.receiveShadow = false
    this.raycast = () => {}
  }
}

const _identity = new THREE.Matrix4()

export class MeshBatcher {
  readonly root = new THREE.Group()
  private materials: MaterialCache
  private groups = new Map<string, BatchGroup>()
  private edges: BatchGroup | null = null
  private wire: BatchGroup | null = null
  private mode: RenderMode = 'shaded'

  constructor(materials: MaterialCache) {
    this.materials = materials
    this.root.name = 'cs-batches'
    this.root.matrixAutoUpdate = false
  }

  static batchable(geometry: THREE.BufferGeometry): boolean {
    const pos = geometry.getAttribute('position')
    return !!pos && pos.count > 0 && pos.count <= BATCH_MAX_VERTICES
  }

  // ------------------------------------------------------------------ parts
  /** Add a part; the caller keeps `geometry` (only its data is copied). Returns null when not batchable. */
  add(geometry: THREE.BufferGeometry, matId: string, def: MaterialDef, tint: string | null, opacity: number | undefined, castShadow: boolean, receiveShadow: boolean): BatchHandle | null {
    if (!MeshBatcher.batchable(geometry)) return null
    const key = `${matId}|${tint ?? ''}|${opacity ?? ''}|${castShadow ? 1 : 0}${receiveShadow ? 1 : 0}`
    let group = this.groups.get(key)
    const src = normalizeMesh(geometry)
    if (!group) {
      const mesh = new THREE.BatchedMesh(MIN_INSTANCES, Math.max(MIN_VERTICES, src.vertices * 4), Math.max(MIN_VERTICES * 3, src.indices * 4), this.materials.get(matId, def, tint, this.mode, opacity))
      mesh.name = `cs-batch:${key}`
      mesh.matrixAutoUpdate = false
      mesh.frustumCulled = false
      mesh.castShadow = castShadow
      mesh.receiveShadow = receiveShadow
      mesh.sortObjects = mesh.material.transparent
      mesh.raycast = () => {} // picking uses the owners' standalone meshes (per-geometry BVH)
      mesh.userData.batch = true
      mesh.userData.noPathTrace = true
      this.root.add(mesh)
      group = { key, mesh, matId, def, tint, opacity, castShadow, receiveShadow, count: 0, wastedVertices: 0, wastedIndices: 0 }
      this.groups.set(key, group)
    }
    return this.insert(group, src)
  }

  /** Feature edges (segment pairs, node-local). */
  addEdges(geometry: THREE.BufferGeometry): BatchHandle | null {
    return this.addLines(geometry, 'edges')
  }

  /** Wireframe-mode lines (segment pairs, node-local); drawn only in wireframe mode. */
  addWire(geometry: THREE.BufferGeometry): BatchHandle | null {
    return this.addLines(geometry, 'wire')
  }

  private addLines(geometry: THREE.BufferGeometry, kind: 'edges' | 'wire'): BatchHandle | null {
    const pos = geometry.getAttribute('position')
    if (!pos || pos.count < 2 || pos.count > BATCH_MAX_VERTICES) return null
    let group = kind === 'edges' ? this.edges : this.wire
    if (!group) {
      const mat = kind === 'edges' ? (this.materials.edges(this.mode) ?? this.materials.edgeShaded) : this.materials.wire(false).front
      const mesh = new BatchedLineSegments(MIN_INSTANCES, Math.max(MIN_VERTICES, pos.count * 4), mat)
      mesh.name = `cs-batch:${kind}`
      mesh.matrixAutoUpdate = false
      mesh.renderOrder = 10
      mesh.userData.batch = true
      mesh.userData[kind] = true
      mesh.userData.noPathTrace = true
      if (kind === 'wire') {
        // second pass right after the first with the same multi-draw ranges: lines behind surfaces, faint
        mesh.onAfterRender = (renderer, scene, camera, geo, material) => {
          if (material !== mesh.material) return // override-material passes (masks, depth) draw once
          // group = null is what three's own renderObject passes for ungrouped geometry (typed too narrowly)
          renderer.renderBufferDirect(camera, scene, geo, this.materials.wire(false).back, mesh, null as unknown as THREE.GeometryGroup)
        }
      }
      this.root.add(mesh)
      group = { key: kind, mesh, matId: '', def: this.materials.fallback, tint: null, opacity: undefined, castShadow: false, receiveShadow: false, count: 0, wastedVertices: 0, wastedIndices: 0 }
      if (kind === 'edges') this.edges = group
      else this.wire = group
      this.applyLineMode()
    }
    const src = new THREE.BufferGeometry()
    src.setAttribute('position', pos)
    src.boundingSphere = geometry.boundingSphere
    return this.insert(group, { geometry: src, vertices: pos.count, indices: 0 })
  }

  private insert(group: BatchGroup, src: Normalized): BatchHandle {
    const mesh = group.mesh
    const reserveV = Math.ceil(src.vertices * SLACK) + 16
    const reserveI = src.indices ? Math.ceil(src.indices * SLACK) + 48 : 0
    this.ensureSpace(group, reserveV, reserveI)
    const geometryId = mesh.addGeometry(src.geometry, reserveV, reserveI)
    const instanceId = mesh.addInstance(geometryId)
    mesh.setMatrixAt(instanceId, _identity)
    group.count++
    return { active: true, group, geometryId, instanceId }
  }

  private ensureSpace(group: BatchGroup, vertices: number, indices: number): void {
    const mesh = group.mesh
    if (mesh.instanceCount >= mesh.maxInstanceCount) mesh.setInstanceCount(mesh.maxInstanceCount * 2)
    const indexed = mesh.geometry.getIndex() !== null
    const fits = () => mesh.unusedVertexCount >= vertices && (!indexed || mesh.unusedIndexCount >= indices)
    if (fits()) return
    // reclaim holes left by deleted geometries before growing
    if (group.wastedVertices > 0 || group.wastedIndices > 0) {
      mesh.optimize()
      group.wastedVertices = 0
      group.wastedIndices = 0
      if (fits()) return
    }
    const g = mesh.geometry
    let maxV = g.getAttribute('position').count
    let maxI = indexed ? g.getIndex()!.count : 0
    const usedV = maxV - mesh.unusedVertexCount
    const usedI = indexed ? maxI - mesh.unusedIndexCount : 0
    while (maxV - usedV < vertices) maxV *= 2
    while (indexed && maxI - usedI < indices) maxI *= 2
    mesh.setGeometrySize(maxV, maxI)
  }

  remove(handle: BatchHandle): void {
    if (!handle.active) return
    handle.active = false
    const group = handle.group
    const mesh = group.mesh
    const info = (mesh as unknown as { _geometryInfo: { reservedVertexCount: number; reservedIndexCount: number; active: boolean }[] })._geometryInfo[handle.geometryId]
    if (info?.active) {
      group.wastedVertices += info.reservedVertexCount
      group.wastedIndices += Math.max(0, info.reservedIndexCount)
    }
    mesh.deleteGeometry(handle.geometryId) // also deletes its instance
    group.count--
  }

  setMatrix(handle: BatchHandle, world: THREE.Matrix4): void {
    if (handle.active) handle.group.mesh.setMatrixAt(handle.instanceId, world)
  }

  setVisible(handle: BatchHandle, visible: boolean): void {
    if (!handle.active) return
    const mesh = handle.group.mesh
    if (mesh.getVisibleAt(handle.instanceId) !== visible) mesh.setVisibleAt(handle.instanceId, visible)
  }

  // ------------------------------------------------------------------ materials / modes
  applyMode(mode: RenderMode): void {
    this.mode = mode
    for (const g of this.groups.values()) this.assignMaterial(g)
    this.applyLineMode()
  }

  private applyLineMode(): void {
    if (this.edges) {
      const em = this.materials.edges(this.mode)
      this.edges.mesh.visible = !!em
      if (em) this.edges.mesh.material = em
    }
    if (this.wire) this.wire.mesh.visible = this.mode === 'wireframe'
  }

  private assignMaterial(g: BatchGroup): void {
    const mat = this.materials.get(g.matId, g.def, g.tint, this.mode, g.opacity)
    g.mesh.material = mat
    g.mesh.sortObjects = mat.transparent
  }

  /** A document material changed: refresh the three materials of groups using it (defs re-resolved by the caller). */
  refreshMaterial(matId: string, def: MaterialDef): void {
    for (const g of this.groups.values()) {
      if (g.matId !== matId) continue
      g.def = def
      this.assignMaterial(g)
    }
  }

  /** Batch objects only (no proxies) — hidden while the path tracer reads the exposed standalone meshes. */
  setBatchesVisible(visible: boolean): void {
    for (const g of this.groups.values()) g.mesh.visible = visible
  }

  get drawGroups(): number {
    return this.groups.size + (this.edges ? 1 : 0) + (this.wire ? 1 : 0)
  }

  dispose(): void {
    for (const g of this.groups.values()) {
      this.root.remove(g.mesh)
      g.mesh.dispose()
    }
    this.groups.clear()
    for (const g of [this.edges, this.wire]) {
      if (!g) continue
      this.root.remove(g.mesh)
      g.mesh.dispose()
    }
    this.edges = null
    this.wire = null
  }
}

interface Normalized {
  geometry: THREE.BufferGeometry
  vertices: number
  indices: number
}

/** All batched meshes share one attribute layout: position, normal, uv, indexed (missing pieces are synthesized). */
function normalizeMesh(geometry: THREE.BufferGeometry): Normalized {
  const pos = geometry.getAttribute('position')
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', pos)
  let index = geometry.getIndex()
  if (!index) {
    const arr = new Uint32Array(pos.count)
    for (let i = 0; i < arr.length; i++) arr[i] = i
    index = new THREE.BufferAttribute(arr, 1)
  }
  g.setIndex(index)
  const normal = geometry.getAttribute('normal')
  if (normal && normal.count === pos.count) g.setAttribute('normal', normal)
  else g.computeVertexNormals()
  const uv = geometry.getAttribute('uv')
  g.setAttribute('uv', uv && uv.count === pos.count ? uv : new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2))
  g.boundingBox = geometry.boundingBox
  g.boundingSphere = geometry.boundingSphere
  return { geometry: g, vertices: pos.count, indices: index.count }
}
