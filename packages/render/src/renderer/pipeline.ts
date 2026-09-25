// Pipeline — renders every viewport of a frame: scene state (mode/plan/sections), environment and
// lighting, background, main pass (direct MSAA / N8AO → HDR → tone mapping / progressive path
// tracing), selection outlines (layer masks), overlay scene (gizmos) and the view cube.
import * as THREE from 'three'
import { N8AOPass } from 'n8ao'
import type { CadDocument, RenderMode, RenderSettings } from '@cadsandbox/doc'
import { DEFAULT_RENDER } from '@cadsandbox/doc'
import type { RenderContext, FrameInfo } from './context'
import type { Viewport } from './viewport'
import type { SceneSync } from '../scene/sceneSync'
import type { ViewStateApplier } from '../scene/viewState'
import type { SceneLighting } from './lights'
import type { EnvironmentManager } from './environment'
import type { InfiniteGrid } from './grid'
import type { ThemeColors } from '../util/css'
import type { LineStyleMaterials } from '../scene/drawing'
import { BlitPass, GradientPass, OutlinePass, ToneMapPass, createHdrTarget, type ToneMode } from './postfx'
import { PathTracerController } from './pathtracer'
import { ViewCube, VIEWCUBE_SIZE } from './viewcube'

export interface OutlineGroup {
  /** three layer index (1..31) enabled on the objects of this group */
  layer: number
  color: THREE.Color
  thicknessPx: number
  glow: number
}

export interface PipelineDeps {
  ctx: RenderContext
  doc: CadDocument
  scene: THREE.Scene
  overlayScene: THREE.Scene
  sync: SceneSync
  viewState: ViewStateApplier
  lighting: SceneLighting
  environment: EnvironmentManager
  grid: InfiniteGrid
  theme: ThemeColors
  lineMaterials: LineStyleMaterials
}

export interface FrameState {
  gridVisible: boolean
  activeLevel: string | null
  isolated: ReadonlySet<string> | null
  editingContext: string | null
  activeViewport: number
  outlineGroups: OutlineGroup[]
  realistic: { active: boolean; targetSamples: number }
  transparentBackground?: boolean
}

interface AoEntry {
  pass: N8AOPass
  camera: THREE.Camera
  w: number
  h: number
}

export const PAPER = new THREE.Color('#f7f6f2')

export class Pipeline {
  readonly d: PipelineDeps
  readonly tonemap = new ToneMapPass()
  readonly outline = new OutlinePass()
  readonly blit = new BlitPass()
  readonly gradient = new GradientPass()
  readonly viewCube: ViewCube
  readonly pathTracer: PathTracerController
  private ao = new Map<number, AoEntry>()
  private hdr = new Map<number, THREE.WebGLRenderTarget>()
  private maskCamera: THREE.Camera | null = null
  /** Hooks run right before each viewport renders (gizmo sizing, overlays). */
  readonly beforeViewport: ((vp: Viewport) => void)[] = []
  private realisticRelease: (() => void) | null = null
  samples = 0
  private lastSceneVersion = -1
  /** Signature of the state the cached shadow map was rendered for (see renderViewport). */
  private shadowKey = ''

  constructor(deps: PipelineDeps) {
    this.d = deps
    // Shadow maps are cached: three.js re-renders every shadow map on EVERY render() call by default
    // (once per viewport per frame, 4096² PCFSoft on the top tier) although casters only change when
    // the scene, the sun or the visibility state does. renderViewport flags needsUpdate on change.
    deps.ctx.renderer.shadowMap.autoUpdate = false
    deps.ctx.renderer.shadowMap.needsUpdate = true
    this.viewCube = new ViewCube(deps.theme)
    this.pathTracer = new PathTracerController(deps.ctx.renderer, deps.ctx.tier.pathTracing && deps.ctx.gpu.floatColorBuffer)
    deps.ctx.events.on('contextrestored', () => this.recreate())
  }

  private settings(): RenderSettings {
    return this.d.doc.meta.render ?? DEFAULT_RENDER
  }

  /** Background color for a viewport: doc color, theme viewport bg when untouched, paper for drawings. */
  backgroundColor(mode: RenderMode): { color: THREE.Color; alpha: number } {
    const s = this.settings()
    if (mode === 'technical' || mode === 'hidden-line') return { color: PAPER, alpha: 1 }
    if (s.background === 'transparent') return { color: new THREE.Color(0, 0, 0), alpha: 0 }
    const custom = s.backgroundColor && s.backgroundColor.toLowerCase() !== DEFAULT_RENDER.backgroundColor.toLowerCase()
    if (custom) return { color: new THREE.Color(s.backgroundColor), alpha: 1 }
    return { color: this.d.theme.get('--cs-viewport-bg').color, alpha: 1 }
  }

  toneMode(mode: RenderMode): ToneMode {
    if (mode === 'technical' || mode === 'hidden-line' || mode === 'wireframe' || mode === 'xray') return 'none'
    return this.settings().toneMapping
  }

  private threeToneMapping(mode: ToneMode): THREE.ToneMapping {
    return mode === 'agx' ? THREE.AgXToneMapping : mode === 'aces' ? THREE.ACESFilmicToneMapping : mode === 'neutral' ? THREE.NeutralToneMapping : THREE.NoToneMapping
  }

  /** Render all viewports for one frame. */
  renderFrame(viewports: Viewport[], frame: FrameInfo, state: FrameState): void {
    const { ctx, scene, sync, lighting, environment } = this.d
    const renderer = ctx.renderer
    if (ctx.lost) return
    sync.flush()
    const settings = this.settings()
    const bounds = sync.sceneBounds()
    const levels = this.d.viewState.levels()
    const activeLevel = levels.find((l) => l.id === state.activeLevel)
    const groundZ = activeLevel ? activeLevel.elevation : bounds.isEmpty() ? 0 : Math.min(bounds.min.z, 0)
    lighting.update(settings, this.d.doc.meta.geo, bounds.isEmpty() ? null : bounds, groundZ, this.d.theme.isDark)
    lighting.group.updateMatrixWorld(true) // scene.matrixWorldAutoUpdate is off (SceneSync.flushMatrices)
    const env = environment.environment(settings, lighting.sunDirection)
    scene.environment = env
    scene.environmentIntensity = settings.envIntensity
    scene.environmentRotation.set(0, 0, settings.envRotation)
    scene.backgroundRotation.set(0, 0, settings.envRotation)
    this.viewCube.setEnvironment(env)
    this.d.grid.setSettings(this.d.doc.meta.grid.size, this.d.doc.meta.grid.subdivisions)

    const anyRealistic = state.realistic.active && viewports.some((v) => v.renderMode === 'realistic')
    if (anyRealistic && !this.pathTracer.unsupported) {
      if (!this.realisticRelease) this.realisticRelease = ctx.acquireContinuous()
    } else if (this.realisticRelease) {
      this.realisticRelease()
      this.realisticRelease = null
    }

    renderer.setRenderTarget(null)
    renderer.setScissorTest(false)
    renderer.setClearColor(0x000000, 0)
    renderer.clear(true, true, true)
    for (const vp of viewports) this.renderViewport(vp, frame, state, bounds, groundZ, settings)
    renderer.setScissorTest(false)
    renderer.clippingPlanes = []
  }

  private renderViewport(vp: Viewport, frame: FrameInfo, state: FrameState, bounds: THREE.Box3, groundZ: number, settings: RenderSettings): void {
    const { ctx, scene, sync, viewState, grid, lineMaterials } = this.d
    const renderer = ctx.renderer
    const r = vp.rect
    if (r.w < 2 || r.h < 2) return
    const dpr = ctx.pixelRatio
    const wPx = Math.max(1, Math.round(r.w * dpr))
    const hPx = Math.max(1, Math.round(r.h * dpr))
    const mode = vp.renderMode
    const camera = vp.camera

    const applied = viewState.apply({
      mode,
      planLevel: vp.planLevel,
      sectionView: vp.section,
      isolated: state.isolated,
      editingContext: state.editingContext,
      showCaps: true,
    })
    renderer.clippingPlanes = applied.planes
    lineMaterials.setResolution(wPx, hPx, dpr)
    vp.fitDepthRange(bounds.isEmpty() ? null : bounds)
    for (const hook of this.beforeViewport) hook(vp)

    // grid
    const gridOn = state.gridVisible && mode !== 'realistic' && mode !== 'technical' && mode !== 'hidden-line'
    grid.mesh.visible = gridOn
    if (gridOn) grid.update(camera, applied.planCutZ !== null ? applied.planCutZ - (vp.planLevel ? this.cutHeightOf(vp.planLevel) : 0) : groundZ, vp.isOrtho, vp.isOrtho ? 0.9 : 1)
    this.d.lighting.catcher.visible = settings.shadows && mode !== 'technical' && mode !== 'hidden-line' && mode !== 'wireframe' && mode !== 'xray' && this.d.lighting.sun.visible

    // background
    const bg = state.transparentBackground ? { color: new THREE.Color(0, 0, 0), alpha: 0 } : this.backgroundColor(mode)
    const showEnvBackground = settings.background === 'environment' && (mode === 'shaded' || mode === 'realistic' || mode === 'clay') && !state.transparentBackground
    scene.background = showEnvBackground ? scene.environment : null
    scene.backgroundBlurriness = 0.35
    scene.backgroundIntensity = settings.envIntensity
    ctx.setRegion(r.x, r.y, r.w, r.h)
    renderer.setRenderTarget(null)
    ctx.clearRegion(bg.color, bg.alpha)
    if (settings.background === 'gradient' && !showEnvBackground && bg.alpha > 0 && mode !== 'technical' && mode !== 'hidden-line') {
      const top = bg.color.clone().lerp(new THREE.Color(1, 1, 1), this.d.theme.isDark ? 0.08 : 0.35)
      const bottom = bg.color.clone().lerp(new THREE.Color(0, 0, 0), this.d.theme.isDark ? 0.35 : 0.06)
      this.gradient.render(renderer, top, bottom)
    }

    const tone = this.toneMode(mode)
    const exposure = settings.exposure
    let drewRealistic = false
    if (mode === 'realistic' && state.realistic.active && !this.pathTracer.unsupported) {
      drewRealistic = this.renderRealistic(vp, wPx, hPx, frame, state, tone, exposure)
    }
    if (!drewRealistic) {
      // Cached shadow map: re-render only when casters (content), the sun or the visibility state
      // changed — never for pure camera motion. The flag must be set right before the main scene
      // pass (three resets it on the first render() that runs the shadow pass).
      const sun = this.d.lighting.sun
      const shadowKey = sun.castShadow
        ? `${sync.contentVersion}|${sun.position.x.toFixed(3)},${sun.position.y.toFixed(3)},${sun.position.z.toFixed(3)}|${sun.shadow.mapSize.x}|${renderer.shadowMap.type}|${applied.key}`
        : 'off'
      if (shadowKey !== this.shadowKey) {
        this.shadowKey = shadowKey
        renderer.shadowMap.needsUpdate = true
      }
      // AO is skipped while navigating (the pass stays allocated, so resuming costs nothing)
      const useAo = (mode === 'shaded' || mode === 'realistic') && ctx.tier.ao && settings.ambientOcclusion && !frame.moving
      if (useAo) this.renderWithAo(vp, wPx, hPx, tone, exposure)
      else this.renderDirect(vp, tone)
    }
    scene.background = null

    // selection / hover / remote outlines
    if (state.outlineGroups.length) this.renderOutlines(vp, wPx, hPx, state.outlineGroups)

    // overlay scene (gizmos, markers) always on top
    renderer.setRenderTarget(null)
    ctx.setRegion(r.x, r.y, r.w, r.h)
    renderer.clippingPlanes = []
    renderer.clearDepth()
    const tm = renderer.toneMapping
    renderer.toneMapping = THREE.NoToneMapping
    renderer.render(this.d.overlayScene, camera)
    renderer.toneMapping = tm

    // view cube (top-left, offset configurable so the UI can keep its chrome clear of it)
    const cube = ctx.viewCubeOffset
    if (r.w > cube.left + VIEWCUBE_SIZE * 2 && r.h > cube.top + VIEWCUBE_SIZE * 2) {
      this.viewCube.sync(camera)
      ctx.setRegion(r.x + cube.left, r.y + cube.top, VIEWCUBE_SIZE, VIEWCUBE_SIZE)
      this.viewCube.render(renderer)
    }
    void sync
  }

  private cutHeightOf(levelId: string): number {
    const l = this.d.doc.getNode<'level'>(levelId)
    return l ? l.params.cutHeight : 1.1
  }

  private renderDirect(vp: Viewport, tone: ToneMode): void {
    const renderer = this.d.ctx.renderer
    renderer.toneMapping = this.threeToneMapping(tone)
    renderer.toneMappingExposure = this.settings().exposure
    renderer.render(this.d.scene, vp.camera)
    renderer.toneMapping = THREE.AgXToneMapping
  }

  private hdrFor(index: number, w: number, h: number): THREE.WebGLRenderTarget {
    let rt = this.hdr.get(index)
    if (!rt) {
      rt = createHdrTarget(w, h, 0)
      this.hdr.set(index, rt)
    } else if (rt.width !== w || rt.height !== h) rt.setSize(w, h)
    return rt
  }

  private aoFor(vp: Viewport, w: number, h: number): N8AOPass {
    let e = this.ao.get(vp.index)
    if (e && e.camera !== vp.camera) {
      e.pass.dispose()
      e = undefined
    }
    if (!e) {
      const pass = new N8AOPass(this.d.scene, vp.camera, w, h)
      pass.renderToScreen = false
      pass.beautyRenderTarget.samples = Math.min(4, this.d.ctx.tier.msaa)
      pass.setQualityMode(this.d.ctx.tier.aoQuality)
      const c = pass.configuration
      c.gammaCorrection = false
      c.aoRadius = 0.7
      c.distanceFalloff = 0.6
      c.intensity = 2.2
      c.screenSpaceRadius = false
      c.halfRes = this.d.ctx.tier.tier === 'medium' || w * h > 2.5e6
      c.depthAwareUpsampling = true
      c.transparencyAware = true
      c.accumulate = false
      c.color.set(0, 0, 0)
      e = { pass, camera: vp.camera, w, h }
      this.ao.set(vp.index, e)
    }
    if (e.w !== w || e.h !== h) {
      e.pass.configuration.halfRes = this.d.ctx.tier.tier === 'medium' || w * h > 2.5e6
      e.pass.setSize(w, h)
      e.w = w
      e.h = h
    }
    return e.pass
  }

  private renderWithAo(vp: Viewport, wPx: number, hPx: number, tone: ToneMode, exposure: number): void {
    const renderer = this.d.ctx.renderer
    const pass = this.aoFor(vp, wPx, hPx)
    const hdr = this.hdrFor(vp.index, wPx, hPx)
    const prevClear = renderer.autoClear
    const prevTm = renderer.toneMapping
    renderer.autoClear = true
    renderer.toneMapping = THREE.NoToneMapping
    renderer.setClearColor(0x000000, 0)
    renderer.setScissorTest(false)
    try {
      pass.render(renderer, hdr, null, 0, false)
    } finally {
      renderer.autoClear = prevClear
      renderer.toneMapping = prevTm
    }
    renderer.setRenderTarget(null)
    const r = vp.rect
    this.d.ctx.setRegion(r.x, r.y, r.w, r.h)
    this.tonemap.render(renderer, hdr.texture, tone, exposure)
  }

  private renderRealistic(vp: Viewport, wPx: number, hPx: number, frame: FrameInfo, state: FrameState, tone: ToneMode, exposure: number): boolean {
    const { scene, sync, ctx } = this.d
    const pt = this.pathTracer
    pt.targetSamples = state.realistic.targetSamples
    if (frame.moving) {
      pt.reset()
      this.samples = 0
      return false
    }
    // hide helpers/text for the BVH build (they are not path traced)
    if (sync.contentVersion !== this.lastSceneVersion || !pt.texture) {
      this.lastSceneVersion = sync.contentVersion
      const hidden: THREE.Object3D[] = []
      scene.traverse((o) => {
        if ((o.userData.noPathTrace || o.userData.helper) && o.visible) {
          o.visible = false
          hidden.push(o)
        }
      })
      const bg = this.backgroundColor('realistic')
      const equirect = this.d.environment.equirect(this.settings(), this.d.lighting.sunDirection)
      pt.environmentEquirect = equirect
      pt.backgroundForTracer = this.settings().background === 'environment' ? equirect : this.settings().background === 'transparent' ? null : bg.color
      scene.background = pt.backgroundForTracer
      // batched parts have no per-mesh objects: expose their standalone meshes while the tracer reads the scene
      const restoreBatches = sync.exposeBatchedMeshes()
      try {
        pt.setScene(scene, vp.camera, sync.contentVersion)
      } finally {
        restoreBatches()
      }
      for (const o of hidden) o.visible = true
    }
    pt.setSize(wPx, hPx)
    const ok = pt.renderSample(vp.camera, vp.cameraVersion)
    this.samples = pt.samples
    if (!ok || !pt.texture) return false
    const renderer = ctx.renderer
    renderer.setRenderTarget(null)
    const r = vp.rect
    ctx.setRegion(r.x, r.y, r.w, r.h)
    this.tonemap.render(renderer, pt.texture, tone, exposure)
    return true
  }

  private renderOutlines(vp: Viewport, wPx: number, hPx: number, groups: OutlineGroup[]): void {
    const { ctx, scene } = this.d
    const renderer = ctx.renderer
    this.outline.setSize(wPx, hPx)
    const camera = vp.camera
    const prevMask = camera.layers.mask
    const prevOverride = scene.overrideMaterial
    const prevBg = scene.background
    const prevEnv = scene.environment
    scene.background = null
    renderer.setRenderTarget(this.outline.target)
    renderer.setScissorTest(false)
    renderer.setClearColor(0x000000, 0)
    renderer.clear(true, true, true)
    const tm = renderer.toneMapping
    renderer.toneMapping = THREE.NoToneMapping
    let drew = false
    for (const g of groups) {
      camera.layers.set(g.layer)
      scene.overrideMaterial = this.outline.maskMaterial(g.color)
      renderer.render(scene, camera)
      drew = true
    }
    camera.layers.mask = prevMask
    scene.overrideMaterial = prevOverride
    scene.background = prevBg
    scene.environment = prevEnv
    renderer.toneMapping = tm
    renderer.setRenderTarget(null)
    const r = vp.rect
    ctx.setRegion(r.x, r.y, r.w, r.h)
    if (!drew) return
    renderer.clearDepth()
    const g0 = groups[0]!
    this.outline.render(renderer, g0.thicknessPx * ctx.pixelRatio, g0.glow)
  }

  /**
   * Offscreen render of a camera into an RGBA8 target (screenshots, sheet views). The caller owns
   * the returned target.
   */
  renderOffscreen(
    camera: THREE.Camera,
    mode: RenderMode,
    width: number,
    height: number,
    opts: { transparent?: boolean; planLevel?: string | null; section?: string | null; isolated?: ReadonlySet<string> | null; samples?: number },
  ): THREE.WebGLRenderTarget {
    const { ctx, scene, viewState, sync, lineMaterials } = this.d
    const renderer = ctx.renderer
    sync.flush()
    const applied = viewState.apply({ mode, planLevel: opts.planLevel ?? null, sectionView: opts.section ?? null, isolated: opts.isolated ?? null, editingContext: null, showCaps: true })
    renderer.clippingPlanes = applied.planes
    lineMaterials.setResolution(width, height, 1)
    const settings = this.settings()
    const bg = opts.transparent ? { color: new THREE.Color(0, 0, 0), alpha: 0 } : this.backgroundColor(mode)
    this.d.grid.mesh.visible = false
    this.d.lighting.catcher.visible = settings.shadows && mode !== 'technical' && mode !== 'hidden-line'
    scene.background = settings.background === 'environment' && (mode === 'shaded' || mode === 'realistic' || mode === 'clay') && !opts.transparent ? scene.environment : null
    const out = new THREE.WebGLRenderTarget(width, height, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: true, stencilBuffer: false, samples: 0 })
    out.texture.colorSpace = THREE.SRGBColorSpace
    const hdr = createHdrTarget(width, height, Math.min(4, ctx.tier.msaa || 4))
    const prevClear = renderer.autoClear
    renderer.setScissorTest(false)
    renderer.setRenderTarget(hdr)
    renderer.setClearColor(bg.color, bg.alpha)
    renderer.clear(true, true, true)
    const tm = renderer.toneMapping
    renderer.toneMapping = THREE.NoToneMapping
    // offscreen views have their own visibility state → fresh shadows now and again for the next frame
    renderer.shadowMap.needsUpdate = true
    this.shadowKey = ''
    renderer.render(scene, camera)
    renderer.setRenderTarget(out)
    renderer.setClearColor(bg.color, bg.alpha)
    renderer.clear(true, true, true)
    this.tonemap.render(renderer, hdr.texture, this.toneMode(mode), settings.exposure)
    renderer.toneMapping = tm
    renderer.autoClear = prevClear
    renderer.setRenderTarget(null)
    renderer.clippingPlanes = []
    scene.background = null
    hdr.dispose()
    return out
  }

  setTheme(theme: ThemeColors): void {
    this.viewCube.setTheme(theme)
  }

  /** Recreate GPU resources after a context restore. */
  recreate(): void {
    for (const e of this.ao.values()) e.pass.dispose()
    this.ao.clear()
    for (const rt of this.hdr.values()) rt.dispose()
    this.hdr.clear()
    this.d.environment.reset()
    this.pathTracer.reset()
  }

  dispose(): void {
    this.realisticRelease?.()
    for (const e of this.ao.values()) e.pass.dispose()
    this.ao.clear()
    for (const rt of this.hdr.values()) rt.dispose()
    this.hdr.clear()
    this.tonemap.dispose()
    this.outline.dispose()
    this.blit.dispose()
    this.gradient.dispose()
    this.viewCube.dispose()
    this.pathTracer.dispose()
    this.maskCamera = null
  }
}
