// Planar graph face finding: turns a soup of 2D segments (wall axes, lines, polylines…) into the
// minimal bounded faces + the outer boundary of every connected component. Used for "click inside
// a closed region" tools (hatch, room, slab, roof) until @cadsandbox/geometry exports its own.
import type { Vec2 } from '@cadsandbox/doc'
import { polygonArea } from '@cadsandbox/doc'
import { pointInPolygon, polygonInside, segmentIntersection, type Seg2 } from './polygon'
import { v2 } from './vec'

export interface PlanarSegment extends Seg2 {
  /** Source id (node id) carried through to face edges. */
  ref?: string
}

export interface FaceEdge {
  a: Vec2
  b: Vec2
  /** Index into the input segments */
  source: number
  ref?: string
  /** true when the face edge runs opposite to the source segment direction (b→a) */
  reversed: boolean
}

export interface PlanarFace {
  /** CCW outline (bounded faces) */
  outline: Vec2[]
  edges: FaceEdge[]
  area: number
  component: number
}

export interface PlanarGraph {
  faces: PlanarFace[]
  /** Outer boundary (CCW) of every connected component, index = component id */
  outer: (PlanarFace | null)[]
}

interface HalfEdge {
  from: number
  to: number
  source: number
  reversed: boolean
  visited: boolean
  twin: HalfEdge | null
}

class VertexIndex {
  private cells = new Map<string, number[]>()
  readonly points: Vec2[] = []
  constructor(private tol: number) {}
  find(p: Vec2): number {
    const cx = Math.round(p[0] / this.tol),
      cy = Math.round(p[1] / this.tol)
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const ids = this.cells.get(`${cx + dx},${cy + dy}`)
        if (!ids) continue
        for (const id of ids) if (v2.dist(this.points[id], p) <= this.tol) return id
      }
    const id = this.points.length
    this.points.push([p[0], p[1]])
    const k = `${cx},${cy}`
    const arr = this.cells.get(k)
    if (arr) arr.push(id)
    else this.cells.set(k, [id])
    return id
  }
}

/** Split all segments at mutual intersections and at endpoints touching other segments. */
export function splitSegments(segments: readonly PlanarSegment[], tol = 1e-4): { a: Vec2; b: Vec2; source: number }[] {
  const params: number[][] = segments.map(() => [0, 1])
  for (let i = 0; i < segments.length; i++) {
    const si = segments[i]
    const li = v2.dist(si.a, si.b)
    if (li < tol) continue
    for (let j = i + 1; j < segments.length; j++) {
      const sj = segments[j]
      const lj = v2.dist(sj.a, sj.b)
      if (lj < tol) continue
      const hit = segmentIntersection(si, sj, tol / Math.max(li, lj))
      if (hit) {
        params[i].push(hit.t)
        params[j].push(hit.u)
        continue
      }
      // T-junctions / overlapping collinear segments: endpoints lying on the other segment.
      pushEndpointOnSegment(sj.a, si, li, params[i], tol)
      pushEndpointOnSegment(sj.b, si, li, params[i], tol)
      pushEndpointOnSegment(si.a, sj, lj, params[j], tol)
      pushEndpointOnSegment(si.b, sj, lj, params[j], tol)
    }
  }
  const out: { a: Vec2; b: Vec2; source: number }[] = []
  segments.forEach((s, i) => {
    const len = v2.dist(s.a, s.b)
    if (len < tol) return
    const ts = [...new Set(params[i].map((t) => Math.min(1, Math.max(0, t))))].sort((x, y) => x - y)
    for (let k = 0; k < ts.length - 1; k++) {
      if ((ts[k + 1] - ts[k]) * len < tol) continue
      out.push({ a: v2.lerp(s.a, s.b, ts[k]), b: v2.lerp(s.a, s.b, ts[k + 1]), source: i })
    }
  })
  return out
}

function pushEndpointOnSegment(p: Vec2, s: Seg2, len: number, params: number[], tol: number): void {
  const d = v2.sub(s.b, s.a)
  const t = v2.dot(v2.sub(p, s.a), d) / (len * len)
  if (t <= 0 || t >= 1) return
  const q = v2.add(s.a, v2.scale(d, t))
  if (v2.dist(p, q) <= tol) params.push(t)
}

/** Build faces from segments. */
export function buildPlanarGraph(segments: readonly PlanarSegment[], tol = 1e-4): PlanarGraph {
  const pieces = splitSegments(segments, tol)
  const vi = new VertexIndex(tol)
  const edgeKeys = new Set<string>()
  const halfEdges: HalfEdge[] = []
  const outgoing = new Map<number, HalfEdge[]>()
  const add = (h: HalfEdge) => {
    halfEdges.push(h)
    const arr = outgoing.get(h.from)
    if (arr) arr.push(h)
    else outgoing.set(h.from, [h])
  }
  for (const p of pieces) {
    const u = vi.find(p.a),
      v = vi.find(p.b)
    if (u === v) continue
    const key = u < v ? `${u}-${v}` : `${v}-${u}`
    if (edgeKeys.has(key)) continue
    edgeKeys.add(key)
    const h1: HalfEdge = { from: u, to: v, source: p.source, reversed: false, visited: false, twin: null }
    const h2: HalfEdge = { from: v, to: u, source: p.source, reversed: true, visited: false, twin: h1 }
    h1.twin = h2
    add(h1)
    add(h2)
  }
  const pts = vi.points
  // Sort outgoing edges CCW by angle.
  const angleOf = (h: HalfEdge) => Math.atan2(pts[h.to][1] - pts[h.from][1], pts[h.to][0] - pts[h.from][0])
  for (const arr of outgoing.values()) arr.sort((x, y) => angleOf(x) - angleOf(y))

  // Union-find for components.
  const parent = pts.map((_, i) => i)
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])))
  for (const h of halfEdges) {
    const a = find(h.from),
      b = find(h.to)
    if (a !== b) parent[a] = b
  }
  const compIds = new Map<number, number>()
  const componentOf = (v: number) => {
    const r = find(v)
    let c = compIds.get(r)
    if (c === undefined) {
      c = compIds.size
      compIds.set(r, c)
    }
    return c
  }

  const faces: PlanarFace[] = []
  const outer: (PlanarFace | null)[] = []
  for (const start of halfEdges) {
    if (start.visited) continue
    const loop: HalfEdge[] = []
    let h = start
    let guard = 0
    do {
      h.visited = true
      loop.push(h)
      // Next: at h.to, take the edge just clockwise of the reverse direction (h.twin).
      const arr = outgoing.get(h.to)!
      const idx = arr.indexOf(h.twin!)
      h = arr[(idx - 1 + arr.length) % arr.length]
    } while (h !== start && guard++ < halfEdges.length + 1)
    const cleaned = removeSpikes(loop)
    if (cleaned.length < 3) continue
    const outline = cleaned.map((e) => pts[e.from])
    const area = polygonArea(outline)
    if (Math.abs(area) < tol * tol) continue
    const comp = componentOf(start.from)
    const face: PlanarFace = {
      outline: area > 0 ? outline : outline.slice().reverse(),
      edges: cleaned.map((e) => ({ a: pts[e.from], b: pts[e.to], source: e.source, ref: segments[e.source]?.ref, reversed: e.reversed })),
      area: Math.abs(area),
      component: comp,
    }
    if (area < 0) {
      // Outer face → keep edges consistent with the reversed (CCW) outline.
      face.edges = cleaned
        .slice()
        .reverse()
        .map((e) => ({ a: pts[e.to], b: pts[e.from], source: e.source, ref: segments[e.source]?.ref, reversed: !e.reversed }))
      const prev = outer[comp]
      if (!prev || prev.area < face.area) outer[comp] = face
    } else faces.push(face)
  }
  for (let i = 0; i < compIds.size; i++) if (outer[i] === undefined) outer[i] = null
  return { faces, outer }
}

/** Drop immediate there-and-back edge pairs (dangling edges) from a face loop. */
function removeSpikes(loop: HalfEdge[]): HalfEdge[] {
  let arr = loop.slice()
  let changed = true
  while (changed && arr.length >= 2) {
    changed = false
    for (let i = 0; i < arr.length; i++) {
      const a = arr[i],
        b = arr[(i + 1) % arr.length]
      if (a.twin === b) {
        if (i + 1 < arr.length) arr.splice(i, 2)
        else arr = arr.slice(1, arr.length - 1)
        changed = true
        break
      }
    }
  }
  return arr
}

export interface Region {
  outline: Vec2[]
  holes: Vec2[][]
  edges: FaceEdge[]
  face: PlanarFace
  graph: PlanarGraph
}

/** The smallest bounded face containing `point`, with islands of other components as holes. */
export function findRegion(segments: readonly PlanarSegment[], point: Vec2, tol = 1e-4): Region | null {
  const graph = buildPlanarGraph(segments, tol)
  return regionAt(graph, point)
}

export function regionAt(graph: PlanarGraph, point: Vec2): Region | null {
  let best: PlanarFace | null = null
  for (const f of graph.faces) {
    if (!pointInPolygon(point, f.outline)) continue
    if (!best || f.area < best.area) best = f
  }
  if (!best) return null
  const holes: Vec2[][] = []
  graph.outer.forEach((o, comp) => {
    if (!o || comp === best!.component) return
    if (polygonInside(o.outline, best!.outline)) holes.push(o.outline)
  })
  return { outline: best.outline, holes, edges: best.edges, face: best, graph }
}

/** Outer boundary of the component that contains `point` (inside any of its faces). */
export function outerBoundaryAt(graph: PlanarGraph, point: Vec2): PlanarFace | null {
  const region = regionAt(graph, point)
  if (!region) return null
  return graph.outer[region.face.component] ?? null
}
