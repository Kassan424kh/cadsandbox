// Direct drag: move the selection by dragging it over its support surface / work plane with
// snapping and inference guides (Spline-like). Shift constrains to the dominant axis, Alt drags a
// duplicate. One drag = one undo step, at most one doc update per frame.
import * as THREE from 'three'
import type { Vec3 } from '@cadsandbox/doc'
import { formatLength } from '@cadsandbox/shared'
import type { ToolPointerEvent, WorkPlane } from '../tools/types'
import type { Core } from '../core/types'
import type { OverlayLayer } from '../core/overlayLayer'
import type { SnapEngine } from '../snapping/snapEngine'
import type { SnapVisuals } from '../snapping/snapVisuals'
import type { PickHit } from '../core/picker'
import { TransformSession } from './transformSession'
import { makePlane, rayPlane } from '../snapping/snapMath'
import { vecSub } from '../util/math'

export class DirectDrag {
  private core: Core
  private overlay: OverlayLayer
  private snap: SnapEngine
  private visuals: SnapVisuals
  private session: TransformSession
  private state: { plane: WorkPlane; start: Vec3; ids: string[]; exclude: Set<string>; label: string | null; moved: boolean; pendingStart: ToolPointerEvent } | null = null
  onDuplicate: ((ids: string[]) => string[]) | null = null

  constructor(core: Core, overlay: OverlayLayer, snap: SnapEngine, visuals: SnapVisuals) {
    this.core = core
    this.overlay = overlay
    this.snap = snap
    this.visuals = visuals
    this.session = new TransformSession(core.doc, core.sync)
  }

  get active(): boolean {
    return this.state !== null
  }

  /** Begin from a pointer-down on a selected node (the tool decides when). */
  begin(e: ToolPointerEvent, hit: PickHit, ids: string[]): void {
    const vp = this.core.viewports.at(e.viewport)
    const hp: Vec3 = [hit.point.x, hit.point.y, hit.point.z]
    let plane: WorkPlane
    if (vp.isOrtho) {
      const n = vp.camera.getWorldDirection(new THREE.Vector3()).negate()
      plane = makePlane(hp, [n.x, n.y, n.z])
    } else if (hit.normal && Math.abs(hit.normal.z) < 0.5 && !isStructural(this.core.doc.getNode(hit.nodeId)?.type)) {
      // wall-mounted object: slide along the face it sits on
      plane = makePlane(hp, [hit.normal.x, hit.normal.y, hit.normal.z])
    } else plane = makePlane(hp, [0, 0, 1], [1, 0, 0], this.core.activeLevelId())
    const exclude = new Set<string>()
    for (const id of ids) {
      exclude.add(id)
      for (const d of this.core.doc.getDescendants(id)) exclude.add(d)
    }
    this.state = { plane, start: hp, ids, exclude, label: null, moved: false, pendingStart: e }
  }

  move(e: ToolPointerEvent): void {
    const s = this.state
    if (!s) return
    if (!s.moved) {
      const dx = e.clientX - s.pendingStart.clientX
      const dy = e.clientY - s.pendingStart.clientY
      if (Math.hypot(dx, dy) < 4) return
      s.moved = true
      if (e.alt && this.onDuplicate) {
        const copies = this.onDuplicate(s.ids)
        if (copies.length) {
          s.ids = copies
          s.exclude = new Set(copies)
          for (const id of copies) for (const d of this.core.doc.getDescendants(id)) s.exclude.add(d)
        }
      }
      const b = this.core.sync.worldBounds(s.ids, _box)
      this.session.start(s.ids, b.isEmpty() ? new THREE.Vector3(...s.start) : b.getCenter(new THREE.Vector3()))
    }
    const settings = this.core.store.getState().snapping
    const r = this.snap.snap(e, { plane: s.plane, from: s.start, exclude: [...s.exclude], settings: { ortho: e.shift || settings.ortho } })
    this.visuals.show(r, e.viewport)
    let target = r.point
    // keep the point on the drag plane when the snap came from elsewhere in 3D (perspective)
    const origin: Vec3 = [e.ray.origin[0], e.ray.origin[1], e.ray.origin[2]]
    const dir: Vec3 = [e.ray.direction[0], e.ray.direction[1], e.ray.direction[2]]
    if (r.kind === 'free' || r.kind === 'grid') target = rayPlane(origin, dir, s.plane, true) ?? r.point
    if (r.kind === 'grid') {
      // grid snaps apply to the object's delta so objects keep their grid alignment
      const raw = rayPlane(origin, dir, s.plane, true)
      if (raw) target = r.point
    }
    const delta = vecSub(target, s.start)
    _m.makeTranslation(delta[0], delta[1], delta[2])
    this.session.applyWorldDelta(_m)
    const units = this.core.doc.meta.units
    const text = `Δ ${formatLength(Math.hypot(delta[0], delta[1], delta[2]), units.length, units.precision)}`
    if (!s.label) s.label = this.overlay.label(target, text, { variant: 'measure', offsetPx: [16, -16], viewport: e.viewport })
    else this.overlay.updateLabel(s.label, target, text)
    this.core.notifyMotion(80)
  }

  /** Returns true when the pointer actually dragged (else the tool treats it as a click). */
  end(): boolean {
    const s = this.state
    if (!s) return false
    const moved = s.moved
    if (moved) this.session.end()
    this.cleanup()
    return moved
  }

  cancel(): void {
    if (!this.state) return
    if (this.state.moved) this.session.cancel()
    this.cleanup()
  }

  private cleanup(): void {
    if (this.state?.label) this.overlay.remove(this.state.label)
    this.visuals.hide()
    this.state = null
    this.core.requestRender()
  }
}

/** Building elements always move in their level plane, never along their own faces. */
function isStructural(type: string | undefined): boolean {
  return type === 'wall' || type === 'slab' || type === 'roof' || type === 'column' || type === 'beam' || type === 'stair' || type === 'railing' || type === 'room' || type === 'level' || type === 'terrain'
}

const _box = new THREE.Box3()
const _m = new THREE.Matrix4()
