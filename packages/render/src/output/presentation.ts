// Presentation helpers: sun-study animation (plays the document's sun over a day), turntable /
// walkthrough video export (canvas capture → MediaRecorder → WebM) and WebXR "View in VR". Built on
// the public Editor API plus a few engine internals (canvas, renderer, scene, render loop) that the
// EditorImpl exposes as readonly fields.
import * as THREE from 'three'
import type { CameraState, Vec3, ViewDef } from '@cadsandbox/doc'
import type { Editor } from '../api'
import type { RenderContext } from '../renderer/context'
import type { SunOverride } from '../renderer/lights'

interface EditorInternals {
  ctx: RenderContext
  scene: THREE.Scene
  requestRender(): void
  activeLevelElevation(): number
  setSunOverride(override: SunOverride | null): void
}
const internals = (editor: Editor): EditorInternals => editor as unknown as EditorInternals

// ------------------------------------------------------------------ sun study
export interface SunStudyOptions {
  /** Start hour (default 6) and end hour (default 20), local time of the document's location */
  from?: number
  to?: number
  /** Playback speed (default 1.5 h per real second) */
  hoursPerSecond?: number
  /** Restart at `from` after reaching `to` (default true) */
  loop?: boolean
  onTick?: (hour: number) => void
}

export interface SunStudy {
  readonly running: boolean
  setSpeed(hoursPerSecond: number): void
  /** Stops and restores the document's sun settings. */
  stop(): void
}

/**
 * Animate the sun between two hours. The animation is an editor-local override of the document's
 * sun (lighting reads it while the study runs) — the shared document is never written, so it works
 * in read-only sessions and never disturbs collaborators; the document's sun is back on stop.
 */
export function startSunStudy(editor: Editor, opts: SunStudyOptions = {}): SunStudy {
  const engine = internals(editor)
  const from = opts.from ?? 6
  const to = Math.max(from + 0.25, opts.to ?? 20)
  let speed = opts.hoursPerSecond ?? 1.5
  let hour = from
  let running = true
  let raf = 0
  let last = performance.now()
  const write = (h: number, _force = false) => {
    engine.setSunOverride({ hour: Math.round(h * 100) / 100 })
  }
  const stop = () => {
    if (!running) return
    running = false
    cancelAnimationFrame(raf)
    engine.setSunOverride(null)
  }
  const tick = (now: number) => {
    if (!running) return
    const dt = Math.min(0.25, (now - last) / 1000)
    last = now
    hour += dt * speed
    if (hour > to) {
      if (opts.loop ?? true) hour = from
      else {
        write(to, true)
        opts.onTick?.(to)
        stop()
        return
      }
    }
    write(hour)
    opts.onTick?.(hour)
    raf = requestAnimationFrame(tick)
  }
  write(hour, true)
  raf = requestAnimationFrame(tick)
  return {
    get running() {
      return running
    },
    setSpeed(v) {
      speed = Math.max(0.05, v)
    },
    stop,
  }
}

// ------------------------------------------------------------------ video
export interface VideoOptions {
  kind: 'turntable' | 'walkthrough'
  /** Seconds (default 10) */
  durationS?: number
  /** Capture frame rate (default 30) */
  fps?: number
  /** Walkthrough: camera keys in order (default: the document's saved views) */
  views?: ViewDef[]
  /** Turntable: orbit center (default: the current camera target) and radius (default: current distance) */
  center?: Vec3
  radius?: number
  /** Turntable: revolutions during the clip (default 1) */
  turns?: number
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

/** Best WebM MIME type MediaRecorder supports here, or null when recording is unavailable. */
export function videoMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  for (const t of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']) if (MediaRecorder.isTypeSupported(t)) return t
  return null
}

const smoothstep = (t: number) => t * t * (3 - 2 * t)
const toV = (p: Vec3) => new THREE.Vector3(p[0], p[1], p[2])
const fromV = (v: THREE.Vector3): Vec3 => [v.x, v.y, v.z]

/** Camera along the clip at t ∈ [0, 1]. */
function cameraPath(start: CameraState, opts: VideoOptions, views: ViewDef[]): (t: number) => CameraState {
  if (opts.kind === 'turntable') {
    const center = opts.center ?? start.target
    const dx = start.position[0] - center[0], dy = start.position[1] - center[1]
    const radius = opts.radius ?? Math.max(0.5, Math.hypot(dx, dy))
    const a0 = Math.atan2(dy, dx)
    const turns = opts.turns ?? 1
    return (t) => {
      const a = a0 + t * turns * Math.PI * 2
      return { ...start, position: [center[0] + Math.cos(a) * radius, center[1] + Math.sin(a) * radius, start.position[2]], target: [center[0], center[1], center[2]] }
    }
  }
  const keys = views.map((v) => v.camera)
  if (keys.length < 2) throw new Error('Save at least two views (Views panel) to record a walkthrough')
  const pos = new THREE.CatmullRomCurve3(keys.map((k) => toV(k.position)), false, 'centripetal')
  const tgt = new THREE.CatmullRomCurve3(keys.map((k) => toV(k.target)), false, 'centripetal')
  const n = keys.length - 1
  return (t) => {
    // ease within each segment so the camera rests briefly at every saved view
    const s = Math.min(n - 1e-9, t * n)
    const i = Math.floor(s)
    const u = (i + smoothstep(s - i)) / n
    const k0 = keys[i]!, k1 = keys[Math.min(n, i + 1)]!
    const f = smoothstep(s - i)
    return { position: fromV(pos.getPoint(u)), target: fromV(tgt.getPoint(u)), up: [0, 0, 1], fov: k0.fov + (k1.fov - k0.fov) * f, projection: 'perspective' }
  }
}

/**
 * Record the active viewport while the camera travels a turntable orbit or a walkthrough through the
 * saved views. Resolves with a WebM blob; the camera returns to where it was.
 */
export async function recordVideo(editor: Editor, opts: VideoOptions): Promise<Blob> {
  const type = videoMimeType()
  const { ctx } = internals(editor)
  const canvas = ctx.canvas as HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream }
  if (!type || typeof canvas.captureStream !== 'function') throw new Error('Video recording is not supported in this browser')
  const fps = Math.max(1, Math.min(60, opts.fps ?? 30))
  const duration = Math.max(1, opts.durationS ?? 10) * 1000
  const start = editor.getCamera()
  const path = cameraPath(start, opts, opts.views ?? editor.doc.listViews())
  const stream = canvas.captureStream(fps)
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 12_000_000 })
  const chunks: Blob[] = []
  const release = ctx.acquireContinuous()
  editor.setCamera(path(0), false)
  return new Promise<Blob>((resolve, reject) => {
    let raf = 0
    const finish = () => {
      cancelAnimationFrame(raf)
      release()
      for (const tr of stream.getTracks()) tr.stop()
      editor.setCamera(start, false)
    }
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data)
    }
    rec.onstop = () => {
      finish()
      resolve(new Blob(chunks, { type }))
    }
    rec.onerror = () => {
      finish()
      reject(new Error('Video recording failed'))
    }
    rec.start(250)
    const t0 = performance.now()
    const step = (now: number) => {
      if (opts.signal?.aborted) {
        rec.stop()
        return
      }
      const t = Math.min(1, (now - t0) / duration)
      editor.setCamera(path(t), false)
      opts.onProgress?.(t)
      if (t < 1) raf = requestAnimationFrame(step)
      else setTimeout(() => rec.stop(), 300) // let the last frames reach the encoder
    }
    raf = requestAnimationFrame(step)
  })
}

// ------------------------------------------------------------------ WebXR
type XRNavigator = Navigator & { xr?: XRSystem }

/** True when the browser can start an immersive VR session (headset or emulator connected). */
export async function vrSupported(): Promise<boolean> {
  const xr = (navigator as XRNavigator).xr
  if (!xr) return false
  try {
    return await xr.isSessionSupported('immersive-vr')
  } catch {
    return false
  }
}

export interface VrSession {
  readonly session: XRSession
  end(): Promise<void>
}

/**
 * "View in VR": immersive-vr session with a local-floor reference space. The Z-up scene is rotated into
 * WebXR's Y-up frame and shifted so the user stands at the current camera's plan position on the
 * active level. The editor's render loop is paused for the duration; everything is restored on exit.
 */
export async function startVr(editor: Editor): Promise<VrSession> {
  const xr = (navigator as XRNavigator).xr
  if (!xr) throw new Error('WebXR is not available in this browser')
  const eng = internals(editor)
  const renderer = eng.ctx.renderer
  const scene = eng.scene
  const session = await xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] })
  const resume = eng.ctx.acquirePause()
  const prev = { rot: scene.rotation.clone(), pos: scene.position.clone(), autoClear: renderer.autoClear }
  const cleanup = () => {
    renderer.setAnimationLoop(null)
    renderer.xr.enabled = false
    renderer.autoClear = prev.autoClear
    scene.rotation.copy(prev.rot)
    scene.position.copy(prev.pos)
    resume()
    eng.requestRender()
  }
  try {
    renderer.xr.enabled = true
    renderer.xr.setReferenceSpaceType('local-floor')
    await renderer.xr.setSession(session)
  } catch (e) {
    cleanup()
    throw e
  }
  // Z-up world → Y-up XR: rotate −90° about X maps (x, y, z) → (x, z, −y); then place the camera's plan
  // position on the active level's floor at the XR origin.
  const cam = editor.getCamera()
  const floorZ = eng.activeLevelElevation()
  scene.rotation.set(-Math.PI / 2, 0, 0)
  scene.position.set(-cam.position[0], -floorZ, cam.position[1])
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 1000)
  renderer.autoClear = true
  renderer.setAnimationLoop(() => {
    renderer.setRenderTarget(null)
    renderer.render(scene, camera)
  })
  session.addEventListener('end', cleanup, { once: true })
  return { session, end: () => session.end() }
}
