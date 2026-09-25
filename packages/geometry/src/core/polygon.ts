// Polygon set operations (clipper2-js, integer scaled), triangulation (earcut) and clipping helpers.
import type { Vec2 } from '@cadsandbox/doc'
import { Clipper, Clipper64, ClipType, FillRule, Path64, Paths64, PathType, Point64 } from 'clipper2-js'
import earcut from 'earcut'
import { F32Buf } from './buffers'
import { bounds2, cleanPolygon, ensureCCW, ensureCW, pointInPolygon, polygonArea } from './math2d'

export type Ring = Vec2[]
export interface PolyWithHoles {
  outer: Ring
  holes: Ring[]
}

/** 10 µm integer grid — exact for scenes up to ~100 km with double arithmetic in clipper2-js. */
export const CLIPPER_SCALE = 1e5

const toPath = (ring: readonly Vec2[]): Path64 => {
  const p = new Path64()
  for (const v of ring) p.push(new Point64(v[0] * CLIPPER_SCALE, v[1] * CLIPPER_SCALE))
  return p
}

const toPaths = (polys: readonly (Ring | PolyWithHoles)[]): Paths64 => {
  const out = new Paths64()
  for (const p of polys) {
    if (Array.isArray(p)) {
      if (p.length >= 3) out.push(toPath(p))
    } else {
      if (p.outer.length >= 3) out.push(toPath(p.outer))
      for (const h of p.holes) if (h.length >= 3) out.push(toPath(h))
    }
  }
  return out
}

const fromPath = (path: Path64): Ring => {
  const r: Ring = new Array(path.length)
  for (let i = 0; i < path.length; i++) r[i] = [path[i]!.x / CLIPPER_SCALE, path[i]!.y / CLIPPER_SCALE]
  return r
}

/** Nest rings into outer/holes by containment depth (even = outer, odd = hole of the innermost outer). */
export function nestRings(rings: readonly Ring[]): PolyWithHoles[] {
  const items = rings
    .map((r) => cleanPolygon(r))
    .filter((r) => r.length >= 3 && Math.abs(polygonArea(r)) > 1e-14)
    .map((r) => ({ ring: r, area: Math.abs(polygonArea(r)), bounds: bounds2(r), parent: -1, depth: 0 }))
  items.sort((a, b) => b.area - a.area)
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!
    // smallest-area container = the nearest enclosing ring (items are sorted by area desc)
    for (let j = i - 1; j >= 0; j--) {
      const c = items[j]!
      const b = it.bounds, cb = c.bounds
      if (b.min[0] < cb.min[0] - 1e-9 || b.min[1] < cb.min[1] - 1e-9 || b.max[0] > cb.max[0] + 1e-9 || b.max[1] > cb.max[1] + 1e-9) continue
      if (pointInPolygon(samplePoint(it.ring), c.ring)) {
        it.parent = j
        break
      }
    }
  }
  for (const it of items) {
    let d = 0
    let p = it.parent
    while (p >= 0) {
      d++
      p = items[p]!.parent
    }
    it.depth = d
  }
  const result: PolyWithHoles[] = []
  const indexOfOuter = new Map<number, number>()
  items.forEach((it, i) => {
    if (it.depth % 2 === 0) {
      indexOfOuter.set(i, result.length)
      result.push({ outer: ensureCCW(it.ring), holes: [] })
    }
  })
  items.forEach((it) => {
    if (it.depth % 2 === 1) {
      const oi = indexOfOuter.get(it.parent)
      if (oi !== undefined) result[oi]!.holes.push(ensureCW(it.ring))
    }
  })
  return result
}

/** A point on the ring that is strictly inside its own region (midpoint of an edge nudged inward). */
function samplePoint(ring: Ring): Vec2 {
  // the midpoint of the longest edge, moved slightly toward the interior side
  let best = 0
  let bl = -1
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!
    const l = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (l > bl) {
      bl = l
      best = i
    }
  }
  const a = ring[best]!, b = ring[(best + 1) % ring.length]!
  const ccw = polygonArea(ring) > 0
  const nx = -(b[1] - a[1]) / (bl || 1), ny = (b[0] - a[0]) / (bl || 1)
  const s = (ccw ? 1 : -1) * 1e-7
  return [(a[0] + b[0]) / 2 + nx * s, (a[1] + b[1]) / 2 + ny * s]
}

const fromPaths = (paths: Paths64): PolyWithHoles[] => nestRings(paths.map(fromPath))

const fill = (rule: 'nonzero' | 'evenodd' | 'positive') => (rule === 'nonzero' ? FillRule.NonZero : rule === 'evenodd' ? FillRule.EvenOdd : FillRule.Positive)

export function unionPolygons(polys: readonly (Ring | PolyWithHoles)[], rule: 'nonzero' | 'evenodd' | 'positive' = 'nonzero'): PolyWithHoles[] {
  if (!polys.length) return []
  return fromPaths(Clipper.Union(toPaths(polys), undefined, fill(rule)))
}

export function differencePolygons(subject: readonly (Ring | PolyWithHoles)[], clip: readonly (Ring | PolyWithHoles)[]): PolyWithHoles[] {
  if (!subject.length) return []
  if (!clip.length) return unionPolygons(subject)
  return fromPaths(Clipper.Difference(toPaths(subject), toPaths(clip), FillRule.NonZero))
}

export function intersectPolygons(subject: readonly (Ring | PolyWithHoles)[], clip: readonly (Ring | PolyWithHoles)[]): PolyWithHoles[] {
  if (!subject.length || !clip.length) return []
  return fromPaths(Clipper.Intersect(toPaths(subject), toPaths(clip), FillRule.NonZero))
}

/**
 * Offset one ring along vertex bisectors (exact miter offset of every edge line). Positive delta
 * grows the ring's enclosed region regardless of its orientation; spikes at very sharp corners are
 * clamped by `miterLimit` (× |delta|). Self-intersections are left to the caller (see offsetPolygons).
 */
export function offsetRing(ring: readonly Vec2[], delta: number, miterLimit = 4): Ring {
  const n = ring.length
  if (n < 3 || Math.abs(delta) < 1e-12) return ring.slice()
  const ccw = polygonArea(ring) > 0
  const out: Ring = new Array(n)
  const nrm: Vec2[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const a = ring[i]!, b = ring[(i + 1) % n]!
    const dx = b[0] - a[0], dy = b[1] - a[1]
    const l = Math.hypot(dx, dy) || 1
    // outward normal: right of the edge for CCW rings
    nrm[i] = ccw ? [dy / l, -dx / l] : [-dy / l, dx / l]
  }
  for (let i = 0; i < n; i++) {
    const n0 = nrm[(i + n - 1) % n]!, n1 = nrm[i]!
    const sx = n0[0] + n1[0], sy = n0[1] + n1[1]
    const l2 = sx * sx + sy * sy
    let vx: number, vy: number
    if (l2 < 1e-12) {
      vx = n1[0]
      vy = n1[1]
    } else {
      // |s|² = 2(1 + cos θ); the miter point is s · (2 / |s|²) · delta away from the vertex
      let k = 2 / l2
      const len = Math.sqrt(l2) * k
      if (len > miterLimit) k *= miterLimit / len
      vx = sx * k
      vy = sy * k
    }
    out[i] = [ring[i]![0] + vx * delta, ring[i]![1] + vy * delta]
  }
  return out
}

/**
 * Offset closed polygons (positive = outward / growing the solid). Every ring is offset exactly
 * along its edge lines (miter joins; other join types are treated as miter) and the result is
 * cleaned with a union so self-intersections and merges resolve.
 */
export function offsetPolygons(polys: readonly (Ring | PolyWithHoles)[], delta: number, join: 'miter' | 'round' | 'square' | 'bevel' = 'miter', miterLimit = 4): PolyWithHoles[] {
  void join
  if (!polys.length) return []
  if (Math.abs(delta) < 1e-12) return unionPolygons(polys)
  const shifted: PolyWithHoles[] = []
  for (const p of polys) {
    if (Array.isArray(p)) {
      if (p.length >= 3) shifted.push({ outer: offsetRing(p, delta, miterLimit), holes: [] })
    } else {
      if (p.outer.length < 3) continue
      const holes: Ring[] = []
      for (const h of p.holes) {
        if (h.length < 3) continue
        const hh = offsetRing(h, -delta, miterLimit)
        // a hole that inverted (collapsed) disappears
        if (Math.sign(polygonArea(hh)) === Math.sign(polygonArea(h))) holes.push(hh)
      }
      const outer = offsetRing(p.outer, delta, miterLimit)
      if (Math.sign(polygonArea(outer)) === Math.sign(polygonArea(p.outer))) shifted.push({ outer, holes })
    }
  }
  return unionPolygons(shifted)
}

/** Band of half-width `delta` around an open/closed polyline (rectangles per segment + round joints). */
export function offsetPolyline(points: readonly Vec2[], delta: number, closed = false, join: 'miter' | 'round' | 'square' = 'miter', end: 'butt' | 'square' | 'round' = 'butt', miterLimit = 10): PolyWithHoles[] {
  void join
  void miterLimit
  if (points.length < 2 || delta <= 0) return []
  const pieces: Ring[] = []
  const n = points.length
  const segs = closed ? n : n - 1
  for (let i = 0; i < segs; i++) {
    const a = points[i]!, b = points[(i + 1) % n]!
    const dx = b[0] - a[0], dy = b[1] - a[1]
    const l = Math.hypot(dx, dy)
    if (l < 1e-12) continue
    const nx = (-dy / l) * delta, ny = (dx / l) * delta
    const ext = end === 'square' && !closed ? delta : 0
    const ax = a[0] - (i === 0 ? (dx / l) * ext : 0), ay = a[1] - (i === 0 ? (dy / l) * ext : 0)
    const bx = b[0] + (i === segs - 1 ? (dx / l) * ext : 0), by = b[1] + (i === segs - 1 ? (dy / l) * ext : 0)
    pieces.push([[ax + nx, ay + ny], [ax - nx, ay - ny], [bx - nx, by - ny], [bx + nx, by + ny]])
  }
  // round joints (and round caps) as polygons at the vertices
  const circle = (c: Vec2): Ring => Array.from({ length: 24 }, (_, k) => [c[0] + Math.cos((k / 24) * Math.PI * 2) * delta, c[1] + Math.sin((k / 24) * Math.PI * 2) * delta] as Vec2)
  const first = closed ? 0 : 1, last = closed ? n : n - 1
  for (let i = first; i < last; i++) pieces.push(circle(points[i]!))
  if (!closed && end === 'round') pieces.push(circle(points[0]!), circle(points[n - 1]!))
  return unionPolygons(pieces)
}

export function polygonsArea(polys: readonly PolyWithHoles[]): number {
  let a = 0
  for (const p of polys) {
    a += Math.abs(polygonArea(p.outer))
    for (const h of p.holes) a -= Math.abs(polygonArea(h))
  }
  return a
}

export function pointInPolys(p: Vec2, polys: readonly PolyWithHoles[]): boolean {
  for (const poly of polys) {
    if (!pointInPolygon(p, poly.outer)) continue
    let inHole = false
    for (const h of poly.holes) if (pointInPolygon(p, h)) inHole = true
    if (!inHole) return true
  }
  return false
}

export function polysBounds(polys: readonly PolyWithHoles[]): { min: Vec2; max: Vec2 } {
  const pts: Vec2[] = []
  for (const p of polys) for (const v of p.outer) pts.push(v)
  return bounds2(pts)
}

/** Earcut triangulation of a polygon with holes: flat 2D vertex list + triangle indices. */
export function triangulatePolygon(poly: PolyWithHoles): { vertices: Float64Array; indices: Uint32Array } {
  const total = poly.outer.length + poly.holes.reduce((s, h) => s + h.length, 0)
  const flat = new Float64Array(total * 2)
  const holeIdx: number[] = []
  let k = 0
  for (const p of poly.outer) {
    flat[k++] = p[0]
    flat[k++] = p[1]
  }
  for (const h of poly.holes) {
    holeIdx.push(k / 2)
    for (const p of h) {
      flat[k++] = p[0]
      flat[k++] = p[1]
    }
  }
  const tris = earcut(flat, holeIdx.length ? holeIdx : null, 2)
  // enforce CCW triangles
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i]!, b = tris[i + 1]!, c = tris[i + 2]!
    const area = (flat[b * 2]! - flat[a * 2]!) * (flat[c * 2 + 1]! - flat[a * 2 + 1]!) - (flat[b * 2 + 1]! - flat[a * 2 + 1]!) * (flat[c * 2]! - flat[a * 2]!)
    if (area < 0) {
      tris[i + 1] = c
      tris[i + 2] = b
    }
  }
  return { vertices: flat, indices: Uint32Array.from(tris) }
}

/** Triangles as a flat [x,y, x,y, x,y, …] list (3 vertices per triangle) for Fill2D. */
export function trianglesOf(polys: readonly PolyWithHoles[]): Float32Array {
  const buf = new F32Buf(64)
  for (const poly of polys) {
    if (poly.outer.length < 3) continue
    const { vertices, indices } = triangulatePolygon(poly)
    buf.ensure(indices.length * 2)
    for (let i = 0; i < indices.length; i++) {
      const v = indices[i]!
      buf.push2(vertices[v * 2]!, vertices[v * 2 + 1]!)
    }
  }
  return buf.toArray()
}

// ------------------------------------------------------------------ segment clipping
/**
 * Clip 2D segments [x0,y0,x1,y1,…] against polygons with holes, keeping the parts inside (or
 * outside). Uses clipper2 open-path clipping in one sweep.
 */
export function clipSegments(segments: ArrayLike<number>, polys: readonly PolyWithHoles[], keepInside = true): Float32Array {
  const n = segments.length / 4
  if (!n) return new Float32Array(0)
  if (!polys.length) return keepInside ? new Float32Array(0) : Float32Array.from(segments as ArrayLike<number>)
  const c = new Clipper64()
  const open = new Paths64()
  for (let i = 0; i < n; i++) {
    const p = new Path64()
    p.push(new Point64(segments[i * 4]! * CLIPPER_SCALE, segments[i * 4 + 1]! * CLIPPER_SCALE))
    p.push(new Point64(segments[i * 4 + 2]! * CLIPPER_SCALE, segments[i * 4 + 3]! * CLIPPER_SCALE))
    open.push(p)
  }
  c.addOpenSubjectPaths(open)
  c.addPaths(toPaths(polys), PathType.Clip)
  const closedOut = new Paths64()
  const openOut = new Paths64()
  c.execute(keepInside ? ClipType.Intersection : ClipType.Difference, FillRule.NonZero, closedOut, openOut)
  const out = new F32Buf(openOut.length * 4)
  for (const path of openOut) {
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i]!, b = path[i + 1]!
      if (a.x === b.x && a.y === b.y) continue
      out.push2(a.x / CLIPPER_SCALE, a.y / CLIPPER_SCALE)
      out.push2(b.x / CLIPPER_SCALE, b.y / CLIPPER_SCALE)
    }
  }
  return out.toArray()
}

/** Clip one polyline to the inside of polygons; returns the surviving pieces as point lists. */
export function clipPolyline(points: readonly Vec2[], polys: readonly PolyWithHoles[], keepInside = true): Vec2[][] {
  if (points.length < 2) return []
  const c = new Clipper64()
  const open = new Paths64()
  open.push(toPath(points))
  c.addOpenSubjectPaths(open)
  c.addPaths(toPaths(polys), PathType.Clip)
  const closedOut = new Paths64()
  const openOut = new Paths64()
  c.execute(keepInside ? ClipType.Intersection : ClipType.Difference, FillRule.NonZero, closedOut, openOut)
  return openOut.map(fromPath).filter((p) => p.length >= 2)
}

/**
 * Pure-JS segment clipping against polygons with holes (parametric splitting at edge crossings,
 * midpoint inside test). Cheaper than clipper for small polygons (wall poché, hatch regions).
 */
export function clipSegmentsAgainst(segments: ArrayLike<number>, polys: readonly PolyWithHoles[], keepInside = true, boundaryEps = 0): Float32Array {
  const n = segments.length / 4
  if (!n) return new Float32Array(0)
  if (!polys.length) return keepInside ? new Float32Array(0) : Float32Array.from(segments as ArrayLike<number>)
  // flatten all rings into edge arrays
  const ex0: number[] = [], ey0: number[] = [], ex1: number[] = [], ey1: number[] = []
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const poly of polys) {
    for (const ring of [poly.outer, ...poly.holes]) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!, b = ring[(i + 1) % ring.length]!
        ex0.push(a[0]); ey0.push(a[1]); ex1.push(b[0]); ey1.push(b[1])
        if (a[0] < minX) minX = a[0]
        if (a[1] < minY) minY = a[1]
        if (a[0] > maxX) maxX = a[0]
        if (a[1] > maxY) maxY = a[1]
      }
    }
  }
  const E = ex0.length
  const out = new F32Buf(n * 4)
  const ts: number[] = []
  for (let s = 0; s < n; s++) {
    const x0 = segments[s * 4]!, y0 = segments[s * 4 + 1]!, x1 = segments[s * 4 + 2]!, y1 = segments[s * 4 + 3]!
    // bbox reject
    const sMinX = Math.min(x0, x1), sMaxX = Math.max(x0, x1), sMinY = Math.min(y0, y1), sMaxY = Math.max(y0, y1)
    if (sMaxX < minX || sMinX > maxX || sMaxY < minY || sMinY > maxY) {
      if (!keepInside) out.pushArray([x0, y0, x1, y1])
      continue
    }
    ts.length = 0
    ts.push(0, 1)
    const dx = x1 - x0, dy = y1 - y0
    for (let e = 0; e < E; e++) {
      const fx = ex1[e]! - ex0[e]!, fy = ey1[e]! - ey0[e]!
      const den = dx * fy - dy * fx
      if (Math.abs(den) < 1e-18) continue
      const wx = ex0[e]! - x0, wy = ey0[e]! - y0
      const t = (wx * fy - wy * fx) / den
      const u = (wx * dy - wy * dx) / den
      if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t)
    }
    ts.sort((a, b) => a - b)
    for (let i = 0; i < ts.length - 1; i++) {
      const ta = ts[i]!, tb = ts[i + 1]!
      if (tb - ta < 1e-9) continue
      const tm = (ta + tb) / 2
      const mx = x0 + dx * tm, my = y0 + dy * tm
      let inside = pointInPolys([mx, my], polys)
      if (!inside && boundaryEps > 0) {
        // midpoints lying on a polygon edge count as inside (coincident boundaries are covered)
        for (let e = 0; e < E && !inside; e++) {
          const fx = ex1[e]! - ex0[e]!, fy = ey1[e]! - ey0[e]!
          const l2 = fx * fx + fy * fy
          if (l2 < 1e-24) continue
          let u = ((mx - ex0[e]!) * fx + (my - ey0[e]!) * fy) / l2
          u = u < 0 ? 0 : u > 1 ? 1 : u
          const qx = ex0[e]! + fx * u - mx, qy = ey0[e]! + fy * u - my
          if (qx * qx + qy * qy <= boundaryEps * boundaryEps) inside = true
        }
      }
      if (inside === keepInside) out.pushArray([x0 + dx * ta, y0 + dy * ta, x0 + dx * tb, y0 + dy * tb])
    }
  }
  // merge consecutive collinear pieces of the same source segment is unnecessary for rendering
  return out.toArray()
}

/** Distance from p to the nearest polygon edge. */
export function distanceToBoundary(p: Vec2, polys: readonly PolyWithHoles[]): number {
  let best = Infinity
  for (const poly of polys) {
    for (const ring of [poly.outer, ...poly.holes]) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!, b = ring[(i + 1) % ring.length]!
        const dx = b[0] - a[0], dy = b[1] - a[1]
        const l2 = dx * dx + dy * dy
        let t = l2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0
        t = t < 0 ? 0 : t > 1 ? 1 : t
        const d = Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1])
        if (d < best) best = d
      }
    }
  }
  return best
}

/** Approximate pole of inaccessibility (best label position): coarse grid + local refinement. */
export function labelPoint(poly: PolyWithHoles): Vec2 {
  const b = bounds2(poly.outer)
  const polys = [poly]
  let best: Vec2 = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2]
  let bestD = pointInPolys(best, polys) ? distanceToBoundary(best, polys) : -1
  const n = 14
  for (let i = 1; i < n; i++) {
    for (let j = 1; j < n; j++) {
      const p: Vec2 = [b.min[0] + ((b.max[0] - b.min[0]) * i) / n, b.min[1] + ((b.max[1] - b.min[1]) * j) / n]
      if (!pointInPolys(p, polys)) continue
      const d = distanceToBoundary(p, polys)
      if (d > bestD) {
        bestD = d
        best = p
      }
    }
  }
  // refine around the best cell
  let step = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1]) / n
  for (let k = 0; k < 6; k++) {
    step /= 2
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as const) {
      const p: Vec2 = [best[0] + dx * step, best[1] + dy * step]
      if (!pointInPolys(p, polys)) continue
      const d = distanceToBoundary(p, polys)
      if (d > bestD) {
        bestD = d
        best = p
      }
    }
  }
  return best
}
