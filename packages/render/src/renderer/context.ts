// RenderContext — the single WebGL2 renderer, canvas sizing (ResizeObserver), render-on-demand loop
// with adaptive device pixel ratio, context loss/restore and frame statistics.
import * as THREE from 'three'
import type { GpuInfo, TierSettings } from './quality'
import { Emitter } from '../util/emitter'

export interface FrameInfo {
  /** Seconds since the previous frame (clamped). */
  dt: number
  /** Timestamp (ms) */
  now: number
  /** True while a camera or drag is in motion (reduced DPR). */
  moving: boolean
}

export interface ContextEvents extends Record<string, unknown> {
  resize: { width: number; height: number }
  contextlost: undefined
  contextrestored: undefined
  frame: FrameInfo
}

export interface FrameStats {
  fps: number
  frameMs: number
  triangles: number
  drawCalls: number
}

export class RenderContext {
  readonly container: HTMLElement
  readonly canvas: HTMLCanvasElement
  readonly renderer: THREE.WebGLRenderer
  readonly events = new Emitter<ContextEvents>()
  readonly gpu: GpuInfo
  tier: TierSettings
  /** CSS pixel size of the canvas. */
  width = 1
  height = 1
  /** Whether the reversed-Z depth buffer is active (EXT_clip_control). */
  readonly reversedDepth: boolean
  lost = false
  /** CSS px offset of the view cube from the viewport's top-left corner (the UI keeps it clear of its chrome). */
  viewCubeOffset = { top: 12, left: 12 }

  private pending = false
  private rafHandle = 0
  private lastTime = 0
  private moving = false
  private movingUntil = 0
  private currentDpr = 1
  private resizeObserver: ResizeObserver | null = null
  private frameTimes: number[] = []
  private statsAcc = { frames: 0, ms: 0, last: 0 }
  readonly stats: FrameStats = { fps: 0, frameMs: 0, triangles: 0, drawCalls: 0 }
  /** Continuous rendering requests (path tracing, animations) keep the loop alive while > 0. */
  private continuous = 0
  /** Pause requests (WebXR sessions) — frames are skipped while > 0. */
  private paused = 0
  private disposed = false

  constructor(container: HTMLElement, gpu: GpuInfo, tier: TierSettings) {
    this.container = container
    this.gpu = gpu
    this.tier = tier
    const canvas = document.createElement('canvas')
    canvas.className = 'cs-editor-canvas'
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;outline:none;'
    canvas.tabIndex = -1
    this.canvas = canvas
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative'
    container.appendChild(canvas)

    const params: THREE.WebGLRendererParameters & { reversedDepthBuffer?: boolean } = {
      canvas,
      antialias: tier.msaa > 0,
      alpha: true,
      premultipliedAlpha: true,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
      reversedDepthBuffer: gpu.clipControl,
      // without EXT_clip_control fall back to a logarithmic depth buffer for the 1 mm – 10 km range
      logarithmicDepthBuffer: !gpu.clipControl,
    }
    this.renderer = new THREE.WebGLRenderer(params)
    const caps = this.renderer.capabilities as THREE.WebGLCapabilities & { reversedDepthBuffer?: boolean }
    this.reversedDepth = caps.reversedDepthBuffer === true
    this.renderer.autoClear = false
    this.renderer.info.autoReset = false
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.AgXToneMapping
    this.renderer.toneMappingExposure = 1
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = tier.softShadows ? THREE.PCFShadowMap : THREE.PCFShadowMap
    this.renderer.localClippingEnabled = true
    this.renderer.setClearColor(0x000000, 0)
    this.currentDpr = tier.dprCap
    this.renderer.setPixelRatio(this.currentDpr)

    canvas.addEventListener('webglcontextlost', this.onLost, false)
    canvas.addEventListener('webglcontextrestored', this.onRestored, false)

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()
  }

  /** Re-read the container size (also public via Editor.resize()). */
  resize(): void {
    const w = Math.max(1, Math.floor(this.container.clientWidth))
    const h = Math.max(1, Math.floor(this.container.clientHeight))
    if (w === this.width && h === this.height) return
    this.width = w
    this.height = h
    this.applyDpr(true) // DPR budget depends on the canvas size; also resizes + emits 'resize'
    this.requestRender()
  }

  setTier(tier: TierSettings): void {
    this.tier = tier
    this.applyDpr(true)
    this.requestRender()
  }

  /** Schedule a frame (idempotent). */
  requestRender(): void {
    if (this.pending || this.disposed || this.lost) return
    this.pending = true
    this.rafHandle = requestAnimationFrame(this.tick)
  }

  /** Mark motion for `ms` (drives adaptive DPR) and request a frame. */
  notifyMotion(ms = 120): void {
    this.movingUntil = Math.max(this.movingUntil, performance.now() + ms)
    if (!this.moving) {
      this.moving = true
      this.applyDpr()
    }
    this.requestRender()
  }

  get isMoving(): boolean {
    return this.moving
  }

  /** Suspend the on-demand loop (e.g. while a WebXR session owns the renderer's animation loop).
   *  The returned release function resumes it and schedules a frame. */
  acquirePause(): () => void {
    this.paused++
    let released = false
    return () => {
      if (released) return
      released = true
      this.paused--
      if (this.paused === 0) this.requestRender()
    }
  }

  /** Keep rendering every frame while the returned release function has not been called. */
  acquireContinuous(): () => void {
    this.continuous++
    this.requestRender()
    let released = false
    return () => {
      if (released) return
      released = true
      this.continuous--
    }
  }

  private applyDpr(force = false): void {
    // Resolution stays FIXED while navigating: switching the DPR per gesture reallocated every render
    // target (MSAA, AO, outline, path tracer) twice per move → multi-second stalls on hi-DPI screens.
    // Motion cost is reduced by skipping expensive passes instead (see Pipeline, ctx.isMoving).
    // Fill-rate budget: large hi-DPI canvases (e.g. 2000×1400 CSS px at DPR 2 = 11 MP) are capped to
    // ~5.5 MP; MSAA keeps edges crisp. Recomputed on resize only.
    const cssPx = Math.max(1, this.width * this.height)
    const target = Math.min(this.tier.dprCap, Math.max(1, Math.sqrt(5.5e6 / cssPx)))
    if (!force && Math.abs(target - this.currentDpr) < 0.01) return
    this.currentDpr = target
    this.renderer.setPixelRatio(target)
    this.renderer.setSize(this.width, this.height, false)
    this.events.emit('resize', { width: this.width, height: this.height })
  }

  get pixelRatio(): number {
    return this.currentDpr
  }

  private tick = (now: number): void => {
    this.pending = false
    this.rafHandle = 0
    if (this.disposed || this.lost) return
    if (this.paused > 0) return // a WebXR session drives the renderer's own animation loop
    const dt = this.lastTime ? Math.min(0.1, (now - this.lastTime) / 1000) : 1 / 60
    this.lastTime = now
    if (this.moving && now > this.movingUntil) {
      this.moving = false
      this.applyDpr()
      // one more frame at full resolution
      this.requestRender()
    }
    const start = performance.now()
    this.renderer.info.reset()
    this.events.emit('frame', { dt, now, moving: this.moving })
    const ms = performance.now() - start
    this.accumulateStats(now, ms)
    if (this.continuous > 0 || this.moving) this.requestRender()
  }

  private accumulateStats(now: number, ms: number): void {
    this.statsAcc.frames++
    this.statsAcc.ms += ms
    this.frameTimes.push(now)
    while (this.frameTimes.length && now - this.frameTimes[0]! > 1000) this.frameTimes.shift()
    this.stats.fps = this.frameTimes.length
    this.stats.frameMs = ms
    this.stats.triangles = this.renderer.info.render.triangles
    this.stats.drawCalls = this.renderer.info.render.calls
  }

  private onLost = (e: Event): void => {
    e.preventDefault()
    this.lost = true
    if (this.rafHandle) cancelAnimationFrame(this.rafHandle)
    this.rafHandle = 0
    this.pending = false
    this.events.emit('contextlost', undefined)
  }

  private onRestored = (): void => {
    this.lost = false
    this.events.emit('contextrestored', undefined)
    this.requestRender()
  }

  /** Device-pixel viewport/scissor for a CSS-pixel rect (WebGL origin is bottom-left). */
  setRegion(x: number, y: number, w: number, h: number): void {
    const r = this.renderer
    r.setViewport(x, this.height - y - h, w, h)
    r.setScissor(x, this.height - y - h, w, h)
    r.setScissorTest(true)
  }

  clearRegion(color: THREE.Color, alpha: number): void {
    this.renderer.setClearColor(color, alpha)
    this.renderer.clear(true, true, true)
  }

  dispose(): void {
    this.disposed = true
    if (this.rafHandle) cancelAnimationFrame(this.rafHandle)
    this.resizeObserver?.disconnect()
    this.canvas.removeEventListener('webglcontextlost', this.onLost)
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored)
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.canvas.remove()
    this.events.clear()
  }
}
