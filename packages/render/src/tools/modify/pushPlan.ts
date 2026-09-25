// Push/pull "plans": which parameter a face drag changes for every node type, how to preview it,
// and how to commit it. Distances are signed along the face normal (positive = pull outward).
import type { AnyNode, NewNode, NodeBase, NodePatch, PathPoint, Transform, Vec2, Vec3 } from '@cadsandbox/doc'
import { decomposeMatrix, makeNode, rotateVec3 } from '@cadsandbox/doc'
import type { ToolContext } from '../types'
import { flattenPolyline, sampleCircle, sampleEllipse } from '../util/arcs'
import { conjugate } from '../util/frame'
import { bounds2, lineIntersection, rotatedRect } from '../util/polygon'
import { sampleContour } from '../util/scene'
import { v2, v3 } from '../util/vec'
import { wallAxis } from '../util/walls'

export interface Face {
  node: AnyNode
  /** World unit normal of the face */
  normal: Vec3
  /** World hit point */
  point: Vec3
  /** Face normal in node-local axes */
  local: Vec3
}

export type PushCommit = { kind: 'patch'; id: string; patch: NodePatch } | { kind: 'replace'; remove: string; add: NewNode }

export interface PushPlan {
  /** Parameter name shown in the hint/label, e.g. "height" */
  label: string
  commit(d: number): PushCommit | null
  /** Full node (parent space) for the ghost preview. */
  preview(d: number): AnyNode | null
}

type Axis = '+x' | '-x' | '+y' | '-y' | '+z' | '-z' | 'other'

export function dominantAxis(n: Vec3): Axis {
  const ax = Math.abs(n[0]),
    ay = Math.abs(n[1]),
    az = Math.abs(n[2])
  const m = Math.max(ax, ay, az)
  if (m < 0.85) return 'other'
  if (m === ax) return n[0] > 0 ? '+x' : '-x'
  if (m === ay) return n[1] > 0 ? '+y' : '-y'
  return n[2] > 0 ? '+z' : '-z'
}

/** Node-local direction of a world vector (rotation only). */
export function worldToLocalDir(ctx: ToolContext, node: AnyNode, world: Vec3): Vec3 {
  const q = decomposeMatrix(ctx.doc.getWorldMatrix(node.id)).r
  return v3.norm(rotateVec3(conjugate(q), world))
}

/** Parent-space translation for a shift along a node-local axis. */
function localShift(node: { t: Transform }, axis: Vec3, amount: number): Vec3 {
  return rotateVec3(node.t.r, v3.scale(axis, amount))
}

function shifted(node: { t: Transform }, axis: Vec3, amount: number): Transform {
  const s = localShift(node, axis, amount)
  return { p: v3.add(node.t.p, s), r: [...node.t.r], s: [...node.t.s] }
}

function patched<T extends AnyNode['type']>(node: NodeBase<T>, params: Partial<NodeBase<T>['params']>, t?: Transform): AnyNode {
  return { ...node, params: { ...node.params, ...params }, t: t ?? node.t } as unknown as AnyNode
}

function planFor<T extends AnyNode['type']>(node: NodeBase<T>, label: string, fn: (d: number) => { params?: Partial<NodeBase<T>['params']>; t?: Transform } | null): PushPlan {
  return {
    label,
    commit(d) {
      const r = fn(d)
      if (!r) return null
      const patch: NodePatch = {}
      if (r.params) (patch as NodePatch<T>).params = r.params
      if (r.t) patch.t = r.t
      return { kind: 'patch', id: node.id, patch }
    },
    preview(d) {
      const r = fn(d)
      return r ? patched(node, r.params ?? {}, r.t) : null
    },
  }
}

const AXES: Record<Exclude<Axis, 'other'>, Vec3> = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0], '+z': [0, 0, 1], '-z': [0, 0, -1] }

/** Size change along an axis for a shape centered on the origin in X/Y and based at Z=0. */
function centeredSize<T extends 'primitive' | 'shape' | 'column'>(node: NodeBase<T>, axis: Axis, key: 'width' | 'depth' | 'height', current: number, d: number) {
  const size = Math.max(0.001, current + d)
  const applied = size - current
  const dir = AXES[axis as Exclude<Axis, 'other'>]
  const t = axis === '+z' ? undefined : axis === '-z' ? shifted(node, [0, 0, 1], -applied) : shifted(node, dir, applied / 2)
  return { params: { [key]: size } as Partial<NodeBase<T>['params']>, t }
}

export function pushPlan(ctx: ToolContext, face: Face): PushPlan | null {
  const node = face.node
  const axis = dominantAxis(face.local)
  switch (node.type) {
    case 'primitive':
      return primitivePlan(node, axis)
    case 'shape':
      return shapePlan(node, axis)
    case 'column': {
      if (axis === 'other') return null
      if (axis === '+z' || axis === '-z') return planFor(node, 'height', (d) => centeredSize(node, axis, 'height', node.params.height, d))
      if (node.params.shape === 'round') return planFor(node, 'diameter', (d) => ({ params: { width: Math.max(0.05, node.params.width + d), depth: Math.max(0.05, node.params.width + d) } }))
      const key = axis === '+x' || axis === '-x' ? 'width' : 'depth'
      return planFor(node, key, (d) => centeredSize(node, axis, key, node.params[key], d))
    }
    case 'slab':
      return slabPlan(ctx, node, face, axis)
    case 'wall':
      return wallPlan(ctx, node, face, axis)
    case 'text':
      if (axis === '+z') return planFor(node, 'depth', (d) => ({ params: { depth: Math.max(0, node.params.depth + d) } }))
      if (axis === '-z') return planFor(node, 'depth', (d) => ({ params: { depth: Math.max(0, node.params.depth + d) }, t: shifted(node, [0, 0, 1], -Math.max(-node.params.depth, d)) }))
      return null
    case 'beam':
      if (axis === '+z' || axis === '-z') return planFor(node, 'height', (d) => ({ params: { height: Math.max(0.02, node.params.height + d) } }))
      if (axis !== 'other') return planFor(node, 'width', (d) => ({ params: { width: Math.max(0.02, node.params.width + d) } }))
      return null
    case 'roof':
      return planFor(node, 'thickness', (d) => ({ params: { thickness: Math.max(0.01, node.params.thickness + d) } }))
    case 'polyline':
    case 'rect':
    case 'circle':
    case 'ellipse':
    case 'spline':
    case 'hatch':
      return convertPlan(ctx, node)
    default:
      return null
  }
}

function primitivePlan(node: NodeBase<'primitive'>, axis: Axis): PushPlan | null {
  if (axis === 'other') return null
  const p = node.params
  const boxLike = p.shape === 'box' || p.shape === 'wedge' || p.shape === 'pyramid' || p.shape === 'plane'
  if (boxLike) {
    if (axis === '+x' || axis === '-x') return planFor(node, 'width', (d) => centeredSize(node, axis, 'width', p.width ?? 1, d))
    if (axis === '+y' || axis === '-y') return planFor(node, 'depth', (d) => centeredSize(node, axis, 'depth', p.depth ?? 1, d))
    if (p.shape === 'plane') return null
    return planFor(node, 'height', (d) => centeredSize(node, axis, 'height', p.height ?? 1, d))
  }
  const round = p.shape === 'sphere' || p.shape === 'icosphere' || p.shape === 'torus'
  if (axis === '+z' || axis === '-z') {
    if (round) return planFor(node, 'radius', (d) => ({ params: { radius: Math.max(0.001, (p.radius ?? 0.5) + d) } }))
    return planFor(node, 'height', (d) => centeredSize(node, axis, 'height', p.height ?? 1, d))
  }
  return planFor(node, 'radius', (d) => ({ params: { radius: Math.max(0.001, (p.radius ?? 0.5) + d) } }))
}

function shapePlan(node: NodeBase<'shape'>, axis: Axis): PushPlan | null {
  const p = node.params
  const dir = p.direction ?? 'up'
  if (axis === '+z' || axis === '-z') {
    return planFor(node, 'depth', (d) => {
      const top = axis === '+z'
      if (dir === 'symmetric') return { params: { depth: Math.max(0, p.depth + 2 * d) } }
      const growsAtFace = dir === 'up' ? top : !top
      const depth = Math.max(0, p.depth + d)
      const applied = depth - p.depth
      if (growsAtFace) return { params: { depth } }
      // Pulling the base face: keep the far face fixed by shifting the node.
      return { params: { depth }, t: shifted(node, [0, 0, 1], top ? applied : -applied) }
    })
  }
  if (axis === 'other' || p.profile === 'path') return null
  const key = axis === '+x' || axis === '-x' ? 'width' : 'height'
  return planFor(node, key, (d) => centeredSize(node, axis, key === 'width' ? 'width' : 'height', p[key], d))
}

function slabPlan(ctx: ToolContext, node: NodeBase<'slab'>, face: Face, axis: Axis): PushPlan | null {
  const p = node.params
  if (axis === '+z') return planFor(node, 'thickness', (d) => ({ params: { offset: p.offset + d, thickness: Math.max(0.01, p.thickness + d) } }))
  if (axis === '-z') return planFor(node, 'thickness', (d) => ({ params: { thickness: Math.max(0.01, p.thickness + d) } }))
  // Side face: move the nearest outline edge whose outward normal matches.
  const local = ctx.toLocal(node.id, face.point)
  const hit: Vec2 = [local[0], local[1]]
  const n2: Vec2 = v2.norm([face.local[0], face.local[1]])
  const outline = p.outline
  const n = outline.length
  if (n < 3) return null
  let best = -1
  let bestD = Infinity
  for (let i = 0; i < n; i++) {
    const a = outline[i],
      b = outline[(i + 1) % n]
    const e = v2.sub(b, a)
    if (v2.len(e) < 1e-9) continue
    const ccw = signedAreaOf(outline) > 0
    const outward = ccw ? v2.scale(v2.perp(v2.norm(e)), -1) : v2.perp(v2.norm(e))
    if (v2.dot(outward, n2) < 0.7) continue
    const t = Math.max(0, Math.min(1, v2.dot(v2.sub(hit, a), e) / v2.dot(e, e)))
    const d = v2.dist(hit, v2.add(a, v2.scale(e, t)))
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  if (best < 0) return null
  return planFor(node, 'edge', (d) => ({ params: { outline: moveEdge(outline, best, d) } }))
}

function signedAreaOf(pts: readonly Vec2[]): number {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i],
      q = pts[(i + 1) % pts.length]
    a += p[0] * q[1] - q[0] * p[1]
  }
  return a / 2
}

/** Move edge i of a polygon outward by d, re-intersecting with the neighbouring edges (miter). */
export function moveEdge(outline: readonly Vec2[], i: number, d: number): Vec2[] {
  const n = outline.length
  const pts = outline.map((p) => [p[0], p[1]] as Vec2)
  const a = pts[i],
    b = pts[(i + 1) % n]
  const e = v2.norm(v2.sub(b, a))
  const ccw = signedAreaOf(pts) > 0
  const outward = ccw ? v2.scale(v2.perp(e), -1) : v2.perp(e)
  const off = v2.scale(outward, d)
  const moved = { a: v2.add(a, off), b: v2.add(b, off) }
  const prev = { a: pts[(i + n - 1) % n], b: a }
  const next = { a: b, b: pts[(i + 2) % n] }
  const na = n > 3 ? lineIntersection(prev, moved) ?? moved.a : moved.a
  const nb = n > 3 ? lineIntersection(moved, next) ?? moved.b : moved.b
  pts[i] = na
  pts[(i + 1) % n] = nb
  return pts
}

function wallPlan(ctx: ToolContext, node: NodeBase<'wall'>, face: Face, axis: Axis): PushPlan | null {
  const p = node.params
  if (axis === '+z') return planFor(node, 'height', (d) => ({ params: { height: Math.max(0.05, p.height + d) } }))
  if (axis === '-z') return planFor(node, 'base', (d) => ({ params: { baseOffset: p.baseOffset - d, height: Math.max(0.05, p.height + d) } }))
  const ax = wallAxis(p)
  const n2: Vec2 = v2.norm([face.local[0], face.local[1]])
  const along = v2.dot(n2, ax.dir)
  if (Math.abs(along) > 0.85) {
    // End face: lengthen the wall at that end (openings keep their world position).
    const atB = along > 0
    return planFor(node, 'length', (d) => {
      if (atB) return { params: { b: v2.add(p.b, v2.scale(ax.dir, d)) } }
      return { params: { a: v2.sub(p.a, v2.scale(ax.dir, d)) } }
    })
  }
  const leftFace = v2.dot(n2, ax.normal) > 0
  return planFor(node, 'thickness', (d) => {
    const thickness = Math.max(0.01, p.thickness + d)
    const applied = thickness - p.thickness
    // Keep the opposite face fixed: the axis moves by the share of the pulled side.
    let shift = 0
    if (p.justification === 'center') shift = applied / 2
    else if (p.justification === 'left') shift = leftFace ? applied : 0
    else shift = leftFace ? 0 : applied
    const s = v2.scale(ax.normal, leftFace ? shift : -shift)
    return { params: { thickness, a: v2.add(p.a, s), b: v2.add(p.b, s) } }
  })
}

/** Closed 2D entity → extruded 'shape' (replaces the source node). */
function convertPlan(ctx: ToolContext, node: AnyNode): PushPlan | null {
  const base = shapeFrom2D(node)
  if (!base) return null
  const build = (d: number): NewNode<'shape'> | null => {
    if (Math.abs(d) < 1e-9) return null
    return {
      ...base,
      params: { ...base.params, depth: Math.abs(d), direction: d >= 0 ? 'up' : 'down' },
    }
  }
  return {
    label: 'extrude',
    commit(d) {
      const add = build(d)
      return add ? { kind: 'replace', remove: node.id, add } : null
    },
    preview(d) {
      const add = build(d)
      return add ? (makeNode(add, node.id) as AnyNode) : null
    },
  }
}

export function shapeFrom2D(node: AnyNode): NewNode<'shape'> | null {
  const common = { parent: node.parent, layer: node.layer, material: node.material, color: node.color, name: node.name === 'Polyline' || node.name === 'Rect' || node.name === 'Circle' ? 'Shape' : node.name }
  const t: Transform = { p: [...node.t.p], r: [...node.t.r], s: [...node.t.s] }
  const baseParams = { depth: 0.1, bevel: 0, bevelSegments: 1, direction: 'up' as const }
  switch (node.type) {
    case 'rect':
      return { type: 'shape', ...common, t, params: { ...baseParams, profile: 'rect', width: node.params.width, height: node.params.height, cornerRadius: node.params.cornerRadius ?? 0 } }
    case 'circle':
      return { type: 'shape', ...common, t, params: { ...baseParams, profile: 'circle', width: node.params.radius * 2, height: node.params.radius * 2 } }
    case 'ellipse':
      return { type: 'shape', ...common, t, params: { ...baseParams, profile: 'ellipse', width: node.params.rx * 2, height: node.params.ry * 2 } }
    case 'polyline': {
      if (!node.params.closed || node.params.points.length < 3) return null
      return pathShape(node, flattenPolyline(node.params.points, node.params.bulges, true).map((p) => ({ p })), common, t)
    }
    case 'spline': {
      const c = node.params.path.contours[0]
      if (!c || !c.closed || c.points.length < 3) return null
      return pathShape(node, c.points.map((pt) => ({ ...pt })), common, t)
    }
    case 'hatch':
      if (node.params.boundary.length < 3) return null
      return pathShape(node, node.params.boundary.map((p) => ({ p })), common, t)
    default:
      return null
  }
}

function pathShape(node: AnyNode, points: PathPoint[], common: Omit<NewNode<'shape'>, 'type' | 'params' | 't'>, t: Transform): NewNode<'shape'> {
  // Re-center the path on its bounding box; the node moves to the box center (in the node's own frame).
  const sampled = sampleContour({ points, closed: true }, 8)
  const bb = bounds2(sampled)!
  const c: Vec2 = [(bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2]
  const rel = (p: Vec2): Vec2 => [p[0] - c[0], p[1] - c[1]]
  const shift = rotateVec3(node.t.r, [c[0] * node.t.s[0], c[1] * node.t.s[1], 0])
  const tt: Transform = { p: v3.add(t.p, shift), r: t.r, s: t.s }
  return {
    type: 'shape',
    ...common,
    t: tt,
    params: {
      profile: 'path',
      width: bb.max[0] - bb.min[0],
      height: bb.max[1] - bb.min[1],
      depth: 0.1,
      bevel: 0,
      bevelSegments: 1,
      direction: 'up',
      path: { contours: [{ closed: true, points: points.map((pt) => ({ p: rel(pt.p), ...(pt.hi ? { hi: rel(pt.hi) } : {}), ...(pt.ho ? { ho: rel(pt.ho) } : {}) })) }] },
    },
  }
}

/** Footprint outline (parent space) of a 2D entity — used to highlight the hovered face. */
export function footprintOf(node: AnyNode): Vec2[] | null {
  switch (node.type) {
    case 'rect':
      return rotatedRect([node.t.p[0], node.t.p[1]], node.params.width, node.params.height, 2 * Math.atan2(node.t.r[2], node.t.r[3]))
    case 'circle':
      return sampleCircle([node.t.p[0], node.t.p[1]], node.params.radius)
    case 'ellipse':
      return sampleEllipse([node.t.p[0], node.t.p[1]], node.params.rx, node.params.ry, 2 * Math.atan2(node.t.r[2], node.t.r[3]))
    default:
      return null
  }
}
