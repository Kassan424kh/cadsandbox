// Viewport — one camera pair (perspective + orthographic) driven by camera-controls, a CSS rect on the
// shared canvas, an overlay element that receives pointer input, and view-preset logic (Z-up).
import * as THREE from 'three'
import CameraControls from 'camera-controls'
import type { CameraState, RenderMode } from '@cadsandbox/doc'
import type { ViewPreset, ViewportState } from '../api'
import { presetLabel } from '../store'
import { clamp, DEG } from '../util/math'

CameraControls.install({ THREE })

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Base orthographic frustum height (m) at zoom = 1. Visible height = ORTHO_BASE / zoom. */
export const ORTHO_BASE = 10
const POLAR_EPS = 1e-4

/** camera-controls spherical angles for presets (Z-up mapping: θ=0 → camera at -Y, φ from +Z). */
export const PRESET_ANGLES: Record<Exclude<ViewPreset, 'perspective'>, { azimuth: number; polar: number }> = {
  top: { azimuth: 0, polar: POLAR_EPS },
  bottom: { azimuth: Math.PI, polar: Math.PI - POLAR_EPS },
  front: { azimuth: 0, polar: Math.PI / 2 },
  back: { azimuth: Math.PI, polar: Math.PI / 2 },
  right: { azimuth: Math.PI / 2, polar: Math.PI / 2 },
  left: { azimuth: -Math.PI / 2, polar: Math.PI / 2 },
  iso: { azimuth: Math.PI / 4, polar: Math.acos(1 / Math.sqrt(3)) },
}

export class Viewport {
  readonly index: number
  readonly el: HTMLDivElement
  readonly persp: THREE.PerspectiveCamera
  readonly ortho: THREE.OrthographicCamera
  readonly controls: CameraControls
  rect: Rect = { x: 0, y: 0, w: 1, h: 1 }
  projection: 'perspective' | 'orthographic' = 'perspective'
  preset: ViewPreset | 'custom' = 'perspective'
  renderMode: RenderMode = 'shaded'
  planLevel: string | null = null
  section: string | null = null
  labelText = 'Perspective'
  /** Incremented whenever the camera moved (consumers compare to detect motion). */
  cameraVersion = 0
  /**
   * Called when camera-controls starts/continues a gesture or an animated transition. The editor
   * renders on demand, so without this the first frame of an orbit/pan drag would only be requested
   * by some unrelated event (e.g. the pointerup) — the camera appeared blocked until then.
   */
  onControl: (() => void) | null = null
  private lastMatrix = new THREE.Matrix4()
  private lastProjection = new THREE.Matrix4()

  constructor(index: number, parent: HTMLElement, preset: ViewPreset | 'custom' = 'perspective') {
    this.index = index
    this.el = document.createElement('div')
    this.el.className = 'cs-viewport'
    this.el.dataset.viewport = String(index)
    this.el.style.cssText = 'position:absolute;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none;'
    parent.appendChild(this.el)

    this.persp = new THREE.PerspectiveCamera(50, 1, 0.05, 5000)
    this.ortho = new THREE.OrthographicCamera(-ORTHO_BASE / 2, ORTHO_BASE / 2, ORTHO_BASE / 2, -ORTHO_BASE / 2, -2000, 2000)
    this.persp.up.set(0, 0, 1)
    this.ortho.up.set(0, 0, 1)
    this.persp.position.set(8, -10, 6)
    this.ortho.position.set(8, -10, 6)

    this.controls = new CameraControls(this.persp)
    this.controls.smoothTime = 0.12
    this.controls.draggingSmoothTime = 0.04
    this.controls.dollyToCursor = true
    this.controls.infinityDolly = true
    this.controls.minDistance = 0.02
    this.controls.maxDistance = 50000
    this.controls.minZoom = 1e-4
    this.controls.maxZoom = 1e5
    this.controls.dollySpeed = 0.9
    this.controls.truckSpeed = 2
    this.controls.azimuthRotateSpeed = 0.8
    this.controls.polarRotateSpeed = 0.8
    this.controls.minPolarAngle = 0
    this.controls.maxPolarAngle = Math.PI
    this.controls.dollyDragInverted = false
    this.controls.setLookAt(8, -10, 6, 0, 0, 0.6, false)
    const wake = () => this.onControl?.()
    this.controls.addEventListener('controlstart', wake)
    this.controls.addEventListener('control', wake)
    this.controls.addEventListener('transitionstart', wake)
    this.controls.addEventListener('wake', wake)
    this.applyPreset(preset, null, false)
  }

  get camera(): THREE.Camera {
    return this.projection === 'perspective' ? this.persp : this.ortho
  }

  get isOrtho(): boolean {
    return this.projection === 'orthographic'
  }

  get isPlanView(): boolean {
    return this.projection === 'orthographic' && (this.preset === 'top' || this.planLevel !== null)
  }

  setRect(r: Rect): void {
    this.rect = { ...r }
    this.el.style.left = `${r.x}px`
    this.el.style.top = `${r.y}px`
    this.el.style.width = `${r.w}px`
    this.el.style.height = `${r.h}px`
    const aspect = r.w / Math.max(1, r.h)
    this.persp.aspect = aspect
    this.persp.updateProjectionMatrix()
    this.ortho.left = (-ORTHO_BASE / 2) * aspect
    this.ortho.right = (ORTHO_BASE / 2) * aspect
    this.ortho.updateProjectionMatrix()
    // camera-controls needs the region for dolly-to-cursor; it expects canvas-relative CSS px
    this.controls.setViewport(r.x, r.y, r.w, r.h)
  }

  /** Attach input handling for orbit/pan/zoom to the overlay element. */
  connect(): void {
    this.controls.connect(this.el)
    this.setNavigationButtons('select')
  }

  /** Mouse button mapping per tool. Tools receive left-button events; camera uses right/middle. */
  setNavigationButtons(tool: 'select' | 'pan' | 'orbit' | 'none', spaceHeld = false): void {
    const A = CameraControls.ACTION
    const mb = this.controls.mouseButtons
    const zoomAction = this.isOrtho ? A.ZOOM : A.DOLLY
    mb.right = A.ROTATE
    mb.middle = A.TRUCK
    mb.wheel = zoomAction
    if (spaceHeld || tool === 'pan') mb.left = A.TRUCK
    else if (tool === 'orbit') mb.left = this.isOrtho ? A.TRUCK : A.ROTATE
    else mb.left = A.NONE
    const t = this.controls.touches
    t.one = tool === 'pan' ? A.TOUCH_TRUCK : tool === 'orbit' && !this.isOrtho ? A.TOUCH_ROTATE : A.NONE
    t.two = this.isOrtho ? A.TOUCH_ZOOM_TRUCK : A.TOUCH_DOLLY_TRUCK
    t.three = A.TOUCH_TRUCK
    // Plan/ortho views should not orbit with the right button in 2D-only layouts; keep orbit available
    // (users can tilt out of a plan) but lock plan views to their preset until they drag.
  }

  /** Per-gesture right-button mapping (set on pointerdown, before camera-controls reads it). */
  setRightButtonAction(action: 'orbit' | 'pan'): void {
    const A = CameraControls.ACTION
    this.controls.mouseButtons.right = action === 'pan' ? A.TRUCK : A.ROTATE
  }

  /** Returns true when the camera moved this frame. */
  update(dt: number): boolean {
    const updated = this.controls.update(dt)
    const cam = this.camera
    cam.updateMatrixWorld()
    const moved = !this.lastMatrix.equals(cam.matrixWorld) || !this.lastProjection.equals(cam.projectionMatrix)
    if (moved) {
      this.lastMatrix.copy(cam.matrixWorld)
      this.lastProjection.copy(cam.projectionMatrix)
      this.cameraVersion++
      if (this.preset !== 'custom' && !this.isOrtho && this.preset !== 'perspective' && this.preset !== 'iso') this.preset = 'custom'
    }
    return updated || moved
  }

  /** Fit near/far planes around scene bounds to keep depth precision (works with reversed-Z too). */
  fitDepthRange(bounds: THREE.Box3 | null): void {
    const cam = this.camera
    const pos = cam.getWorldPosition(_pos)
    let far = 1000
    let near = 0.05
    if (bounds && !bounds.isEmpty()) {
      const center = bounds.getCenter(_center)
      const radius = Math.max(0.5, bounds.getSize(_size).length() / 2)
      const dist = pos.distanceTo(center)
      far = dist + radius * 2 + 10
      near = Math.max(0.005, (dist - radius) * 0.5)
      near = Math.min(near, 1)
    }
    if (cam instanceof THREE.PerspectiveCamera) {
      // The ground grid must reach the horizon: a far plane fitted to the scene bounds cuts the
      // ground at a hard horizontal line when the camera is far out. Depth is reversed-Z (float) or
      // logarithmic, so a huge far costs no precision; near still tracks the scene.
      far = Math.max(far, 1e5, pos.length() * 10)
      if (Math.abs(cam.near - near) > 1e-6 || Math.abs(cam.far - far) > 1e-3) {
        cam.near = near
        cam.far = far
        cam.updateProjectionMatrix()
      }
    } else if (cam instanceof THREE.OrthographicCamera) {
      const range = Math.max(far, 100)
      if (Math.abs(cam.far - range) > 1e-3) {
        cam.near = -range
        cam.far = range
        cam.updateProjectionMatrix()
      }
    }
  }

  applyPreset(preset: ViewPreset | 'custom', bounds: THREE.Box3 | null, animate: boolean): void {
    this.preset = preset
    if (preset === 'custom') return
    const wantOrtho = preset !== 'perspective'
    if (wantOrtho !== this.isOrtho) this.setProjection(wantOrtho ? 'orthographic' : 'perspective', false)
    if (preset === 'perspective') {
      const iso = PRESET_ANGLES.iso
      void this.controls.rotateTo(iso.azimuth, iso.polar, animate)
    } else {
      const a = PRESET_ANGLES[preset]
      void this.controls.rotateTo(a.azimuth, a.polar, animate)
    }
    if (bounds && !bounds.isEmpty()) this.fit(bounds, animate)
    this.labelText = presetLabel(preset)
  }

  setProjection(projection: 'perspective' | 'orthographic', animate: boolean): void {
    if (projection === this.projection) return
    const from = this.camera
    from.updateMatrixWorld()
    const target = this.controls.getTarget(_target, true)
    const position = this.controls.getPosition(_pos, true)
    const distance = position.distanceTo(target)
    const tanHalf = Math.tan((this.persp.fov / 2) * DEG)
    if (projection === 'orthographic') {
      // keep framing: visible height at the target distance
      const visibleHeight = 2 * distance * tanHalf
      this.ortho.zoom = ORTHO_BASE / Math.max(1e-6, visibleHeight)
      this.ortho.updateProjectionMatrix()
      this.controls.camera = this.ortho
      this.controls.updateCameraUp()
      void this.controls.zoomTo(this.ortho.zoom, false)
    } else {
      const visibleHeight = ORTHO_BASE / this.ortho.zoom
      const dist = visibleHeight / (2 * tanHalf)
      const dir = _dir.copy(position).sub(target).normalize()
      const p = _p2.copy(target).addScaledVector(dir, dist)
      this.controls.camera = this.persp
      this.controls.updateCameraUp()
      void this.controls.setLookAt(p.x, p.y, p.z, target.x, target.y, target.z, false)
    }
    this.projection = projection
    void animate
    this.cameraVersion++
    if (projection === 'perspective' && this.preset !== 'iso') this.preset = 'perspective'
    this.labelText = presetLabel(this.preset)
    this.setNavigationButtons('select')
  }

  fit(bounds: THREE.Box3, animate: boolean, padding = 1.15): void {
    if (bounds.isEmpty()) return
    const sphere = bounds.getBoundingSphere(_sphere)
    sphere.radius = Math.max(0.01, sphere.radius * padding)
    if (this.isOrtho) {
      const size = bounds.getSize(_size)
      // fit the projected box: approximate with sphere in ortho
      const h = Math.max(size.length() * 0.9, 0.02) * padding
      const zoom = ORTHO_BASE / h
      void this.controls.zoomTo(zoom, animate)
      void this.controls.moveTo(sphere.center.x, sphere.center.y, sphere.center.z, animate)
    } else {
      void this.controls.fitToSphere(sphere, animate)
    }
  }

  getCameraState(): CameraState {
    const target = this.controls.getTarget(_target, true)
    const position = this.controls.getPosition(_pos, true)
    return {
      position: [position.x, position.y, position.z],
      target: [target.x, target.y, target.z],
      up: [0, 0, 1],
      fov: this.persp.fov,
      projection: this.projection,
      orthoHeight: this.isOrtho ? ORTHO_BASE / this.ortho.zoom : undefined,
    }
  }

  setCameraState(s: CameraState, animate: boolean): void {
    if (s.projection !== this.projection) this.setProjection(s.projection, false)
    if (typeof s.fov === 'number' && s.fov > 1 && s.fov < 179 && s.fov !== this.persp.fov) {
      this.persp.fov = s.fov
      this.persp.updateProjectionMatrix()
    }
    void this.controls.setLookAt(s.position[0], s.position[1], s.position[2], s.target[0], s.target[1], s.target[2], animate)
    if (this.isOrtho && s.orthoHeight && s.orthoHeight > 0) void this.controls.zoomTo(ORTHO_BASE / s.orthoHeight, animate)
    this.preset = 'custom'
    this.labelText = presetLabel('custom')
  }

  /** World meters per CSS pixel at a world point. */
  worldPerPixel(point: THREE.Vector3): number {
    if (this.isOrtho) return ORTHO_BASE / this.ortho.zoom / Math.max(1, this.rect.h)
    const dist = _pos.copy(point).sub(this.persp.getWorldPosition(_p2)).dot(this.persp.getWorldDirection(_dir))
    const h = 2 * Math.max(0.001, Math.abs(dist)) * Math.tan((this.persp.fov / 2) * DEG)
    return h / Math.max(1, this.rect.h)
  }

  /** Client → NDC within this viewport. */
  ndc(clientX: number, clientY: number, containerRect: DOMRect, out: THREE.Vector2): THREE.Vector2 {
    const x = clientX - containerRect.left - this.rect.x
    const y = clientY - containerRect.top - this.rect.y
    return out.set((x / this.rect.w) * 2 - 1, -(y / this.rect.h) * 2 + 1)
  }

  contains(x: number, y: number): boolean {
    return x >= this.rect.x && x < this.rect.x + this.rect.w && y >= this.rect.y && y < this.rect.y + this.rect.h
  }

  /** Project a world point to viewport-local CSS px. Returns false when behind the camera. */
  project(world: THREE.Vector3, out: THREE.Vector2): boolean {
    _p2.copy(world).project(this.camera)
    out.set(((_p2.x + 1) / 2) * this.rect.w, ((1 - _p2.y) / 2) * this.rect.h)
    if (this.isOrtho) return true
    return _p2.z < 1 && _p2.z > -1 || (this.camera as THREE.PerspectiveCamera).getWorldDirection(_dir).dot(_pos.copy(world).sub(this.camera.getWorldPosition(_center))) > 0
  }

  toState(): ViewportState {
    return {
      index: this.index,
      preset: this.preset,
      projection: this.projection,
      renderMode: this.renderMode,
      label: this.labelText,
      planLevel: this.planLevel,
      section: this.section,
    }
  }

  /** Slightly tilt away from the exact pole so orbiting out of a top view works. */
  clampPolar(): void {
    const sph = this.controls.getSpherical(_sph, true)
    if (sph.phi < POLAR_EPS) void this.controls.rotatePolarTo(POLAR_EPS, false)
    if (sph.phi > Math.PI - POLAR_EPS) void this.controls.rotatePolarTo(Math.PI - POLAR_EPS, false)
    void clamp
  }

  dispose(): void {
    this.controls.disconnect()
    this.controls.dispose()
    this.el.remove()
  }
}

const _pos = new THREE.Vector3()
const _target = new THREE.Vector3()
const _center = new THREE.Vector3()
const _size = new THREE.Vector3()
const _dir = new THREE.Vector3()
const _p2 = new THREE.Vector3()
const _sphere = new THREE.Sphere()
const _sph = new THREE.Spherical()
