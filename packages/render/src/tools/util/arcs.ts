// Arc helpers: DXF-style bulges, 3-point arcs, tangent arcs, sampling.
import type { Vec2 } from '@cadsandbox/doc'
import { positiveAngle, TAU, v2 } from './vec'

export interface ArcDef {
  center: Vec2
  radius: number
  /** Start angle (rad, from +X, CCW) */
  start: number
  /** End angle; arc runs CCW from start to end (end > start after normalization) */
  end: number
}

/** Circle through three points, or null if collinear. */
export function circleFrom3Points(a: Vec2, b: Vec2, c: Vec2): { center: Vec2; radius: number } | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]))
  if (Math.abs(d) < 1e-12) return null
  const a2 = a[0] * a[0] + a[1] * a[1]
  const b2 = b[0] * b[0] + b[1] * b[1]
  const c2 = c[0] * c[0] + c[1] * c[1]
  const ux = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d
  const uy = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d
  return { center: [ux, uy], radius: Math.hypot(a[0] - ux, a[1] - uy) }
}

/** Arc from start through `mid` to end (AutoCAD 3-point). Always stored CCW; may swap ends. */
export function arcFrom3Points(start: Vec2, mid: Vec2, end: Vec2): ArcDef | null {
  const c = circleFrom3Points(start, mid, end)
  if (!c) return null
  const a0 = v2.angle(v2.sub(start, c.center))
  const a1 = v2.angle(v2.sub(mid, c.center))
  const a2 = v2.angle(v2.sub(end, c.center))
  // CCW from start to end passes through mid?
  const sweepSE = positiveAngle(a2 - a0)
  const sweepSM = positiveAngle(a1 - a0)
  const ccw = sweepSM < sweepSE
  return ccw ? normalizeArc(c.center, c.radius, a0, a2) : normalizeArc(c.center, c.radius, a2, a0)
}

/** Arc given the center, a start point and an end point (the end point only sets the end angle). */
export function arcFromCenterStartEnd(center: Vec2, start: Vec2, end: Vec2, ccw = true): ArcDef {
  const r = v2.dist(center, start)
  const a0 = v2.angle(v2.sub(start, center))
  const a1 = v2.angle(v2.sub(end, center))
  return ccw ? normalizeArc(center, r, a0, a1) : normalizeArc(center, r, a1, a0)
}

export function normalizeArc(center: Vec2, radius: number, start: number, end: number): ArcDef {
  const s = positiveAngle(start)
  let e = positiveAngle(end)
  if (e <= s + 1e-12) e += TAU
  return { center, radius, start: s, end: e }
}

export function arcSweep(arc: ArcDef): number {
  return arc.end - arc.start
}

export function arcPoint(arc: ArcDef, angle: number): Vec2 {
  return [arc.center[0] + Math.cos(angle) * arc.radius, arc.center[1] + Math.sin(angle) * arc.radius]
}

export function arcStartPoint(arc: ArcDef): Vec2 {
  return arcPoint(arc, arc.start)
}

export function arcEndPoint(arc: ArcDef): Vec2 {
  return arcPoint(arc, arc.end)
}

export function arcLength(arc: ArcDef): number {
  return arcSweep(arc) * arc.radius
}

/** Sample points along an arc (inclusive of both ends). */
export function sampleArc(arc: ArcDef, segments = 0): Vec2[] {
  const sweep = arcSweep(arc)
  const n = segments > 0 ? segments : Math.max(2, Math.ceil((sweep / TAU) * Math.max(16, Math.min(96, arc.radius * 48))))
  const out: Vec2[] = []
  for (let i = 0; i <= n; i++) out.push(arcPoint(arc, arc.start + (sweep * i) / n))
  return out
}

export function sampleCircle(center: Vec2, radius: number, segments = 0): Vec2[] {
  const n = segments > 0 ? segments : Math.max(24, Math.min(128, Math.ceil(radius * 48)))
  const out: Vec2[] = []
  for (let i = 0; i < n; i++) out.push([center[0] + Math.cos((i / n) * TAU) * radius, center[1] + Math.sin((i / n) * TAU) * radius])
  return out
}

export function sampleEllipse(center: Vec2, rx: number, ry: number, rotation = 0, segments = 0): Vec2[] {
  const n = segments > 0 ? segments : Math.max(32, Math.min(128, Math.ceil(Math.max(rx, ry) * 48)))
  const out: Vec2[] = []
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU
    out.push(v2.rotate([center[0] + Math.cos(t) * rx, center[1] + Math.sin(t) * ry], rotation, center))
  }
  return out
}

// ------------------------------------------------------------------ bulges
/** Bulge (tan(θ/4)) of the arc from a to b whose included angle is θ; sign = CCW positive. */
export function bulgeFromArc(a: Vec2, b: Vec2, arc: ArcDef): number {
  const sweep = arcSweep(arc)
  const side = v2.cross(v2.sub(b, a), v2.sub(arc.center, a))
  const bulge = Math.tan(sweep / 4)
  // If the chord a→b runs CCW around the center (center on the left), the bulge is positive.
  return side > 0 ? bulge : -bulge
}

/** Arc for a polyline segment a→b with bulge (0 = straight → null). */
export function arcFromBulge(a: Vec2, b: Vec2, bulge: number): ArcDef | null {
  if (Math.abs(bulge) < 1e-12) return null
  const chord = v2.dist(a, b)
  if (chord < 1e-12) return null
  const theta = 4 * Math.atan(Math.abs(bulge))
  const r = chord / (2 * Math.sin(theta / 2))
  const mid = v2.mid(a, b)
  const dir = v2.norm(v2.sub(b, a))
  const n = v2.perp(dir) // left of a→b
  const d = r * Math.cos(theta / 2) // center offset from the chord midpoint
  const center: Vec2 = bulge > 0 ? v2.add(mid, v2.scale(n, d)) : v2.sub(mid, v2.scale(n, d))
  const aa = v2.angle(v2.sub(a, center))
  const ab = v2.angle(v2.sub(b, center))
  return bulge > 0 ? normalizeArc(center, r, aa, ab) : normalizeArc(center, r, ab, aa)
}

/** Points along a bulged polyline segment (excluding a, including b). */
export function bulgeSegmentPoints(a: Vec2, b: Vec2, bulge: number): Vec2[] {
  const arc = arcFromBulge(a, b, bulge)
  if (!arc) return [b]
  const pts = sampleArc(arc)
  if (bulge < 0) pts.reverse()
  pts.shift()
  pts[pts.length - 1] = [b[0], b[1]] // exact endpoint (no float drift)
  return pts
}

/** Bulge of an arc from a to b that is tangent to direction `tangent` at a. */
export function tangentBulge(a: Vec2, b: Vec2, tangent: Vec2): number {
  const chord = v2.sub(b, a)
  const L = v2.len(chord)
  if (L < 1e-12) return 0
  const t = v2.norm(tangent)
  const c = v2.norm(chord)
  const cosA = Math.max(-1, Math.min(1, v2.dot(t, c)))
  const alpha = Math.acos(cosA) // angle between tangent and chord = θ/2
  if (alpha < 1e-9 || Math.abs(alpha - Math.PI) < 1e-9) return 0
  const sign = v2.cross(t, c) > 0 ? 1 : -1
  return sign * Math.tan(alpha / 2)
}

/** Flatten a polyline with bulges into plain points (closed → last segment included, no repeated first point). */
export function flattenPolyline(points: Vec2[], bulges: number[] | undefined, closed: boolean): Vec2[] {
  const n = points.length
  if (n === 0) return []
  const out: Vec2[] = [points[0]]
  const segs = closed ? n : n - 1
  for (let i = 0; i < segs; i++) {
    const a = points[i]
    const b = points[(i + 1) % n]
    const bulge = bulges?.[i] ?? 0
    const pts = bulgeSegmentPoints(a, b, bulge)
    if (closed && i === segs - 1) pts.pop()
    out.push(...pts)
  }
  return out
}
