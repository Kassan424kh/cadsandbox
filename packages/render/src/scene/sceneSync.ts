// SceneSync — mirrors the CadDocument scene tree into three.js and applies geometry results:
// one Group per node (matrix from node.t), meshes + edges from parts, node-plane drawings, plan
// symbology, lights, section helpers; component instances are batched by `Instancing`.
import * as THREE from 'three'
import type { AnyNode, CadDocument, DocChangeEvent, RenderMode } from '@cadsandbox/doc'
import { DEFAULT_LAYER_ID, DEFS_ROOT } from '@cadsandbox/doc'
import type { GeometryResult, GeometryService } from '@cadsandbox/geometry'
import type { MaterialCache } from '../materials/materials'
import type { HatchTextures } from '../materials/hatch'
import type { ThemeColors } from '../util/css'
import { matrixFromTransform } from '../util/math'
import { DrawingView, type LineStyleMaterials } from './drawing'
import { buildEdges, buildLight, buildParts, buildSectionHelper, buildWire, cancelBvh, resultBounds, type BuiltPart } from './nodeContent'
import { Instancing } from './instancing'
import { MeshBatcher, type BatchHandle } from './batching'

export interface PartInfo {
  mesh: THREE.Mesh
  matId: string
  def: import('@cadsandbox/doc').MaterialDef
  tint: string | null
  opacity: number | undefined
  triangles: number
  castShadow: boolean
  receiveShadow: boolean
  /** GPU copy in the shared BatchedMesh; the standalone `mesh` is detached from the graph while batched. */
  handle: BatchHandle | null
}

export class NodeView {
  readonly id: string
  node: AnyNode
  readonly group = new THREE.Group()
  readonly content = new THREE.Group()
  parts: PartInfo[] = []
  edges: THREE.LineSegments | null = null
  /** Wireframe-mode lines: front/back pass objects, in the graph only while unbatched or selected. */
  wire: THREE.LineSegments | null = null
  wireBack: THREE.LineSegments | null = null
  drawing: DrawingView | null = null
  plan: DrawingView | null = null
  light: THREE.Object3D | null = null
  helper: THREE.Object3D | null = null
  caps = new Map<string, THREE.Mesh>()
  localBounds = new THREE.Box3()
  result: GeometryResult | undefined
  levelId: string | null = null
  consumed = false
  layerVisible = true
  triangles = 0
  /** Set while a plan viewport shows the plan symbology instead of the 3D content. */
  planShown = false
  /** Bumped whenever content, transform or visibility of this node (or an ancestor) changed. */
  version = 0
  /** Batched feature edges / wireframe lines. */
  edgesHandle: BatchHandle | null = null
  wireHandle: BatchHandle | null = null
  /** Rendered standalone (selected/hovered/remote-selected/dragged) so layer outlines and gizmos work. */
  pulled = false
  /** Selected: the wire leaves the batch and is drawn standalone in the selection color. */
  wireSelected = false
  /** Content-level visibility of parts / edges / wire computed by the last ViewStateApplier.apply. */
  partsShown = true
  edgesShown = true
  wireShown = false
  /** Interactive transform preview (local matrix) that overrides node.t until cleared. */
  previewMatrix: THREE.Matrix4 | null = null

  constructor(node: AnyNode) {
    this.id = node.id
    this.node = node
    this.group.name = node.name
    this.group.matrixAutoUpdate = false
    this.group.userData.nodeId = node.id
    this.content.matrixAutoUpdate = false
    this.content.userData.nodeId = node.id
    this.group.add(this.content)
  }

  get isArch(): boolean {
    const t = this.node.type
    return t === 'wall' || t === 'opening' || t === 'slab' || t === 'roof' || t === 'stair' || t === 'column' || t === 'beam' || t === 'railing' || t === 'room' || t === 'furniture'
  }
}

export interface SceneSyncOptions {
  doc: CadDocument
  geometry: GeometryService
  materials: MaterialCache
  lineMaterials: LineStyleMaterials
  hatches: HatchTextures
  theme: ThemeColors
  requestRender: () => void
}

export class SceneSync {
  readonly root = new THREE.Group()
  readonly views = new Map<string, NodeView>()
  readonly instancing: Instancing
  readonly batcher: MeshBatcher
  /** Bumps on any content change (path tracer rebuild, bounds cache). */
  contentVersion = 0
  /** Bumps when anything that ViewStateApplier.apply derives visibility from changed (not on transforms). */
  visibilityVersion = 0
  /** Views whose world matrix changed since the last flush (batch instance matrices to push). */
  private dirtyMatrices = new Set<NodeView>()
  private pulledIds = new Set<string>()
  private wireSelectedIds = new Set<string>()
  private doc: CadDocument
  private geometry: GeometryService
  private materials: MaterialCache
  private lineMaterials: LineStyleMaterials
  private hatches: HatchTextures
  private theme: ThemeColors
  private requestRender: () => void
  private mode: RenderMode = 'shaded'
  private unsubscribers: (() => void)[] = []
  private boundsCache: THREE.Box3 | null = null
  private boundsVersion = -1
  private pendingMaterialRefresh = new Set<string>()
  /** Node ids whose content must be re-read from the geometry service. */
  private dirtyContent = new Set<string>()
  onSectionsChanged: (() => void) | null = null

  constructor(opts: SceneSyncOptions) {
    this.doc = opts.doc
    this.geometry = opts.geometry
    this.materials = opts.materials
    this.lineMaterials = opts.lineMaterials
    this.hatches = opts.hatches
    this.theme = opts.theme
    this.requestRender = opts.requestRender
    this.root.name = 'cs-nodes'
    this.root.matrixAutoUpdate = false
    this.instancing = new Instancing(this.doc, this.geometry, this.materials, this.requestRender)
    this.root.add(this.instancing.root)
    this.batcher = new MeshBatcher(this.materials)
    this.root.add(this.batcher.root)
    for (const id of this.doc.nodeIds()) this.createView(id)
    for (const view of this.views.values()) this.attach(view)
    this.instancing.markAllDirty()
    this.unsubscribers.push(this.doc.onChange((e) => this.onDocChange(e)))
    this.unsubscribers.push(this.geometry.onUpdate((changed) => this.onGeometryUpdate(changed)))
  }

  // ------------------------------------------------------------------ hierarchy
  private createView(id: string): NodeView | null {
    if (this.views.has(id) || this.doc.isDefinitionNode(id) || id === DEFS_ROOT) return null
    const node = this.doc.getNode(id) as AnyNode | undefined
    if (!node) return null
    const view = new NodeView(node)
    this.views.set(id, view)
    this.updateMatrix(view)
    this.updateFlags(view)
    this.updateSpecial(view)
    this.applyResult(view, this.geometry.get(id))
    return view
  }

  private attach(view: NodeView): void {
    const parentId = view.node.parent
    const parentView = parentId ? this.views.get(parentId) : undefined
    const target = parentView ? parentView.group : this.root
    if (view.group.parent !== target) {
      view.group.parent?.remove(view.group)
      target.add(view.group)
      this.bumpSubtree(view)
      this.visibilityVersion++
    }
    view.levelId = this.doc.getLevelOf(view.id)
  }

  private destroyView(id: string): void {
    const view = this.views.get(id)
    if (!view) return
    this.views.delete(id)
    // re-attach children that survive (rare: doc removes descendants too)
    for (const child of [...view.group.children]) {
      const cid = child.userData.nodeId as string | undefined
      const cv = cid && cid !== id ? this.views.get(cid) : undefined
      if (cv) {
        this.root.add(child)
        this.bumpSubtree(cv)
      }
    }
    this.dirtyMatrices.delete(view)
    view.group.parent?.remove(view.group)
    this.clearContent(view)
    this.visibilityVersion++
    this.bump()
  }

  private updateMatrix(view: NodeView): void {
    // Openings are placed by their host wall via params.offset; the evaluator expresses a hosted
    // opening's result in the opening node frame (host.toLocal = world(opening)⁻¹ × world(wall)), so
    // applying the node transform like everywhere else (doc.getWorldMatrix, picking, vectorize,
    // export) keeps geometry and render in agreement for any t. Interactive moves never write t
    // for openings (TransformSession → params.offset).
    if (view.previewMatrix) view.group.matrix.copy(view.previewMatrix)
    else matrixFromTransform(view.node.t, view.group.matrix)
    view.group.matrixWorldNeedsUpdate = true
    this.bumpSubtree(view)
  }

  /** Version stamp for the view and every descendant view (world placement changed). */
  private bumpSubtree(view: NodeView): void {
    view.version++
    this.dirtyMatrices.add(view)
    const stack: THREE.Object3D[] = [...view.group.children]
    while (stack.length) {
      const o = stack.pop()!
      const id = o.userData.nodeId as string | undefined
      if (id && id !== view.id) {
        const v = this.views.get(id)
        if (v && v.group === o) {
          v.version++
          this.dirtyMatrices.add(v)
        }
      }
      for (const c of o.children) if ((c as THREE.Group).isGroup) stack.push(c)
    }
  }

  /**
   * Interactive transform preview: the node renders at `local` (parent space) without a document
   * write; null restores node.t. TransformSession uses it so drags run at frame rate while the
   * shared document is written at a throttled rate.
   */
  setPreviewTransform(id: string, local: THREE.Matrix4 | null): void {
    const view = this.views.get(id)
    if (!view) return
    if (local) {
      if (!view.previewMatrix) view.previewMatrix = new THREE.Matrix4()
      view.previewMatrix.copy(local)
    } else if (view.previewMatrix) view.previewMatrix = null
    else return
    this.updateMatrix(view)
    this.bumpMoved(view)
    this.requestRender()
  }

  /**
   * A node moved: the content version drives shadow/snap refresh, but the scene bounds cache only
   * grows by the moved subtree instead of an O(n) recompute per frame (exact again on the next
   * structural change).
   */
  private bumpMoved(view: NodeView): void {
    this.contentVersion++
    if (this.boundsCache && this.boundsVersion === this.contentVersion - 1) {
      this.viewWorldBounds(view, this.boundsCache)
      for (const d of this.doc.getDescendants(view.id)) {
        const dv = this.views.get(d)
        if (dv) this.viewWorldBounds(dv, this.boundsCache)
      }
      this.boundsVersion = this.contentVersion
    } else this.boundsCache = null
  }

  private updateFlags(view: NodeView): void {
    const n = view.node
    const layer = this.doc.getLayer(n.layer ?? DEFAULT_LAYER_ID)
    view.layerVisible = layer ? layer.visible : true
    view.group.visible = n.visible
    view.consumed = this.isConsumed(n.id)
    this.applyContentVisibility(view)
  }

  private isConsumed(id: string): boolean {
    if (this.geometry.isConsumed(id)) return true
    for (const a of this.doc.getAncestors(id)) if (this.geometry.isConsumed(a)) return true
    return false
  }

  private applyContentVisibility(view: NodeView): void {
    const visible = view.layerVisible && !view.consumed
    if (view.content.visible !== visible) {
      view.content.visible = visible
      this.visibilityVersion++
    }
    view.version++
  }

  private updateSpecial(view: NodeView): void {
    const n = view.node
    if (view.light) {
      view.content.remove(view.light)
      view.light.traverse((o) => {
        const l = o as THREE.Light
        if (l.isLight) l.dispose()
      })
      view.light = null
    }
    if (view.helper) {
      view.content.remove(view.helper)
      view.helper.traverse((o) => {
        const m = o as THREE.Mesh
        m.geometry?.dispose()
        if (m.material) (m.material as THREE.Material).dispose()
      })
      view.helper = null
    }
    if (n.type === 'light') {
      view.light = buildLight(n.params, n.id)
      view.content.add(view.light)
    } else if (n.type === 'section') {
      view.helper = buildSectionHelper(n.params, n.id, this.theme.get('--cs-accent').color, (n.meta as { extent?: { length?: number; height?: number } }).extent)
      view.content.add(view.helper)
      this.onSectionsChanged?.()
    }
    this.dirtyMatrices.add(view)
    this.visibilityVersion++
  }

  // ------------------------------------------------------------------ content
  private clearContent(view: NodeView): void {
    for (const p of view.parts) {
      if (p.handle) this.batcher.remove(p.handle)
      p.mesh.parent?.remove(p.mesh)
      cancelBvh(p.mesh.geometry)
      p.mesh.geometry.disposeBoundsTree?.()
      p.mesh.geometry.dispose()
    }
    view.parts = []
    if (view.edgesHandle) {
      this.batcher.remove(view.edgesHandle)
      view.edgesHandle = null
    }
    if (view.edges) {
      view.edges.parent?.remove(view.edges)
      view.edges.geometry.dispose()
      view.edges = null
    }
    if (view.wireHandle) {
      this.batcher.remove(view.wireHandle)
      view.wireHandle = null
    }
    if (view.wire) {
      view.wire.parent?.remove(view.wire)
      view.wireBack?.parent?.remove(view.wireBack)
      view.wire.geometry.dispose()
      view.wire = null
      view.wireBack = null
    }
    view.drawing?.dispose()
    view.drawing = null
    view.plan?.dispose()
    view.plan = null
    for (const cap of view.caps.values()) {
      view.content.remove(cap)
      cap.geometry.dispose()
    }
    view.caps.clear()
    view.triangles = 0
    view.localBounds.makeEmpty()
  }

  private applyResult(view: NodeView, result: GeometryResult | undefined): void {
    if (result === view.result && view.parts.length + (view.drawing ? 1 : 0) > 0) return
    this.clearContent(view)
    view.result = result
    if (!result) return
    const n = view.node
    const built = buildParts(result, n.id, this.requestRender)
    const opacity = n.type === 'image' ? n.params.opacity : undefined
    // images carry per-node textures/opacity → standalone; everything else joins the material batches
    const batchable = n.type !== 'image'
    for (const bp of built) {
      const { def, id, tint } = this.materials.resolveDef(n, bp.part)
      bp.mesh.material = this.materials.get(id, def, tint, this.mode, opacity)
      const castShadow = bp.part.castShadow ?? true
      const receiveShadow = bp.part.receiveShadow ?? true
      const handle = batchable ? this.batcher.add(bp.mesh.geometry, id, def, tint, opacity, castShadow, receiveShadow) : null
      const info: PartInfo = { mesh: bp.mesh, matId: id, def, tint, opacity, triangles: bp.triangles, castShadow, receiveShadow, handle }
      view.parts.push(info)
      this.placePart(view, info)
      view.triangles += bp.triangles
    }
    view.edges = buildEdges(result, n.id)
    if (view.edges) {
      const em = this.materials.edges(this.mode)
      view.edges.material = em ?? this.materials.edgeShaded
      view.edges.visible = !!em
      view.edgesHandle = this.batcher.addEdges(view.edges.geometry)
      if (!view.edgesHandle) view.content.add(view.edges)
    }
    view.wire = buildWire(result, n.id)
    if (view.wire) view.wireHandle = this.batcher.addWire(view.wire.geometry)
    this.dirtyMatrices.add(view)
    // new objects start in the visibility state the last ViewStateApplier.apply computed for this
    // node, so a content refresh (re-evaluated wall while dragging) needs no full visibility pass
    const chain = this.chainVisible(view)
    for (const p of view.parts) {
      p.mesh.visible = view.partsShown
      if (p.handle) this.batcher.setVisible(p.handle, chain && view.partsShown && !view.pulled)
    }
    if (view.edges) view.edges.visible = view.edgesShown
    if (view.edgesHandle) this.batcher.setVisible(view.edgesHandle, chain && view.edgesShown)
    this.placeWire(view)
    const hadDrawing = !!view.drawing || !!view.plan
    if (hadDrawing) this.visibilityVersion++
    if (result.drawing && (result.drawing.lines.length || result.drawing.fills.length || result.drawing.texts.length)) {
      view.drawing = new DrawingView(this.lineMaterials, this.hatches, this.theme, this.requestRender)
      view.drawing.set(result.drawing, { colorOverride: this.layerColor(n) })
      view.drawing.group.userData.nodeId = n.id
      view.content.add(view.drawing.group)
    }
    if (result.plan && (result.plan.lines.length || result.plan.fills.length || result.plan.texts.length)) {
      view.plan = new DrawingView(this.lineMaterials, this.hatches, this.theme, this.requestRender)
      view.plan.set(result.plan, { variant: 'overlay' })
      view.plan.group.userData.nodeId = n.id
      view.plan.group.visible = false
      view.content.add(view.plan.group)
    }
    resultBounds(result, view.localBounds)
    view.version++
    this.bump()
  }

  /** Drafting entities take their layer color unless they carry an explicit color. */
  private layerColor(n: AnyNode): string | null {
    if (n.color) return n.color
    const drafting = n.type === 'line' || n.type === 'polyline' || n.type === 'rect' || n.type === 'circle' || n.type === 'arc' || n.type === 'ellipse' || n.type === 'spline' || n.type === 'hatch' || n.type === 'leader'
    if (!drafting) return null
    const layer = this.doc.getLayer(n.layer ?? DEFAULT_LAYER_ID)
    if (!layer || layer.id === DEFAULT_LAYER_ID) return null
    return layer.color
  }

  private rematerialize(view: NodeView): void {
    for (const p of view.parts) {
      const part = view.result?.parts[p.mesh.userData.partIndex as number]
      if (!part) continue
      const { def, id, tint } = this.materials.resolveDef(view.node, part)
      const moved = p.handle && (id !== p.matId || tint !== p.tint)
      p.def = def
      p.matId = id
      p.tint = tint
      p.opacity = view.node.type === 'image' ? view.node.params.opacity : undefined
      p.mesh.material = this.materials.get(id, def, tint, this.mode, p.opacity)
      if (moved) {
        // material key changed → the part belongs to another batch
        this.batcher.remove(p.handle!)
        p.handle = this.batcher.add(p.mesh.geometry, id, def, tint, p.opacity, p.castShadow, p.receiveShadow)
        this.placePart(view, p)
        this.dirtyMatrices.add(view)
      }
    }
    if (view.drawing && view.result?.drawing) view.drawing.set(view.result.drawing, { colorOverride: this.layerColor(view.node) })
    this.bump()
  }

  // ------------------------------------------------------------------ events
  private onDocChange(e: DocChangeEvent): void {
    const dirtyComponents = new Set<string>()
    const markInstances = (id: string) => {
      const n = this.doc.getNode(id)
      if (!n) return
      if (n.type === 'instance') dirtyComponents.add((n as AnyNode & { params: { component: string } }).params.component)
      for (const d of this.doc.getDescendants(id)) {
        const dn = this.doc.getNode<'instance'>(d)
        if (dn?.type === 'instance') dirtyComponents.add(dn.params.component)
      }
    }
    for (const id of e.nodes.removed) {
      this.destroyView(id)
      // a removed definition node or instance: refresh all batches (cheap; rare)
      this.instancing.markAllDirty()
    }
    for (const id of e.nodes.added) {
      if (this.doc.isDefinitionNode(id)) {
        const c = this.instancing.componentOfDefinitionNode(id)
        if (c) dirtyComponents.add(c)
        continue
      }
      const view = this.createView(id)
      if (view) this.attach(view)
      markInstances(id)
    }
    for (const [id, keys] of e.nodes.updated) {
      const view = this.views.get(id)
      if (!view) {
        if (this.doc.isDefinitionNode(id)) {
          const c = this.instancing.componentOfDefinitionNode(id)
          if (c) dirtyComponents.add(c)
        }
        continue
      }
      const node = this.doc.getNode(id) as AnyNode | undefined
      if (!node) continue
      view.node = node
      if (keys.has('t')) {
        this.updateMatrix(view)
        markInstances(id)
        this.bumpMoved(view)
      }
      if (keys.has('parent') || keys.has('order')) {
        this.attach(view)
        markInstances(id)
        this.bump()
      }
      if (keys.has('visible') || keys.has('layer')) {
        this.updateFlags(view)
        markInstances(id)
        this.bump()
      }
      if (keys.has('material') || keys.has('color')) this.rematerialize(view)
      if (keys.has('name')) view.group.name = node.name
      if (keys.has('params')) {
        if (node.type === 'light' || node.type === 'section') this.updateSpecial(view)
        if (node.type === 'image') this.rematerialize(view)
        if (node.type === 'level') this.bump()
      }
    }
    if (e.materials.size) {
      for (const mid of e.materials) {
        this.materials.invalidate(mid)
        this.instancing.invalidateMaterial(mid)
        this.batcher.refreshMaterial(mid, this.doc.getMaterial(mid) ?? this.materials.fallback)
      }
      for (const view of this.views.values()) if (view.parts.some((p) => e.materials.has(p.matId)) || (view.node.material && e.materials.has(view.node.material))) this.rematerialize(view)
    }
    if (e.layers) {
      for (const view of this.views.values()) {
        this.updateFlags(view)
        if (view.drawing && view.result?.drawing) view.drawing.set(view.result.drawing, { colorOverride: this.layerColor(view.node) })
      }
      this.instancing.markAllDirty()
      this.bump()
    }
    for (const c of e.components) dirtyComponents.add(c)
    for (const c of dirtyComponents) this.instancing.markDirty(c)
    if (dirtyComponents.size || e.nodes.added.size || e.nodes.removed.size) this.bump()
    this.requestRender()
  }

  private onGeometryUpdate(changed: ReadonlySet<string>): void {
    for (const id of changed) {
      const view = this.views.get(id)
      if (view) {
        this.dirtyContent.add(id)
        continue
      }
      if (this.doc.isDefinitionNode(id)) {
        const c = this.instancing.componentOfDefinitionNode(id)
        if (c) this.instancing.markDirty(c)
      }
    }
    // consumed flags may have changed for operands
    for (const id of changed) {
      const n = this.doc.getNode(id)
      if (n?.type === 'boolean') for (const c of this.doc.getDescendants(id)) this.dirtyContent.add(c)
    }
    this.requestRender()
  }

  /** Apply pending geometry results and instance rebuilds. Call once per frame before rendering. */
  flush(): void {
    if (this.dirtyContent.size) {
      for (const id of this.dirtyContent) {
        const view = this.views.get(id)
        if (!view) continue
        view.node = (this.doc.getNode(id) as AnyNode | undefined) ?? view.node
        view.consumed = this.isConsumed(id)
        this.applyContentVisibility(view)
        this.applyResult(view, this.geometry.get(id))
      }
      this.dirtyContent.clear()
    }
    if (this.instancing.flush()) this.bump()
    if (this.pendingMaterialRefresh.size) this.pendingMaterialRefresh.clear()
    this.flushMatrices()
  }

  /**
   * Recompute the world matrices of views whose placement changed and push them to the batches.
   * The scene has matrixWorldAutoUpdate off: a full traversal per render pass cost more than the
   * batched draw calls themselves at 1600 nodes, so only dirty subtrees are updated (the parent
   * chain is current — a moved ancestor marks its whole subtree dirty and recomputes it).
   */
  flushMatrices(): void {
    if (!this.dirtyMatrices.size) return
    // three recomputes matrixWorld in updateWorldMatrix only for flagged objects (and then forces the
    // subtree). Node groups set their local matrix directly, and a bounds/pick query may already have
    // consumed the moved view's flag without visiting its children — so flag every dirty view here.
    for (const view of this.dirtyMatrices) {
      if (!this.views.has(view.id)) continue
      view.group.matrixWorldNeedsUpdate = true
      view.group.updateWorldMatrix(false, true)
    }
    for (const view of this.dirtyMatrices) {
      if (!this.views.has(view.id)) continue
      const m = view.group.matrixWorld
      for (const p of view.parts) {
        if (!p.handle) continue
        this.batcher.setMatrix(p.handle, m)
        if (!p.mesh.parent) p.mesh.matrixWorld.copy(m) // detached standalone mesh: picking reads matrixWorld
      }
      if (view.edgesHandle) this.batcher.setMatrix(view.edgesHandle, m)
      if (view.wireHandle) this.batcher.setMatrix(view.wireHandle, m)
      if (view.wire && !view.wire.parent) {
        // detached wire objects (batched, unselected) stay current for their next pull-out
        view.wire.matrixWorld.copy(m)
        view.wireBack?.matrixWorld.copy(m)
      }
    }
    this.dirtyMatrices.clear()
  }

  /**
   * Placement invariant (tests + dev assertion): every rendered copy of a node — its group, the
   * standalone part meshes (attached while pulled out, detached picking copies otherwise), the batch
   * instances of parts/edges/wire and the standalone edge/wire objects — sits at doc.getWorldMatrix(id).
   * Returns human-readable violations; empty when the scene is consistent with the document.
   */
  placementViolations(tolerance = 1e-5): string[] {
    this.flushMatrices()
    const out: string[] = []
    for (const view of this.views.values()) {
      if (view.node.type === 'instance') continue // GPU instancing keeps its own per-instance matrices
      const world = this.doc.getWorldMatrix(view.id)
      const name = `${view.node.name || view.node.type} (${view.id})`
      const check = (what: string, m: ArrayLike<number>) => {
        let d = 0
        for (let i = 0; i < 16; i++) d = Math.max(d, Math.abs(world[i]! - m[i]!))
        if (d > tolerance) out.push(`${name}: ${what} off by ${d.toExponential(2)}`)
      }
      check('group', view.group.matrixWorld.elements)
      for (const p of view.parts) {
        const attached = p.mesh.parent === view.content
        check(attached ? 'standalone mesh' : 'picking copy', p.mesh.matrixWorld.elements)
        if (attached && !_identity.equals(p.mesh.matrix)) out.push(`${name}: standalone mesh has a local matrix`)
        if (p.handle?.active) {
          p.handle.group.mesh.getMatrixAt(p.handle.instanceId, _im)
          check('batch instance', _im.elements)
          if (attached !== view.pulled) out.push(`${name}: pulled=${view.pulled} but mesh ${attached ? 'in' : 'out of'} the graph`)
        } else if (!attached) out.push(`${name}: unbatched mesh is not in the graph`)
      }
      for (const [what, h] of [['edges batch instance', view.edgesHandle], ['wire batch instance', view.wireHandle]] as const) {
        if (!h?.active) continue
        h.group.mesh.getMatrixAt(h.instanceId, _im)
        check(what, _im.elements)
      }
      for (const [what, o] of [['edges', view.edges], ['wire', view.wire], ['wire back pass', view.wireBack]] as const) if (o?.parent) check(what, o.matrixWorld.elements)
    }
    return out
  }

  // ------------------------------------------------------------------ batching
  /** Standalone mesh in the graph only while unbatched or pulled out (selection outlines need real objects). */
  private placePart(view: NodeView, p: PartInfo): void {
    const standalone = !p.handle || view.pulled
    if (standalone) {
      if (p.mesh.parent !== view.content) view.content.add(p.mesh)
    } else if (p.mesh.parent) p.mesh.parent.remove(p.mesh)
    if (p.handle && view.pulled) this.batcher.setVisible(p.handle, false)
  }

  /**
   * Wireframe lines of a node: batched while unselected, standalone (front + faint back pass in the
   * selection color) while selected or unbatchable. Also applies the per-viewport `wireShown` flag.
   */
  placeWire(view: NodeView): void {
    if (!view.wire) return
    const standalone = !view.wireHandle || view.wireSelected
    const mats = this.materials.wire(view.wireSelected)
    view.wire.material = mats.front
    if (!view.wireBack) {
      const back = new THREE.LineSegments(view.wire.geometry, mats.back)
      back.matrixAutoUpdate = false
      back.userData.nodeId = view.id
      back.userData.wire = true
      back.userData.noPathTrace = true
      back.renderOrder = 10
      back.raycast = () => {}
      view.wireBack = back
    }
    view.wireBack!.material = mats.back
    const show = standalone && view.wireShown && this.mode === 'wireframe'
    view.wire.visible = show
    view.wireBack!.visible = show
    if (standalone) {
      if (view.wire.parent !== view.content) {
        // entering the graph: start at the node's current world placement (the scene never
        // traverses matrices on its own, see flushMatrices)
        this.flushMatrices()
        view.wire.matrixWorld.copy(view.group.matrixWorld)
        view.wireBack!.matrixWorld.copy(view.group.matrixWorld)
        view.content.add(view.wire, view.wireBack!)
      }
    } else if (view.wire.parent) view.content.remove(view.wire, view.wireBack!)
    if (view.wireHandle) this.batcher.setVisible(view.wireHandle, !view.wireSelected && view.wireShown && this.chainVisible(view))
  }

  /**
   * Nodes rendered standalone (selected, hovered, remote-selected, dragged): their batch instances
   * are hidden and the standalone meshes re-enter the graph so layer-based outlines and gizmos work.
   * `selected` nodes additionally draw their wireframe lines in the selection color.
   */
  setActive(ids: ReadonlySet<string>, selected: ReadonlySet<string> = ids): void {
    let changed = false
    for (const id of this.wireSelectedIds) {
      const view = this.views.get(id)
      if (view && view.wireSelected && !selected.has(id)) {
        view.wireSelected = false
        this.placeWire(view)
        changed = true
      }
    }
    for (const id of selected) {
      const view = this.views.get(id)
      if (view && !view.wireSelected) {
        view.wireSelected = true
        this.placeWire(view)
        changed = true
      }
    }
    this.wireSelectedIds = new Set(selected)
    for (const id of this.pulledIds) {
      if (ids.has(id)) continue
      const view = this.views.get(id)
      if (view && view.pulled) {
        view.pulled = false
        for (const p of view.parts) this.placePart(view, p)
        changed = true
      }
    }
    for (const id of ids) {
      const view = this.views.get(id)
      if (!view || view.pulled) continue
      view.pulled = true
      for (const p of view.parts) this.placePart(view, p)
      changed = true
    }
    if (changed || ids.size !== this.pulledIds.size) {
      this.pulledIds = new Set(ids)
      if (changed) {
        this.visibilityVersion++
        this.requestRender()
      }
    }
  }

  /** Whether a view's 3D parts are visible in the currently applied viewport state (including ancestors). */
  partsEffectivelyVisible(view: NodeView): boolean {
    return view.partsShown && this.chainVisible(view)
  }

  /** Push the per-viewport visibility computed by ViewStateApplier into the batch instances. */
  applyBatchVisibility(): void {
    for (const view of this.views.values()) {
      if (!view.parts.length && !view.edgesHandle && !view.wireHandle) continue
      const chain = this.chainVisible(view)
      if (view.parts.length) {
        const vis = chain && view.partsShown && !view.pulled
        for (const p of view.parts) if (p.handle) this.batcher.setVisible(p.handle, vis)
      }
      if (view.edgesHandle) this.batcher.setVisible(view.edgesHandle, chain && view.edgesShown)
      if (view.wireHandle) this.batcher.setVisible(view.wireHandle, chain && view.wireShown && !view.wireSelected)
    }
  }

  private chainVisible(view: NodeView): boolean {
    let o: THREE.Object3D | null = view.content
    while (o && o !== this.root) {
      if (!o.visible) return false
      o = o.parent
    }
    return true
  }

  /** Raycast the detached standalone meshes of batched parts (BVH accelerated) into `out`. */
  raycastBatched(raycaster: THREE.Raycaster, out: THREE.Intersection[]): void {
    for (const view of this.views.values()) {
      if (view.pulled || !view.parts.length || !this.partsEffectivelyVisible(view)) continue
      for (const p of view.parts) if (p.handle && !p.mesh.parent) p.mesh.raycast(raycaster, out)
    }
  }

  /**
   * Temporarily attach the standalone meshes of batched parts (world-placed) and hide the batches so
   * scene consumers that traverse meshes (path tracer) see every surface. Returns the restore function.
   */
  exposeBatchedMeshes(): () => void {
    const proxies = new THREE.Group()
    proxies.name = 'cs-batch-proxies'
    proxies.matrixAutoUpdate = false
    const exposed: THREE.Mesh[] = []
    for (const view of this.views.values()) {
      if (view.pulled || !view.parts.length || !this.partsEffectivelyVisible(view)) continue
      for (const p of view.parts) {
        if (!p.handle || p.mesh.parent) continue
        p.mesh.matrix.copy(view.group.matrixWorld)
        p.mesh.matrixWorld.copy(view.group.matrixWorld)
        p.mesh.visible = true
        proxies.add(p.mesh)
        exposed.push(p.mesh)
      }
    }
    this.root.add(proxies)
    this.batcher.setBatchesVisible(false)
    return () => {
      for (const m of exposed) {
        proxies.remove(m)
        m.matrix.identity()
        const view = this.views.get(m.userData.nodeId as string)
        if (view) m.matrixWorld.copy(view.group.matrixWorld)
      }
      this.root.remove(proxies)
      this.batcher.setBatchesVisible(true)
    }
  }

  private bump(): void {
    this.contentVersion++
    this.boundsCache = null
  }

  // ------------------------------------------------------------------ modes
  applyMode(mode: RenderMode): void {
    if (mode === this.mode) return
    this.mode = mode
    const edgeMat = this.materials.edges(mode)
    for (const view of this.views.values()) {
      for (const p of view.parts) p.mesh.material = this.materials.get(p.matId, p.def, p.tint, mode, p.opacity)
      if (view.edges) {
        view.edges.visible = !!edgeMat
        if (edgeMat) view.edges.material = edgeMat
      }
      this.placeWire(view)
      for (const cap of view.caps.values()) cap.material = this.materials.cap(mode)
    }
    this.instancing.applyMode(mode)
    this.batcher.applyMode(mode)
    const mono = mode === 'technical' || mode === 'hidden-line'
    this.lineMaterials.setMonochrome(mono)
    for (const view of this.views.values()) {
      view.drawing?.setMonochrome(mono)
      view.plan?.setMonochrome(mono)
    }
  }

  get currentMode(): RenderMode {
    return this.mode
  }

  setTheme(theme: ThemeColors): void {
    this.theme = theme
    for (const view of this.views.values()) {
      view.drawing?.retheme(theme)
      view.plan?.retheme(theme)
      if (view.node.type === 'section') this.updateSpecial(view)
    }
  }

  // ------------------------------------------------------------------ queries
  /** World bounds of nodes (groups include descendants; instances via batches). */
  worldBounds(ids: Iterable<string>, out = new THREE.Box3()): THREE.Box3 {
    out.makeEmpty()
    for (const id of ids) {
      const view = this.views.get(id)
      if (view) {
        this.viewWorldBounds(view, out)
        for (const d of this.doc.getDescendants(id)) {
          const dv = this.views.get(d)
          if (dv) this.viewWorldBounds(dv, out)
        }
      } else if (this.doc.getNode(id)?.type === 'instance') {
        if (this.instancing.worldBounds(id, _b)) out.union(_b)
      }
    }
    return out
  }

  private viewWorldBounds(view: NodeView, out: THREE.Box3): void {
    if (view.node.type === 'instance') {
      if (this.instancing.worldBounds(view.id, _b)) out.union(_b)
      return
    }
    // pending moves (this view or an ancestor) → recompute the dirty subtrees first
    this.flushMatrices()
    if (view.localBounds.isEmpty()) {
      if (view.light || view.helper) out.expandByPoint(_v.setFromMatrixPosition(view.group.matrixWorld))
      return
    }
    _b.copy(view.localBounds).applyMatrix4(view.group.matrixWorld)
    out.union(_b)
  }

  /** Bounds of everything visible (cached per content version). */
  sceneBounds(): THREE.Box3 {
    if (this.boundsCache && this.boundsVersion === this.contentVersion) return this.boundsCache
    const out = new THREE.Box3()
    for (const view of this.views.values()) {
      if (!view.group.visible || !view.content.visible) continue
      if (view.node.type === 'light' || view.node.type === 'section' || view.node.type === 'level') continue
      this.viewWorldBounds(view, out)
    }
    this.boundsCache = out
    this.boundsVersion = this.contentVersion
    return out
  }

  /** Node id owning a scene object (meshes carry it; groups too). */
  nodeIdOf(obj: THREE.Object3D | null): string | null {
    let o: THREE.Object3D | null = obj
    while (o) {
      const id = o.userData.nodeId as string | undefined
      if (id) return id
      o = o.parent
    }
    return null
  }

  /** Total triangle count of node content (stats). */
  triangleCount(): number {
    let t = 0
    for (const v of this.views.values()) t += v.triangles
    return t
  }

  /** Visible nodes after node/layer/isolation filters (isolation applied by the caller's hidden set). */
  visibleNodes(hidden: ReadonlySet<string>): AnyNode[] {
    const out: AnyNode[] = []
    for (const view of this.views.values()) {
      if (hidden.has(view.id) || !view.layerVisible) continue
      if (!this.doc.isEffectivelyVisible(view.id)) continue
      out.push(view.node)
    }
    return out
  }

  dispose(): void {
    for (const u of this.unsubscribers) u()
    this.unsubscribers = []
    for (const view of this.views.values()) {
      this.clearContent(view)
      view.light?.traverse((o) => (o as THREE.Light).isLight && (o as THREE.Light).dispose())
    }
    this.views.clear()
    this.instancing.dispose()
    this.batcher.dispose()
    this.dirtyMatrices.clear()
    this.root.clear()
  }
}

const _b = new THREE.Box3()
const _v = new THREE.Vector3()
const _im = new THREE.Matrix4()
const _identity = new THREE.Matrix4()
