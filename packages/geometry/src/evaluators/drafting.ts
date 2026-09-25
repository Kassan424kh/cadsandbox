// 2D drafting entities: line, polyline (bulges), rect, circle, arc, ellipse, spline, hatch, leader.
import type { AnyNode, NodeBase, Vec2 } from '@cadsandbox/doc'
import type { GeometryResult, SnapPoint } from '../api'
import { ANNO, DrawingBuilder, readableRotation } from '../core/drawing'
import { hatchSegments } from '../core/hatch'
import { TAU, angleOf, arcSegments, dist2, expandBulges, mid2, normalize2, perp2, polygonCentroid, sub2, wrapAngle } from '../core/math2d'
import { flattenPath, roundCorners } from '../core/path'
import { nestRings, type PolyWithHoles } from '../core/polygon'
import { drawingBounds, emptyResult, snap } from './result'

const textSizeOf = (node: AnyNode, fallback = ANNO.textSize): number => {
  const s = (node.meta as Record<string, unknown>).textSize
  return typeof s === 'number' && s > 0 ? s : fallback
}

function done(d: DrawingBuilder, snaps: SnapPoint[], quantities?: Record<string, number>): GeometryResult {
  const drawing = d.build()
  const res = emptyResult({ drawing })
  res.bounds = drawingBounds(drawing) ?? res.bounds
  if (snaps.length) res.snaps = snaps
  if (quantities) res.quantities = quantities
  return res
}

const fillPolys = (d: DrawingBuilder, polys: PolyWithHoles[], color: string | null | undefined): void => {
  if (color && polys.length) d.fill(polys, 'solid', { color })
}

export function evaluateLine(node: NodeBase<'line'>): GeometryResult {
  const { a, b } = node.params
  const d = new DrawingBuilder()
  d.segP('drafting', a, b)
  const m = mid2(a, b)
  return done(d, [snap('endpoint', a[0], a[1]), snap('endpoint', b[0], b[1]), snap('midpoint', m[0], m[1])], { length: dist2(a, b) })
}

export function evaluatePolyline(node: NodeBase<'polyline'>): GeometryResult {
  const p = node.params
  const pts = (p.points ?? []).filter((q) => Array.isArray(q) && q.length === 2)
  const d = new DrawingBuilder()
  if (pts.length < 2) return done(d, pts.map((q) => snap('endpoint', q[0], q[1])))
  const dense = expandBulges(pts, p.bulges, p.closed)
  d.polyline('drafting', dense, p.closed)
  const snaps: SnapPoint[] = pts.map((q) => snap('endpoint', q[0], q[1]))
  const segs = p.closed ? pts.length : pts.length - 1
  for (let i = 0; i < segs; i++) {
    if (!p.bulges || Math.abs(p.bulges[i] ?? 0) < 1e-9) {
      const m = mid2(pts[i]!, pts[(i + 1) % pts.length]!)
      snaps.push(snap('midpoint', m[0], m[1]))
    }
  }
  let length = 0
  for (let i = 0; i < dense.length - 1; i++) length += dist2(dense[i]!, dense[i + 1]!)
  if (p.closed) length += dist2(dense[dense.length - 1]!, dense[0]!)
  const quantities: Record<string, number> = { length }
  if (p.closed && dense.length >= 3) {
    const polys = nestRings([dense])
    fillPolys(d, polys, p.fill)
    quantities.area = polys.reduce((s, poly) => s + Math.abs(polyArea(poly)), 0)
  }
  return done(d, snaps, quantities)
}

const polyArea = (poly: PolyWithHoles): number => {
  let a = 0
  const ring = poly.outer
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!, q = ring[(i + 1) % ring.length]!
    a += p[0] * q[1] - q[0] * p[1]
  }
  return a / 2
}

export function evaluateRect(node: NodeBase<'rect'>): GeometryResult {
  const p = node.params
  const hw = Math.max(0, p.width) / 2, hh = Math.max(0, p.height) / 2
  const corners: Vec2[] = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]
  const ring = p.cornerRadius && p.cornerRadius > 0 ? roundCorners(corners, p.cornerRadius) : corners
  const d = new DrawingBuilder()
  d.polyline('drafting', ring, true)
  fillPolys(d, [{ outer: ring, holes: [] }], p.fill)
  const snaps: SnapPoint[] = [snap('center', 0, 0)]
  for (const c of corners) snaps.push(snap('endpoint', c[0], c[1]))
  snaps.push(snap('midpoint', 0, -hh), snap('midpoint', hw, 0), snap('midpoint', 0, hh), snap('midpoint', -hw, 0))
  return done(d, snaps, { area: p.width * p.height, perimeter: 2 * (p.width + p.height) })
}

export function evaluateCircle(node: NodeBase<'circle'>): GeometryResult {
  const r = Math.max(0, node.params.radius)
  const d = new DrawingBuilder()
  d.circle('drafting', [0, 0], r)
  if (node.params.fill) {
    const n = arcSegments(r, TAU)
    const ring: Vec2[] = Array.from({ length: n }, (_, i) => [Math.cos((TAU * i) / n) * r, Math.sin((TAU * i) / n) * r] as Vec2)
    fillPolys(d, [{ outer: ring, holes: [] }], node.params.fill)
  }
  return done(d, [snap('center', 0, 0), snap('quadrant', r, 0), snap('quadrant', 0, r), snap('quadrant', -r, 0), snap('quadrant', 0, -r)], { area: Math.PI * r * r, perimeter: TAU * r })
}

export function evaluateArc(node: NodeBase<'arc'>): GeometryResult {
  const { radius: r, start, end } = node.params
  let sweep = wrapAngle(end - start)
  if (sweep < 1e-9) sweep = TAU
  const d = new DrawingBuilder()
  d.arc('drafting', [0, 0], r, start, sweep)
  const a: Vec2 = [Math.cos(start) * r, Math.sin(start) * r]
  const b: Vec2 = [Math.cos(start + sweep) * r, Math.sin(start + sweep) * r]
  const m: Vec2 = [Math.cos(start + sweep / 2) * r, Math.sin(start + sweep / 2) * r]
  return done(d, [snap('center', 0, 0), snap('endpoint', a[0], a[1]), snap('endpoint', b[0], b[1]), snap('midpoint', m[0], m[1])], { length: r * sweep, angle: sweep })
}

export function evaluateEllipse(node: NodeBase<'ellipse'>): GeometryResult {
  const { rx, ry } = node.params
  const n = arcSegments(Math.max(rx, ry), TAU)
  const ring: Vec2[] = Array.from({ length: n }, (_, i) => [Math.cos((TAU * i) / n) * rx, Math.sin((TAU * i) / n) * ry] as Vec2)
  const d = new DrawingBuilder()
  d.polyline('drafting', ring, true)
  fillPolys(d, [{ outer: ring, holes: [] }], node.params.fill)
  return done(d, [snap('center', 0, 0), snap('quadrant', rx, 0), snap('quadrant', 0, ry), snap('quadrant', -rx, 0), snap('quadrant', 0, -ry)], { area: Math.PI * rx * ry })
}

export function evaluateSpline(node: NodeBase<'spline'>): GeometryResult {
  const contours = flattenPath(node.params.path, 0.0005)
  const d = new DrawingBuilder()
  const snaps: SnapPoint[] = []
  let length = 0
  for (const c of contours) {
    d.polyline('drafting', c.points, c.closed)
    for (let i = 0; i < c.points.length - 1; i++) length += dist2(c.points[i]!, c.points[i + 1]!)
    if (c.closed && c.points.length > 2) length += dist2(c.points[c.points.length - 1]!, c.points[0]!)
  }
  for (const c of node.params.path?.contours ?? []) for (const q of c.points) snaps.push(snap('endpoint', q.p[0], q.p[1]))
  return done(d, snaps, { length })
}

export function evaluateHatch(node: NodeBase<'hatch'>): GeometryResult {
  const p = node.params
  const rings = [p.boundary, ...(p.holes ?? [])].filter((r) => r && r.length >= 3)
  const d = new DrawingBuilder()
  if (!rings.length) return done(d, [])
  const polys = nestRings(rings)
  if (p.background) d.fill(polys, 'solid', { color: p.background })
  d.fill(polys, p.pattern, { color: p.color ?? undefined, scale: p.scale, angle: p.angle })
  d.segments('thin', hatchSegments(polys, p.pattern, p.scale, p.angle))
  const snaps: SnapPoint[] = p.boundary.map((q) => snap('endpoint', q[0], q[1]))
  const c = polygonCentroid(p.boundary)
  snaps.push(snap('center', c[0], c[1]))
  return done(d, snaps, { area: polys.reduce((s, poly) => s + Math.abs(polyArea(poly)) - poly.holes.reduce((hs, h) => hs + Math.abs(polyArea({ outer: h, holes: [] })), 0), 0) })
}

/** Filled arrow head at `tip` pointing along `dir` (unit). */
export function arrowHead(d: DrawingBuilder, tip: Vec2, dir: Vec2, length = ANNO.arrow, width = ANNO.arrowWidth): void {
  const n = perp2(dir)
  const base: Vec2 = [tip[0] - dir[0] * length, tip[1] - dir[1] * length]
  const l: Vec2 = [base[0] + n[0] * width * 0.5, base[1] + n[1] * width * 0.5]
  const r: Vec2 = [base[0] - n[0] * width * 0.5, base[1] - n[1] * width * 0.5]
  d.fill([{ outer: [tip, l, r], holes: [] }], 'solid')
  d.segP('annotation', tip, l)
  d.segP('annotation', tip, r)
  d.segP('annotation', l, r)
}

export function evaluateLeader(node: NodeBase<'leader'>): GeometryResult {
  const p = node.params
  const pts = (p.points ?? []).filter((q) => Array.isArray(q) && q.length === 2)
  const d = new DrawingBuilder()
  const size = textSizeOf(node)
  if (pts.length >= 2) {
    d.polyline('annotation', pts, false)
    arrowHead(d, pts[0]!, normalize2(sub2(pts[0]!, pts[1]!)))
    const last = pts[pts.length - 1]!
    const prev = pts[pts.length - 2]!
    const toRight = last[0] >= prev[0]
    const landing = size * 2.5
    const end: Vec2 = [last[0] + (toRight ? landing : -landing), last[1]]
    d.segP('annotation', last, end)
    d.text(p.text, [last[0] + (toRight ? size * 0.4 : -size * 0.4), last[1] + size * 0.35], size, { align: toRight ? 'left' : 'right', baseline: 'bottom', style: 'annotation' })
  } else if (pts.length === 1) d.text(p.text, pts[0]!, size, { align: 'left', baseline: 'bottom' })
  const snaps = pts.map((q) => snap('endpoint', q[0], q[1]))
  return done(d, snaps)
}

export { readableRotation, angleOf }
