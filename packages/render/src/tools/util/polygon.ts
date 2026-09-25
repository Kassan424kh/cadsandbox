// 2D polygon / segment utilities (meters). Polygons are Vec2[] without a repeated closing vertex.
import type { Vec2 } from '@cadsandbox/doc'
import { polygonArea } from '@cadsandbox/doc'
import { v2 } from './vec'

export interface Seg2 {
  a: Vec2
  b: Vec2
}

export interface Bounds2 {
  min: Vec2
  max: Vec2
}

export function bounds2(points: Iterable<Vec2>): Bounds2 | null {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const p of points) {
    if (p[0] < minX) minX = p[0]
    if (p[1] < minY) minY = p[1]
    if (p[0] > maxX) maxX = p[0]
    if (p[1] > maxY) maxY = p[1]
  }
  if (minX === Infinity) return null
  return { min: [minX, minY], max: [maxX, maxY] }
}

export function signedArea(poly: readonly Vec2[]): number {
  return polygonArea(poly)
}

export function isCCW(poly: readonly Vec2[]): boolean {
  return polygonArea(poly) > 0
}

export function ensureCCW(poly: Vec2[]): Vec2[] {
  return isCCW(poly) ? poly : [...poly].reverse()
}

export function centroid(poly: readonly Vec2[]): Vec2 {
  const n = poly.length
  if (n === 0) return [0, 0]
  const a = polygonArea(poly)
  if (Math.abs(a) < 1e-12) {
    let x = 0,
      y = 0
    for (const p of poly) {
      x += p[0]
      y += p[1]
    }
    return [x / n, y / n]
  }
  let cx = 0,
    cy = 0
  for (let i = 0; i < n; i++) {
    const p = poly[i],
      q = poly[(i + 1) % n]
    const f = p[0] * q[1] - q[0] * p[1]
    cx += (p[0] + q[0]) * f
    cy += (p[1] + q[1]) * f
  }
  return [cx / (6 * a), cy / (6 * a)]
}

export function perimeter(poly: readonly Vec2[], closed = true): number {
  let l = 0
  const n = poly.length
  for (let i = 0; i < (closed ? n : n - 1); i++) l += v2.dist(poly[i], poly[(i + 1) % n])
  return l
}

/** Even-odd point-in-polygon test. */
export function pointInPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false
  const n = poly.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const pi = poly[i],
      pj = poly[j]
    const intersects = pi[1] > p[1] !== pj[1] > p[1] && p[0] < ((pj[0] - pi[0]) * (p[1] - pi[1])) / (pj[1] - pi[1]) + pi[0]
    if (intersects) inside = !inside
  }
  return inside
}

/** True when every vertex of `inner` lies inside `outer` (no edge test — good enough for islands). */
export function polygonInside(inner: readonly Vec2[], outer: readonly Vec2[]): boolean {
  return inner.length > 0 && inner.every((p) => pointInPolygon(p, outer) || distanceToPolygon(p, outer) < 1e-6)
}

export function distanceToPolygon(p: Vec2, poly: readonly Vec2[], closed = true): number {
  let d = Infinity
  const n = poly.length
  for (let i = 0; i < (closed ? n : n - 1); i++) d = Math.min(d, distanceToSegment(p, poly[i], poly[(i + 1) % n]))
  return d
}

/** Closest point on segment ab to p as parameter t ∈ [0,1]. */
export function projectParam(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = v2.sub(b, a)
  const l2 = v2.dot(ab, ab)
  if (l2 < 1e-18) return 0
  return Math.max(0, Math.min(1, v2.dot(v2.sub(p, a), ab) / l2))
}

/** Unclamped parameter of the projection of p onto the infinite line ab. */
export function lineParam(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = v2.sub(b, a)
  const l2 = v2.dot(ab, ab)
  if (l2 < 1e-18) return 0
  return v2.dot(v2.sub(p, a), ab) / l2
}

export function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  return v2.lerp(a, b, projectParam(p, a, b))
}

export function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  return v2.dist(p, closestPointOnSegment(p, a, b))
}

/** Signed distance of p from the infinite line through a→b (positive = left). */
export function signedLineDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const d = v2.sub(b, a)
  const l = v2.len(d)
  if (l < 1e-12) return v2.dist(p, a)
  return v2.cross(d, v2.sub(p, a)) / l
}

/** Intersection of infinite lines (p, p+r) and (q, q+s) → parameters [t, u] or null if parallel. */
export function lineLineParams(p: Vec2, r: Vec2, q: Vec2, s: Vec2): [number, number] | null {
  const denom = v2.cross(r, s)
  if (Math.abs(denom) < 1e-12) return null
  const qp = v2.sub(q, p)
  return [v2.cross(qp, s) / denom, v2.cross(qp, r) / denom]
}

/** Intersection of infinite lines through segments a and b, or null when parallel. */
export function lineIntersection(a: Seg2, b: Seg2): Vec2 | null {
  const r = v2.sub(a.b, a.a)
  const s = v2.sub(b.b, b.a)
  const t = lineLineParams(a.a, r, b.a, s)
  return t ? v2.add(a.a, v2.scale(r, t[0])) : null
}

/** Segment ∩ segment (inclusive with tolerance). Returns the point and both parameters. */
export function segmentIntersection(a: Seg2, b: Seg2, tol = 1e-9): { p: Vec2; t: number; u: number } | null {
  const r = v2.sub(a.b, a.a)
  const s = v2.sub(b.b, b.a)
  const tu = lineLineParams(a.a, r, b.a, s)
  if (!tu) return null
  const [t, u] = tu
  if (t < -tol || t > 1 + tol || u < -tol || u > 1 + tol) return null
  return { p: v2.add(a.a, v2.scale(r, t)), t, u }
}

/** Circle ∩ infinite line a→b → line parameters (0..2 values). */
export function lineCircleParams(a: Vec2, b: Vec2, center: Vec2, radius: number): number[] {
  const d = v2.sub(b, a)
  const f = v2.sub(a, center)
  const A = v2.dot(d, d)
  const B = 2 * v2.dot(f, d)
  const C = v2.dot(f, f) - radius * radius
  if (A < 1e-18) return []
  const disc = B * B - 4 * A * C
  if (disc < 0) return []
  const sq = Math.sqrt(disc)
  if (sq < 1e-12) return [-B / (2 * A)]
  return [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]
}

/** Remove consecutive duplicates (and a duplicated closing vertex). */
export function dedupePolygon(poly: readonly Vec2[], tol = 1e-7): Vec2[] {
  const out: Vec2[] = []
  for (const p of poly) if (!out.length || !v2.eq(out[out.length - 1], p, tol)) out.push([p[0], p[1]])
  while (out.length > 1 && v2.eq(out[0], out[out.length - 1], tol)) out.pop()
  return out
}

/** Remove collinear vertices. */
export function simplifyPolygon(poly: readonly Vec2[], tol = 1e-7): Vec2[] {
  const pts = dedupePolygon(poly, tol)
  const n = pts.length
  if (n < 3) return pts
  const out: Vec2[] = []
  for (let i = 0; i < n; i++) {
    const prev = pts[(i + n - 1) % n],
      cur = pts[i],
      next = pts[(i + 1) % n]
    const cross = v2.cross(v2.sub(cur, prev), v2.sub(next, cur))
    if (Math.abs(cross) > tol) out.push(cur)
  }
  return out.length >= 3 ? out : pts
}

/**
 * Offset a polygon (positive = outward for CCW input) or an open polyline (positive = left of the
 * travel direction) using mitered joins. Robust enough for building outlines and drafting curves;
 * self-intersections of strongly concave shapes are not resolved.
 */
export function offsetPolyline(points: readonly Vec2[], distance: number, closed: boolean): Vec2[] {
  const pts = dedupePolygon(points)
  const n = pts.length
  if (n === 0 || Math.abs(distance) < 1e-12) return pts.map((p) => [p[0], p[1]])
  if (n === 1) return [[pts[0][0], pts[0][1]]]
  // For closed polygons "outward" must be independent of winding: flip for CW input.
  let d = distance
  if (closed && n >= 3 && !isCCW(pts)) d = -distance
  const segCount = closed ? n : n - 1
  const lines: { a: Vec2; b: Vec2 }[] = []
  for (let i = 0; i < segCount; i++) {
    const a = pts[i],
      b = pts[(i + 1) % n]
    const nrm = v2.perp(v2.norm(v2.sub(b, a))) // left normal
    // CCW polygon: left = inside → outward offset is −left.
    const off = v2.scale(nrm, closed ? -d : d)
    lines.push({ a: v2.add(a, off), b: v2.add(b, off) })
  }
  const out: Vec2[] = []
  if (!closed) {
    out.push(lines[0].a)
    for (let i = 0; i < lines.length - 1; i++) out.push(miter(lines[i], lines[i + 1]))
    out.push(lines[lines.length - 1].b)
    return out
  }
  for (let i = 0; i < n; i++) out.push(miter(lines[(i + n - 1) % n], lines[i]))
  return out
}

function miter(l1: Seg2, l2: Seg2): Vec2 {
  const p = lineIntersection(l1, l2)
  if (!p) return l1.b
  // Guard against extreme spikes at nearly-parallel joins: fall back to the segment junction.
  const limit = 50 * Math.max(v2.dist(l1.a, l1.b), v2.dist(l2.a, l2.b), 1e-3)
  if (v2.dist(p, l1.b) > limit) return v2.mid(l1.b, l2.a)
  return p
}

/** Inset each edge of a closed loop by its own distance (positive = toward the loop interior). */
export function insetLoop(loop: readonly Vec2[], edgeInsets: readonly number[]): Vec2[] {
  const pts = dedupePolygon(loop)
  const n = pts.length
  if (n < 3) return pts
  const ccw = isCCW(pts)
  const lines: Seg2[] = []
  for (let i = 0; i < n; i++) {
    const a = pts[i],
      b = pts[(i + 1) % n]
    const left = v2.perp(v2.norm(v2.sub(b, a)))
    const inward = ccw ? left : v2.scale(left, -1)
    const off = v2.scale(inward, edgeInsets[i] ?? 0)
    lines.push({ a: v2.add(a, off), b: v2.add(b, off) })
  }
  const out: Vec2[] = []
  for (let i = 0; i < n; i++) out.push(miter(lines[(i + n - 1) % n], lines[i]))
  return out
}

/** Axis-aligned rectangle corners (CCW) from two opposite corners. */
export function rectCorners(a: Vec2, b: Vec2): Vec2[] {
  const minX = Math.min(a[0], b[0]),
    maxX = Math.max(a[0], b[0])
  const minY = Math.min(a[1], b[1]),
    maxY = Math.max(a[1], b[1])
  return [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ]
}

/** Corners of a rotated rectangle centered at c. */
export function rotatedRect(c: Vec2, width: number, height: number, rotation: number): Vec2[] {
  const hw = width / 2,
    hh = height / 2
  return [
    v2.rotate([c[0] - hw, c[1] - hh], rotation, c),
    v2.rotate([c[0] + hw, c[1] - hh], rotation, c),
    v2.rotate([c[0] + hw, c[1] + hh], rotation, c),
    v2.rotate([c[0] - hw, c[1] + hh], rotation, c),
  ]
}

/** Polygon edges as segments. */
export function polygonSegments(poly: readonly Vec2[], closed = true): Seg2[] {
  const out: Seg2[] = []
  const n = poly.length
  for (let i = 0; i < (closed ? n : n - 1); i++) out.push({ a: poly[i], b: poly[(i + 1) % n] })
  return out
}

/** Ear-clipping triangulation of a simple polygon (any winding) → flat [x,y,…] triangles. */
export function triangulate(poly: readonly Vec2[]): number[] {
  const pts = ensureCCW(dedupePolygon(poly))
  const n = pts.length
  const out: number[] = []
  if (n < 3) return out
  const idx = pts.map((_, i) => i)
  let guard = 0
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i + idx.length - 1) % idx.length],
        i1 = idx[i],
        i2 = idx[(i + 1) % idx.length]
      const a = pts[i0],
        b = pts[i1],
        c = pts[i2]
      if (v2.cross(v2.sub(b, a), v2.sub(c, b)) <= 1e-12) continue // reflex
      let ok = true
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue
        if (pointInTriangle(pts[j], a, b, c)) {
          ok = false
          break
        }
      }
      if (!ok) continue
      out.push(a[0], a[1], b[0], b[1], c[0], c[1])
      idx.splice(i, 1)
      clipped = true
      break
    }
    if (!clipped) break
  }
  if (idx.length === 3) {
    const [a, b, c] = [pts[idx[0]], pts[idx[1]], pts[idx[2]]]
    out.push(a[0], a[1], b[0], b[1], c[0], c[1])
  }
  return out
}

export function pointInTriangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const d1 = v2.cross(v2.sub(b, a), v2.sub(p, a))
  const d2 = v2.cross(v2.sub(c, b), v2.sub(p, b))
  const d3 = v2.cross(v2.sub(a, c), v2.sub(p, c))
  const neg = d1 < -1e-12 || d2 < -1e-12 || d3 < -1e-12
  const pos = d1 > 1e-12 || d2 > 1e-12 || d3 > 1e-12
  return !(neg && pos)
}

/** Chain unordered segments into closed loops / open chains (endpoints merged within tol). */
export function chainSegments(segs: readonly Seg2[], tol = 1e-5): { loops: Vec2[][]; open: Vec2[][] } {
  const used = new Array(segs.length).fill(false)
  const loops: Vec2[][] = []
  const open: Vec2[][] = []
  const key = (p: Vec2) => `${Math.round(p[0] / tol)},${Math.round(p[1] / tol)}`
  const byEnd = new Map<string, number[]>()
  segs.forEach((s, i) => {
    for (const k of [key(s.a), key(s.b)]) {
      const arr = byEnd.get(k)
      if (arr) arr.push(i)
      else byEnd.set(k, [i])
    }
  })
  for (let start = 0; start < segs.length; start++) {
    if (used[start]) continue
    used[start] = true
    const chain: Vec2[] = [segs[start].a, segs[start].b]
    let closed = false
    for (let dir = 0; dir < 2 && !closed; dir++) {
      for (;;) {
        const tail = chain[chain.length - 1]
        const cands = byEnd.get(key(tail)) ?? []
        let next = -1
        for (const c of cands) if (!used[c]) next = c
        if (next < 0) break
        used[next] = true
        const s = segs[next]
        chain.push(v2.eq(s.a, tail, tol * 2) ? s.b : s.a)
        if (v2.eq(chain[chain.length - 1], chain[0], tol * 2)) {
          chain.pop()
          closed = true
          break
        }
      }
      if (!closed) chain.reverse()
    }
    if (closed) loops.push(chain)
    else open.push(chain)
  }
  return { loops, open }
}
