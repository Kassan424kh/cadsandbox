// 2D bounding-box gizmo for orthographic viewports (SVG overlay): 8 circular handles, a rotate
// handle and size pills ("120 mm" below, height pill rotated on the right) — like the product mock.
// Corner/edge drags scale about the opposite side (Alt: center, Shift: uniform); the rotate
// handle turns the selection about the view axis with angle snapping; pills open a size prompt.
import * as THREE from 'three'
import { formatLength } from '@cadsandbox/shared'
import type { ToolPointerEvent } from '../tools/types'
import type { InteractionLayer } from '../core/toolHost'
import type { Core } from '../core/types'
import type { OverlayLayer } from '../core/overlayLayer'
import type { Viewport } from '../renderer/viewport'
import { TransformSession, rotationAbout, scaleAbout } from './transformSession'
import { intersectRayPlane, roundTo } from '../util/math'

const HANDLE_R = 5
const SVG_NS = 'http://www.w3.org/2000/svg'

type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate'

interface Frame {
  vp: Viewport
  center: THREE.Vector3
  u: THREE.Vector3
  v: THREE.Vector3
  n: THREE.Vector3
  /** half extents along u/v (world) */
  hu: number
  hv: number
  /** screen rect (viewport px) */
  x0: number
  y0: number
  x1: number
  y1: number
}

interface Layer {
  svg: SVGSVGElement
  rect: SVGRectElement
  handles: Map<HandleId, SVGCircleElement>
  stem: SVGLineElement
  widthPill: HTMLDivElement
  heightPill: HTMLDivElement
}

export class BoxGizmo2D implements InteractionLayer {
  private core: Core
  private overlay: OverlayLayer
  private session: TransformSession
  private layers = new Map<number, Layer>()
  private frames = new Map<number, Frame>()
  private drag: { id: HandleId; frame: Frame; start: THREE.Vector3; startAngle: number; label: string | null; anchor: THREE.Vector3; basis: THREE.Matrix4 } | null = null

  constructor(core: Core, overlay: OverlayLayer) {
    this.core = core
    this.overlay = overlay
    this.session = new TransformSession(core.doc, core.sync)
  }

  get dragging(): boolean {
    return this.drag !== null
  }

  private layer(vp: Viewport): Layer {
    let l = this.layers.get(vp.index)
    if (l && l.svg.parentElement === vp.el) return l
    const svg = document.createElementNS(SVG_NS, 'svg')
    svg.setAttribute('class', 'cs-box-gizmo')
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;'
    const rect = document.createElementNS(SVG_NS, 'rect')
    rect.setAttribute('fill', 'none')
    rect.setAttribute('stroke-width', '1.25')
    svg.appendChild(rect)
    const stem = document.createElementNS(SVG_NS, 'line')
    stem.setAttribute('stroke-width', '1.25')
    svg.appendChild(stem)
    const handles = new Map<HandleId, SVGCircleElement>()
    const ids: HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'rotate']
    for (const id of ids) {
      const c = document.createElementNS(SVG_NS, 'circle')
      c.setAttribute('r', String(id === 'rotate' ? HANDLE_R + 1 : HANDLE_R))
      c.setAttribute('stroke-width', '1.5')
      c.style.pointerEvents = 'auto'
      c.style.cursor = id === 'rotate' ? 'grab' : cursorFor(id)
      c.dataset.handle = id
      svg.appendChild(c)
      handles.set(id, c)
    }
    const pill = (rot: boolean) => {
      const d = document.createElement('div')
      d.className = 'cs-size-pill'
      d.dataset.pill = rot ? 'h' : 'w'
      d.style.cssText = `position:absolute;left:0;top:0;pointer-events:auto;cursor:text;padding:2px 8px;border-radius:999px;font:500 11px/1.4 var(--cs-font-mono, ui-monospace, monospace);letter-spacing:.02em;white-space:nowrap;user-select:none;`
      vp.el.appendChild(d)
      return d
    }
    vp.el.appendChild(svg)
    l = { svg, rect, handles, stem, widthPill: pill(false), heightPill: pill(true) }
    this.layers.set(vp.index, l)
    this.applyTheme(l)
    return l
  }

  private applyTheme(l: Layer): void {
    const t = this.core.theme
    const accent = t.css('--cs-accent')
    l.rect.setAttribute('stroke', accent)
    l.stem.setAttribute('stroke', accent)
    for (const c of l.handles.values()) {
      c.setAttribute('fill', t.css('--cs-surface'))
      c.setAttribute('stroke', accent)
    }
    for (const p of [l.widthPill, l.heightPill]) {
      p.style.background = t.css('--cs-glass-strong')
      p.style.border = `1px solid ${t.css('--cs-border-strong')}`
      p.style.color = t.css('--cs-text')
      p.style.boxShadow = 'var(--cs-shadow-1, 0 1px 2px rgba(0,0,0,.3))'
    }
  }

  setTheme(): void {
    for (const l of this.layers.values()) this.applyTheme(l)
  }

  /** Called per frame for every viewport. */
  update(vp: Viewport, selection: readonly string[]): void {
    const show = vp.isOrtho && selection.length > 0 && !this.core.readOnly
    const l = this.layer(vp)
    if (!show) {
      l.svg.style.display = 'none'
      l.widthPill.style.display = 'none'
      l.heightPill.style.display = 'none'
      this.frames.delete(vp.index)
      return
    }
    const frame = this.drag && this.drag.frame.vp === vp ? this.drag.frame : this.computeFrame(vp, selection)
    if (!frame) {
      l.svg.style.display = 'none'
      l.widthPill.style.display = 'none'
      l.heightPill.style.display = 'none'
      return
    }
    if (!this.drag) this.frames.set(vp.index, frame)
    else this.refreshFrameScreen(frame, selection)
    l.svg.style.display = 'block'
    const { x0, y0, x1, y1 } = frame
    l.rect.setAttribute('x', String(x0))
    l.rect.setAttribute('y', String(y0))
    l.rect.setAttribute('width', String(Math.max(0, x1 - x0)))
    l.rect.setAttribute('height', String(Math.max(0, y1 - y0)))
    const cx = (x0 + x1) / 2
    const cy = (y0 + y1) / 2
    const pos: Record<HandleId, [number, number]> = {
      nw: [x0, y0],
      n: [cx, y0],
      ne: [x1, y0],
      e: [x1, cy],
      se: [x1, y1],
      s: [cx, y1],
      sw: [x0, y1],
      w: [x0, cy],
      rotate: [cx, y0 - 28],
    }
    for (const [id, c] of l.handles) {
      c.setAttribute('cx', String(pos[id][0]))
      c.setAttribute('cy', String(pos[id][1]))
    }
    l.stem.setAttribute('x1', String(cx))
    l.stem.setAttribute('y1', String(y0))
    l.stem.setAttribute('x2', String(cx))
    l.stem.setAttribute('y2', String(y0 - 22))
    const units = this.core.doc.meta.units
    l.widthPill.style.display = 'block'
    l.heightPill.style.display = 'block'
    l.widthPill.textContent = formatLength(frame.hu * 2, units.length, units.precision)
    l.heightPill.textContent = formatLength(frame.hv * 2, units.length, units.precision)
    l.widthPill.style.transform = `translate3d(${cx.toFixed(1)}px, ${(y1 + 14).toFixed(1)}px, 0) translate(-50%, 0)`
    l.heightPill.style.transform = `translate3d(${(x1 + 14).toFixed(1)}px, ${cy.toFixed(1)}px, 0) translate(0, -50%) rotate(-90deg) translate(-50%, -50%) translate(50%, 0)`
    l.heightPill.style.transformOrigin = '0 50%'
  }

  private viewFrame(vp: Viewport): { u: THREE.Vector3; v: THREE.Vector3; n: THREE.Vector3 } {
    const cam = vp.camera
    const n = cam.getWorldDirection(new THREE.Vector3()).negate()
    const u = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.getWorldQuaternion(_q)).normalize()
    const v = new THREE.Vector3(0, 1, 0).applyQuaternion(_q).normalize()
    return { u, v, n }
  }

  private computeFrame(vp: Viewport, selection: readonly string[]): Frame | null {
    const b = this.core.sync.worldBounds(selection, _box)
    if (b.isEmpty()) return null
    const { u, v, n } = this.viewFrame(vp)
    const center = b.getCenter(new THREE.Vector3())
    let hu = 0
    let hv = 0
    for (let i = 0; i < 8; i++) {
      _t.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).sub(center)
      hu = Math.max(hu, Math.abs(_t.dot(u)))
      hv = Math.max(hv, Math.abs(_t.dot(v)))
    }
    const frame: Frame = { vp, center, u, v, n, hu, hv, x0: 0, y0: 0, x1: 0, y1: 0 }
    this.projectFrame(frame)
    return frame
  }

  private refreshFrameScreen(frame: Frame, selection: readonly string[]): void {
    const b = this.core.sync.worldBounds(selection, _box)
    if (b.isEmpty()) return
    const center = b.getCenter(_t)
    frame.hu = 0
    frame.hv = 0
    for (let i = 0; i < 8; i++) {
      _t2.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).sub(center)
      frame.hu = Math.max(frame.hu, Math.abs(_t2.dot(frame.u)))
      frame.hv = Math.max(frame.hv, Math.abs(_t2.dot(frame.v)))
    }
    frame.center.copy(center)
    this.projectFrame(frame)
  }

  private projectFrame(f: Frame): void {
    const corners = [
      _c.copy(f.center).addScaledVector(f.u, -f.hu).addScaledVector(f.v, f.hv),
      _c2.copy(f.center).addScaledVector(f.u, f.hu).addScaledVector(f.v, -f.hv),
    ]
    f.vp.project(corners[0]!, _s)
    f.x0 = _s.x
    f.y0 = _s.y
    f.vp.project(corners[1]!, _s)
    f.x1 = _s.x
    f.y1 = _s.y
  }

  private handleAt(target: EventTarget | null): { id: HandleId | 'pill-w' | 'pill-h'; vp: Viewport } | null {
    const el = target as HTMLElement | SVGElement | null
    if (!el || !(el instanceof Element)) return null
    for (const [index, l] of this.layers) {
      const vp = this.core.viewports.viewports[index]
      if (!vp) continue
      if (el === l.widthPill) return { id: 'pill-w', vp }
      if (el === l.heightPill) return { id: 'pill-h', vp }
      const h = (el as SVGElement).dataset?.handle as HandleId | undefined
      if (h && l.handles.get(h) === el) return { id: h, vp }
    }
    return null
  }

  onPointerDown(e: ToolPointerEvent): boolean {
    if (e.button !== 0) return false
    const hit = this.handleAt(e.native.target)
    if (!hit) return false
    const frame = this.frames.get(hit.vp.index)
    if (!frame) return false
    if (hit.id === 'pill-w' || hit.id === 'pill-h') {
      void this.promptSize(frame, hit.id === 'pill-w')
      return true
    }
    const ray = rayOf(e)
    const start = new THREE.Vector3()
    if (!intersectRayPlane(ray.origin, ray.direction, frame.center, frame.n, start, true)) return false
    const anchor = this.anchorFor(hit.id, frame, e.alt)
    const basis = new THREE.Matrix4().makeBasis(frame.u, frame.v, frame.n)
    this.session.start(this.core.store.getState().selection, frame.center.clone())
    const d = _t.copy(start).sub(frame.center)
    this.drag = { id: hit.id, frame, start, startAngle: Math.atan2(d.dot(frame.v), d.dot(frame.u)), label: null, anchor, basis }
    return true
  }

  private anchorFor(id: HandleId, f: Frame, center: boolean): THREE.Vector3 {
    const a = f.center.clone()
    if (center || id === 'rotate') return a
    const su = id.includes('e') ? -1 : id.includes('w') ? 1 : 0
    const sv = id.includes('n') ? -1 : id.includes('s') ? 1 : 0
    return a.addScaledVector(f.u, su * f.hu).addScaledVector(f.v, sv * f.hv)
  }

  onPointerMove(e: ToolPointerEvent): boolean {
    if (!this.drag) return false
    const d = this.drag
    const f = d.frame
    const ray = rayOf(e)
    const p = intersectRayPlane(ray.origin, ray.direction, f.center, f.n, _t, true)
    if (!p) return true
    const snapping = this.core.store.getState().snapping
    const units = this.core.doc.meta.units
    let label = ''
    if (d.id === 'rotate') {
      const v = _t2.copy(p).sub(f.center)
      let angle = Math.atan2(v.dot(f.v), v.dot(f.u)) - d.startAngle
      const stepRad = snapping.enabled && (snapping.angle || e.shift) ? (snapping.angleStepDeg * Math.PI) / 180 : 0
      if (stepRad > 0 && !e.alt) angle = roundTo(angle, stepRad)
      this.session.applyWorldDelta(rotationAbout(f.center, f.n, angle, _m4))
      label = `${((angle * 180) / Math.PI).toFixed(1)}°`
    } else {
      const usesU = d.id.includes('e') || d.id.includes('w')
      const usesV = d.id.includes('n') || d.id.includes('s')
      const startU = _t2.copy(d.start).sub(d.anchor).dot(f.u)
      const startV = _t2.copy(d.start).sub(d.anchor).dot(f.v)
      const curU = _t2.copy(p).sub(d.anchor).dot(f.u)
      const curV = _t2.copy(p).sub(d.anchor).dot(f.v)
      let su = usesU && Math.abs(startU) > 1e-9 ? curU / startU : 1
      let sv = usesV && Math.abs(startV) > 1e-9 ? curV / startV : 1
      if (e.shift || (usesU && usesV && !e.alt && !e.mod)) {
        // corners scale uniformly by default (keeps proportions like design tools)
        const f0 = usesU && usesV ? (Math.abs(su - 1) > Math.abs(sv - 1) ? su : sv) : usesU ? su : sv
        su = sv = f0
      }
      su = clampScale(su)
      sv = clampScale(sv)
      const grid = this.core.doc.meta.grid
      const step = snapping.enabled && snapping.grid ? grid.size / Math.max(1, grid.subdivisions) : 0
      if (step > 0 && !e.alt) {
        // snap resulting size to the grid step
        const w = f.hu * 2 * su
        const h = f.hv * 2 * sv
        if (usesU && f.hu > 1e-9) su = Math.max(1e-3, roundTo(w, step)) / (f.hu * 2)
        if (usesV && f.hv > 1e-9) sv = Math.max(1e-3, roundTo(h, step)) / (f.hv * 2)
        if (e.shift) su = sv = usesU ? su : sv
      }
      this.session.applyWorldDelta(scaleAbout(d.anchor, d.basis, su, sv, e.shift ? su : 1, _m4))
      label = `${formatLength(f.hu * 2 * su, units.length, units.precision)} × ${formatLength(f.hv * 2 * sv, units.length, units.precision)}`
    }
    const world: [number, number, number] = [p.x, p.y, p.z]
    if (!d.label) d.label = this.overlay.label(world, label, { variant: 'measure', offsetPx: [16, -16], viewport: f.vp.index })
    else this.overlay.updateLabel(d.label, world, label)
    this.core.notifyMotion(80)
    return true
  }

  onPointerUp(): boolean {
    if (!this.drag) return false
    this.finish(false)
    return true
  }

  onKeyDown(ev: KeyboardEvent): boolean {
    if (this.drag && ev.key === 'Escape') {
      this.finish(true)
      return true
    }
    return false
  }

  private finish(cancel: boolean): void {
    const d = this.drag
    if (!d) return
    if (cancel) this.session.cancel()
    else this.session.end()
    if (d.label) this.overlay.remove(d.label)
    this.drag = null
    this.core.requestRender()
  }

  private async promptSize(frame: Frame, width: boolean): Promise<void> {
    const units = this.core.doc.meta.units
    const cur = (width ? frame.hu : frame.hv) * 2
    const anchor = frame.center.clone().addScaledVector(width ? frame.v : frame.u, width ? -frame.hv : frame.hu)
    const text = await this.overlay.prompt([anchor.x, anchor.y, anchor.z], formatLength(cur, units.length, units.precision, false), { placeholder: width ? 'Width' : 'Height' })
    if (text === null) return
    const { parseLength } = await import('@cadsandbox/shared')
    const v = parseLength(text, units.length)
    if (v === null || v <= 0 || cur <= 1e-9) return
    const f = v / cur
    const basis = new THREE.Matrix4().makeBasis(frame.u, frame.v, frame.n)
    this.session.start(this.core.store.getState().selection, frame.center.clone())
    this.session.applyWorldDelta(scaleAbout(frame.center, basis, width ? f : 1, width ? 1 : f, 1, _m4))
    this.session.end()
    this.core.requestRender()
  }

  dispose(): void {
    this.finish(true)
    for (const l of this.layers.values()) {
      l.svg.remove()
      l.widthPill.remove()
      l.heightPill.remove()
    }
    this.layers.clear()
  }
}

function cursorFor(id: HandleId): string {
  switch (id) {
    case 'n':
    case 's':
      return 'ns-resize'
    case 'e':
    case 'w':
      return 'ew-resize'
    case 'ne':
    case 'sw':
      return 'nesw-resize'
    case 'nw':
    case 'se':
      return 'nwse-resize'
    default:
      return 'grab'
  }
}

const clampScale = (s: number) => (!Number.isFinite(s) ? 1 : Math.abs(s) < 1e-3 ? (s < 0 ? -1e-3 : 1e-3) : s)

function rayOf(e: ToolPointerEvent): THREE.Ray {
  _ray.origin.set(e.ray.origin[0], e.ray.origin[1], e.ray.origin[2])
  _ray.direction.set(e.ray.direction[0], e.ray.direction[1], e.ray.direction[2])
  return _ray
}

const _ray = new THREE.Ray()
const _box = new THREE.Box3()
const _t = new THREE.Vector3()
const _t2 = new THREE.Vector3()
const _c = new THREE.Vector3()
const _c2 = new THREE.Vector3()
const _s = new THREE.Vector2()
const _q = new THREE.Quaternion()
const _m4 = new THREE.Matrix4()
