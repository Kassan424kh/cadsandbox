// Planar graph face finding: split segments at intersections, build half-edges, trace faces.
// Used for hatch-region detection (findRegion) and straight-skeleton face extraction.
import type { Vec2 } from '@cadsandbox/doc'
import { pointInPolygon, polygonArea, segmentIntersection } from './math2d'
import type { PolyWithHoles } from './polygon'

export interface PlanarGraph {
  vertices: Vec2[]
  /** CCW bounded faces as vertex index loops */
  faces: number[][]
  /** CW outer loops (one per connected component) */
  outer: number[][]
}

/** Segment list → planar subdivision. `eps` snaps coincident endpoints/crossings. */
export function planarFaces(segments: readonly (readonly [Vec2, Vec2])[], eps = 1e-6): PlanarGraph {
  // 1. split at proper intersections
  type Seg = { a: Vec2; b: Vec2; ts: number[] }
  const segs: Seg[] = segments.filter(([a, b]) => Math.hypot(a[0] - b[0], a[1] - b[1]) > eps).map(([a, b]) => ({ a, b, ts: [] }))
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const s = segs[i]!, t = segs[j]!
      const r = segmentIntersection(s.a, s.b, t.a, t.b, 1e-9)
      if (!r) continue
      if (r.t > 1e-9 && r.t < 1 - 1e-9) s.ts.push(r.t)
      if (r.u > 1e-9 && r.u < 1 - 1e-9) t.ts.push(r.u)
    }
  }
  // 2. vertices (snapped) and directed edges
  const inv = 1 / eps
  const vmap = new Map<string, number>()
  const vertices: Vec2[] = []
  const vid = (p: Vec2): number => {
    const key = `${Math.round(p[0] * inv)},${Math.round(p[1] * inv)}`
    let id = vmap.get(key)
    if (id === undefined) {
      id = vertices.length
      vmap.set(key, id)
      vertices.push([p[0], p[1]])
    }
    return id
  }
  const edgeSet = new Set<string>()
  const halfFrom: number[] = [] // half-edge origin
  const halfTo: number[] = []
  const addEdge = (u: number, v: number) => {
    if (u === v) return
    const key = u < v ? `${u}-${v}` : `${v}-${u}`
    if (edgeSet.has(key)) return
    edgeSet.add(key)
    halfFrom.push(u, v)
    halfTo.push(v, u)
  }
  for (const s of segs) {
    const ts = [0, ...s.ts.sort((x, y) => x - y), 1]
    let prev = vid(s.a)
    for (let k = 1; k < ts.length; k++) {
      const t = ts[k]!
      const p: Vec2 = k === ts.length - 1 ? s.b : [s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t]
      const cur = vid(p)
      addEdge(prev, cur)
      prev = cur
    }
  }
  const H = halfFrom.length
  // 3. angular order of outgoing half-edges per vertex
  const outgoing: number[][] = vertices.map(() => [])
  for (let h = 0; h < H; h++) outgoing[halfFrom[h]!]!.push(h)
  const angle = (h: number) => Math.atan2(vertices[halfTo[h]!]![1] - vertices[halfFrom[h]!]![1], vertices[halfTo[h]!]![0] - vertices[halfFrom[h]!]![0])
  const rank = new Int32Array(H)
  for (const list of outgoing) {
    list.sort((p, q) => angle(p) - angle(q))
    list.forEach((h, i) => (rank[h] = i))
  }
  // next half-edge of the face on the left: at the target, take the clockwise neighbour of the twin
  const next = (h: number): number => {
    const twin = h ^ 1
    const list = outgoing[halfFrom[twin]!]!
    const i = rank[twin]!
    return list[(i - 1 + list.length) % list.length]!
  }
  const visited = new Uint8Array(H)
  const faces: number[][] = []
  const outer: number[][] = []
  for (let h0 = 0; h0 < H; h0++) {
    if (visited[h0]) continue
    const loop: number[] = []
    let h = h0
    let guard = 0
    while (!visited[h] && guard++ < H + 1) {
      visited[h] = 1
      loop.push(halfFrom[h]!)
      h = next(h)
    }
    if (loop.length < 2) continue
    const pts = loop.map((i) => vertices[i]!)
    const a = polygonArea(pts)
    if (a > eps * eps) faces.push(loop)
    else if (a < -eps * eps) outer.push(loop)
  }
  return { vertices, faces, outer }
}

/**
 * The closed region of a segment soup that contains `point`: the smallest bounded face around the
 * point, with inner components (islands) as holes. Returns null when the point is not enclosed.
 */
export function findRegion(segments: ArrayLike<number> | readonly (readonly [Vec2, Vec2])[], point: Vec2, eps = 1e-6): PolyWithHoles | null {
  let list: (readonly [Vec2, Vec2])[]
  if (typeof (segments as ArrayLike<number>).length === 'number' && typeof (segments as ArrayLike<number>)[0] === 'number') {
    const s = segments as ArrayLike<number>
    list = []
    for (let i = 0; i + 3 < s.length; i += 4) list.push([[s[i]!, s[i + 1]!], [s[i + 2]!, s[i + 3]!]])
  } else list = segments as (readonly [Vec2, Vec2])[]
  const g = planarFaces(list, eps)
  let best: number[] | null = null
  let bestArea = Infinity
  for (const f of g.faces) {
    const pts = f.map((i) => g.vertices[i]!)
    if (!pointInPolygon(point, pts)) continue
    const a = polygonArea(pts)
    if (a < bestArea) {
      bestArea = a
      best = f
    }
  }
  if (!best) return null
  const outer = best.map((i) => g.vertices[i]!)
  const holes: Vec2[][] = []
  for (const o of g.outer) {
    const pts = o.map((i) => g.vertices[i]!)
    // an island's outer loop lies inside our face and does not contain the point
    if (pts.length && pointInPolygon(pts[0]!, outer) && !pointInPolygon(point, pts) && Math.abs(polygonArea(pts)) < bestArea) {
      // it must not be our own face's outer loop (same vertex set)
      if (!sameLoop(o, best)) holes.push(pts)
    }
  }
  return { outer, holes }
}

function sameLoop(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  const sa = new Set(a)
  for (const v of b) if (!sa.has(v)) return false
  return true
}
