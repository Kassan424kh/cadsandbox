// Progressive path tracing (three-gpu-pathtracer) for the "realistic" render mode. Accumulates while
// the camera is still, restarts on change, exposes sample counts; the caller composites the HDR
// target into the viewport with the tone-mapping pass.
import * as THREE from 'three'
import { WebGLPathTracer } from 'three-gpu-pathtracer'
import { GenerateMeshBVHWorker, ParallelMeshBVHWorker } from 'three-mesh-bvh/worker'

/** Worker BVH builds slower than this are treated as hung (small scenes build in well under a second). */
const BVH_WORKER_TIMEOUT_MS = 15000

export class PathTracerController {
  private renderer: THREE.WebGLRenderer
  private tracer: WebGLPathTracer | null = null
  private sceneVersion = -1
  private building: Promise<void> | null = null
  private buildQueued = false
  private lastCameraVersion = -1
  private width = 0
  private height = 0
  targetSamples = 256
  /** Set when the GPU cannot path trace (falls back to shaded + AO). */
  unsupported = false
  active = false
  private camera: THREE.Camera | null = null
  private scene: THREE.Scene | null = null
  private disposed = false
  private bvhWorker: GenerateMeshBVHWorker | null = null
  /** Set once a worker build timed out: all further builds run on the main thread. */
  private workerDisabled = false
  private buildToken = 0

  constructor(renderer: THREE.WebGLRenderer, supported: boolean) {
    this.renderer = renderer
    this.unsupported = !supported
  }

  private ensure(): WebGLPathTracer | null {
    if (this.unsupported) return null
    if (!this.tracer) {
      try {
        const pt = new WebGLPathTracer(this.renderer)
        pt.renderToCanvas = false
        pt.dynamicLowRes = true
        pt.lowResScale = 0.25
        pt.bounces = 4
        pt.transmissiveBounces = 6
        pt.filterGlossyFactor = 0.5
        pt.minSamples = 1
        pt.renderDelay = 0
        pt.fadeDuration = 0
        pt.tiles.set(2, 2)
        pt.renderScale = 1
        // BVH generation off the main thread (required for setSceneAsync). The single-worker generator
        // is used on purpose: ParallelMeshBVHWorker spawns nested workers from inside its worker
        // (`new Worker(new URL(...), import.meta.url)`), which silently never completes under Vite dev
        // and is fragile behind COEP — the build promise then hangs forever and "Realistic" stays
        // rasterized. A watchdog in setScene() falls back to the main-thread build in any case.
        if (typeof Worker !== 'undefined' && !this.workerDisabled) {
          try {
            this.bvhWorker = new GenerateMeshBVHWorker()
          } catch {
            try {
              this.bvhWorker = new ParallelMeshBVHWorker()
            } catch {
              this.bvhWorker = null
            }
          }
          if (this.bvhWorker) pt.setBVHWorker(this.bvhWorker as unknown as Parameters<WebGLPathTracer['setBVHWorker']>[0])
        }
        // WebGLPathTracer reads scene.environment/background itself inside setScene()/setSceneAsync()
        // (_updateFromResults → updateEnvironment). The editor scene carries a PMREM render-target
        // texture there, which the tracer cannot read ("Cannot read properties of undefined (reading
        // '0')" → every scene build failed and Realistic silently fell back to raster). Route every
        // environment update through the CPU-readable equirect instead.
        const updateEnvironment = pt.updateEnvironment.bind(pt)
        pt.updateEnvironment = () => {
          const scene = pt.scene ?? this.scene
          if (scene) this.withTracerEnvironment(scene, updateEnvironment)
          else updateEnvironment()
        }
        this.tracer = pt
      } catch (err) {
        console.warn('[cadsandbox/render] path tracer unavailable', err)
        this.unsupported = true
        return null
      }
    }
    return this.tracer
  }

  get samples(): number {
    return this.tracer ? Math.floor(this.tracer.samples) : 0
  }

  get texture(): THREE.Texture | null {
    return this.tracer ? this.tracer.target.texture : null
  }

  get isBuilding(): boolean {
    return this.building !== null
  }

  /** Equirect (CPU-readable) environment the tracer samples; PMREM render targets cannot be read. */
  environmentEquirect: THREE.Texture | null = null
  /** Background the tracer should see (equirect for 'environment', flat color otherwise, null = transparent). */
  backgroundForTracer: THREE.Texture | THREE.Color | null = null

  /** Swap the scene environment/background for tracer-compatible values around a tracer update. */
  private withTracerEnvironment(scene: THREE.Scene, fn: () => void): void {
    const prevEnv = scene.environment
    const prevBg = scene.background
    if (this.environmentEquirect) scene.environment = this.environmentEquirect
    scene.background = this.backgroundForTracer
    try {
      fn()
    } finally {
      scene.environment = prevEnv
      scene.background = prevBg
    }
  }

  /** (Re)build the BVH scene representation when the content changed. Debounced by callers. */
  setScene(scene: THREE.Scene, camera: THREE.Camera, version: number): void {
    const pt = this.ensure()
    if (!pt) return
    this.scene = scene
    this.camera = camera
    if (version === this.sceneVersion && !this.buildQueued) return
    if (this.building) {
      this.buildQueued = true
      return
    }
    this.sceneVersion = version
    this.buildQueued = false
    const viaWorker = !!this.bvhWorker
    const token = ++this.buildToken
    let watchdog = 0
    const build = viaWorker
      ? new Promise<void>((resolve, reject) => {
          // a worker that never answers (failed nested worker, blocked script) must not hang "Realistic" forever
          watchdog = window.setTimeout(() => reject(new Error('BVH worker build timed out')), BVH_WORKER_TIMEOUT_MS)
          pt.setSceneAsync(scene, camera).then(() => resolve(), reject)
        })
      : new Promise<void>((resolve, reject) => {
          try {
            pt.setScene(scene, camera)
            resolve()
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)))
          }
        })
    this.building = build
      .then(
        () => true,
        (err: unknown) => {
          console.warn('[cadsandbox/render] path tracer scene build failed', err)
          return false
        },
      )
      .then((ok) => {
        clearTimeout(watchdog)
        if (token !== this.buildToken || this.disposed) return
        this.building = null
        if (!ok && viaWorker) {
          this.recoverWithoutWorker()
          return
        }
        // _updateFromResults read scene.environment (PMREM) — re-point the tracer at the equirect
        this.withTracerEnvironment(scene, () => pt.updateEnvironment())
        if (this.buildQueued && this.scene && this.camera) this.setScene(this.scene, this.camera, this.sceneVersion + 1)
      })
  }

  /** The worker build failed or timed out: drop the worker and the tracer whose generator is stuck in
   *  "building"; the pipeline re-creates the tracer (no texture) and builds on the main thread. */
  private recoverWithoutWorker(): void {
    console.warn('[cadsandbox/render] BVH worker unavailable — path tracer scenes are built on the main thread from now on')
    this.workerDisabled = true
    try {
      this.bvhWorker?.dispose()
    } catch {
      /* ignore */
    }
    this.bvhWorker = null
    try {
      this.tracer?.dispose()
    } catch {
      /* ignore */
    }
    this.tracer = null
    this.sceneVersion = -1
    this.buildQueued = false
    this.building = null
  }

  /**
   * Render size = viewport region (device px). WebGLPathTracer only sizes itself from the drawing
   * buffer, which is wrong for scissored viewports, so the internal tracers are sized directly.
   */
  setSize(width: number, height: number): void {
    const pt = this.ensure()
    if (!pt) return
    if (width === this.width && height === this.height) return
    this.width = width
    this.height = height
    // Path tracing is fill-rate bound: cap the traced resolution (~1.5 MP) and split each sample into
    // tiles so no single frame monopolizes the GPU — the UI stays responsive while it converges.
    const px = Math.max(1, width * height)
    pt.renderScale = Math.min(1, Math.sqrt(1.5e6 / px))
    const tiles = px > 3e6 ? 3 : 2
    pt.tiles.set(tiles, tiles)
    const inner = pt as unknown as { _pathTracer?: { setSize(w: number, h: number): void }; _lowResPathTracer?: { setSize(w: number, h: number): void } }
    if (inner._pathTracer && inner._lowResPathTracer) {
      pt.synchronizeRenderSize = false
      const w = Math.max(1, Math.floor(width * pt.renderScale))
      const h = Math.max(1, Math.floor(height * pt.renderScale))
      inner._pathTracer.setSize(w, h)
      inner._lowResPathTracer.setSize(Math.max(1, Math.floor(w * pt.lowResScale)), Math.max(1, Math.floor(h * pt.lowResScale)))
    } else pt.synchronizeRenderSize = true
    pt.reset()
  }

  /** Render one progressive sample. Returns false when nothing could be rendered (fallback). */
  renderSample(camera: THREE.Camera, cameraVersion: number): boolean {
    const pt = this.ensure()
    if (!pt || this.building || !pt.scene) return false
    if (camera !== pt.camera) {
      pt.setCamera(camera)
      pt.reset()
    } else if (cameraVersion !== this.lastCameraVersion) {
      pt.updateCamera()
    }
    this.lastCameraVersion = cameraVersion
    if (pt.samples < this.targetSamples) pt.renderSample()
    return pt.samples > 0
  }

  get converged(): boolean {
    return !!this.tracer && this.tracer.samples >= this.targetSamples
  }

  reset(): void {
    this.tracer?.reset()
  }

  updateMaterials(): void {
    this.tracer?.updateMaterials()
  }

  updateEnvironment(): void {
    if (this.tracer && this.scene) this.withTracerEnvironment(this.scene, () => this.tracer!.updateEnvironment())
  }

  dispose(): void {
    this.disposed = true
    this.tracer?.dispose()
    this.tracer = null
    this.bvhWorker?.dispose()
    this.bvhWorker = null
  }
}
