// TransformGizmo — translate arrows + plane handles + free-move center, rotate rings with angle
// readout, scale handles; world/local space; grid and angle snapping; live labels. Lives in the
// overlay scene (always on top) at constant screen size, shown in perspective/iso viewports.
import * as THREE from 'three'
import { formatLength } from '@cadsandbox/shared'
import type { GizmoMode } from '../api'
import type { ToolPointerEvent } from '../tools/types'
import type { InteractionLayer } from '../core/toolHost'
import type { Core } from '../core/types'
import type { OverlayLayer } from '../core/overlayLayer'
import type { Viewport } from '../renderer/viewport'
import { TransformSession, rotationAbout, scaleAbout } from './transformSession'
import { closestParamLineToRay, intersectRayPlane, roundTo } from '../util/math'

type Axis = 'x' | 'y' | 'z'
type HandleKind = 'axis' | 'plane' | 'free' | 'ring' | 'scale' | 'uniform'

interface Handle {
  kind: HandleKind
  axis: Axis | null
  mesh: THREE.Mesh
  collider: THREE.Mesh
  baseColor: THREE.Color
}

const AXIS_VEC: Record<Axis, THREE.Vector3> = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) }
const GIZMO_PX = 105

export class TransformGizmo implements InteractionLayer {
  readonly group = new THREE.Group()
  private core: Core
  private overlay: OverlayLayer
  private session: TransformSession
  private handles: Handle[] = []
  private raycaster = new THREE.Raycaster()
  private hovered: Handle | null = null
  private drag: {
    handle: Handle
    startParam: number
    startPoint: THREE.Vector3
    startAngle: number
    plane: THREE.Plane
    axisWorld: THREE.Vector3
    label: string | null
    basis: THREE.Matrix4
    startDist: number
  } | null = null
  private mode: GizmoMode = 'translate'
  private space: 'world' | 'local' = 'world'
  private colors: Record<Axis, THREE.Color> = { x: new THREE.Color('#ff4d5e'), y: new THREE.Color('#2fd67b'), z: new THREE.Color('#3fb6ff') }
  private accent = new THREE.Color('#7c5cff')
  visible = false

  constructor(core: Core, overlay: OverlayLayer) {
    this.core = core
    this.overlay = overlay
    this.session = new TransformSession(core.doc, core.sync)
    this.group.name = 'cs-gizmo'
    this.group.visible = false
    this.raycaster.params.Line = { threshold: 0.05 }
    this.build()
    this.setTheme()
  }

  get dragging(): boolean {
    return this.drag !== null
  }

  setTheme(): void {
    const t = this.core.theme
    this.colors.x.copy(t.get('--cs-danger').color)
    this.colors.y.copy(t.get('--cs-success').color)
    this.colors.z.copy(t.get('--cs-info').color)
    this.accent.copy(t.get('--cs-accent').color)
    for (const h of this.handles) {
      h.baseColor.copy(h.axis ? this.colors[h.axis] : this.accent)
      ;(h.mesh.material as THREE.MeshBasicMaterial).color.copy(h.baseColor)
    }
  }

  private mat(color: THREE.Color, opacity = 1): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthTest: false, depthWrite: false, toneMapped: false, side: THREE.DoubleSide })
  }

  private add(kind: HandleKind, axis: Axis | null, mesh: THREE.Mesh, collider: THREE.Mesh, mode: GizmoMode): void {
    const color = axis ? this.colors[axis] : this.accent
    mesh.material = this.mat(color, kind === 'plane' ? 0.45 : 1)
    mesh.renderOrder = 100
    collider.material = new THREE.MeshBasicMaterial({ visible: false })
    collider.userData.handle = true
    mesh.userData.mode = mode
    collider.userData.mode = mode
    this.group.add(mesh, collider)
    this.handles.push({ kind, axis, mesh, collider, baseColor: color.clone() })
  }

  private orient(obj: THREE.Object3D, axis: Axis): void {
    if (axis === 'x') obj.rotation.set(0, 0, -Math.PI / 2)
    else if (axis === 'z') obj.rotation.set(0, 0, 0)
    else obj.rotation.set(0, 0, 0)
    // geometries are authored along +Y; map to axes
    if (axis === 'x') obj.rotation.set(0, 0, -Math.PI / 2)
    if (axis === 'y') obj.rotation.set(0, 0, 0)
    if (axis === 'z') obj.rotation.set(Math.PI / 2, 0, 0)
  }

  private build(): void {
    const axes: Axis[] = ['x', 'y', 'z']
    for (const a of axes) {
      // translate arrow (shaft + cone along +Y then oriented)
      const shaft = new THREE.CylinderGeometry(0.012, 0.012, 0.75, 12).translate(0, 0.375 + 0.12, 0)
      const cone = new THREE.ConeGeometry(0.05, 0.16, 16).translate(0, 1.0, 0)
      const arrowGeo = mergeGeometries([shaft, cone])
      const arrow = new THREE.Mesh(arrowGeo)
      const arrowCol = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.0, 8).translate(0, 0.6, 0))
      this.orient(arrow, a)
      this.orient(arrowCol, a)
      this.add('axis', a, arrow, arrowCol, 'translate')
      // scale handle (cube at end)
      const cube = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.09).translate(0, 1.0, 0))
      const line = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.85, 8).translate(0, 0.55, 0))
      const scaleGeo = mergeGeometries([cube.geometry, line.geometry])
      const scale = new THREE.Mesh(scaleGeo)
      const scaleCol = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.05, 8).translate(0, 0.6, 0))
      this.orient(scale, a)
      this.orient(scaleCol, a)
      this.add('scale', a, scale, scaleCol, 'scale')
      // rotate ring (in the plane perpendicular to the axis)
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.012, 8, 96))
      const ringCol = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.07, 6, 48))
      if (a === 'x') {
        ring.rotation.y = Math.PI / 2
        ringCol.rotation.y = Math.PI / 2
      } else if (a === 'y') {
        ring.rotation.x = Math.PI / 2
        ringCol.rotation.x = Math.PI / 2
      }
      this.add('ring', a, ring, ringCol, 'rotate')
    }
    // plane handles
    const planes: [Axis, THREE.Vector3, THREE.Euler][] = [
      ['z', new THREE.Vector3(0.3, 0.3, 0), new THREE.Euler(0, 0, 0)],
      ['x', new THREE.Vector3(0, 0.3, 0.3), new THREE.Euler(0, Math.PI / 2, 0)],
      ['y', new THREE.Vector3(0.3, 0, 0.3), new THREE.Euler(Math.PI / 2, 0, 0)],
    ]
    for (const [axis, pos, rot] of planes) {
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22))
      quad.position.copy(pos)
      quad.rotation.copy(rot)
      const col = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3))
      col.position.copy(pos)
      col.rotation.copy(rot)
      this.add('plane', axis, quad, col, 'translate')
    }
    // free move / uniform scale center
    const center = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12))
    const centerCol = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6))
    this.add('free', null, center, centerCol, 'translate')
    const uni = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12))
    const uniCol = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22))
    this.add('uniform', null, uni, uniCol, 'scale')
    this.group.traverse((o) => {
      o.userData.noPathTrace = true
      o.userData.helper = true
    })
  }

  /** Called every frame (before rendering a viewport) with the current selection state. */
  update(vp: Viewport, selection: readonly string[], mode: GizmoMode, space: 'world' | 'local'): void {
    this.mode = mode
    this.space = space
    const show = selection.length > 0 && mode !== 'none' && !vp.isOrtho && !this.core.readOnly
    this.visible = show
    this.group.visible = show
    if (!show) return
    if (!this.drag) {
      const b = this.core.sync.worldBounds(selection, _box)
      if (b.isEmpty()) {
        this.group.visible = false
        return
      }
      if (selection.length === 1) {
        const m = this.core.doc.getWorldMatrix(selection[0]!)
        this.group.position.set(m[12]!, m[13]!, m[14]!)
        // keep pivot inside bounds for objects whose origin is far away
        if (!b.containsPoint(this.group.position)) b.getCenter(this.group.position)
      } else b.getCenter(this.group.position)
      if (space === 'local' && selection.length >= 1) {
        const m = this.core.doc.getWorldMatrix(selection[0]!)
        _m4.set(m[0]!, m[4]!, m[8]!, 0, m[1]!, m[5]!, m[9]!, 0, m[2]!, m[6]!, m[10]!, 0, 0, 0, 0, 1)
        _m4.decompose(_p, this.group.quaternion, _s)
        this.group.quaternion.normalize()
      } else this.group.quaternion.identity()
    }
    const s = vp.worldPerPixel(this.group.position) * GIZMO_PX
    this.group.scale.setScalar(s)
    for (const h of this.handles) {
      const on = (h.mesh.userData.mode as GizmoMode) === mode
      h.mesh.visible = on
      h.collider.visible = on
    }
    this.group.updateMatrixWorld(true)
  }

  private pickHandle(e: ToolPointerEvent): Handle | null {
    if (!this.group.visible) return null
    _ndc.set(e.ndc[0], e.ndc[1])
    const vp = this.core.viewports.at(e.viewport)
    if (vp.isOrtho) return null
    this.raycaster.setFromCamera(_ndc, vp.camera)
    const colliders = this.handles.filter((h) => h.collider.visible).map((h) => h.collider)
    const hits = this.raycaster.intersectObjects(colliders, false)
    if (!hits.length) return null
    return this.handles.find((h) => h.collider === hits[0]!.object) ?? null
  }

  private axisWorld(axis: Axis): THREE.Vector3 {
    return AXIS_VEC[axis].clone().applyQuaternion(this.group.quaternion).normalize()
  }

  onPointerDown(e: ToolPointerEvent): boolean {
    if (e.button !== 0) return false
    const handle = this.pickHandle(e)
    if (!handle) return false
    const vp = this.core.viewports.at(e.viewport)
    const selection = this.core.store.getState().selection
    const pivot = this.group.position.clone()
    const camDir = vp.camera.getWorldDirection(new THREE.Vector3())
    const ray = rayOf(e)
    let plane: THREE.Plane
    let axisWorld = new THREE.Vector3(0, 0, 1)
    if (handle.axis) axisWorld = this.axisWorld(handle.axis)
    if (handle.kind === 'axis' || handle.kind === 'scale') {
      // drag plane containing the axis, facing the camera
      const n = camDir.clone().sub(axisWorld.clone().multiplyScalar(camDir.dot(axisWorld)))
      if (n.lengthSq() < 1e-8) n.copy(camDir)
      plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n.normalize(), pivot)
    } else if (handle.kind === 'plane' || handle.kind === 'ring') plane = new THREE.Plane().setFromNormalAndCoplanarPoint(axisWorld, pivot)
    else plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camDir.clone().negate(), pivot)
    const startPoint = new THREE.Vector3()
    if (!intersectRayPlane(ray.origin, ray.direction, pivot, plane.normal, startPoint, true)) startPoint.copy(pivot)
    const startParam = handle.kind === 'axis' || handle.kind === 'scale' ? closestParamLineToRay(pivot, axisWorld, ray.origin, ray.direction) : 0
    const basis = new THREE.Matrix4().makeRotationFromQuaternion(this.group.quaternion)
    let startAngle = 0
    if (handle.kind === 'ring') startAngle = this.ringAngle(startPoint, pivot, axisWorld)
    this.session.start(selection, pivot)
    this.drag = { handle, startParam, startPoint, startAngle, plane, axisWorld, label: null, basis, startDist: Math.max(1e-6, startPoint.distanceTo(pivot)) }
    this.highlight(handle, true)
    return true
  }

  private ringAngle(p: THREE.Vector3, pivot: THREE.Vector3, axis: THREE.Vector3): number {
    const u = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1).cross(axis).normalize() : new THREE.Vector3(1, 0, 0)
    const v = new THREE.Vector3().crossVectors(axis, u)
    const d = _t.copy(p).sub(pivot)
    return Math.atan2(d.dot(v), d.dot(u))
  }

  onPointerMove(e: ToolPointerEvent): boolean {
    if (!this.drag) {
      const h = this.group.visible ? this.pickHandle(e) : null
      if (h !== this.hovered) {
        if (this.hovered) this.highlight(this.hovered, false)
        this.hovered = h
        if (h) this.highlight(h, true)
        this.core.requestRender()
      }
      return false
    }
    const d = this.drag
    const ray = rayOf(e)
    const snapping = this.core.store.getState().snapping
    const pivot = this.session.pivot
    const grid = this.core.doc.meta.grid
    const step = snapping.enabled && snapping.grid ? grid.size / Math.max(1, grid.subdivisions) : 0
    const units = this.core.doc.meta.units
    let label = ''
    if (d.handle.kind === 'axis') {
      const t = closestParamLineToRay(pivot, d.axisWorld, ray.origin, ray.direction)
      let delta = t - d.startParam
      if (step > 0 && !e.alt) delta = roundTo(delta, step)
      _m4.makeTranslation(d.axisWorld.x * delta, d.axisWorld.y * delta, d.axisWorld.z * delta)
      this.session.applyWorldDelta(_m4)
      this.group.position.copy(pivot).addScaledVector(d.axisWorld, delta)
      label = `Δ ${formatLength(delta, units.length, units.precision)}`
    } else if (d.handle.kind === 'plane' || d.handle.kind === 'free') {
      const p = intersectRayPlane(ray.origin, ray.direction, pivot, d.plane.normal, _t, true)
      if (!p) return true
      const delta = p.clone().sub(d.startPoint)
      if (step > 0 && !e.alt) {
        // snap in-plane components along the gizmo basis
        const u = new THREE.Vector3().setFromMatrixColumn(d.basis, d.handle.axis === 'x' ? 1 : 0)
        const v = new THREE.Vector3().setFromMatrixColumn(d.basis, d.handle.axis === 'y' ? 2 : d.handle.axis === 'x' ? 2 : 1)
        if (d.handle.kind === 'plane') {
          const du = roundTo(delta.dot(u), step)
          const dv = roundTo(delta.dot(v), step)
          delta.copy(u).multiplyScalar(du).addScaledVector(v, dv)
        } else delta.set(roundTo(delta.x, step), roundTo(delta.y, step), roundTo(delta.z, step))
      }
      _m4.makeTranslation(delta.x, delta.y, delta.z)
      this.session.applyWorldDelta(_m4)
      this.group.position.copy(pivot).add(delta)
      label = `Δ ${formatLength(delta.length(), units.length, units.precision)}`
    } else if (d.handle.kind === 'ring') {
      const p = intersectRayPlane(ray.origin, ray.direction, pivot, d.plane.normal, _t, true)
      if (!p) return true
      let angle = this.ringAngle(p, pivot, d.axisWorld) - d.startAngle
      const stepRad = snapping.enabled && (snapping.angle || e.shift) ? (snapping.angleStepDeg * Math.PI) / 180 : 0
      if (stepRad > 0 && !e.alt) angle = roundTo(angle, stepRad)
      this.session.applyWorldDelta(rotationAbout(pivot, d.axisWorld, angle, _m4))
      label = `${((angle * 180) / Math.PI).toFixed(1)}°`
    } else if (d.handle.kind === 'scale') {
      const t = closestParamLineToRay(pivot, d.axisWorld, ray.origin, ray.direction)
      const denom = Math.abs(d.startParam) < 1e-6 ? 1e-6 : d.startParam
      let f = t / denom
      if (!Number.isFinite(f) || Math.abs(f) < 1e-3) f = 1e-3
      if (e.shift) this.session.applyWorldDelta(scaleAbout(pivot, d.basis, f, f, f, _m4))
      else {
        const sx = d.handle.axis === 'x' ? f : 1
        const sy = d.handle.axis === 'y' ? f : 1
        const sz = d.handle.axis === 'z' ? f : 1
        this.session.applyWorldDelta(scaleAbout(pivot, d.basis, sx, sy, sz, _m4))
      }
      label = `×${f.toFixed(2)}`
    } else if (d.handle.kind === 'uniform') {
      const p = intersectRayPlane(ray.origin, ray.direction, pivot, d.plane.normal, _t, true)
      if (!p) return true
      const f = Math.max(1e-3, p.distanceTo(pivot) / d.startDist)
      this.session.applyWorldDelta(scaleAbout(pivot, d.basis, f, f, f, _m4))
      label = `×${f.toFixed(2)}`
    }
    this.updateLabel(label, e)
    this.core.notifyMotion(80)
    return true
  }

  private updateLabel(text: string, e: ToolPointerEvent): void {
    const d = this.drag!
    const vp = this.core.viewports.at(e.viewport)
    // anchor near the cursor: unproject the pointer onto the drag plane
    const ray = rayOf(e)
    const p = intersectRayPlane(ray.origin, ray.direction, this.session.pivot, d.plane.normal, _t, true) ?? this.session.pivot
    const world: [number, number, number] = [p.x, p.y, p.z]
    if (!d.label) d.label = this.overlay.label(world, text, { variant: 'measure', offsetPx: [18, -18], viewport: vp.index })
    else this.overlay.updateLabel(d.label, world, text)
  }

  onPointerUp(_e: ToolPointerEvent): boolean {
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
    this.highlight(d.handle, false)
    this.drag = null
    this.core.requestRender()
  }

  private highlight(h: Handle, on: boolean): void {
    const m = h.mesh.material as THREE.MeshBasicMaterial
    if (on) m.color.copy(h.baseColor).lerp(new THREE.Color(1, 1, 1), 0.45)
    else m.color.copy(h.baseColor)
    if (h.kind === 'plane') m.opacity = on ? 0.8 : 0.45
  }

  dispose(): void {
    this.finish(true)
    for (const h of this.handles) {
      h.mesh.geometry.dispose()
      ;(h.mesh.material as THREE.Material).dispose()
      h.collider.geometry.dispose()
      ;(h.collider.material as THREE.Material).dispose()
    }
    this.handles = []
    this.group.clear()
  }

  get currentMode(): GizmoMode {
    return this.mode
  }
  get currentSpace(): 'world' | 'local' {
    return this.space
  }
}

function rayOf(e: ToolPointerEvent): THREE.Ray {
  _ray.origin.set(e.ray.origin[0], e.ray.origin[1], e.ray.origin[2])
  _ray.direction.set(e.ray.direction[0], e.ray.direction[1], e.ray.direction[2])
  return _ray
}

/** Concatenate non-indexed position-only geometries (gizmo parts are simple). */
function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = []
  for (const g of geos) {
    const ng = g.index ? g.toNonIndexed() : g
    const p = ng.getAttribute('position')
    for (let i = 0; i < p.count; i++) positions.push(p.getX(i), p.getY(i), p.getZ(i))
    if (ng !== g) ng.dispose()
    g.dispose()
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  out.computeVertexNormals()
  return out
}

const _ray = new THREE.Ray()
const _ndc = new THREE.Vector2()
const _box = new THREE.Box3()
const _m4 = new THREE.Matrix4()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()
const _t = new THREE.Vector3()
