// modify.mirror — mirror the selection across a 2-point axis (keep-original option). Param-based
// entities (lines, polylines, walls, slabs…) get reflected coordinates; placed nodes get a
// reflected position + orientation (path shapes flip their profile, stairs flip their turn).
import { Matrix4 } from 'three'
import type { AnyNode, CadDocument, NodePatch, Quat, Vec2, Vec3 } from '@cadsandbox/doc'
import { makeNode } from '@cadsandbox/doc'
import type { ToolContext, ToolOptionSpec, ToolPointerEvent } from '../types'
import { ToolBase, isPrimary } from '../util/base'
import { parseVcb } from '../util/input'
import { boolOption } from '../util/nodes'
import { entityCurves, nodeToParent2, parentToNode2 } from '../util/scene'
import { fromPlane, quatZ, toPlane, v2, v3, wrapAngle, yawOf } from '../util/vec'

export const MIRROR_OPTIONS: ToolOptionSpec[] = [boolOption('keepOriginal', 'Keep original', true)]

export interface Axis2 {
  /** Point on the axis */
  a: Vec2
  /** Unit direction */
  u: Vec2
}

export function reflectPoint(p: Vec2, axis: Axis2): Vec2 {
  const v = v2.sub(p, axis.a)
  const along = v2.dot(v, axis.u)
  return v2.add(axis.a, v2.sub(v2.scale(axis.u, 2 * along), v))
}

/** Axis expressed in a node parent's frame. */
export function axisInParent(ctx: ToolContext, parent: string | null, worldA: Vec3, worldB: Vec3): Axis2 {
  const la = ctx.toLocal(parent, worldA)
  const lb = ctx.toLocal(parent, worldB)
  const d: Vec2 = [lb[0] - la[0], lb[1] - la[1]]
  return { a: [la[0], la[1]], u: v2.len(d) < 1e-12 ? [1, 0] : v2.norm(d) }
}

/** Patch that mirrors `node` across `axis` (axis in the node's parent frame). */
export function mirrorPatch(node: AnyNode, axis: Axis2): NodePatch {
  const toP = nodeToParent2(node)
  const toN = parentToNode2(node)
  const R = (p: Vec2): Vec2 => toN(reflectPoint(toP(p), axis))
  const R3 = (p: Vec3): Vec3 => {
    const q = R([p[0], p[1]])
    return [q[0], q[1], p[2]]
  }
  const phi = v2.angle(axis.u)
  switch (node.type) {
    case 'line':
      return { params: { a: R(node.params.a), b: R(node.params.b) } }
    case 'polyline':
      return { params: { points: node.params.points.map(R), ...(node.params.bulges ? { bulges: node.params.bulges.map((b) => -b) } : {}) } }
    case 'wall':
      return {
        params: {
          a: R(node.params.a),
          b: R(node.params.b),
          ...(node.params.bulge ? { bulge: -node.params.bulge } : {}),
          justification: node.params.justification === 'left' ? 'right' : node.params.justification === 'right' ? 'left' : 'center',
        },
      }
    case 'slab':
      return { params: { outline: node.params.outline.map(R), ...(node.params.holes ? { holes: node.params.holes.map((h) => h.map(R)) } : {}) } }
    case 'room':
    case 'roof':
      return { params: { outline: node.params.outline.map(R) } }
    case 'hatch':
      return { params: { boundary: node.params.boundary.map(R), ...(node.params.holes ? { holes: node.params.holes.map((h) => h.map(R)) } : {}) } }
    case 'railing':
      return { params: { path: node.params.path.map(R) } }
    case 'leader':
      return { params: { points: node.params.points.map(R) } }
    case 'dimension':
      return { params: { points: node.params.points.map(R3) } }
    case 'beam':
      return { params: { a: R3(node.params.a), b: R3(node.params.b) } }
    case 'spline':
      return {
        params: {
          path: {
            contours: node.params.path.contours.map((c) => ({
              closed: c.closed,
              points: c.points.map((pt) => ({ p: R(pt.p), ...(pt.hi ? { hi: R(pt.hi) } : {}), ...(pt.ho ? { ho: R(pt.ho) } : {}) })),
            })),
          },
        },
      }
    case 'arc': {
      const c = entityCurves(node)[0]
      const arc = c && c.kind === 'arc' ? c.arc : null
      const center = reflectPoint([node.t.p[0], node.t.p[1]], axis)
      const yaw = yawOf(node.t.r)
      if (!arc) return { t: { ...node.t, p: [center[0], center[1], node.t.p[2]] } }
      const start = 2 * phi - arc.end - yaw
      const end = 2 * phi - arc.start - yaw
      return { t: { ...node.t, p: [center[0], center[1], node.t.p[2]] }, params: { start, end } }
    }
    default:
      return placedPatch(node, axis, phi)
  }
}

/** Reflected placement: p' = reflect(p), yaw' = 2φ − yaw (+ local geometry flip where meaningful). */
function placedPatch(node: AnyNode, axis: Axis2, phi: number): NodePatch {
  const p = reflectPoint([node.t.p[0], node.t.p[1]], axis)
  let yaw = wrapAngle(2 * phi - yawOf(node.t.r))
  const patch: NodePatch = {}
  const t = { p: [p[0], p[1], node.t.p[2]] as Vec3, r: quatZ(yaw) as Quat, s: [...node.t.s] as Vec3 }
  if (node.type === 'shape' && node.params.profile === 'path' && node.params.path) {
    // reflect the profile about the local X axis (y → −y)
    const flip = (q: Vec2): Vec2 => [q[0], -q[1]]
    ;(patch as NodePatch<'shape'>).params = {
      path: {
        contours: node.params.path.contours.map((c) => ({
          closed: c.closed,
          points: c.points.map((pt) => ({ p: flip(pt.p), ...(pt.hi ? { hi: flip(pt.hi) } : {}), ...(pt.ho ? { ho: flip(pt.ho) } : {}) })),
        })),
      },
    }
  } else if (node.type === 'stair') {
    // a stair climbing +Y reflected about X climbs −Y: rotate 180° and swap its handedness
    yaw = wrapAngle(yaw + Math.PI)
    t.r = quatZ(yaw)
    const swap = (s: 'left' | 'right') => (s === 'left' ? 'right' : 'left')
    ;(patch as NodePatch<'stair'>).params = {
      turn: swap(node.params.turn),
      railing: node.params.railing === 'left' || node.params.railing === 'right' ? swap(node.params.railing) : node.params.railing,
    }
  }
  patch.t = t
  return patch
}

/** Mirror nodes (top-level ids) across the world axis A→B. Returns the ids of the mirrored nodes. */
export function mirrorNodes(ctx: ToolContext, ids: string[], worldA: Vec3, worldB: Vec3, keepOriginal: boolean): string[] {
  const doc: CadDocument = ctx.doc
  const roots = doc.topLevel(ids)
  if (!roots.length) return []
  return ctx.commit(() => {
    const targets = keepOriginal ? doc.duplicateNodes(roots) : roots
    for (const id of targets) {
      const node = doc.getNode(id) as AnyNode | undefined
      if (!node) continue
      const axis = axisInParent(ctx, node.parent, worldA, worldB)
      doc.updateNode(id, mirrorPatch(node, axis))
      if (node.type === 'wall') {
        // (duplicated children are read via nodesOfType: the child index updates after the transaction)
        for (const o of doc.nodesOfType('opening')) {
          if (o.parent !== id) continue
          const swap = (s: 'left' | 'right') => (s === 'left' ? 'right' : 'left')
          doc.updateNode(o.id, { params: { hinge: swap(o.params.hinge), opensTo: swap(o.params.opensTo) } })
        }
      }
    }
    return targets
  })
}

export class MirrorTool extends ToolBase {
  readonly id = 'modify.mirror' as const
  override readonly specs = MIRROR_OPTIONS
  private a: Vec3 | null = null

  protected override start(): void {
    this.a = null
    this.hint(this.selection().length ? 'Mirror: click the first point of the mirror axis' : 'Mirror: select objects first (click one to select it)')
  }
  protected isBusy(): boolean {
    return this.a !== null
  }
  protected reset(): void {
    this.a = null
    this.clearAll()
    this.clearInput()
    this.hint('Mirror: click the first point of the mirror axis')
  }

  private selection(): string[] {
    return this.ctx.doc.topLevel(this.ctx.editor.getState().selection).filter((id) => !this.ctx.doc.isEffectivelyLocked(id))
  }

  onPointerDown(e: ToolPointerEvent): boolean {
    if (!isPrimary(e)) return false
    if (!this.selection().length) {
      const hit = this.ctx.pick(e)
      if (hit) {
        this.ctx.editor.select([hit.nodeId])
        this.hint('Mirror: click the first point of the mirror axis')
      } else this.ctx.notify('info', 'Select the objects to mirror first')
      return true
    }
    const s = this.snap(e, this.a)
    if (!this.a) {
      this.a = s.point
      this.hint('Click the second point of the axis · type length<angle')
      return true
    }
    this.apply(this.a, s.point)
    return true
  }

  onPointerMove(e: ToolPointerEvent): void {
    this.clearAll()
    const s = this.snap(e, this.a)
    if (!this.a) return
    this.previewAxis(this.a, s.point)
  }

  onInput(text: string): void {
    if (!this.a) return void this.ctx.notify('info', 'Click the first axis point first')
    const v = parseVcb(text, this.ctx)
    if (!v) return
    const plane = this.plane()
    const a = toPlane(plane, this.a)
    const b = v.kind === 'delta' ? v2.add(a, [v.dx, v.dy]) : v.kind === 'polar' ? v2.add(a, v2.fromAngle(v.angle, v.length)) : null
    if (!b) return void this.ctx.notify('info', 'Type the axis as length<angle or dx;dy')
    this.apply(this.a, fromPlane(plane, b))
  }

  private previewAxis(a: Vec3, b: Vec3): void {
    if (v3.dist(a, b) < 1e-9) return
    const dir = v3.norm(v3.sub(b, a))
    this.lines([v3.sub(a, v3.scale(dir, 50)), v3.add(b, v3.scale(dir, 50))], { style: 'guide', dashed: true })
    this.lines([a, b], { style: 'rubber' })
    for (const id of this.selection()) {
      const node = this.ctx.node(id) as AnyNode | undefined
      if (!node) continue
      const axis = axisInParent(this.ctx, node.parent, a, b)
      const patch = mirrorPatch(node, axis)
      const ghost = makeNode({ ...node, ...(patch.t ? { t: patch.t } : {}), params: { ...node.params, ...(patch.params ?? {}) } } as AnyNode, node.id) as AnyNode
      this.ghost(ghost, { opacity: 0.5, parentMatrix: new Matrix4().fromArray(Array.from(this.ctx.doc.getWorldMatrix(node.parent))) })
    }
  }

  private apply(a: Vec3, b: Vec3): void {
    this.clearAll()
    this.clearInput()
    this.a = null
    if (v3.dist(a, b) < 1e-9) return void this.ctx.notify('warning', 'Axis points coincide')
    const ids = mirrorNodes(this.ctx, this.selection(), a, b, this.optBool('keepOriginal', true))
    if (ids.length) {
      this.ctx.editor.select(ids)
      this.ctx.emit('created', { ids, tool: this.id })
      this.ctx.requestRender()
    }
    this.hint('Mirrored · click the first point of another axis')
  }
}
