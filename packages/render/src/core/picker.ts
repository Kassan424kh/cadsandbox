// Picker — BVH-accelerated raycasting against node meshes, instanced components, 2D drawings
// (pixel-tolerant fat lines / texts) and light markers, with CAD-sensible priorities, plus
// screen-space box selection (window / crossing) over projected node bounds.
import * as THREE from 'three'
import type { AnyNode, CadDocument } from '@cadsandbox/doc'
import type { Viewport } from '../renderer/viewport'
import type { SceneSync } from '../scene/sceneSync'
import type { ViewStateApplier, ViewportSceneState } from '../scene/viewState'
import { classifyBox, rectFromPoints, type BoxMode, type Rect } from '../picking/boxSelect'

export interface PickHit {
  nodeId: string
  point: THREE.Vector3
  normal: THREE.Vector3 | null
  object: THREE.Object3D
  distance: number
  faceIndex: number | null
  instanceId: number | null
  /** true when the hit came from a 2D drawing (line/fill/text) rather than a surface */
  flat: boolean
}

export interface PickOptions {
  filter?: (n: AnyNode) => boolean
  exclude?: ReadonlySet<string> | null
  /** Skip locked nodes (selection) — snapping keeps them. */
  skipLocked?: boolean
  /** Only descendants of this node (editing context). */
  within?: string | null
  tolerancePx?: number
  /** Include light markers / section helpers. */
  helpers?: boolean
  /** Include preview/ghost objects (never by default). */
  hidden?: ReadonlySet<string> | null
}

const TYPE_PRIORITY: Partial<Record<AnyNode['type'], number>> = {
  opening: 0,
  furniture: 1,
  dimension: 1,
  leader: 1,
  line: 2,
  polyline: 2,
  rect: 2,
  circle: 2,
  arc: 2,
  ellipse: 2,
  spline: 2,
  hatch: 3,
  light: 1,
  section: 1,
  column: 3,
  beam: 3,
  railing: 3,
  wall: 5,
  slab: 6,
  roof: 6,
  room: 7,
  terrain: 8,
}

export class Picker {
  private doc: CadDocument
  private sync: SceneSync
  private viewState: ViewStateApplier
  private raycaster = new THREE.Raycaster()
  private stateFor: (vp: Viewport) => ViewportSceneState

  constructor(doc: CadDocument, sync: SceneSync, viewState: ViewStateApplier, stateFor: (vp: Viewport) => ViewportSceneState) {
    this.doc = doc
    this.sync = sync
    this.viewState = viewState
    this.stateFor = stateFor
    this.raycaster.firstHitOnly = false
    this.raycaster.params.Line2 = { threshold: 6 }
    this.raycaster.params.Line = { threshold: 0.02 }
    this.raycaster.params.Points = { threshold: 0.02 }
  }

  /** Prepare the shared scene for the given viewport (visibility/plan state) and set the ray. */
  private prepare(vp: Viewport, ndc: THREE.Vector2, tolerancePx: number): void {
    this.viewState.apply(this.stateFor(vp))
    this.sync.flushMatrices()
    this.raycaster.setFromCamera(ndc, vp.camera)
    this.raycaster.params.Line2 = { threshold: tolerancePx }
    const wpp = vp.worldPerPixel(this.raycaster.ray.origin)
    this.raycaster.params.Line = { threshold: wpp * tolerancePx }
  }

  /** Pick the best node under the pointer. */
  pick(vp: Viewport, ndc: THREE.Vector2, opts: PickOptions = {}): PickHit | null {
    const hits = this.pickAll(vp, ndc, opts)
    return hits[0] ?? null
  }

  /** All candidate hits, best first (distance with CAD priority tie-breaks). */
  pickAll(vp: Viewport, ndc: THREE.Vector2, opts: PickOptions = {}): PickHit[] {
    this.prepare(vp, ndc, opts.tolerancePx ?? 6)
    const raw = this.raycaster.intersectObjects(this.sync.root.children, true)
    // batched parts render from shared buffers; their standalone meshes (per-geometry BVH) are picked directly
    const before = raw.length
    this.sync.raycastBatched(this.raycaster, raw)
    if (raw.length !== before) raw.sort((a, b) => a.distance - b.distance)
    const out: PickHit[] = []
    const seen = new Set<string>()
    for (const h of raw) {
      const obj = h.object
      if (!this.isVisible(obj)) continue
      if (obj.userData.cap) continue
      if (obj.userData.helper && !opts.helpers && !obj.userData.nodeId) continue
      let nodeId: string | null = null
      let instanceId: number | null = null
      if (obj.userData.instanced && h.instanceId !== undefined) {
        instanceId = h.instanceId
        nodeId = this.sync.instancing.nodeIdAt(obj as THREE.InstancedMesh, h.instanceId)
      } else nodeId = this.sync.nodeIdOf(obj)
      if (!nodeId) continue
      const node = this.doc.getNode(nodeId) as AnyNode | undefined
      if (!node) continue
      if (opts.exclude?.has(nodeId)) continue
      if (opts.hidden?.has(nodeId)) continue
      if (opts.within && nodeId !== opts.within && !this.doc.isAncestor(opts.within, nodeId)) continue
      if (opts.skipLocked && this.doc.isEffectivelyLocked(nodeId)) continue
      if (opts.filter && !opts.filter(node)) continue
      const key = `${nodeId}:${h.distance.toFixed(5)}`
      if (seen.has(key)) continue
      seen.add(key)
      const flat = !!(obj.userData.lineStyle || obj.userData.hatch || obj.userData.isText)
      let normal: THREE.Vector3 | null = null
      if (h.face && !flat) {
        normal = h.face.normal.clone()
        const nm = _nm.getNormalMatrix(obj.matrixWorld)
        if (instanceId !== null) {
          ;(obj as THREE.InstancedMesh).getMatrixAt(instanceId, _im)
          _im.premultiply(obj.matrixWorld)
          nm.getNormalMatrix(_im)
        }
        normal.applyNormalMatrix(nm).normalize()
        // face the camera side
        if (normal.dot(this.raycaster.ray.direction) > 0 && (obj as THREE.Mesh).material && ((obj as THREE.Mesh).material as THREE.Material).side === THREE.DoubleSide) normal.negate()
      } else if (flat) {
        normal = new THREE.Vector3(0, 0, 1).transformDirection(obj.matrixWorld)
      }
      out.push({ nodeId, point: h.point.clone(), normal, object: obj, distance: h.distance, faceIndex: h.faceIndex ?? null, instanceId, flat })
    }
    out.sort((a, b) => {
      // flat 2D entities lying on surfaces win within a small depth band
      const bias = (x: PickHit) => (x.flat ? -0.01 : 0)
      const da = a.distance + bias(a)
      const db = b.distance + bias(b)
      if (Math.abs(da - db) > 2e-3) return da - db
      const pa = TYPE_PRIORITY[this.doc.getNode(a.nodeId)!.type] ?? 4
      const pb = TYPE_PRIORITY[this.doc.getNode(b.nodeId)!.type] ?? 4
      return pa - pb
    })
    return out
  }

  private isVisible(obj: THREE.Object3D): boolean {
    let o: THREE.Object3D | null = obj
    while (o) {
      if (!o.visible) return false
      o = o.parent
    }
    return true
  }

  /**
   * Selection target for a hit: the outermost grouping ancestor (group/boolean/instance) below the
   * editing context and level. Openings stay individually selectable inside walls.
   */
  selectionTarget(nodeId: string, editingContext: string | null): string {
    let cur = nodeId
    let parent = this.doc.getParent(cur)
    while (parent && parent !== editingContext) {
      const p = this.doc.getNode(parent)
      if (!p || p.type === 'level') break
      if (p.type === 'group' || p.type === 'boolean' || p.type === 'instance') cur = parent
      else break
      parent = this.doc.getParent(cur)
    }
    return cur
  }

  /**
   * Nodes whose projected bounds pass the box in `mode`. Candidates = selectable top-level nodes
   * (children of the editing context / levels / root), never levels themselves.
   */
  boxSelect(vp: Viewport, rect: Rect, mode: BoxMode, editingContext: string | null, hidden: ReadonlySet<string>): string[] {
    this.viewState.apply(this.stateFor(vp))
    this.sync.flushMatrices()
    const out: string[] = []
    const cam = vp.camera
    const w = vp.rect.w
    const h = vp.rect.h
    const candidates = this.selectableRoots(editingContext)
    const corners = new Float32Array(16)
    for (const id of candidates) {
      if (hidden.has(id) || !this.doc.isEffectivelyVisible(id) || this.doc.isEffectivelyLocked(id)) continue
      const b = this.sync.worldBounds([id], _box)
      if (b.isEmpty()) continue
      let k = 0
      for (let i = 0; i < 8; i++) {
        _v.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).project(cam)
        corners[k++] = _v.x
        corners[k++] = _v.y
      }
      const r = rectFromPoints(corners, w, h)
      if (r && classifyBox(r, rect, mode)) out.push(id)
    }
    return out
  }

  /** Top-level selectable ids under the editing context (or every level/root child). */
  selectableRoots(editingContext: string | null): string[] {
    if (editingContext) return [...this.doc.getChildren(editingContext)]
    const out: string[] = []
    for (const id of this.doc.getChildren(null)) {
      const n = this.doc.getNode(id)
      if (!n) continue
      if (n.type === 'level') for (const c of this.doc.getChildren(id)) out.push(c)
      else out.push(id)
    }
    return out
  }

  /** Ray for a viewport/ndc without picking (tools' rayPlane). */
  ray(vp: Viewport, ndc: THREE.Vector2, out: THREE.Ray): THREE.Ray {
    this.raycaster.setFromCamera(ndc, vp.camera)
    out.copy(this.raycaster.ray)
    return out
  }
}

const _nm = new THREE.Matrix3()
const _im = new THREE.Matrix4()
const _box = new THREE.Box3()
const _v = new THREE.Vector3()
