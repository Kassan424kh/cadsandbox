// PathData flattening (cubic Béziers), profile presets and rounded polygons.
import type { PathData, ProfileKind, ShapeParams, Vec2 } from '@cadsandbox/doc'
import { TAU, cleanPolygon, dist2, ensureCCW, flattenCubic, normalize2, perp2, polygonArea, sub2 } from './math2d'
import { nestRings, type PolyWithHoles, type Ring } from './polygon'

export interface FlatContour {
  points: Vec2[]
  closed: boolean
}

/** Flatten every contour of a path into polylines (Bézier handles honored). */
export function flattenPath(path: PathData | undefined, tol = 0.001): FlatContour[] {
  const out: FlatContour[] = []
  if (!path?.contours) return out
  for (const c of path.contours) {
    const pts = c.points
    if (!pts?.length) continue
    const poly: Vec2[] = [[pts[0]!.p[0], pts[0]!.p[1]]]
    const segs = c.closed ? pts.length : pts.length - 1
    for (let i = 0; i < segs; i++) {
      const a = pts[i]!
      const b = pts[(i + 1) % pts.length]!
      if (a.ho || b.hi) {
        flattenCubic(a.p, a.ho ?? a.p, b.hi ?? b.p, b.p, poly, tol)
      } else poly.push([b.p[0], b.p[1]])
    }
    if (c.closed && poly.length > 1 && dist2(poly[0]!, poly[poly.length - 1]!) < 1e-9) poly.pop()
    out.push({ points: poly, closed: c.closed })
  }
  return out
}

/** Closed contours of a path → polygons with holes (even-odd nesting). */
export function pathToPolygons(path: PathData | undefined, tol = 0.001): PolyWithHoles[] {
  const rings: Ring[] = []
  for (const c of flattenPath(path, tol)) if (c.closed && c.points.length >= 3) rings.push(c.points)
  return nestRings(rings)
}

/** Replace polygon corners by arcs of `radius` (clamped to the adjacent edge half-lengths). */
export function roundCorners(poly: readonly Vec2[], radius: number, segmentsPerCorner = 6): Vec2[] {
  if (radius <= 1e-9 || poly.length < 3) return poly.slice()
  const n = poly.length
  const out: Vec2[] = []
  for (let i = 0; i < n; i++) {
    const p = poly[(i + n - 1) % n]!
    const c = poly[i]!
    const q = poly[(i + 1) % n]!
    const d0 = normalize2(sub2(p, c))
    const d1 = normalize2(sub2(q, c))
    const cosA = Math.max(-1, Math.min(1, d0[0] * d1[0] + d0[1] * d1[1]))
    const ang = Math.acos(cosA)
    if (ang < 1e-6 || Math.abs(ang - Math.PI) < 1e-6) {
      out.push([c[0], c[1]])
      continue
    }
    const half = ang / 2
    const maxR = Math.min(dist2(p, c), dist2(q, c)) * 0.5 * Math.tan(half)
    const r = Math.min(radius, maxR)
    const t = r / Math.tan(half)
    const a: Vec2 = [c[0] + d0[0] * t, c[1] + d0[1] * t]
    const b: Vec2 = [c[0] + d1[0] * t, c[1] + d1[1] * t]
    const bis = normalize2([d0[0] + d1[0], d0[1] + d1[1]])
    const center: Vec2 = [c[0] + (bis[0] * r) / Math.sin(half), c[1] + (bis[1] * r) / Math.sin(half)]
    const a0 = Math.atan2(a[1] - center[1], a[0] - center[0])
    let a1 = Math.atan2(b[1] - center[1], b[0] - center[0])
    // take the short way around
    while (a1 - a0 > Math.PI) a1 -= TAU
    while (a1 - a0 < -Math.PI) a1 += TAU
    for (let k = 0; k <= segmentsPerCorner; k++) {
      const s = a0 + ((a1 - a0) * k) / segmentsPerCorner
      out.push([center[0] + Math.cos(s) * r, center[1] + Math.sin(s) * r])
    }
  }
  return cleanPolygon(out, 1e-9)
}

function ellipsePts(rx: number, ry: number, n: number): Vec2[] {
  const out: Vec2[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU
    out[i] = [Math.cos(t) * rx, Math.sin(t) * ry]
  }
  return out
}

export function circleSegmentCount(radius: number, hint = 0): number {
  if (hint && hint >= 8) return hint
  return Math.max(24, Math.min(128, Math.ceil(radius * 64)))
}

/** Preset profile polygons (centered at the origin, fitting width × height). */
export function profilePolygons(params: ShapeParams, tol = 0.001): PolyWithHoles[] {
  const w = Math.max(1e-6, params.width)
  const h = Math.max(1e-6, params.height)
  const hw = w / 2
  const hh = h / 2
  const kind: ProfileKind = params.profile
  const cr = Math.max(0, params.cornerRadius ?? 0)
  const rounded = (ring: Vec2[]) => (cr > 0 ? roundCorners(ring, cr) : ring)
  switch (kind) {
    case 'rect':
      return [{ outer: rounded([[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]), holes: [] }]
    case 'circle':
    case 'ellipse':
      return [{ outer: ellipsePts(hw, hh, circleSegmentCount(Math.max(hw, hh), params.sides && params.sides > 8 ? params.sides : 0)), holes: [] }]
    case 'triangle':
      return [{ outer: rounded([[-hw, -hh], [hw, -hh], [0, hh]]), holes: [] }]
    case 'polygon': {
      const n = Math.max(3, Math.round(params.sides ?? 6))
      const pts: Vec2[] = []
      for (let i = 0; i < n; i++) {
        const t = Math.PI / 2 + (i / n) * TAU
        pts.push([Math.cos(t) * hw, Math.sin(t) * hh])
      }
      return [{ outer: rounded(pts), holes: [] }]
    }
    case 'star': {
      const n = Math.max(3, Math.round(params.sides ?? 5))
      const inner = Math.min(0.98, Math.max(0.02, params.innerRatio ?? 0.5))
      const pts: Vec2[] = []
      for (let i = 0; i < n * 2; i++) {
        const t = Math.PI / 2 + (i / (n * 2)) * TAU
        const r = i % 2 === 0 ? 1 : inner
        pts.push([Math.cos(t) * hw * r, Math.sin(t) * hh * r])
      }
      return [{ outer: rounded(pts), holes: [] }]
    }
    case 'heart': {
      const n = 96
      const pts: Vec2[] = []
      for (let i = 0; i < n; i++) {
        const t = (i / n) * TAU
        // classic heart curve, normalized to [-1,1]²
        const x = (16 * Math.pow(Math.sin(t), 3)) / 16
        const y = (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 17
        pts.push([x * hw, (y + 0.15) * hh])
      }
      return [{ outer: ensureCCW(cleanPolygon(pts, 1e-9)), holes: [] }]
    }
    case 'arrow': {
      const head = Math.min(w * 0.45, h)
      const shaft = h * 0.4
      return [
        {
          outer: rounded([
            [-hw, -shaft / 2],
            [hw - head, -shaft / 2],
            [hw - head, -hh],
            [hw, 0],
            [hw - head, hh],
            [hw - head, shaft / 2],
            [-hw, shaft / 2],
          ]),
          holes: [],
        },
      ]
    }
    case 'cross': {
      const ax = w / 3
      const ay = h / 3
      return [
        {
          outer: rounded([
            [-ax / 2, -hh],
            [ax / 2, -hh],
            [ax / 2, -ay / 2],
            [hw, -ay / 2],
            [hw, ay / 2],
            [ax / 2, ay / 2],
            [ax / 2, hh],
            [-ax / 2, hh],
            [-ax / 2, ay / 2],
            [-hw, ay / 2],
            [-hw, -ay / 2],
            [-ax / 2, -ay / 2],
          ]),
          holes: [],
        },
      ]
    }
    case 'ring': {
      const inner = Math.min(0.98, Math.max(0.02, params.innerRatio ?? 0.5))
      const n = circleSegmentCount(Math.max(hw, hh))
      const outer = ellipsePts(hw, hh, n)
      const hole = ellipsePts(hw * inner, hh * inner, n).reverse()
      return [{ outer, holes: [hole] }]
    }
    case 'path':
      return pathToPolygons(params.path, tol)
  }
}

/** Parallel-transport-free 2D polyline outline helpers for open contours (used by splines). */
export function contourLength(points: readonly Vec2[], closed: boolean): number {
  let l = 0
  for (let i = 0; i < points.length - 1; i++) l += dist2(points[i]!, points[i + 1]!)
  if (closed && points.length > 2) l += dist2(points[points.length - 1]!, points[0]!)
  return l
}

export { polygonArea, perp2 }
