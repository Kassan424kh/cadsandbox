// GPU instancing of component instances: one InstancedMesh per (component, definition node, part).
// Instance matrices = instance node world matrix × definition-local matrix of the part's node.
import * as THREE from 'three'
import type { AnyNode, CadDocument, NodeBase, RenderMode } from '@cadsandbox/doc'
import type { GeometryService } from '@cadsandbox/geometry'
import type { MaterialCache } from '../materials/materials'
import { buildParts, resultBounds } from './nodeContent'
import { mat4FromDoc } from '../util/math'

interface BatchMesh {
  mesh: THREE.InstancedMesh
  defNodeId: string
  partIndex: number
  matId: string
  def: import('@cadsandbox/doc').MaterialDef
  tint: string | null
  localBounds: THREE.Box3
}

interface ComponentBatch {
  componentId: string
  rootId: string
  meshes: BatchMesh[]
  /** Instance node ids in matrix order */
  instanceIds: string[]
  dirty: boolean
  /** World bounds of every instance (index-aligned with instanceIds) */
  instanceBounds: THREE.Box3[]
  group: THREE.Group
}

export class Instancing {
  readonly root = new THREE.Group()
  private doc: CadDocument
  private geometry: GeometryService
  private materials: MaterialCache
  private batches = new Map<string, ComponentBatch>()
  private mode: RenderMode = 'shaded'
  /** Instance nodes hidden by isolation/level filters (global, not per viewport). */
  private hidden = new Set<string>()
  private requestRender: () => void

  constructor(doc: CadDocument, geometry: GeometryService, materials: MaterialCache, requestRender: () => void) {
    this.doc = doc
    this.geometry = geometry
    this.materials = materials
    this.requestRender = requestRender
    this.root.name = 'cs-instances'
    this.root.matrixAutoUpdate = false
  }

  /** Component whose definition subtree contains `defNodeId`, if any. */
  componentOfDefinitionNode(defNodeId: string): string | null {
    const rootId = this.definitionRootOf(defNodeId)
    if (!rootId) return null
    for (const c of this.doc.listComponents()) if (c.root === rootId) return c.id
    return null
  }

  private definitionRootOf(id: string): string | null {
    let cur: string | null = id
    const guard = new Set<string>()
    while (cur && !guard.has(cur)) {
      guard.add(cur)
      const parent: string | null = this.doc.getParent(cur)
      if (parent === '__defs__') return cur
      cur = parent
    }
    return null
  }

  markDirty(componentId: string): void {
    const b = this.batches.get(componentId)
    if (b) b.dirty = true
    else if (this.doc.getComponent(componentId)) this.batches.set(componentId, this.newBatch(componentId))
  }

  markAllDirty(): void {
    for (const b of this.batches.values()) b.dirty = true
    for (const c of this.doc.listComponents()) if (!this.batches.has(c.id)) this.batches.set(c.id, this.newBatch(c.id))
  }

  private newBatch(componentId: string): ComponentBatch {
    const def = this.doc.getComponent(componentId)!
    const group = new THREE.Group()
    group.matrixAutoUpdate = false
    group.userData.componentId = componentId
    this.root.add(group)
    return { componentId, rootId: def.root, meshes: [], instanceIds: [], dirty: true, instanceBounds: [], group }
  }

  setHidden(ids: Set<string>): void {
    let changed = ids.size !== this.hidden.size
    if (!changed) for (const id of ids) if (!this.hidden.has(id)) changed = true
    if (!changed) return
    this.hidden = new Set(ids)
    this.markAllDirty()
  }

  /** Rebuild dirty batches (called once per frame before rendering). */
  flush(): boolean {
    let changed = false
    for (const [cid, batch] of this.batches) {
      if (!batch.dirty) continue
      batch.dirty = false
      changed = true
      const def = this.doc.getComponent(cid)
      if (!def) {
        this.disposeBatch(batch)
        this.batches.delete(cid)
        continue
      }
      batch.rootId = def.root
      this.rebuild(batch)
    }
    return changed
  }

  private rebuild(batch: ComponentBatch): void {
    for (const bm of batch.meshes) {
      batch.group.remove(bm.mesh)
      bm.mesh.dispose()
    }
    batch.meshes = []
    const instances = this.doc
      .instancesOf(batch.componentId)
      .filter((n) => !this.doc.isDefinitionNode(n.id) && this.doc.isEffectivelyVisible(n.id) && !this.hidden.has(n.id))
    batch.instanceIds = instances.map((n) => n.id)
    batch.instanceBounds = instances.map(() => new THREE.Box3())
    if (!instances.length) return
    const worldMatrices = instances.map((n) => mat4FromDoc(this.doc.getWorldMatrix(n.id)))
    const defNodes = [batch.rootId, ...this.doc.getDescendants(batch.rootId)]
    for (const defId of defNodes) {
      const result = this.geometry.get(defId)
      if (!result || !result.parts.length || this.geometry.isConsumed(defId)) continue
      const node = this.doc.getNode(defId) as AnyNode | undefined
      if (!node || !node.visible) continue
      const local = mat4FromDoc(this.doc.getWorldMatrix(defId)) // relative to DEFS_ROOT = definition space
      const built = buildParts(result, defId, this.requestRender)
      const bounds = resultBounds(result)
      built.forEach((bp, partIndex) => {
        const { def, id, tint } = this.materials.resolveDef(node, bp.part)
        const im = new THREE.InstancedMesh(bp.mesh.geometry, this.materials.get(id, def, tint, this.mode), instances.length)
        im.castShadow = bp.part.castShadow ?? true
        im.receiveShadow = bp.part.receiveShadow ?? true
        im.matrixAutoUpdate = false
        im.userData.componentId = batch.componentId
        im.userData.defNodeId = defId
        im.userData.instanced = true
        for (let i = 0; i < instances.length; i++) {
          _m.multiplyMatrices(worldMatrices[i]!, local)
          im.setMatrixAt(i, _m)
          if (!bounds.isEmpty()) batch.instanceBounds[i]!.union(_b.copy(bounds).applyMatrix4(_m))
        }
        im.instanceMatrix.needsUpdate = true
        im.computeBoundingSphere()
        batch.group.add(im)
        batch.meshes.push({ mesh: im, defNodeId: defId, partIndex, matId: id, def, tint, localBounds: bounds })
      })
    }
  }

  /** Instance node id for a raycast hit on an instanced mesh. */
  nodeIdAt(mesh: THREE.InstancedMesh, instanceId: number): string | null {
    const batch = this.batches.get(mesh.userData.componentId as string)
    return batch?.instanceIds[instanceId] ?? null
  }

  worldBounds(instanceNodeId: string, out: THREE.Box3): boolean {
    const node = this.doc.getNode<'instance'>(instanceNodeId)
    if (!node) return false
    const batch = this.batches.get(node.params.component)
    if (!batch) return false
    const i = batch.instanceIds.indexOf(instanceNodeId)
    if (i < 0 || batch.instanceBounds[i]!.isEmpty()) return false
    out.copy(batch.instanceBounds[i]!)
    return true
  }

  /** Matrix + geometry for an outline proxy of one instance. */
  proxies(instanceNodeId: string): { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }[] {
    const node = this.doc.getNode<'instance'>(instanceNodeId)
    if (!node) return []
    const batch = this.batches.get(node.params.component)
    if (!batch) return []
    const i = batch.instanceIds.indexOf(instanceNodeId)
    if (i < 0) return []
    return batch.meshes.map((bm) => {
      const m = new THREE.Matrix4()
      bm.mesh.getMatrixAt(i, m)
      return { geometry: bm.mesh.geometry, matrix: m }
    })
  }

  applyMode(mode: RenderMode): void {
    if (mode === this.mode) return
    this.mode = mode
    for (const batch of this.batches.values()) {
      for (const bm of batch.meshes) {
        bm.mesh.material = this.materials.get(bm.matId, bm.def, bm.tint, mode)
        bm.mesh.visible = mode !== 'wireframe'
      }
    }
  }

  /** All instanced meshes (for picking). */
  meshes(): THREE.InstancedMesh[] {
    const out: THREE.InstancedMesh[] = []
    for (const b of this.batches.values()) for (const bm of b.meshes) out.push(bm.mesh)
    return out
  }

  get componentIds(): Iterable<string> {
    return this.batches.keys()
  }

  onInstancesChanged(componentIds: Iterable<string>): void {
    for (const c of componentIds) this.markDirty(c)
  }

  invalidateMaterial(materialId: string): void {
    for (const b of this.batches.values()) if (b.meshes.some((m) => m.matId === materialId)) b.dirty = true
  }

  private disposeBatch(batch: ComponentBatch): void {
    for (const bm of batch.meshes) {
      bm.mesh.dispose()
      const g = bm.mesh.geometry
      g.disposeBoundsTree?.()
      g.dispose()
    }
    batch.meshes = []
    this.root.remove(batch.group)
  }

  dispose(): void {
    for (const b of this.batches.values()) this.disposeBatch(b)
    this.batches.clear()
  }

  static instanceType(node: NodeBase | undefined): node is NodeBase<'instance'> {
    return !!node && node.type === 'instance'
  }
}

const _m = new THREE.Matrix4()
const _b = new THREE.Box3()
