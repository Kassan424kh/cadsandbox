// createEditor — composition root wiring renderer, scene sync, viewports, interaction, tools,
// commands, presence and output into the public Editor contract.
import * as THREE from 'three'
import type { StoreApi } from 'zustand/vanilla'
import type { AnyNode, CadDocument, CameraState, DocChangeEvent, DocSnapshot, NewNode, RenderMode, SheetViewSource, Vec3 } from '@cadsandbox/doc'
import { SILENT_ORIGIN } from '@cadsandbox/doc'
import type { GeometryService } from '@cadsandbox/geometry'
import type { Editor, EditorAssets, EditorEvents, EditorOptions, EditorState, EditorUser, GizmoMode, NavigationSettings, Quality, SnapSettings, Theme, ToolId, Unsubscribe, ViewLayout, ViewPreset } from './api'
import type { Core } from './core/types'
import { createEditorStore, arraysEqual, presetLabel } from './store'
import { probeGpu, resolveQuality, type TierSettings } from './renderer/quality'
import { RenderContext, type FrameInfo } from './renderer/context'
import { ViewportManager } from './renderer/viewportManager'
import type { Viewport } from './renderer/viewport'
import { Pipeline } from './renderer/pipeline'
import { SceneLighting, type SunOverride } from './renderer/lights'
import { EnvironmentManager } from './renderer/environment'
import { InfiniteGrid } from './renderer/grid'
import { ThemeColors } from './util/css'
import { Emitter } from './util/emitter'
import { ProceduralTextures } from './materials/procedural'
import { MaterialCache } from './materials/materials'
import { HatchTextures } from './materials/hatch'
import { LineStyleMaterials } from './scene/drawing'
import { SceneSync } from './scene/sceneSync'
import { ViewStateApplier, type ViewportSceneState } from './scene/viewState'
import { createGeometryForEditor } from './geometryBridge'
import { OverlayLayer } from './core/overlayLayer'
import { PreviewLayer } from './core/previewLayer'
import { Picker } from './core/picker'
import { SelectionVisuals } from './core/selectionVisuals'
import { SnapEngine } from './snapping/snapEngine'
import { SnapVisuals } from './snapping/snapVisuals'
import { adaptiveGridStep, rayPlane } from './snapping/snapMath'
import { TransformGizmo } from './gizmo/transformGizmo'
import { BoxGizmo2D } from './gizmo/boxGizmo2D'
import { DirectDrag } from './gizmo/directDrag'
import { ToolHost } from './core/toolHost'
import { ToolContextImpl } from './core/toolContext'
import { InputManager } from './core/input'
import { createCoreTools } from './core-tools'
import { InsertionApi } from './core/insertion'
import { ClipboardStore } from './commands/clipboard'
import { createCommandRegistry } from './commands/registry'
import { createActions } from './commands/actions'
import { Presence } from './presence/presence'
import { screenshotViewport } from './output/screenshot'
import { renderSheetView, vectorize } from './output/sheetViews'
import { boundsFromBox3 } from './util/math'
import { throttle } from './util/emitter'

export function createEditor(options: EditorOptions): Editor {
  return new EditorImpl(options)
}

class EditorImpl implements Editor, Core {
  readonly doc: CadDocument
  readonly geometry: GeometryService
  readonly assets: EditorAssets
  readonly user: EditorUser
  readonly store: StoreApi<EditorState>
  readonly commands
  readonly ctx: RenderContext
  readonly theme: ThemeColors
  readonly viewports: ViewportManager
  readonly sync: SceneSync
  readonly viewState: ViewStateApplier
  readonly materials: MaterialCache
  readonly lineMaterials: LineStyleMaterials
  readonly hatches: HatchTextures
  readonly scene = new THREE.Scene()
  readonly overlayScene = new THREE.Scene()
  readonly pipeline: Pipeline
  readonly events = new Emitter<EditorEvents>()
  readonly readOnly: boolean

  private gpu = probeGpu()
  private tier: TierSettings
  private ownsGeometry: boolean
  private procedural: ProceduralTextures
  private lighting: SceneLighting
  private environment: EnvironmentManager
  private grid: InfiniteGrid
  private overlay: OverlayLayer
  private preview: PreviewLayer
  private picker: Picker
  private selectionVisuals: SelectionVisuals
  private snapEngine: SnapEngine
  private snapVisuals: SnapVisuals
  private gizmo: TransformGizmo
  private boxGizmo: BoxGizmo2D
  private directDrag: DirectDrag
  private host: ToolHost
  private input: InputManager
  private clipboard = new ClipboardStore()
  private presence: Presence
  private insertion: InsertionApi
  private unsubscribers: (() => void)[] = []
  private walking = false
  private fitted = false
  private firstBoundsAt = 0
  private lastStats = 0
  private lastSelectionKey = ''
  private lastBoundsVersion = -1
  private viewportStateKey = ''
  private disposed = false
  private lastCursor: Vec3 | null = null

  constructor(options: EditorOptions) {
    THREE.Object3D.DEFAULT_UP.set(0, 0, 1)
    this.doc = options.doc
    this.assets = options.assets
    this.user = options.user
    this.readOnly = !!options.readOnly
    this.tier = resolveQuality(options.quality, this.gpu)
    this.store = createEditorStore(options.theme, this.readOnly, this.gpu.renderer, this.tier.tier)
    this.theme = new ThemeColors(options.container, options.theme)
    this.ctx = new RenderContext(options.container, this.gpu, this.tier)
    if (options.geometry) {
      this.geometry = options.geometry
      this.ownsGeometry = false
    } else {
      const g = createGeometryForEditor(this.doc, this.assets)
      this.geometry = g.service
      this.ownsGeometry = g.owned
      if (g.degraded) this.emitLater('notify', { level: 'warning', message: 'Geometry engine unavailable — objects will not render yet' })
    }
    const anisotropy = Math.min(8, this.ctx.renderer.capabilities.getMaxAnisotropy())
    this.procedural = new ProceduralTextures(this.tier.textureSize, anisotropy)
    this.materials = new MaterialCache({ doc: this.doc, assets: this.assets, procedural: this.procedural, theme: this.theme, onReady: () => this.requestRender(), anisotropy })
    this.lineMaterials = new LineStyleMaterials(this.theme)
    this.hatches = new HatchTextures()
    this.sync = new SceneSync({ doc: this.doc, geometry: this.geometry, materials: this.materials, lineMaterials: this.lineMaterials, hatches: this.hatches, theme: this.theme, requestRender: () => this.requestRender() })
    // No per-render-pass matrix traversal of the (large) node graph: SceneSync.flushMatrices updates
    // dirty subtrees, lighting/preview/caps update themselves (see Pipeline.renderFrame, onFrame).
    this.scene.matrixWorldAutoUpdate = false
    this.scene.add(this.sync.root)
    this.viewState = new ViewStateApplier(this.doc, this.sync, this.materials)
    this.lighting = new SceneLighting(this.tier.shadowMapSize)
    this.scene.add(this.lighting.group)
    this.environment = new EnvironmentManager(this.ctx.renderer, this.assets)
    this.environment.onCustomLoaded = () => this.requestRender()
    this.grid = new InfiniteGrid(this.theme)
    this.scene.add(this.grid.mesh)
    if (options.viewCubeOffset) this.ctx.viewCubeOffset = { top: Math.max(0, options.viewCubeOffset.top), left: Math.max(0, options.viewCubeOffset.left) }
    this.viewports = new ViewportManager(this.ctx, this.theme, () => this.syncViewportState(), options.showViewportLabels !== false)
    this.pipeline = new Pipeline({ ctx: this.ctx, doc: this.doc, scene: this.scene, overlayScene: this.overlayScene, sync: this.sync, viewState: this.viewState, lighting: this.lighting, environment: this.environment, grid: this.grid, theme: this.theme, lineMaterials: this.lineMaterials })
    this.overlay = new OverlayLayer(this.viewports, this.theme)
    this.preview = new PreviewLayer(this.geometry, this.materials, this.lineMaterials, this.hatches, this.theme, this.overlay, () => this.requestRender())
    this.scene.add(this.preview.root)
    this.snapVisuals = new SnapVisuals(this.theme, this.lineMaterials, this.overlay)
    this.overlayScene.add(this.snapVisuals.root)
    this.picker = new Picker(this.doc, this.sync, this.viewState, (vp) => this.sceneStateFor(vp))
    this.snapEngine = new SnapEngine({
      doc: this.doc,
      sync: this.sync,
      picker: this.picker,
      settings: () => this.store.getState().snapping,
      gridStep: (vp, plane) => adaptiveGridStep(this.doc.meta.grid.size, this.doc.meta.grid.subdivisions, vp.worldPerPixel(_v.set(plane.origin[0], plane.origin[1], plane.origin[2]))),
      workPlane: (vp) => this.toolContext.workPlane(vp.index),
      hidden: () => this.hiddenIds(),
      viewportAt: (i) => this.viewports.at(i),
    })
    this.selectionVisuals = new SelectionVisuals(this.doc, this.sync, this.theme)
    this.scene.add(this.selectionVisuals.proxies)
    this.gizmo = new TransformGizmo(this, this.overlay)
    this.overlayScene.add(this.gizmo.group)
    this.boxGizmo = new BoxGizmo2D(this, this.overlay)
    this.directDrag = new DirectDrag(this, this.overlay, this.snapEngine, this.snapVisuals)
    this.directDrag.onDuplicate = (ids) => {
      this.doc.stopCapturing()
      const copies = this.doc.duplicateNodes(ids)
      this.select(copies, 'replace')
      return copies
    }
    this.host = new ToolHost(
      createCoreTools({
        core: this,
        editor: () => this,
        picker: this.picker,
        directDrag: this.directDrag,
        overlay: this.overlay,
        preview: this.preview,
        snap: this.snapEngine,
        snapVisuals: this.snapVisuals,
        setEditingContext: (id) => this.setEditingContext(id),
        setWalking: (on) => (this.walking = on),
      }),
      this.store,
      (css) => this.toolContext.setCursor(css),
    )
    this.host.layers.push(this.gizmo, this.boxGizmo)
    this.toolContext = new ToolContextImpl({ core: this, editor: this, picker: this.picker, snapEngine: this.snapEngine, snapVisuals: this.snapVisuals, preview: this.preview, overlay: this.overlay, host: this.host })
    this.host.attach(this.toolContext)
    this.host.onToolChanged = (id) => {
      this.input?.applyNavigation()
      this.presence?.setTool(id)
      this.snapVisuals.hide()
      this.requestRender()
    }
    this.input = new InputManager(this, this.viewports, this.host, this.pipeline, this.picker, {
      onEscape: () => this.cancel(),
      onEnter: () => this.host.confirm(),
      onDelete: () => void this.commands.execute('edit.delete'),
      onPickForContextMenu: (vp, ndc) => {
        const hit = this.picker.pick(vp, ndc, { skipLocked: true, within: this.store.getState().editingContext, hidden: this.hiddenIds() })
        const target = hit ? this.picker.selectionTarget(hit.nodeId, this.store.getState().editingContext) : null
        if (target && !this.store.getState().selection.includes(target)) this.select([target], 'replace')
        return target
      },
      onPointerMoved: (e) => this.trackCursor(e.viewport, e.ray),
      onViewCube: (vp, azimuth, polar, preset) => {
        void vp.controls.rotateTo(azimuth, polar, true)
        vp.preset = (preset as ViewPreset | null) ?? 'custom'
        vp.labelText = presetLabel(vp.preset)
        this.applyPlanLevelRule(vp)
        this.syncViewportState()
        this.ctx.notifyMotion(500)
      },
      isWalking: () => this.walking,
    })
    this.insertion = new InsertionApi({ core: this, input: this.input, snapEngine: this.snapEngine, snapVisuals: this.snapVisuals, picker: this.picker, toolContext: this.toolContext, preview: this.preview, select: (ids) => this.select(ids, 'replace') })
    this.commands = createCommandRegistry(
      createActions({
        core: this,
        editor: () => this,
        clipboard: this.clipboard,
        picker: this.picker,
        cursorWorld: () => this.lastCursor,
        setEditingContext: (id) => this.setEditingContext(id),
        confirmTool: () => {
          this.input.resetInput()
          this.host.confirm()
        },
      }),
    )
    this.presence = new Presence(
      options.awareness ?? null,
      this.user,
      this.overlay,
      (users) => {
        this.store.setState({ remoteUsers: users })
        this.selectionVisuals.invalidate()
        this.requestRender()
      },
      (camera) => {
        if (this.store.getState().following !== null) this.viewports.activeViewport.setCameraState(camera, true)
        this.ctx.notifyMotion(300)
      },
    )
    this.overlayScene.add(this.presence.root)
    this.pipeline.beforeViewport.push((vp) => {
      const s = this.store.getState()
      this.gizmo.update(vp, s.selection, s.gizmo, s.transformSpace)
      this.boxGizmo.update(vp, s.selection)
      this.presence.updateScale((p) => vp.worldPerPixel(p))
    })

    this.unsubscribers.push(this.ctx.events.on('frame', (f) => this.onFrame(f)))
    this.unsubscribers.push(this.ctx.events.on('resize', () => this.viewports.updateRects()))
    this.unsubscribers.push(this.ctx.events.on('contextlost', () => this.emit('notify', { level: 'warning', message: 'Graphics context lost — restoring…' })))
    this.unsubscribers.push(this.ctx.events.on('contextrestored', () => this.requestRender()))
    this.unsubscribers.push(this.doc.onChange((e) => this.onDocChange(e)))
    this.unsubscribers.push(this.geometry.onUpdate(() => this.requestRender()))
    const undoUpdate = () => this.store.setState({ canUndo: this.doc.canUndo(), canRedo: this.doc.canRedo() })
    for (const ev of ['stack-item-added', 'stack-item-popped', 'stack-cleared'] as const) {
      this.doc.undoManager.on(ev, undoUpdate)
      this.unsubscribers.push(() => this.doc.undoManager.off(ev, undoUpdate))
    }
    this.store.setState({ activeLevel: this.doc.meta.activeLevel ?? this.doc.levels()[0]?.id ?? null })
    this.host.setTool('select')
    if (!this.doc.nodeIds().some((id) => !this.doc.isDefinitionNode(id))) this.fitted = true
    this.store.setState({ ready: true })
    this.requestRender()
  }

  private toolContext!: ToolContextImpl

  private emitLater<K extends keyof EditorEvents>(event: K, payload: EditorEvents[K]): void {
    setTimeout(() => this.emit(event, payload), 0)
  }

  // ------------------------------------------------------------------ Core
  requestRender(): void {
    this.ctx.requestRender()
  }
  notifyMotion(ms = 120): void {
    this.ctx.notifyMotion(ms)
  }
  /** Editor-local sun time for presentations (sun study); null restores the document's sun. Never writes the document. */
  setSunOverride(override: SunOverride | null): void {
    this.lighting.sunOverride = override
    this.requestRender()
  }
  emit<K extends keyof EditorEvents>(event: K, payload: EditorEvents[K]): void {
    this.events.emit(event, payload)
  }
  hiddenIds(): ReadonlySet<string> {
    const iso = this.store.getState().isolated
    return this.viewState.isolationHidden(iso ? new Set(iso) : null)
  }
  activeLevelId(): string | null {
    const id = this.store.getState().activeLevel
    return id && this.doc.hasNode(id) ? id : (this.doc.meta.activeLevel && this.doc.hasNode(this.doc.meta.activeLevel) ? this.doc.meta.activeLevel : null)
  }
  activeLevelElevation(): number {
    const id = this.activeLevelId()
    return id ? (this.doc.getNode<'level'>(id)?.t.p[2] ?? 0) : 0
  }
  rayFor(vp: Viewport, clientX: number, clientY: number, out: THREE.Ray): THREE.Ray {
    const rect = this.ctx.container.getBoundingClientRect()
    vp.ndc(clientX, clientY, rect, _ndc)
    _raycaster.setFromCamera(_ndc, vp.camera)
    return out.copy(_raycaster.ray)
  }

  private sceneStateFor(vp: Viewport): ViewportSceneState {
    const s = this.store.getState()
    return { mode: vp.renderMode, planLevel: vp.planLevel, sectionView: vp.section, isolated: s.isolated ? new Set(s.isolated) : null, editingContext: s.editingContext, showCaps: true }
  }

  // ------------------------------------------------------------------ frame
  private onFrame(frame: FrameInfo): void {
    if (this.disposed) return
    const moved = this.viewports.update(frame.dt)
    if (moved) this.ctx.notifyMotion(60)
    if (!this.fitted && this.canFitNow(frame.now)) {
      this.fitted = true
      for (const vp of this.viewports.viewports) vp.fit(this.sync.sceneBounds(), false)
    }
    const s = this.store.getState()
    this.updateSelectionBounds(s)
    this.selectionVisuals.update(s.selection, s.hover, s.remoteUsers.map((u) => ({ clientId: u.clientId, color: u.user.color, ids: u.selection })))
    this.preview.root.updateMatrixWorld(false) // ghosts flag matrixWorldNeedsUpdate; the scene no longer auto-updates
    this.pipeline.renderFrame(this.viewports.viewports, frame, {
      gridVisible: s.gridVisible,
      activeLevel: this.activeLevelId(),
      isolated: s.isolated ? new Set(s.isolated) : null,
      editingContext: s.editingContext,
      activeViewport: this.viewports.active,
      outlineGroups: this.selectionVisuals.outlineGroups(),
      realistic: { active: s.realistic.active, targetSamples: s.realistic.targetSamples },
    })
    this.overlay.update(moved || true)
    if (moved) this.presence.setCamera(this.viewports.activeViewport.getCameraState())
    if (s.realistic.active && this.pipeline.samples !== s.realistic.samples) this.store.setState({ realistic: { ...s.realistic, samples: this.pipeline.samples } })
    if (frame.now - this.lastStats > 500) {
      this.lastStats = frame.now
      const st = this.ctx.stats
      this.store.setState({ stats: { ...s.stats, fps: st.fps, frameMs: Math.round(st.frameMs * 100) / 100, triangles: Number.isFinite(st.triangles) ? st.triangles : this.sync.triangleCount(), drawCalls: st.drawCalls, nodes: this.sync.views.size, geometryPending: this.geometry.stats.pending, quality: this.tier.tier } })
    }
    this.syncViewportState()
  }

  /**
   * Initial framing: wait until the first evaluation batch settled (partial bounds would frame a
   * fragment) and the viewport has a real size — camera-controls fits the sphere to the horizontal
   * fov when aspect < 1, so a not-yet-laid-out 1×N px rect puts the camera kilometres away.
   */
  private canFitNow(now: number): boolean {
    if (this.sync.sceneBounds().isEmpty()) return false
    const r = this.viewports.activeViewport.rect
    if (r.w < 64 || r.h < 64) return false
    if (!this.firstBoundsAt) this.firstBoundsAt = now
    return this.geometry.stats.pending === 0 || now - this.firstBoundsAt > 1500
  }

  private updateSelectionBounds(s: EditorState): void {
    const key = s.selection.join(',')
    if (key === this.lastSelectionKey && this.lastBoundsVersion === this.sync.contentVersion) return
    this.lastSelectionKey = key
    this.lastBoundsVersion = this.sync.contentVersion
    if (!s.selection.length) {
      if (s.selectionBounds) this.store.setState({ selectionBounds: null })
      return
    }
    const b = this.sync.worldBounds(s.selection, _box)
    this.store.setState({ selectionBounds: b.isEmpty() ? null : boundsFromBox3(b) })
  }

  private onDocChange(e: DocChangeEvent): void {
    const s = this.store.getState()
    const alive = s.selection.filter((id) => this.doc.hasNode(id))
    if (alive.length !== s.selection.length) this.select(alive, 'replace')
    if (s.hover && !this.doc.hasNode(s.hover)) this.store.setState({ hover: null })
    if (s.editingContext && !this.doc.hasNode(s.editingContext)) this.setEditingContext(null)
    const metaLevel = this.doc.meta.activeLevel
    if (metaLevel !== s.activeLevel && (metaLevel === null || this.doc.hasNode(metaLevel))) {
      this.store.setState({ activeLevel: metaLevel ?? this.doc.levels()[0]?.id ?? null })
      for (const vp of this.viewports.viewports) this.applyPlanLevelRule(vp)
    }
    this.store.setState({ canUndo: this.doc.canUndo(), canRedo: this.doc.canRedo() })
    // viewport chrome (labels) only depends on structure/names — transform-only bursts (drags at
    // ~15 Hz) must not push a fresh `viewports` state to the React chrome every time
    let structural = e.nodes.added.size > 0 || e.nodes.removed.size > 0 || e.meta || e.layers
    if (!structural) for (const keys of e.nodes.updated.values()) if (keys.has('name') || keys.has('params') || keys.has('parent')) structural = true
    this.syncViewportState(structural)
    this.requestRender()
  }

  private trackCursor = throttle((viewport: number, ray: { origin: Vec3; direction: Vec3 }) => {
    const vp = this.viewports.at(viewport)
    const plane = this.toolContext.workPlane(vp.index)
    const p = this.snapEngine.lastResult?.point ?? rayPlane(ray.origin, ray.direction, plane, true)
    this.lastCursor = p
    this.store.setState({ cursorWorld: p })
    this.presence.setCursor(p)
  }, 33)

  private setEditingContext(id: string | null): void {
    if (this.store.getState().editingContext === id) return
    this.store.setState({ editingContext: id })
    this.requestRender()
  }

  /** Top/bottom orthographic viewports show the active level as a plan cut. */
  private applyPlanLevelRule(vp: Viewport): void {
    const plan = vp.isOrtho && (vp.preset === 'top' || vp.preset === 'bottom')
    const level = plan ? this.activeLevelId() : null
    vp.planLevel = level
    const name = level ? (this.doc.getNode(level)?.name ?? null) : null
    this.viewports.setLabel(vp, name)
  }

  private syncViewportState(force = false): void {
    const states = this.viewports.states()
    const key = JSON.stringify(states) + `|${this.viewports.active}|${this.viewports.layout}`
    if (!force && key === this.viewportStateKey) return
    this.viewportStateKey = key
    this.viewports.refreshChrome()
    this.store.setState({ viewports: states, activeViewport: this.viewports.active, layout: this.viewports.layout })
  }

  // ------------------------------------------------------------------ Editor API
  getState(): EditorState {
    return this.store.getState()
  }

  on<K extends keyof EditorEvents>(event: K, listener: (e: EditorEvents[K]) => void): Unsubscribe {
    return this.events.on(event, listener)
  }

  setTool(tool: ToolId, options?: Record<string, unknown>): void {
    this.host.setTool(tool, options)
  }

  submitToolInput(value: string): void {
    this.input.submitInput(value)
  }

  cancel(): void {
    this.input.resetInput() // an unsent typed value never survives a cancel
    if (this.host.cancel()) {
      this.requestRender()
      return
    }
    const s = this.store.getState()
    if (this.host.currentId !== 'select') this.host.setTool('select')
    else if (s.selection.length) this.select([], 'replace')
    else if (s.editingContext) this.setEditingContext(null)
    else if (s.isolated) this.isolate(null)
    this.snapVisuals.hide()
    this.requestRender()
  }

  select(ids: string[], mode: 'replace' | 'add' | 'toggle' | 'remove' = 'replace'): void {
    const cur = this.store.getState().selection
    const valid = ids.filter((id) => this.doc.hasNode(id) && !this.doc.isDefinitionNode(id))
    let next: string[]
    switch (mode) {
      case 'add':
        next = [...cur, ...valid.filter((id) => !cur.includes(id))]
        break
      case 'toggle':
        next = cur.filter((id) => !valid.includes(id)).concat(valid.filter((id) => !cur.includes(id)))
        break
      case 'remove':
        next = cur.filter((id) => !valid.includes(id))
        break
      default:
        next = [...new Set(valid)]
    }
    if (arraysEqual(cur, next)) return
    this.store.setState({ selection: next })
    this.presence.setSelection(next)
    this.requestRender()
  }

  setHover(id: string | null): void {
    if (this.store.getState().hover === id) return
    this.store.setState({ hover: id })
    this.requestRender()
  }

  setLayout(layout: ViewLayout): void {
    const bounds = this.sync.sceneBounds()
    this.viewports.setLayout(layout, bounds.isEmpty() ? null : bounds)
    this.input.attachAll()
    for (const vp of this.viewports.viewports) this.applyPlanLevelRule(vp)
    this.syncViewportState(true)
    this.requestRender()
  }

  setViewPreset(preset: ViewPreset, viewport?: number): void {
    const vp = this.viewports.at(viewport)
    vp.applyPreset(preset, null, true)
    this.applyPlanLevelRule(vp)
    this.input.applyNavigation()
    this.syncViewportState(true)
    this.ctx.notifyMotion(500)
  }

  setRenderMode(mode: RenderMode, viewport?: number): void {
    const vp = this.viewports.at(viewport)
    vp.renderMode = mode
    const anyRealistic = this.viewports.viewports.some((v) => v.renderMode === 'realistic')
    if (anyRealistic) this.startRealistic()
    else this.stopRealistic()
    this.syncViewportState(true)
    this.requestRender()
  }

  setActiveViewport(index: number): void {
    this.viewports.setActive(index)
    this.syncViewportState(true)
  }

  setActiveLevel(levelId: string | null): void {
    if (levelId && !this.doc.hasNode(levelId)) return
    if (this.doc.meta.activeLevel !== levelId) this.doc.transact(() => this.doc.metaMap.set('activeLevel', levelId), SILENT_ORIGIN)
    this.store.setState({ activeLevel: levelId })
    for (const vp of this.viewports.viewports) this.applyPlanLevelRule(vp)
    this.syncViewportState(true)
    this.requestRender()
  }

  setSnapping(patch: Partial<SnapSettings>): void {
    this.store.setState({ snapping: { ...this.store.getState().snapping, ...patch } })
  }

  /** Navigation preferences (persisted by the app, device-level). */
  setNavigation(patch: Partial<NavigationSettings>): void {
    const before = this.store.getState().navigation
    this.store.setState({ navigation: { ...before, ...patch } })
    if (patch.viewOnly !== undefined && patch.viewOnly !== before.viewOnly) {
      if (patch.viewOnly) this.cancel() // drop any tool step in progress
      this.input.applyNavigation()
    }
  }

  setViewCubeOffset(offset: { top: number; left: number }): void {
    const cur = this.ctx.viewCubeOffset
    const top = Math.max(0, Math.round(offset.top))
    const left = Math.max(0, Math.round(offset.left))
    if (cur.top === top && cur.left === left) return
    this.ctx.viewCubeOffset = { top, left }
    this.viewports.refreshChrome()
    this.requestRender()
  }

  setGizmo(mode: GizmoMode): void {
    this.store.setState({ gizmo: mode })
    this.requestRender()
  }

  setTheme(theme: Theme): void {
    this.theme.setTheme(theme)
    this.store.setState({ theme })
    this.grid.setTheme(this.theme)
    this.materials.setTheme(this.theme)
    this.lineMaterials.setTheme(this.theme)
    this.sync.setTheme(this.theme)
    this.pipeline.setTheme(this.theme)
    this.viewports.setTheme(this.theme)
    this.overlay.setTheme(this.theme)
    this.preview.setTheme(this.theme)
    this.selectionVisuals.setTheme(this.theme)
    this.gizmo.setTheme()
    this.boxGizmo.setTheme()
    this.snapVisuals.setTheme(this.theme)
    this.requestRender()
  }

  setQuality(q: Quality): void {
    this.tier = resolveQuality(q, this.gpu)
    this.ctx.setTier(this.tier)
    this.ctx.renderer.shadowMap.type = this.tier.softShadows ? THREE.PCFShadowMap : THREE.PCFShadowMap
    this.lighting.setShadowMapSize(this.tier.shadowMapSize)
    this.pipeline.recreate()
    this.store.setState({ stats: { ...this.store.getState().stats, quality: this.tier.tier } })
    this.requestRender()
  }

  zoomToFit(ids?: string[], animate = true): void {
    const b = ids && ids.length ? this.sync.worldBounds(ids, new THREE.Box3()) : this.sync.sceneBounds().clone()
    if (b.isEmpty()) b.set(new THREE.Vector3(-5, -5, 0), new THREE.Vector3(5, 5, 3))
    this.viewports.activeViewport.fit(b, animate)
    this.ctx.notifyMotion(600)
  }

  getCamera(viewport?: number): CameraState {
    return this.viewports.at(viewport).getCameraState()
  }

  setCamera(state: CameraState, animate = false, viewport?: number): void {
    const vp = this.viewports.at(viewport)
    vp.setCameraState(state, animate)
    this.applyPlanLevelRule(vp)
    this.syncViewportState(true)
    this.ctx.notifyMotion(animate ? 500 : 60)
  }

  follow(clientId: number | null): void {
    this.presence.follow(clientId)
    this.store.setState({ following: this.presence.following })
  }

  isolate(ids: string[] | null): void {
    const roots = ids && ids.length ? this.doc.topLevel(ids) : null
    this.store.setState({ isolated: roots })
    this.selectionVisuals.invalidate()
    this.requestRender()
  }

  // ------------------------------------------------------------------ insertion & picking
  insert(content: DocSnapshot | NewNode[], at?: { clientX: number; clientY: number } | { world: Vec3 }): Promise<string[]> {
    return this.insertion.insert(content, at)
  }

  dragPreview(content: DocSnapshot | NewNode[] | null, clientX?: number, clientY?: number): void {
    this.insertion.dragPreview(content, clientX, clientY)
  }

  pick(clientX: number, clientY: number): { nodeId: string | null; point: Vec3; normal: Vec3 | null } | null {
    return this.insertion.pick(clientX, clientY)
  }

  project(world: Vec3, viewport?: number): { x: number; y: number; visible: boolean } | null {
    return this.insertion.project(world, viewport)
  }

  // ------------------------------------------------------------------ output
  screenshot(opts: { width?: number; height?: number; viewport?: number; transparent?: boolean; mime?: 'image/png' | 'image/webp'; samples?: number } = {}): Promise<Blob> {
    const vp = this.viewports.at(opts.viewport)
    const iso = this.store.getState().isolated
    return screenshotViewport(this.pipeline, vp, opts, iso ? new Set(iso) : null)
  }

  vectorize(source: SheetViewSource) {
    return vectorize(this.doc, this.geometry, this.sync, source)
  }

  renderView(source: SheetViewSource, opts: { width: number; height: number; style: 'shaded' | 'realistic' | 'hidden-line' }): Promise<Blob> {
    return renderSheetView(this.pipeline, this.doc, this.sync, source, opts)
  }

  startRealistic(targetSamples?: number): void {
    const cur = this.store.getState().realistic
    this.store.setState({ realistic: { active: true, samples: 0, targetSamples: targetSamples ?? cur.targetSamples } })
    if (this.pipeline.pathTracer.unsupported) this.emit('notify', { level: 'info', message: 'Path tracing is not supported on this GPU — showing shaded preview with ambient occlusion' })
    this.pipeline.pathTracer.reset()
    this.requestRender()
  }

  stopRealistic(): void {
    const cur = this.store.getState().realistic
    if (!cur.active) return
    this.store.setState({ realistic: { ...cur, active: false, samples: 0 } })
    this.requestRender()
  }

  visibleNodes(): AnyNode[] {
    return this.sync.visibleNodes(this.hiddenIds())
  }

  resize(): void {
    this.ctx.resize()
    this.viewports.updateRects()
    this.requestRender()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const u of this.unsubscribers) u()
    this.unsubscribers = []
    this.trackCursor.cancel()
    this.host.dispose()
    this.input.dispose()
    this.presence.dispose()
    this.gizmo.dispose()
    this.boxGizmo.dispose()
    this.directDrag.cancel()
    this.insertion.dispose()
    this.preview.dispose()
    this.snapVisuals.dispose()
    this.snapEngine.dispose()
    this.selectionVisuals.dispose()
    this.overlay.dispose()
    this.pipeline.dispose()
    this.sync.dispose()
    this.materials.dispose()
    this.lineMaterials.dispose()
    this.hatches.dispose()
    this.procedural.dispose()
    this.lighting.dispose()
    this.environment.dispose()
    this.grid.dispose()
    this.viewports.dispose()
    if (this.ownsGeometry) this.geometry.dispose()
    this.ctx.dispose()
    this.events.clear()
  }
}

const _v = new THREE.Vector3()
const _ndc = new THREE.Vector2()
const _raycaster = new THREE.Raycaster()
const _box = new THREE.Box3()
