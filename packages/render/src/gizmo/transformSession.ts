// TransformSession — one interactive transform of the selection = one undo step. World-space
// deltas are converted to each node's parent space. With a render-side preview the nodes follow the
// pointer at frame rate while the document is written at ~15 Hz (collaborators see the motion,
// dependent geometry re-evaluates at that rate) plus one exact final write; without a preview
// (hosted openings, tests) the document is updated at most once per animation frame.
import * as THREE from 'three'
import type { CadDocument, NodeBase, NodePatch, Transform } from '@cadsandbox/doc'
import { decomposeMatrix, invertMatrix, multiplyMatrices, type Mat4 } from '@cadsandbox/doc'
import { WallFrame } from '@cadsandbox/geometry'
import { mat4FromDoc } from '../util/math'

interface Entry {
  id: string
  initialWorld: THREE.Matrix4
  parentInv: Mat4
  initialLocal: Transform
  /** Door/window hosted in a wall: the move slides it along the wall (params.offset), never its t. */
  host: HostedOpening | null
}

interface HostedOpening {
  frame: WallFrame
  wallWorld: THREE.Matrix4
  wallInv: THREE.Matrix4
  offset0: number
  width: number
}

type Patch = { id: string; patch: NodePatch }

/** Render-side transform preview (SceneSync.setPreviewTransform). */
export interface TransformPreview {
  setPreviewTransform(id: string, local: THREE.Matrix4 | null): void
}

/** Document write cadence while a preview carries the visible motion. */
const WRITE_INTERVAL_MS = 66

export class TransformSession {
  private doc: CadDocument
  private preview: TransformPreview | null
  private entries: Entry[] = []
  private pending: Patch[] | null = null
  private raf = 0
  private timer = 0
  private lastWrite = 0
  private previewing = false
  private active = false
  readonly pivot = new THREE.Vector3()
  /** Rotation frame for local-space gizmos (first node's world rotation). */
  readonly frame = new THREE.Quaternion()

  constructor(doc: CadDocument, preview?: TransformPreview | null) {
    this.doc = doc
    this.preview = preview ?? null
  }

  get isActive(): boolean {
    return this.active
  }

  get ids(): string[] {
    return this.entries.map((e) => e.id)
  }

  /** Capture initial transforms of top-level ids (descendants follow their parents). */
  start(ids: readonly string[], pivot: THREE.Vector3): void {
    this.entries = []
    const roots = this.doc.topLevel(ids).filter((id) => !this.doc.isEffectivelyLocked(id))
    for (const id of roots) {
      const node = this.doc.getNode(id)
      if (!node) continue
      const world = mat4FromDoc(this.doc.getWorldMatrix(id))
      const host = node.type === 'opening' ? this.hostOf(node as NodeBase<'opening'>) : null
      this.entries.push({ id, initialWorld: world, parentInv: invertMatrix(this.doc.getWorldMatrix(node.parent)), initialLocal: node.t, host })
    }
    this.pivot.copy(pivot)
    if (this.entries[0]) this.entries[0].initialWorld.decompose(_p, this.frame, _s)
    else this.frame.identity()
    this.active = true
    this.lastWrite = 0
    this.doc.stopCapturing()
  }

  /** world' = delta × world for every node. */
  applyWorldDelta(delta: THREE.Matrix4): void {
    this.apply((e) => _m.multiplyMatrices(delta, e.initialWorld))
  }

  /** Custom per-node world matrix. */
  apply(fn: (entry: { id: string; initialWorld: THREE.Matrix4 }) => THREE.Matrix4): void {
    if (!this.active) return
    const patches: Patch[] = []
    // hosted openings are placed by the evaluator (params.offset) → no render-side preview for them
    const preview = this.preview && !this.entries.some((e) => e.host) ? this.preview : null
    for (const e of this.entries) {
      const world = fn(e)
      if (e.host) {
        patches.push({ id: e.id, patch: { params: { offset: hostedOffset(e, e.host, world) } } })
        continue
      }
      const local = multiplyMatrices(e.parentInv, toMat4(world))
      if (preview) preview.setPreviewTransform(e.id, _local.fromArray(local))
      patches.push({ id: e.id, patch: { t: decomposeMatrix(local) } })
    }
    this.pending = patches
    if (preview) {
      this.previewing = true
      const due = this.lastWrite + WRITE_INTERVAL_MS - performance.now()
      if (due <= 0) this.flush()
      else if (!this.timer)
        this.timer = window.setTimeout(() => {
          this.timer = 0
          this.flush()
        }, due)
    } else if (!this.raf) this.raf = requestAnimationFrame(() => this.flush())
  }

  private flush(): void {
    this.raf = 0
    if (!this.pending) return
    const p = this.pending
    this.pending = null
    this.lastWrite = performance.now()
    this.doc.updateNodes(p)
  }

  private clearTimers(): void {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
    if (this.timer) clearTimeout(this.timer)
    this.timer = 0
  }

  private clearPreviews(): void {
    if (!this.previewing || !this.preview) return
    this.previewing = false
    for (const e of this.entries) if (!e.host) this.preview.setPreviewTransform(e.id, null)
  }

  private hostOf(node: NodeBase<'opening'>): HostedOpening | null {
    const wall = node.parent ? this.doc.getNode(node.parent) : undefined
    if (!wall || wall.type !== 'wall') return null
    const wallWorld = mat4FromDoc(this.doc.getWorldMatrix(wall.id))
    return { frame: new WallFrame((wall as NodeBase<'wall'>).params, null), wallWorld, wallInv: wallWorld.clone().invert(), offset0: node.params.offset, width: node.params.width }
  }

  end(): void {
    if (!this.active) return
    this.clearTimers()
    this.flush() // exact final transforms
    this.clearPreviews()
    this.doc.stopCapturing()
    this.active = false
  }

  cancel(): void {
    if (!this.active) return
    this.clearTimers()
    this.pending = null
    this.clearPreviews()
    this.doc.updateNodes(this.entries.map((e): Patch => ({ id: e.id, patch: e.host ? { params: { offset: e.host.offset0 } } : { t: e.initialLocal } })))
    this.doc.stopCapturing()
    this.active = false
  }
}

const _local = new THREE.Matrix4()

function toMat4(m: THREE.Matrix4): Mat4 {
  const out = new Float64Array(16)
  for (let i = 0; i < 16; i++) out[i] = m.elements[i]!
  return out
}

/**
 * New params.offset of a hosted opening after the world delta (world × initialWorld⁻¹): the delta is
 * applied to the opening's insertion point on the wall, the result projected back onto the wall's
 * reference curve (straight or arc) and clamped so the opening stays inside the wall.
 */
function hostedOffset(e: Entry, h: HostedOpening, world: THREE.Matrix4): number {
  const f = h.frame
  const p0 = f.point(f.sFromRef(h.offset0), 0)
  _hp.set(p0[0], p0[1], f.z0).applyMatrix4(h.wallWorld)
  _delta.copy(e.initialWorld).invert().premultiply(world)
  _hp.applyMatrix4(_delta).applyMatrix4(h.wallInv)
  const s = f.toWall([_hp.x, _hp.y])[0]
  const ref = f.L > 0 ? (s / f.L) * f.Lref : s
  const half = Math.min(h.width / 2, f.Lref / 2)
  return Math.min(f.Lref - half, Math.max(half, ref))
}

const _m = new THREE.Matrix4()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()
const _hp = new THREE.Vector3()
const _delta = new THREE.Matrix4()

/** Rotation about an axis through a pivot as a world delta matrix. */
export function rotationAbout(pivot: THREE.Vector3, axis: THREE.Vector3, angle: number, out = new THREE.Matrix4()): THREE.Matrix4 {
  out.makeRotationAxis(axis, angle)
  _t.copy(pivot).applyMatrix4(out)
  out.setPosition(pivot.x - _t.x, pivot.y - _t.y, pivot.z - _t.z)
  return out
}

/** Scale about a pivot along an orthonormal basis (columns u, v, n). */
export function scaleAbout(pivot: THREE.Vector3, basis: THREE.Matrix4, sx: number, sy: number, sz: number, out = new THREE.Matrix4()): THREE.Matrix4 {
  _b.copy(basis)
  _bi.copy(basis).invert()
  out.makeScale(sx, sy, sz)
  out.premultiply(_b).multiply(_bi)
  _t.copy(pivot).applyMatrix4(out)
  const e = out.elements
  e[12] += pivot.x - _t.x
  e[13] += pivot.y - _t.y
  e[14] += pivot.z - _t.z
  return out
}

const _t = new THREE.Vector3()
const _b = new THREE.Matrix4()
const _bi = new THREE.Matrix4()
