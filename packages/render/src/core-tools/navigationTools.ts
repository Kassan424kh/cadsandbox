// Pan / orbit / zoom-window / walk tools.
import * as THREE from 'three'
import type { Tool, ToolContext, ToolPointerEvent } from '../tools/types'
import type { CoreToolDeps } from './deps'
import { normalizeRect } from '../picking/boxSelect'
import { intersectRayPlane } from '../util/math'

export class PanTool implements Tool {
  readonly id = 'pan' as const
  activate(ctx: ToolContext): void {
    ctx.setHint('Drag to pan · wheel to zoom · Esc back to select')
    ctx.setCursor('grab')
  }
  deactivate(): void {}
}

export class OrbitTool implements Tool {
  readonly id = 'orbit' as const
  activate(ctx: ToolContext): void {
    ctx.setHint('Drag to orbit · wheel to zoom · Esc back to select')
    ctx.setCursor('move')
  }
  deactivate(): void {}
}

export class ZoomWindowTool implements Tool {
  readonly id = 'zoom-window' as const
  private d: CoreToolDeps
  private ctx!: ToolContext
  private start: ToolPointerEvent | null = null
  constructor(d: CoreToolDeps) {
    this.d = d
  }
  activate(ctx: ToolContext): void {
    this.ctx = ctx
    ctx.setHint('Drag a rectangle to zoom into it')
    ctx.setCursor('zoom-in')
  }
  deactivate(): void {
    for (const vp of this.d.core.viewports.viewports) this.d.overlay.showRect(vp, null)
    this.start = null
  }
  onPointerDown(e: ToolPointerEvent): boolean {
    if (e.button !== 0) return false
    this.start = e
    return true
  }
  onPointerMove(e: ToolPointerEvent): void {
    if (!this.start) return
    const vp = this.d.core.viewports.at(e.viewport)
    const r = this.d.core.ctx.container.getBoundingClientRect()
    this.d.overlay.showRect(vp, { x0: this.start.clientX - r.left - vp.rect.x, y0: this.start.clientY - r.top - vp.rect.y, x1: e.clientX - r.left - vp.rect.x, y1: e.clientY - r.top - vp.rect.y })
  }
  onPointerUp(e: ToolPointerEvent): boolean {
    const s = this.start
    this.start = null
    if (!s) return false
    const vp = this.d.core.viewports.at(e.viewport)
    this.d.overlay.showRect(vp, null)
    const r = this.d.core.ctx.container.getBoundingClientRect()
    const rect = normalizeRect(s.clientX - r.left - vp.rect.x, s.clientY - r.top - vp.rect.y, e.clientX - r.left - vp.rect.x, e.clientY - r.top - vp.rect.y)
    if (rect.maxX - rect.minX < 4 || rect.maxY - rect.minY < 4) {
      this.ctx.setTool('select')
      return true
    }
    // plane through the camera target facing the camera; unproject the rect corners
    const target = vp.controls.getTarget(new THREE.Vector3(), true)
    const normal = vp.camera.getWorldDirection(new THREE.Vector3()).negate()
    const box = new THREE.Box3()
    const ray = new THREE.Raycaster()
    for (const [px, py] of [[rect.minX, rect.minY], [rect.maxX, rect.minY], [rect.maxX, rect.maxY], [rect.minX, rect.maxY]] as const) {
      _ndc.set((px / vp.rect.w) * 2 - 1, -(py / vp.rect.h) * 2 + 1)
      ray.setFromCamera(_ndc, vp.camera)
      const p = intersectRayPlane(ray.ray.origin, ray.ray.direction, target, normal, new THREE.Vector3(), true)
      if (p) box.expandByPoint(p)
    }
    if (!box.isEmpty()) {
      const size = box.getSize(new THREE.Vector3())
      box.expandByVector(normal.clone().multiplyScalar(Math.max(size.x, size.y, size.z) * 0.01 + 1e-3))
      void vp.controls.fitToBox(box, true, { cover: true })
      this.d.core.notifyMotion(500)
    }
    this.ctx.setTool('select')
    return true
  }
  onCancel(): boolean {
    if (this.start) {
      this.start = null
      for (const vp of this.d.core.viewports.viewports) this.d.overlay.showRect(vp, null)
      return true
    }
    return false
  }
}

const EYE_HEIGHT = 1.65

export class WalkTool implements Tool {
  readonly id = 'walk' as const
  private d: CoreToolDeps
  private ctx!: ToolContext
  private keys = new Set<string>()
  private yaw = 0
  private pitch = 0
  private position = new THREE.Vector3()
  private raf = 0
  private lastTime = 0
  private look: { x: number; y: number } | null = null
  private vpIndex = 0
  private onKeyUp = (ev: KeyboardEvent) => this.keys.delete(ev.code)

  constructor(d: CoreToolDeps) {
    this.d = d
  }

  activate(ctx: ToolContext): void {
    this.ctx = ctx
    const vp = this.d.core.viewports.activeViewport
    this.vpIndex = vp.index
    if (vp.isOrtho) vp.setProjection('perspective', false)
    vp.controls.enabled = false
    const cam = vp.persp
    cam.getWorldPosition(this.position)
    const dir = cam.getWorldDirection(new THREE.Vector3())
    this.yaw = Math.atan2(dir.y, dir.x)
    this.pitch = Math.asin(THREE.MathUtils.clamp(dir.z, -0.99, 0.99))
    const floor = this.d.core.activeLevelElevation()
    this.position.z = floor + EYE_HEIGHT
    this.apply()
    this.d.setWalking(true)
    ctx.setHint('Walk: W A S D / arrows move · drag to look · Shift run · Q/E down/up · Esc exit')
    ctx.setCursor('crosshair')
    window.addEventListener('keyup', this.onKeyUp)
    this.lastTime = performance.now()
    this.loop()
  }

  deactivate(): void {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
    window.removeEventListener('keyup', this.onKeyUp)
    this.keys.clear()
    this.d.setWalking(false)
    const vp = this.d.core.viewports.at(this.vpIndex)
    vp.controls.enabled = true
    const target = this.forward().multiplyScalar(5).add(this.position)
    void vp.controls.setLookAt(this.position.x, this.position.y, this.position.z, target.x, target.y, target.z, false)
    vp.preset = 'custom'
    this.d.core.requestRender()
  }

  private forward(): THREE.Vector3 {
    const cp = Math.cos(this.pitch)
    return new THREE.Vector3(Math.cos(this.yaw) * cp, Math.sin(this.yaw) * cp, Math.sin(this.pitch))
  }

  private apply(): void {
    const vp = this.d.core.viewports.at(this.vpIndex)
    const cam = vp.persp
    cam.position.copy(this.position)
    cam.up.set(0, 0, 1)
    cam.lookAt(_t.copy(this.position).add(this.forward()))
    cam.updateMatrixWorld()
    vp.cameraVersion++
    this.d.core.requestRender()
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop)
    const now = performance.now()
    const dt = Math.min(0.1, (now - this.lastTime) / 1000)
    this.lastTime = now
    if (!this.keys.size) return
    const run = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')
    const speed = (run ? 4.5 : 1.5) * dt
    const f = this.forward()
    f.z = 0
    if (f.lengthSq() < 1e-6) f.set(Math.cos(this.yaw), Math.sin(this.yaw), 0)
    f.normalize()
    const right = new THREE.Vector3(f.y, -f.x, 0)
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) this.position.addScaledVector(f, speed)
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) this.position.addScaledVector(f, -speed)
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.position.addScaledVector(right, speed)
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.position.addScaledVector(right, -speed)
    if (this.keys.has('KeyE')) this.position.z += speed
    if (this.keys.has('KeyQ')) this.position.z -= speed
    this.apply()
    this.d.core.notifyMotion(100)
  }

  onKeyDown(ev: KeyboardEvent): boolean {
    if (ev.key === 'Escape') return false
    if (/^(Key[WASDQE]|Arrow(Up|Down|Left|Right)|Shift(Left|Right))$/.test(ev.code)) {
      this.keys.add(ev.code)
      return true
    }
    return false
  }

  onPointerDown(e: ToolPointerEvent): boolean {
    if (e.button !== 0) return false
    this.look = { x: e.clientX, y: e.clientY }
    return true
  }

  onPointerMove(e: ToolPointerEvent): void {
    if (!this.look || !(e.buttons & 1)) return
    const dx = e.clientX - this.look.x
    const dy = e.clientY - this.look.y
    this.look = { x: e.clientX, y: e.clientY }
    this.yaw -= dx * 0.004
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.004, -1.4, 1.4)
    this.apply()
    this.d.core.notifyMotion(80)
  }

  onPointerUp(): boolean {
    this.look = null
    return true
  }

  onCancel(): boolean {
    return false
  }
}

const _ndc = new THREE.Vector2()
const _t = new THREE.Vector3()
