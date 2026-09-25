// Drafting entities → 2D curves in their PARENT's local XY (node transform applied). Used by
// trim/extend/fillet/offset/hatch and by the mock picker.
import type { AnyNode, CadDocument, Contour, NodeBase, PathData, Vec2 } from '@cadsandbox/doc'
import { DRAFTING_TYPES } from '@cadsandbox/doc'
import { arcFromBulge, arcPoint, arcSweep, flattenPolyline, normalizeArc, sampleArc, sampleCircle, sampleEllipse, type ArcDef } from './arcs'
import { distanceToSegment, projectParam, rotatedRect, type Seg2 } from './polygon'
import { positiveAngle, v2, yawOf } from './vec'
import { wallOutline } from './walls'

export type Curve = { kind: 'seg'; a: Vec2; b: Vec2 } | { kind: 'arc'; arc: ArcDef }

/** Node-local XY → parent-local XY (translation + yaw + XY scale of node.t). */
export function nodeToParent2(node: AnyNode): (p: Vec2) => Vec2 {
  const yaw = yawOf(node.t.r)
  const [sx, sy] = node.t.s
  const [tx, ty] = node.t.p
  const c = Math.cos(yaw),
    s = Math.sin(yaw)
  return (p) => {
    const x = p[0] * sx,
      y = p[1] * sy
    return [tx + x * c - y * s, ty + x * s + y * c]
  }
}

/** Parent-local XY → node-local XY. */
export function parentToNode2(node: AnyNode): (p: Vec2) => Vec2 {
  const yaw = yawOf(node.t.r)
  const [sx, sy] = node.t.s
  const [tx, ty] = node.t.p
  const c = Math.cos(-yaw),
    s = Math.sin(-yaw)
  return (p) => {
    const x = p[0] - tx,
      y = p[1] - ty
    return [(x * c - y * s) / (sx || 1), (x * s + y * c) / (sy || 1)]
  }
}

export function isDrafting(node: AnyNode): boolean {
  return (DRAFTING_TYPES as readonly string[]).includes(node.type)
}

/** Sample a cubic Bézier contour to points (closed contours omit the repeated first point). */
export function sampleContour(c: Contour, perSpan = 12): Vec2[] {
  const n = c.points.length
  if (n === 0) return []
  const out: Vec2[] = [[c.points[0].p[0], c.points[0].p[1]]]
  const spans = c.closed ? n : n - 1
  for (let i = 0; i < spans; i++) {
    const p0 = c.points[i]
    const p1 = c.points[(i + 1) % n]
    const h0 = p0.ho ?? p0.p
    const h1 = p1.hi ?? p1.p
    const straight = !p0.ho && !p1.hi
    if (straight) {
      if (!(c.closed && i === spans - 1)) out.push([p1.p[0], p1.p[1]])
      continue
    }
    const last = c.closed && i === spans - 1 ? perSpan - 1 : perSpan
    for (let k = 1; k <= last; k++) {
      const t = k / perSpan
      const mt = 1 - t
      const a = mt * mt * mt,
        b = 3 * mt * mt * t,
        cc = 3 * mt * t * t,
        d = t * t * t
      out.push([a * p0.p[0] + b * h0[0] + cc * h1[0] + d * p1.p[0], a * p0.p[1] + b * h0[1] + cc * h1[1] + d * p1.p[1]])
    }
  }
  return out
}

export function samplePath(path: PathData, perSpan = 12): { points: Vec2[]; closed: boolean }[] {
  return path.contours.map((c) => ({ points: sampleContour(c, perSpan), closed: c.closed }))
}

/** Exact curves (segments + arcs) of a drafting entity in parent space; ellipses/splines are sampled. */
export function entityCurves(node: AnyNode): Curve[] {
  const toP = nodeToParent2(node)
  switch (node.type) {
    case 'line':
      return [{ kind: 'seg', a: toP(node.params.a), b: toP(node.params.b) }]
    case 'polyline': {
      const { points, bulges, closed } = node.params
      const out: Curve[] = []
      const n = points.length
      const segs = closed ? n : n - 1
      for (let i = 0; i < segs; i++) {
        const a = toP(points[i]),
          b = toP(points[(i + 1) % n])
        const arc = bulges?.[i] ? arcFromBulge(a, b, bulges[i]) : null
        out.push(arc ? { kind: 'arc', arc } : { kind: 'seg', a, b })
      }
      return out
    }
    case 'rect': {
      const corners = rotatedRect([node.t.p[0], node.t.p[1]], node.params.width * node.t.s[0], node.params.height * node.t.s[1], yawOf(node.t.r))
      return corners.map((c, i) => ({ kind: 'seg', a: c, b: corners[(i + 1) % 4] }))
    }
    case 'circle': {
      const r = node.params.radius * node.t.s[0]
      return [{ kind: 'arc', arc: { center: [node.t.p[0], node.t.p[1]], radius: r, start: 0, end: Math.PI * 2 } }]
    }
    case 'arc': {
      const yaw = yawOf(node.t.r)
      const r = node.params.radius * node.t.s[0]
      return [{ kind: 'arc', arc: normalizeArc([node.t.p[0], node.t.p[1]], r, node.params.start + yaw, node.params.end + yaw) }]
    }
    case 'ellipse': {
      const pts = sampleEllipse([node.t.p[0], node.t.p[1]], node.params.rx * node.t.s[0], node.params.ry * node.t.s[1], yawOf(node.t.r))
      return polyCurves(pts, true)
    }
    case 'spline': {
      const out: Curve[] = []
      for (const c of samplePath(node.params.path)) out.push(...polyCurves(c.points.map(toP), c.closed))
      return out
    }
    case 'hatch':
      return polyCurves(node.params.boundary.map(toP), true)
    case 'wall':
      return polyCurves(wallOutline(node.params), true)
    case 'slab':
    case 'room':
      return polyCurves(node.params.outline.map(toP), true)
    case 'shape': {
      if (node.params.profile === 'path' && node.params.path) {
        const out: Curve[] = []
        for (const c of samplePath(node.params.path)) out.push(...polyCurves(c.points.map(toP), c.closed))
        return out
      }
      const corners = rotatedRect([node.t.p[0], node.t.p[1]], node.params.width * node.t.s[0], node.params.height * node.t.s[1], yawOf(node.t.r))
      return corners.map((c, i) => ({ kind: 'seg', a: c, b: corners[(i + 1) % 4] }))
    }
    default:
      return []
  }
}

function polyCurves(points: Vec2[], closed: boolean): Curve[] {
  const out: Curve[] = []
  const n = points.length
  for (let i = 0; i < (closed ? n : n - 1); i++) out.push({ kind: 'seg', a: points[i], b: points[(i + 1) % n] })
  return out
}

/** Flattened segments of an entity in parent space. */
export function entitySegments(node: AnyNode): Seg2[] {
  const out: Seg2[] = []
  for (const c of entityCurves(node)) {
    if (c.kind === 'seg') out.push({ a: c.a, b: c.b })
    else {
      const pts = sampleArc(c.arc)
      for (let i = 0; i < pts.length - 1; i++) out.push({ a: pts[i], b: pts[i + 1] })
    }
  }
  return out
}

/** Flattened outline (parent space) of closed 2D entities, or null when open/unsupported. */
export function entityOutline(node: AnyNode): Vec2[] | null {
  const toP = nodeToParent2(node)
  switch (node.type) {
    case 'polyline':
      return node.params.closed && node.params.points.length >= 3 ? flattenPolyline(node.params.points, node.params.bulges, true).map(toP) : null
    case 'rect':
      return rotatedRect([node.t.p[0], node.t.p[1]], node.params.width * node.t.s[0], node.params.height * node.t.s[1], yawOf(node.t.r))
    case 'circle':
      return sampleCircle([node.t.p[0], node.t.p[1]], node.params.radius * node.t.s[0])
    case 'ellipse':
      return sampleEllipse([node.t.p[0], node.t.p[1]], node.params.rx * node.t.s[0], node.params.ry * node.t.s[1], yawOf(node.t.r))
    case 'spline': {
      const c = node.params.path.contours[0]
      return c && c.closed && c.points.length >= 3 ? sampleContour(c).map(toP) : null
    }
    case 'hatch':
      return node.params.boundary.map(toP)
    case 'wall':
      return wallOutline(node.params)
    case 'slab':
    case 'room':
      return node.params.outline.map(toP)
    default:
      return null
  }
}

/** Distance from p to a curve and the closest point on it. */
export function closestOnCurve(c: Curve, p: Vec2): { point: Vec2; distance: number; t: number } {
  if (c.kind === 'seg') {
    const t = projectParam(p, c.a, c.b)
    const point = v2.lerp(c.a, c.b, t)
    return { point, distance: v2.dist(p, point), t }
  }
  const { arc } = c
  const ang = positiveAngle(Math.atan2(p[1] - arc.center[1], p[0] - arc.center[0]))
  const sweep = arcSweep(arc)
  let rel = ang - arc.start
  if (rel < 0) rel += Math.PI * 2
  if (rel <= sweep) {
    const point = arcPoint(arc, arc.start + rel)
    return { point, distance: v2.dist(p, point), t: rel / sweep }
  }
  const s = arcPoint(arc, arc.start),
    e = arcPoint(arc, arc.end)
  const ds = v2.dist(p, s),
    de = v2.dist(p, e)
  return ds < de ? { point: s, distance: ds, t: 0 } : { point: e, distance: de, t: 1 }
}

export interface CurveHit {
  node: AnyNode
  curveIndex: number
  curve: Curve
  point: Vec2
  distance: number
  t: number
}

/** Nearest drafting entity curve to p among nodes (parent space). */
export function nearestCurve(nodes: readonly AnyNode[], p: Vec2, maxDistance: number): CurveHit | null {
  let best: CurveHit | null = null
  for (const node of nodes) {
    entityCurves(node).forEach((curve, curveIndex) => {
      const c = closestOnCurve(curve, p)
      if (c.distance <= maxDistance && (!best || c.distance < best.distance)) best = { node, curveIndex, curve, point: c.point, distance: c.distance, t: c.t }
    })
  }
  return best
}

export function segmentDistance(seg: Seg2, p: Vec2): number {
  return distanceToSegment(p, seg.a, seg.b)
}

/** Visible, unlocked children of `parent` of the given types. */
export function siblingsOfType(doc: CadDocument, parent: string | null, types: readonly AnyNode['type'][], exclude: Iterable<string> = []): AnyNode[] {
  const ex = new Set(exclude)
  const out: AnyNode[] = []
  for (const id of doc.getChildren(parent)) {
    if (ex.has(id)) continue
    const n = doc.getNode(id) as AnyNode | undefined
    if (!n || !types.includes(n.type)) continue
    if (!doc.isEffectivelyVisible(id) || doc.isEffectivelyLocked(id)) continue
    out.push(n)
  }
  return out
}

export type LineNode = NodeBase<'line'>
export type PolylineNode = NodeBase<'polyline'>
