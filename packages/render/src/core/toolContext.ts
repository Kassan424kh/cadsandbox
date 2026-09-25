// ToolContext implementation: work planes, snapping, picking (with wall/face info), units, hints,
// single-undo-step commits and coordinate conversions for the tool plugins.
import * as THREE from 'three'
import type { AnyNode, NewNode, NodeBase, UnitsSettings, Vec3 } from '@cadsandbox/doc'
import { invertMatrix, transformPoint } from '@cadsandbox/doc'
import type { GeometryResult } from '@cadsandbox/geometry'
import { formatLength as fmtLength, parseAngle as prsAngle, parseLength as prsLength } from '@cadsandbox/shared'
import type { Editor, EditorEvents, ToolId, ToolInput } from '../api'
import type { LevelInfo, PickResult, SnapQuery, SnapResult, ToolContext as ToolContextApi, ToolPointerEvent, WorkPlane } from '../tools/types'
import type { Core } from './types'
import type { Viewport } from '../renderer/viewport'
import type { Picker } from './picker'
import type { SnapEngine } from '../snapping/snapEngine'
import type { SnapVisuals } from '../snapping/snapVisuals'
import type { PreviewLayer } from './previewLayer'
import type { OverlayLayer } from './overlayLayer'
import type { ToolHost } from './toolHost'
import { makePlane, rayPlane } from '../snapping/snapMath'

export interface ToolContextDeps {
  core: Core
  editor: Editor
  picker: Picker
  snapEngine: SnapEngine
  snapVisuals: SnapVisuals
  preview: PreviewLayer
  overlay: OverlayLayer
  host: ToolHost
}

export class ToolContextImpl implements ToolContextApi {
  readonly editor: Editor
  readonly preview: PreviewLayer
  readonly overlay: OverlayLayer
  private d: ToolContextDeps

  constructor(d: ToolContextDeps) {
    this.d = d
    this.editor = d.editor
    this.preview = d.preview
    this.overlay = d.overlay
  }

  get doc() {
    return this.d.core.doc
  }
  get geometry() {
    return this.d.core.geometry
  }

  private vp(index?: number): Viewport {
    return this.d.core.viewports.at(index)
  }

  // ------------------------------------------------------------------ planes
  workPlane(viewport?: number): WorkPlane {
    const vp = this.vp(viewport)
    const levelId = this.activeLevelIdForPlane(vp)
    const z = levelId ? (this.doc.getNode<'level'>(levelId)?.t.p[2] ?? 0) : 0
    const target = vp.controls.getTarget(_t, true)
    if (vp.isOrtho) {
      const dir = vp.camera.getWorldDirection(_d)
      const ax = Math.abs(dir.x),
        ay = Math.abs(dir.y),
        az = Math.abs(dir.z)
      if (az >= ax && az >= ay) return makePlane([0, 0, z], [0, 0, 1], [1, 0, 0], levelId)
      if (ay >= ax) {
        // front (camera at -Y looks +Y → plane normal -Y) / back
        const front = dir.y > 0
        return front ? makePlane([0, target.y, 0], [0, -1, 0], [1, 0, 0], levelId) : makePlane([0, target.y, 0], [0, 1, 0], [-1, 0, 0], levelId)
      }
      const right = dir.x < 0 // camera at +X looks -X
      return right ? makePlane([target.x, 0, 0], [1, 0, 0], [0, 1, 0], levelId) : makePlane([target.x, 0, 0], [-1, 0, 0], [0, -1, 0], levelId)
    }
    return makePlane([0, 0, z], [0, 0, 1], [1, 0, 0], levelId)
  }

  private activeLevelIdForPlane(vp: Viewport): string | null {
    if (vp.planLevel && this.doc.hasNode(vp.planLevel)) return vp.planLevel
    return this.d.core.activeLevelId()
  }

  snap(e: ToolPointerEvent, query?: SnapQuery): SnapResult {
    const r = this.d.snapEngine.snap(e, query)
    this.d.snapVisuals.show(r, e.viewport)
    this.d.core.requestRender()
    return r
  }

  pick(e: ToolPointerEvent, filter?: (n: AnyNode) => boolean): PickResult | null {
    const vp = this.vp(e.viewport)
    _ndc.set(e.ndc[0], e.ndc[1])
    const hit = this.d.picker.pick(vp, _ndc, { filter, hidden: this.d.core.hiddenIds(), skipLocked: false, within: this.d.core.store.getState().editingContext })
    if (!hit) return null
    const out: PickResult = { nodeId: hit.nodeId, point: [hit.point.x, hit.point.y, hit.point.z], normal: hit.normal ? [hit.normal.x, hit.normal.y, hit.normal.z] : null }
    if (hit.normal && !hit.flat) out.face = { normal: out.normal!, point: out.point }
    const node = this.doc.getNode(hit.nodeId)
    if (node?.type === 'wall') {
      const wall = node as NodeBase<'wall'>
      const local = transformPoint(invertMatrix(this.doc.getWorldMatrix(hit.nodeId)), out.point)
      const ax = wall.params.b[0] - wall.params.a[0]
      const ay = wall.params.b[1] - wall.params.a[1]
      const len = Math.hypot(ax, ay) || 1
      const dx = local[0] - wall.params.a[0]
      const dy = local[1] - wall.params.a[1]
      out.wallOffset = Math.max(0, Math.min(len, (dx * ax + dy * ay) / len))
      const cross = (ax * dy - ay * dx) / len
      out.wallSide = cross >= 0 ? 'left' : 'right'
    }
    return out
  }

  rayPlane(e: ToolPointerEvent, plane: WorkPlane): Vec3 | null {
    return rayPlane([e.ray.origin[0], e.ray.origin[1], e.ray.origin[2]], [e.ray.direction[0], e.ray.direction[1], e.ray.direction[2]], plane)
  }

  // ------------------------------------------------------------------ doc helpers
  activeLevel(): LevelInfo | null {
    const id = this.d.core.activeLevelId()
    const n = id ? this.doc.getNode<'level'>(id) : undefined
    if (!n) return null
    return { id: n.id, name: n.name, elevation: n.t.p[2], height: n.params.height, cutHeight: n.params.cutHeight }
  }

  units(): UnitsSettings {
    return this.doc.meta.units
  }

  formatLength(meters: number): string {
    const u = this.units()
    return fmtLength(meters, u.length, u.precision)
  }

  parseLength(text: string): number | null {
    return prsLength(text, this.units().length)
  }

  parseAngle(text: string): number | null {
    return prsAngle(text)
  }

  setHint(text: string): void {
    if (this.d.core.store.getState().toolHint !== text) this.d.core.store.setState({ toolHint: text })
  }

  setInput(input: ToolInput | null): void {
    this.d.core.store.setState({ toolInput: input })
  }

  setCursor(css: string): void {
    this.d.core.ctx.container.style.cursor = css
    for (const vp of this.d.core.viewports.viewports) vp.el.style.cursor = css
  }

  notify(level: EditorEvents['notify']['level'], message: string): void {
    this.d.core.emit('notify', { level, message })
  }

  emit<K extends keyof EditorEvents>(event: K, payload: EditorEvents[K]): void {
    this.d.core.emit(event, payload)
  }

  commitNodes(nodes: NewNode[], opts?: { select?: boolean }): string[] {
    if (this.d.core.readOnly) {
      this.notify('warning', 'This file is read-only')
      return []
    }
    const parent = this.defaultParent()
    const prepared = nodes.map((n) => (n.parent === undefined ? { ...n, parent } : n))
    this.doc.stopCapturing()
    const ids = this.doc.addNodes(prepared)
    this.doc.stopCapturing()
    this.d.snapVisuals.hide()
    if (opts?.select !== false) this.editor.select(ids, 'replace')
    this.emit('created', { ids, tool: this.d.host.currentId })
    return ids
  }

  commit<R>(fn: () => R): R {
    if (this.d.core.readOnly) {
      this.notify('warning', 'This file is read-only')
      return undefined as R
    }
    this.doc.stopCapturing()
    const r = this.doc.transact(fn)
    this.doc.stopCapturing()
    this.d.snapVisuals.hide()
    return r
  }

  defaultParent(): string | null {
    const ctx = this.d.core.store.getState().editingContext
    if (ctx && this.doc.hasNode(ctx)) return ctx
    return this.d.core.activeLevelId()
  }

  toLocal(parent: string | null, world: Vec3): Vec3 {
    return transformPoint(invertMatrix(this.doc.getWorldMatrix(parent)), world)
  }

  toWorld(parent: string | null, local: Vec3): Vec3 {
    return transformPoint(this.doc.getWorldMatrix(parent), local)
  }

  result(nodeId: string): GeometryResult | undefined {
    return this.geometry.get(nodeId)
  }

  node<T extends AnyNode['type']>(id: string): NodeBase<T> | undefined {
    return this.doc.getNode<T>(id)
  }

  setTool(tool: ToolId, options?: Record<string, unknown>): void {
    this.editor.setTool(tool, options)
  }

  requestRender(): void {
    this.d.core.requestRender()
  }

  isPlanView(viewport?: number): boolean {
    return this.vp(viewport).isPlanView
  }

  camera(viewport?: number): THREE.Camera {
    return this.vp(viewport).camera
  }

  worldPerPixel(point: Vec3, viewport?: number): number {
    return this.vp(viewport).worldPerPixel(_t.set(point[0], point[1], point[2]))
  }
}

const _t = new THREE.Vector3()
const _d = new THREE.Vector3()
const _ndc = new THREE.Vector2()
