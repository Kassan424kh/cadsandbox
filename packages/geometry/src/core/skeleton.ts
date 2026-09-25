// Weighted straight skeleton of a simple polygon (edge weight = offset speed; 0 = static edge, as
// for gable ends). Event-driven wavefront propagation with global re-evaluation of candidates per
// step — O(n³) but robust for building footprints (n ≲ 60).
import type { Vec2 } from '@cadsandbox/doc'
import { cross2, ensureCCW, polygonArea, sub2 } from './math2d'
import { planarFaces } from './planar'

export interface SkeletonArc {
  a: Vec2
  b: Vec2
  /** offset "time" (distance for weight 1) at each end */
  ta: number
  tb: number
}

export interface SkeletonFace {
  /** index of the source polygon edge (i → i+1) */
  edge: number
  /** face polygon (CCW) with the offset time per vertex */
  points: Vec2[]
  times: number[]
}

export interface StraightSkeleton {
  polygon: Vec2[]
  arcs: SkeletonArc[]
  faces: SkeletonFace[]
  /** maximum offset time reached (roof height / tan pitch) */
  maxTime: number
}

interface Edge {
  n: Vec2 // inward unit normal
  c: number // n · x for points on the edge line at t = 0
  w: number
}

interface Vert {
  id: number
  x0: Vec2
  v: Vec2
  tc: number
  eL: number
  eR: number
  prev: Vert
  next: Vert
  alive: boolean
  born: Vec2
}

const EPS = 1e-9

function solve2(n1: Vec2, r1: number, n2: Vec2, r2: number): Vec2 | null {
  const det = n1[0] * n2[1] - n1[1] * n2[0]
  if (Math.abs(det) < 1e-12) return null
  return [(r1 * n2[1] - r2 * n1[1]) / det, (n1[0] * r2 - n2[0] * r1) / det]
}

export function straightSkeleton(input: readonly Vec2[], weights?: readonly number[]): StraightSkeleton {
  const poly = ensureCCW(input.slice())
  const n = poly.length
  const edges: Edge[] = []
  for (let i = 0; i < n; i++) {
    const a = poly[i]!, b = poly[(i + 1) % n]!
    const d = sub2(b, a)
    const l = Math.hypot(d[0], d[1]) || 1
    // inward normal of a CCW polygon = left normal
    const nn: Vec2 = [-d[1] / l, d[0] / l]
    edges.push({ n: nn, c: nn[0] * a[0] + nn[1] * a[1], w: Math.max(0, weights?.[i] ?? 1) })
  }
  const arcs: SkeletonArc[] = []
  let idCounter = 0
  const makeVert = (eL: number, eR: number, at: Vec2, tc: number): Vert => {
    const a = edges[eL]!, b = edges[eR]!
    let v = solve2(a.n, a.w, b.n, b.w)
    if (!v) {
      // parallel edges: collinear continuation moves with the edge; opposite edges = ridge vertex
      const same = a.n[0] * b.n[0] + a.n[1] * b.n[1] > 0
      const w = (a.w + b.w) / 2
      v = same ? [a.n[0] * w, a.n[1] * w] : [0, 0]
    }
    const x0: Vec2 = [at[0] - v[0] * tc, at[1] - v[1] * tc]
    const vert = { id: idCounter++, x0, v, tc, eL, eR, alive: true, born: [at[0], at[1]] } as Vert
    vert.prev = vert
    vert.next = vert
    return vert
  }
  const posAt = (v: Vert, t: number): Vec2 => [v.x0[0] + v.v[0] * t, v.x0[1] + v.v[1] * t]
  // initial LAV
  const lavs: Vert[][] = []
  const first: Vert[] = []
  for (let i = 0; i < n; i++) first.push(makeVert((i + n - 1) % n, i, poly[i]!, 0))
  for (let i = 0; i < n; i++) {
    first[i]!.prev = first[(i + n - 1) % n]!
    first[i]!.next = first[(i + 1) % n]!
  }
  lavs.push(first)
  const isReflex = (v: Vert): boolean => {
    const a = edges[v.eL]!, b = edges[v.eR]!
    // edge directions: rotate normals by -90° (n = left normal of d → d = (n.y, -n.x))
    const da: Vec2 = [a.n[1], -a.n[0]], db: Vec2 = [b.n[1], -b.n[0]]
    return cross2(da, db) < -1e-9
  }
  const die = (v: Vert, at: Vec2, t: number) => {
    v.alive = false
    arcs.push({ a: v.born, b: [at[0], at[1]], ta: v.tc, tb: t })
  }
  let time = 0
  let maxTime = 0
  let iterations = 0
  const maxIter = 20 * n + 200
  const active = (): Vert[][] => lavs.filter((l) => l.length && l[0]!.alive)
  while (iterations++ < maxIter) {
    // collect live LAVs (rebuilt from linked lists)
    const live: Vert[][] = []
    for (const l of active()) {
      const start = l.find((v) => v.alive)
      if (!start) continue
      const list: Vert[] = []
      let v = start
      let guard = 0
      do {
        list.push(v)
        v = v.next
      } while (v !== start && guard++ < 100000)
      live.push(list)
    }
    if (!live.length) break
    // finish LAVs of size ≤ 2
    let progressed = false
    for (const list of live) {
      if (list.length <= 2) {
        const a = list[0]!
        const b = list[1]
        const pa = posAt(a, time)
        const pb = b ? posAt(b, time) : pa
        die(a, pa, time)
        if (b) die(b, pb, time)
        if (b && Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) > 1e-7) arcs.push({ a: pa, b: pb, ta: time, tb: time })
        progressed = true
      }
    }
    if (progressed) {
      lavs.length = 0
      lavs.push(...live.filter((l) => l.length > 2))
      continue
    }
    // find the earliest event over all LAVs
    let best: { t: number; kind: 'edge' | 'split'; a: Vert; b?: Vert; edge?: number; p: Vec2 } | null = null
    for (const list of live) {
      for (const a of list) {
        const b = a.next
        // edge event: a and b meet
        const dv: Vec2 = [a.v[0] - b.v[0], a.v[1] - b.v[1]]
        const dx: Vec2 = [b.x0[0] - a.x0[0], b.x0[1] - a.x0[1]]
        const dd = dv[0] * dv[0] + dv[1] * dv[1]
        if (dd > 1e-18) {
          const t = (dx[0] * dv[0] + dx[1] * dv[1]) / dd
          if (t >= time - 1e-9) {
            const pa = posAt(a, t), pb = posAt(b, t)
            if (Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) < 1e-6 * Math.max(1, Math.abs(t))) {
              if (!best || t < best.t - EPS) best = { t, kind: 'edge', a, b, p: pa }
            }
          }
        }
        // split events for reflex vertices
        if (!isReflex(a)) continue
        for (const u of list) {
          const ej = u.eR
          if (ej === a.eL || ej === a.eR || u === a || u.next === a) continue
          const e = edges[ej]!
          // the vertex approaches the moving edge line when d/dt (n·V − (c + w t)) = n·v − w < 0
          const den = e.n[0] * a.v[0] + e.n[1] * a.v[1] - e.w
          if (den >= -1e-12) continue
          const t = (e.c - (e.n[0] * a.x0[0] + e.n[1] * a.x0[1])) / den
          if (t < time - 1e-9) continue // simultaneous events are allowed
          if (best && t >= best.t - EPS) continue
          const p = posAt(a, t)
          const pu = posAt(u, t), pw = posAt(u.next, t)
          const seg = sub2(pw, pu)
          const l2 = seg[0] * seg[0] + seg[1] * seg[1]
          const s = l2 > 1e-18 ? ((p[0] - pu[0]) * seg[0] + (p[1] - pu[1]) * seg[1]) / l2 : 0
          if (s < -1e-6 || s > 1 + 1e-6) continue
          best = { t, kind: 'split', a, b: u, edge: ej, p }
        }
      }
    }
    if (!best) {
      // no more events: remaining vertices are stationary (all-static polygon) — stop
      for (const list of live) for (const v of list) die(v, posAt(v, time), time)
      break
    }
    time = Math.max(time, best.t)
    maxTime = Math.max(maxTime, time)
    if (best.kind === 'edge') {
      const a = best.a, b = best.b!
      die(a, best.p, time)
      die(b, best.p, time)
      const nv = makeVert(a.eL, b.eR, best.p, time)
      nv.prev = a.prev
      nv.next = b.next
      a.prev.next = nv
      b.next.prev = nv
      // replace in lav storage
      for (const l of lavs) {
        const i = l.indexOf(a)
        if (i >= 0) {
          l.splice(i, 1, nv)
          const j = l.indexOf(b)
          if (j >= 0) l.splice(j, 1)
        }
      }
    } else {
      const v = best.a
      const u = best.b! // edge ej runs u → u.next
      const w = u.next
      die(v, best.p, time)
      const x = v.prev, y = v.next
      const n1 = makeVert(v.eL, best.edge!, best.p, time)
      const n2 = makeVert(best.edge!, v.eR, best.p, time)
      // LAV1: x → n1 → w … x ; LAV2: u → n2 → y … u
      x.next = n1
      n1.prev = x
      n1.next = w
      w.prev = n1
      u.next = n2
      n2.prev = u
      n2.next = y
      y.prev = n2
      const rebuild = (start: Vert): Vert[] => {
        const out: Vert[] = []
        let c = start
        let guard = 0
        do {
          out.push(c)
          c = c.next
        } while (c !== start && guard++ < 100000)
        return out
      }
      for (let i = lavs.length - 1; i >= 0; i--) if (lavs[i]!.includes(v)) lavs.splice(i, 1)
      lavs.push(rebuild(n1), rebuild(n2))
    }
  }
  return { polygon: poly, arcs, faces: skeletonFaces(poly, arcs, edges), maxTime }
}

/** Faces per polygon edge from the arrangement of polygon edges + arcs. */
function skeletonFaces(poly: Vec2[], arcs: SkeletonArc[], edges: Edge[]): SkeletonFace[] {
  const n = poly.length
  const segs: [Vec2, Vec2][] = []
  for (let i = 0; i < n; i++) segs.push([poly[i]!, poly[(i + 1) % n]!])
  for (const a of arcs) if (Math.hypot(a.a[0] - a.b[0], a.a[1] - a.b[1]) > 1e-7) segs.push([a.a, a.b])
  const eps = 1e-6
  const g = planarFaces(segs, eps)
  const same = (p: Vec2, q: Vec2) => Math.abs(p[0] - q[0]) < 1e-5 && Math.abs(p[1] - q[1]) < 1e-5
  const faces: SkeletonFace[] = []
  for (const loop of g.faces) {
    const pts = loop.map((i) => g.vertices[i]!)
    // the source edge appears as one whole boundary edge of its face
    let edge = -1
    for (let i = 0; i < n && edge < 0; i++) {
      if (edges[i]!.w <= 0) continue
      const a = poly[i]!, b = poly[(i + 1) % n]!
      for (let k = 0; k < pts.length; k++) {
        const p = pts[k]!, q = pts[(k + 1) % pts.length]!
        if ((same(p, a) && same(q, b)) || (same(p, b) && same(q, a))) {
          edge = i
          break
        }
      }
    }
    if (edge < 0) continue
    // a face is the plane swept by its edge: time = distance from the edge line / weight
    const e = edges[edge]!
    const times = pts.map((p) => Math.max(0, (e.n[0] * p[0] + e.n[1] * p[1] - e.c) / e.w))
    faces.push({ edge, points: pts, times })
  }
  faces.sort((a, b) => a.edge - b.edge)
  return faces
}

export { polygonArea }
