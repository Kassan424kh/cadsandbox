// Per-viewport scene state: render mode materials, isolation, plan-view level filtering (levels above
// hidden, active level cut with plan symbology, faint underlay of the level below), section planes
// and sliced caps. Applied right before each viewport is rendered.
import * as THREE from 'three'
import type { CadDocument, NodeBase, RenderMode } from '@cadsandbox/doc'
import type { MaterialCache } from '../materials/materials'
import { clipPlane, planCutPlane, planeToLocal, SliceCache } from '../renderer/clipping'
import type { NodeView, SceneSync } from './sceneSync'

export interface ViewportSceneState {
  mode: RenderMode
  planLevel: string | null
  sectionView: string | null
  isolated: ReadonlySet<string> | null
  editingContext: string | null
  /** Show plan symbology also in non-plan views for these types (never by default). */
  showCaps: boolean
}

export interface LevelInfoLite {
  id: string
  elevation: number
  cutHeight: number
  height: number
}

export interface SectionPlaneInfo {
  id: string
  plane: THREE.Plane
  depth: number
  key: string
}

export class ViewStateApplier {
  private doc: CadDocument
  private sync: SceneSync
  private materials: MaterialCache
  private slices = new SliceCache()
  private hiddenByIsolation = new Set<string>()
  private lastIsolationKey = ''
  private sections: SectionPlaneInfo[] = []
  private sectionsVersion = -1
  private localPlane = new THREE.Plane()
  private lastApply: { stateKey: string; visibilityVersion: number; levelsKey: string; result: { planes: THREE.Plane[]; planCutZ: number | null; hidden: ReadonlySet<string>; key: string } } | null = null

  constructor(doc: CadDocument, sync: SceneSync, materials: MaterialCache) {
    this.doc = doc
    this.sync = sync
    this.materials = materials
  }

  levels(): LevelInfoLite[] {
    return this.doc.levels().map((l) => ({ id: l.id, elevation: l.t.p[2], cutHeight: l.params.cutHeight, height: l.params.height }))
  }

  /** Enabled section nodes → world clip planes (recomputed when content changes). */
  sectionPlanes(): SectionPlaneInfo[] {
    if (this.sectionsVersion === this.sync.contentVersion) return this.sections
    this.sectionsVersion = this.sync.contentVersion
    this.sections = []
    for (const s of this.doc.nodesOfType('section')) {
      if (!s.params.enabled || !this.doc.isEffectivelyVisible(s.id)) continue
      const view = this.sync.views.get(s.id)
      if (!view) continue
      this.sync.flushMatrices()
      const m = view.group.matrixWorld
      const point = new THREE.Vector3().setFromMatrixPosition(m)
      const normal = new THREE.Vector3(0, 0, 1).transformDirection(m)
      const e = m.elements
      const key = `sec:${s.id}:${e[12]!.toFixed(4)},${e[13]!.toFixed(4)},${e[14]!.toFixed(4)},${normal.x.toFixed(4)},${normal.y.toFixed(4)},${normal.z.toFixed(4)}`
      this.sections.push({ id: s.id, plane: clipPlane(normal, point), depth: s.params.depth, key })
    }
    return this.sections
  }

  /** Compute isolation-hidden set (ids not in isolation nor descendants/ancestors of it). */
  isolationHidden(isolated: ReadonlySet<string> | null): Set<string> {
    const key = isolated ? [...isolated].sort().join(',') + `#${this.sync.contentVersion}` : ''
    if (key === this.lastIsolationKey) return this.hiddenByIsolation
    this.lastIsolationKey = key
    this.hiddenByIsolation = new Set()
    if (!isolated || !isolated.size) return this.hiddenByIsolation
    const keep = new Set<string>()
    for (const id of isolated) {
      keep.add(id)
      for (const a of this.doc.getAncestors(id)) keep.add(a)
      for (const d of this.doc.getDescendants(id)) keep.add(d)
    }
    for (const id of this.sync.views.keys()) if (!keep.has(id)) this.hiddenByIsolation.add(id)
    return this.hiddenByIsolation
  }

  /**
   * Apply the viewport state to the shared scene. Returns the clipping planes for the renderer and
   * the plan cut elevation (for the grid) when in a plan view.
   */
  apply(state: ViewportSceneState): { planes: THREE.Plane[]; planCutZ: number | null; hidden: ReadonlySet<string>; key: string } {
    this.sync.applyMode(state.mode)
    const hidden = this.isolationHidden(state.isolated)
    const levels = this.levels()
    // Nothing visibility-relevant changed since the last apply of this exact state → the scene is
    // already in that state (transforms alone never change it). Plan cuts and sections depend on
    // placements (caps), so they always take the full pass.
    const levelsKey = levels.map((l) => `${l.id}:${l.elevation}:${l.cutHeight}`).join(';')
    const stateKey = `${this.lastIsolationKey}|${state.planLevel ?? ''}|${state.sectionView ?? ''}|${state.editingContext ?? ''}|${state.mode}|${state.showCaps ? 1 : 0}`
    const sections = this.sectionPlanes()
    const cached = this.lastApply
    if (cached && cached.stateKey === stateKey && cached.visibilityVersion === this.sync.visibilityVersion && cached.levelsKey === levelsKey && !state.planLevel && !sections.length) return cached.result
    this.sync.instancing.setHidden(hidden)
    const planLevel = state.planLevel ? levels.find((l) => l.id === state.planLevel) ?? null : null
    const planes: THREE.Plane[] = []
    const capKeys = new Set<string>()
    let planCutZ: number | null = null
    if (planLevel) {
      planCutZ = planLevel.elevation + planLevel.cutHeight
      planes.push(planCutPlane(planCutZ))
      capKeys.add(`plan:${planLevel.id}:${planCutZ.toFixed(4)}`)
    }
    for (const s of sections) {
      if (state.sectionView && s.id !== state.sectionView) continue
      planes.push(s.plane)
      capKeys.add(s.key)
    }
    const below = planLevel ? levels.filter((l) => l.elevation < planLevel.elevation).sort((a, b) => b.elevation - a.elevation)[0] ?? null : null
    for (const view of this.sync.views.values()) {
      const isolatedHidden = hidden.has(view.id)
      const node = view.node
      let visible = node.visible && !isolatedHidden
      let planMode: 'none' | 'overlay' | 'faint' = 'none'
      let showContent = true
      if (planLevel && view.levelId) {
        const lvl = levels.find((l) => l.id === view.levelId)
        if (lvl) {
          if (lvl.elevation > planLevel.elevation) visible = false
          else if (lvl.id === planLevel.id) planMode = view.plan ? 'overlay' : 'none'
          else if (below && lvl.id === below.id) {
            // faint underlay: only 2D symbology/drawings of the level below
            planMode = view.plan || view.drawing ? 'faint' : 'none'
            showContent = false
          } else visible = false
        }
      }
      if (planLevel && node.type === 'level' && view.levelId !== planLevel.id && (!below || view.levelId !== below.id)) visible = false
      view.group.visible = visible
      if (!visible) continue
      const contentVisible = view.layerVisible && !view.consumed
      // arch nodes swap 3D content for plan symbology on the active plan level
      const usePlan = planMode === 'overlay' && view.isArch && !!view.plan
      const usePlanFaint = planMode === 'faint'
      // wireframe mode: parts still render (depth only) so lines behind surfaces can be drawn fainter
      const partsVisible = contentVisible && showContent && !usePlan
      view.partsShown = partsVisible
      view.edgesShown = contentVisible && showContent && !usePlan && !!this.materials.edges(state.mode)
      view.wireShown = contentVisible && showContent && !usePlan && state.mode === 'wireframe'
      for (const p of view.parts) p.mesh.visible = partsVisible
      if (view.edges) view.edges.visible = view.edgesShown
      if (view.wire) this.sync.placeWire(view)
      if (view.drawing) {
        view.drawing.group.visible = contentVisible
        view.drawing.setVariant(usePlanFaint ? 'faint' : planMode === 'overlay' ? 'overlay' : 'normal')
      }
      if (view.plan) {
        view.plan.group.visible = contentVisible && (usePlan || usePlanFaint)
        view.plan.setVariant(usePlanFaint ? 'faint' : 'overlay')
      }
      view.planShown = usePlan
      if (view.light) view.light.visible = contentVisible
      if (view.helper) view.helper.visible = contentVisible && state.mode !== 'technical'
      // caps for cut solids (not for nodes drawn as plan symbology)
      if (capKeys.size && contentVisible && showContent && !usePlan && view.parts.length && state.showCaps) this.updateCaps(view, planLevel ? [{ key: `plan:${planLevel.id}:${planCutZ!.toFixed(4)}`, plane: planes[0]! }] : [], sections, state, capKeys)
      else for (const cap of view.caps.values()) cap.visible = false
    }
    // batched parts/edges: per-instance visibility from the flags above + ancestor visibility
    this.sync.applyBatchVisibility()
    // signature of what is visible/cut in this state (shadow-map cache, per-viewport caches)
    const key = `${this.lastIsolationKey}|${state.planLevel ?? ''}|${state.sectionView ?? ''}|${state.editingContext ?? ''}|${state.mode}|${[...capKeys].join(',')}`
    const result = { planes, planCutZ, hidden, key }
    this.lastApply = { stateKey, visibilityVersion: this.sync.visibilityVersion, levelsKey, result }
    return result
  }

  private updateCaps(view: NodeView, planCut: { key: string; plane: THREE.Plane }[], sections: SectionPlaneInfo[], state: ViewportSceneState, active: Set<string>): void {
    const wanted: { key: string; plane: THREE.Plane }[] = [...planCut]
    for (const s of sections) if (!state.sectionView || s.id === state.sectionView) wanted.push({ key: s.key, plane: s.plane })
    for (const cap of view.caps.values()) cap.visible = false
    this.sync.flushMatrices()
    _wb.copy(view.localBounds).applyMatrix4(view.group.matrixWorld)
    for (const w of wanted) {
      if (!w.plane.intersectsBox(_wb)) continue
      for (const p of view.parts) {
        const key = `${w.key}|${p.mesh.userData.partIndex as number}`
        let cap = view.caps.get(key)
        if (!cap) {
          planeToLocal(w.plane, view.group.matrixWorld, this.localPlane)
          const slice = this.slices.get(p.mesh.geometry, this.localPlane)
          if (!slice.capTriangles.length) continue
          const geo = new THREE.BufferGeometry()
          geo.setAttribute('position', new THREE.BufferAttribute(slice.capTriangles, 3))
          geo.computeVertexNormals()
          cap = new THREE.Mesh(geo, this.materials.cap(state.mode))
          cap.matrixAutoUpdate = false
          cap.userData.nodeId = view.id
          cap.userData.cap = true
          cap.userData.noPathTrace = true
          cap.castShadow = false
          cap.receiveShadow = false
          cap.renderOrder = 5
          // nudge into the kept half-space so the clip test never discards the cap
          _n.copy(this.localPlane.normal).multiplyScalar(2e-4)
          cap.matrix.makeTranslation(_n.x, _n.y, _n.z)
          view.content.add(cap)
          cap.updateMatrixWorld(true) // the scene does not auto-update matrices (see SceneSync.flushMatrices)
          view.caps.set(key, cap)
          if (view.caps.size > 12) {
            const first = view.caps.keys().next().value!
            const old = view.caps.get(first)!
            view.content.remove(old)
            old.geometry.dispose()
            view.caps.delete(first)
          }
        }
        cap.material = this.materials.cap(state.mode)
        cap.visible = active.has(w.key)
      }
    }
  }

  levelById(id: string | null): NodeBase<'level'> | undefined {
    return id ? this.doc.getNode<'level'>(id) : undefined
  }

  invalidateSlices(geometry: THREE.BufferGeometry): void {
    this.slices.invalidate(geometry)
  }
}

const _wb = new THREE.Box3()
const _n = new THREE.Vector3()
