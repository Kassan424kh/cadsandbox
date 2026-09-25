// Placement math shared by the place tool, Editor.insert() and Editor.dragPreview(): where a
// dropped node/snapshot goes (snapped point, orientation from the surface normal + R rotations).
import * as THREE from 'three'
import type { AnyNode, CadDocument, DocSnapshot, NewNode, Quat, Transform, Vec3 } from '@cadsandbox/doc'
import { composeMatrix, decomposeMatrix, invertMatrix, makeNode, multiplyMatrices, quatFromAxisAngle, transformPoint } from '@cadsandbox/doc'
import type { SnapResult } from '../tools/types'
import type { PreviewLayer } from '../core/previewLayer'

export type PlaceContent = { node: NewNode } | { snapshot: DocSnapshot }

export interface Placement {
  point: Vec3
  /** World rotation applied to the content (yaw + optional surface alignment) */
  rotation: Quat
}

/** Orientation for a drop: upright with yaw on floors; against walls the back (+Y) faces the wall. */
export function placementRotation(normal: Vec3 | null, yawSteps: number): Quat {
  let yaw = yawSteps * (Math.PI / 2)
  if (normal && Math.abs(normal[2]) < 0.5) {
    // local +Y should point into the wall (= -normal)
    yaw += Math.atan2(-normal[1], -normal[0]) - Math.PI / 2
  }
  return quatFromAxisAngle([0, 0, 1], yaw)
}

export function placementFromSnap(snap: SnapResult, yawSteps: number): Placement {
  return { point: snap.point, rotation: placementRotation(snap.normal, yawSteps) }
}

/** World transform of a new node placed at `p` (keeps its own rotation/scale composed after the yaw). */
export function placedTransform(base: Transform | undefined, p: Placement): Transform {
  const t: Transform = base ? { p: [...base.p] as Vec3, r: [...base.r] as Quat, s: [...base.s] as Vec3 } : { p: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }
  const rot = composeMatrix({ p: p.point, r: p.rotation, s: [1, 1, 1] })
  const own = composeMatrix({ p: [0, 0, 0], r: t.r, s: t.s })
  return decomposeMatrix(multiplyMatrices(rot, own))
}

/** Convert a world transform into `parent` space. */
export function toParentSpace(doc: CadDocument, parent: string | null, world: Transform): Transform {
  return decomposeMatrix(multiplyMatrices(invertMatrix(doc.getWorldMatrix(parent)), composeMatrix(world)))
}

/** Ghost preview of content following the cursor. */
export class GhostPreview {
  private preview: PreviewLayer
  private handles: { handle: string; node: AnyNode; relative: THREE.Matrix4 }[] = []
  private content: PlaceContent | null = null

  constructor(preview: PreviewLayer) {
    this.preview = preview
  }

  set(content: PlaceContent | null): void {
    this.clear()
    this.content = content
    if (!content) return
    if ('node' in content) {
      const node = makeNode(content.node) as AnyNode
      const relative = new THREE.Matrix4()
      this.handles.push({ handle: this.preview.node({ ...node, t: { p: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] } }, { opacity: 0.55 }), node, relative })
    } else {
      const snap = content.snapshot
      const byId = new Map(snap.nodes.map((n) => [n.id, n]))
      const worldOf = (n: AnyNode): Float64Array => {
        const chain: AnyNode[] = [n]
        let p = n.parent ? byId.get(n.parent) : undefined
        while (p) {
          chain.push(p)
          p = p.parent ? byId.get(p.parent) : undefined
        }
        let m = composeMatrix(chain[chain.length - 1]!.t)
        for (let i = chain.length - 2; i >= 0; i--) m = multiplyMatrices(m, composeMatrix(chain[i]!.t))
        return m
      }
      const origin = snapshotOrigin(snap)
      const originInv = invertMatrix(composeMatrix({ p: origin, r: [0, 0, 0, 1], s: [1, 1, 1] }))
      for (const n of snap.nodes) {
        if (n.type === 'group' || n.type === 'level') continue
        const rel = multiplyMatrices(originInv, worldOf(n))
        const relative = new THREE.Matrix4().fromArray(Array.from(rel))
        this.handles.push({ handle: this.preview.node({ ...n, t: decomposeMatrix(rel) }, { opacity: 0.55 }), node: n, relative })
      }
    }
  }

  /** Move the ghost to a placement. */
  place(p: Placement): void {
    const m = new THREE.Matrix4().fromArray(Array.from(composeMatrix({ p: p.point, r: p.rotation, s: [1, 1, 1] })))
    for (const h of this.handles) {
      const world = new THREE.Matrix4().multiplyMatrices(m, h.relative)
      const arr = new Float64Array(16)
      world.toArray(arr as unknown as number[])
      this.preview.updateNode(h.handle, { ...h.node, t: decomposeMatrix(arr) })
    }
  }

  get active(): boolean {
    return this.content !== null
  }

  clear(): void {
    for (const h of this.handles) this.preview.remove(h.handle)
    this.handles = []
    this.content = null
  }
}

/** Snapshot origin: min-z center of its bounds when known, else the first root position. */
export function snapshotOrigin(snap: DocSnapshot): Vec3 {
  if (snap.bounds) return [(snap.bounds.min[0] + snap.bounds.max[0]) / 2, (snap.bounds.min[1] + snap.bounds.max[1]) / 2, snap.bounds.min[2]]
  const root = snap.nodes.find((n) => n.parent === null)
  return root ? [...root.t.p] as Vec3 : [0, 0, 0]
}

/** Insert content at a placement as ONE undo step. Returns new root ids. */
export function commitPlacement(doc: CadDocument, content: PlaceContent, p: Placement, parent: string | null): string[] {
  doc.stopCapturing()
  let ids: string[] = []
  try {
    ids = doc.transact(() => {
      if ('node' in content) {
        const world = placedTransform(content.node.t, p)
        const local = toParentSpace(doc, parent, world)
        return doc.addNodes([{ ...content.node, parent, t: local }])
      }
      const snap = content.snapshot
      const origin = snapshotOrigin(snap)
      const roots = doc.insertSnapshot(snap, { parent, offset: [p.point[0] - origin[0], p.point[1] - origin[1], p.point[2] - origin[2]] })
      // rotate the inserted roots about the drop point
      const rot = composeMatrix({ p: p.point, r: p.rotation, s: [1, 1, 1] })
      const unrot = composeMatrix({ p: [-p.point[0], -p.point[1], -p.point[2]], r: [0, 0, 0, 1], s: [1, 1, 1] })
      const delta = multiplyMatrices(rot, unrot)
      const parentInv = invertMatrix(doc.getWorldMatrix(parent))
      const entries: [string, Transform][] = roots.map((id) => [id, decomposeMatrix(multiplyMatrices(parentInv, multiplyMatrices(delta, doc.getWorldMatrix(id))))])
      doc.setTransforms(entries)
      return roots
    })
  } finally {
    doc.stopCapturing()
  }
  return ids
}

export const worldPoint = (m: Float64Array, v: Vec3): Vec3 => transformPoint(m, v)
