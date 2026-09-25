// Editor insertion & picking API (drag-and-drop from the library / files): drop placement via the
// snap engine, ghost previews, world/screen picking and projection.
import * as THREE from 'three'
import type { DocSnapshot, NewNode, Vec3 } from '@cadsandbox/doc'
import type { Core } from './types'
import type { InputManager } from './input'
import type { SnapEngine } from '../snapping/snapEngine'
import type { SnapVisuals } from '../snapping/snapVisuals'
import type { Picker } from './picker'
import type { ToolContextImpl } from './toolContext'
import { GhostPreview, commitPlacement, placementFromSnap, type PlaceContent, type Placement } from '../core-tools/placement'
import { rayPlane } from '../snapping/snapMath'
import type { PreviewLayer } from './previewLayer'

export interface InsertionDeps {
  core: Core
  input: InputManager
  snapEngine: SnapEngine
  snapVisuals: SnapVisuals
  picker: Picker
  toolContext: ToolContextImpl
  preview: PreviewLayer
  select(ids: string[]): void
}

export class InsertionApi {
  private d: InsertionDeps
  private ghost: GhostPreview

  constructor(d: InsertionDeps) {
    this.d = d
    this.ghost = new GhostPreview(d.preview)
  }

  private placeContent(content: DocSnapshot | NewNode[]): PlaceContent[] {
    if (Array.isArray(content)) return content.map((node) => ({ node }))
    return [{ snapshot: content }]
  }

  private placementAt(at?: { clientX: number; clientY: number } | { world: Vec3 }): Placement {
    if (at && 'world' in at) return { point: at.world, rotation: [0, 0, 0, 1] }
    const { viewports, ctx } = this.d.core
    const vp = at ? (viewports.hit(at.clientX, at.clientY) ?? viewports.activeViewport) : viewports.activeViewport
    const rect = ctx.container.getBoundingClientRect()
    const cx = at ? at.clientX : rect.left + vp.rect.x + vp.rect.w / 2
    const cy = at ? at.clientY : rect.top + vp.rect.y + vp.rect.h / 2
    const ev = this.d.input.buildEvent({ clientX: cx, clientY: cy, button: 0, buttons: 0, shiftKey: false, altKey: false, metaKey: false, ctrlKey: false } as MouseEvent, vp)
    const snap = this.d.snapEngine.snap(ev, { surfaces: true })
    return placementFromSnap(snap, 0)
  }

  async insert(content: DocSnapshot | NewNode[], at?: { clientX: number; clientY: number } | { world: Vec3 }): Promise<string[]> {
    const core = this.d.core
    if (core.readOnly) return []
    const placement = this.placementAt(at)
    const parent = core.store.getState().editingContext ?? core.activeLevelId()
    const ids: string[] = []
    for (const c of this.placeContent(content)) ids.push(...commitPlacement(core.doc, c, placement, parent))
    this.d.select(ids)
    core.emit('created', { ids, tool: 'place' })
    this.d.snapVisuals.hide()
    core.requestRender()
    return ids
  }

  dragPreview(content: DocSnapshot | NewNode[] | null, clientX?: number, clientY?: number): void {
    const core = this.d.core
    if (!content) {
      this.ghost.clear()
      this.d.snapVisuals.hide()
      core.requestRender()
      return
    }
    if (!this.ghost.active) {
      const list = this.placeContent(content)
      this.ghost.set(list[0] ?? null)
    }
    if (clientX !== undefined && clientY !== undefined) this.ghost.place(this.placementAt({ clientX, clientY }))
    core.requestRender()
  }

  pick(clientX: number, clientY: number): { nodeId: string | null; point: Vec3; normal: Vec3 | null } | null {
    const core = this.d.core
    const vp = core.viewports.hit(clientX, clientY)
    if (!vp) return null
    const rect = core.ctx.container.getBoundingClientRect()
    vp.ndc(clientX, clientY, rect, _ndc)
    const hit = this.d.picker.pick(vp, _ndc, { skipLocked: false, hidden: core.hiddenIds(), within: core.store.getState().editingContext })
    if (hit) return { nodeId: hit.nodeId, point: [hit.point.x, hit.point.y, hit.point.z], normal: hit.normal ? [hit.normal.x, hit.normal.y, hit.normal.z] : null }
    _raycaster.setFromCamera(_ndc, vp.camera)
    const plane = this.d.toolContext.workPlane(vp.index)
    const o = _raycaster.ray.origin
    const dir = _raycaster.ray.direction
    const p = rayPlane([o.x, o.y, o.z], [dir.x, dir.y, dir.z], plane, true)
    return p ? { nodeId: null, point: p, normal: plane.normal } : null
  }

  project(world: Vec3, viewport?: number): { x: number; y: number; visible: boolean } | null {
    const { viewports, ctx } = this.d.core
    const vp = viewport === undefined ? viewports.activeViewport : viewports.viewports[viewport]
    if (!vp) return null
    const visible = vp.project(_v.set(world[0], world[1], world[2]), _ndc)
    const rect = ctx.container.getBoundingClientRect()
    return { x: rect.left + vp.rect.x + _ndc.x, y: rect.top + vp.rect.y + _ndc.y, visible }
  }

  dispose(): void {
    this.ghost.clear()
  }
}

const _v = new THREE.Vector3()
const _ndc = new THREE.Vector2()
const _raycaster = new THREE.Raycaster()
