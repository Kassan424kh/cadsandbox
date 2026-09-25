// Wall 3D construction: one closed solid per layer, openings cut with reveal faces; feature edges of
// the outer shell filtered against joined neighbours.
import type { Vec2, Vec3 } from '@cadsandbox/doc'
import type { MeshBuffers } from '../../api'
import { Seg3Buf } from '../../core/buffers'
import { GEOM_EPS } from '../../core/math2d'
import { DEFAULT_CREASE, MeshBuilder, computeFeatureEdges } from '../../core/mesh'
import { clipSegmentsAgainst, differencePolygons, nestRings, offsetPolygons, pointInPolys, triangulatePolygon, type PolyWithHoles, type Ring } from '../../core/polygon'
import type { OpeningRef } from '../context'
import type { LayerBand, WallFrame } from './frame'
import { endParam, type WallSolve } from './joins'

export interface OpeningCut {
  ids: string[]
  s0: number
  s1: number
  z0: number
  z1: number
}

/** Opening rectangles in wall coordinates, clamped to the straight range and merged when overlapping. */
export function openingCuts(f: WallFrame, solve: WallSolve, openings: readonly OpeningRef[] | undefined): OpeningCut[] {
  if (!openings?.length) return []
  const sMin = Math.max(solve.a.sL, solve.a.sR) + 0.001
  const sMax = Math.min(solve.b.sL, solve.b.sR) - 0.001
  const cuts: OpeningCut[] = []
  for (const o of openings) {
    const p = o.params
    const sc = f.sFromRef(p.offset)
    const w = Math.max(0, p.width)
    let s0 = Math.max(sMin, sc - w / 2)
    let s1 = Math.min(sMax, sc + w / 2)
    if (s1 - s0 < 0.01) continue
    const z0 = Math.max(f.z0, f.z0 + Math.max(0, p.sill))
    const z1 = Math.min(f.z1, z0 + Math.max(0, p.height))
    if (z1 - z0 < 0.01) continue
    cuts.push({ ids: [o.id], s0, s1, z0, z1 })
  }
  // merge overlapping cuts
  cuts.sort((a, b) => a.s0 - b.s0)
  const merged: OpeningCut[] = []
  for (const c of cuts) {
    const last = merged[merged.length - 1]
    if (last && c.s0 < last.s1 - GEOM_EPS && c.z0 < last.z1 - GEOM_EPS && c.z1 > last.z0 + GEOM_EPS) {
      last.s1 = Math.max(last.s1, c.s1)
      last.z0 = Math.min(last.z0, c.z0)
      last.z1 = Math.max(last.z1, c.z1)
      last.ids.push(...c.ids)
    } else merged.push({ ...c, ids: [...c.ids] })
  }
  return merged
}

/** Layer band footprint in XY between two end parameters (CCW). */
export function bandRing(f: WallFrame, band: LayerBand, sA_R: number, sB_R: number, sB_L: number, sA_L: number): Ring {
  const right = f.sample(band.oR, sA_R, sB_R)
  const left = f.sample(band.oL, sB_L, sA_L)
  return right.concat(left)
}

/** XY rectangle of an opening cut across a band. */
export function cutRing(f: WallFrame, oR: number, oL: number, s0: number, s1: number): Ring {
  return f.sample(oR, s0, s1).concat(f.sample(oL, s1, s0))
}

/** Insert intermediate s samples into (s,z)-space polygon edges so cylindrical faces stay smooth. */
function densify(f: WallFrame, ring: Ring, o: number): Ring {
  if (f.kind === 'line') return ring
  const rho = Math.abs(f.R - f.sgn * o)
  const step = Math.max(0.02, Math.sqrt(8 * rho * 0.002)) // chord error ≈ 2 mm
  const out: Ring = []
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!
    out.push(a)
    const ds = Math.abs(b[0] - a[0])
    if (ds > step && Math.abs(b[1] - a[1]) < GEOM_EPS) {
      const n = Math.ceil(ds / step)
      for (let k = 1; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1]])
    }
  }
  return out
}

/** Triangulate an (s,z) polygon and place it on the face at offset o with outward normal sign. */
function sideFace(mb: MeshBuilder, f: WallFrame, poly: PolyWithHoles, o: number, outwardLeft: boolean): void {
  const dense: PolyWithHoles = { outer: densify(f, poly.outer, o), holes: poly.holes.map((h) => densify(f, h, o)) }
  const { vertices, indices } = triangulatePolygon(dense)
  const base = mb.vertexCount
  for (let i = 0; i < vertices.length; i += 2) {
    const s = vertices[i]!, z = vertices[i + 1]!
    const p = f.point(s, o)
    const n = f.normal(s)
    const sign = outwardLeft ? 1 : -1
    mb.vertex(p[0], p[1], z, n[0] * sign, n[1] * sign, 0, s, z)
  }
  for (let i = 0; i < indices.length; i += 3) mb.orientedTri(base + indices[i]!, base + indices[i + 1]!, base + indices[i + 2]!)
}

const lift = (ring: Ring, z: number): Vec3[] => ring.map((p) => [p[0], p[1], z] as Vec3)

/** Strip between two sampled curves (same length) at height z (head/sill faces). */
function strip(mb: MeshBuilder, lower: Vec2[], upper: Vec2[], z: number, nz: number): void {
  for (let i = 0; i < lower.length - 1; i++) {
    const a = lower[i]!, b = lower[i + 1]!, c = upper[i + 1]!, d = upper[i]!
    const ia = mb.vertex(a[0], a[1], z, 0, 0, nz, a[0], a[1])
    const ib = mb.vertex(b[0], b[1], z, 0, 0, nz, b[0], b[1])
    const ic = mb.vertex(c[0], c[1], z, 0, 0, nz, c[0], c[1])
    const id = mb.vertex(d[0], d[1], z, 0, 0, nz, d[0], d[1])
    mb.orientedQuad(ia, ib, ic, id)
  }
}

export interface WallMeshResult {
  layers: { band: LayerBand; mesh: MeshBuffers }[]
  edges: Float32Array
}

export function buildWallMesh(f: WallFrame, solve: WallSolve, cuts: OpeningCut[]): WallMeshResult {
  const cutRects: PolyWithHoles[] = cuts.map((c) => ({ outer: [[c.s0, c.z0], [c.s1, c.z0], [c.s1, c.z1], [c.s0, c.z1]], holes: [] }))
  const layers = f.layers.map((band) => ({ band, mesh: bandSolid(f, solve, cutRects, cuts, band) }))
  // edges come from the outer shell (one solid across all layers) so layer boundaries stay invisible
  const half = f.t / 2
  const first = f.layers[0]!
  const shell = f.layers.length === 1 ? layers[0]!.mesh : bandSolid(f, solve, cutRects, cuts, { ...first, oL: half, oR: -half, thickness: f.t })
  return { layers, edges: wallEdges(f, solve, shell) }
}

/** Closed solid of one layer band: side faces with opening cut-outs, top/bottom, end caps, reveals. */
function bandSolid(f: WallFrame, solve: WallSolve, cutRects: PolyWithHoles[], cuts: OpeningCut[], band: LayerBand): MeshBuffers {
  const mb = new MeshBuilder(256)
  const sA_L = endParam(f, solve.a, band.oL), sA_R = endParam(f, solve.a, band.oR)
  const sB_L = endParam(f, solve.b, band.oL), sB_R = endParam(f, solve.b, band.oR)
  // side faces in (s,z) space
  for (const [o, sA, sB, left] of [[band.oL, sA_L, sB_L, true], [band.oR, sA_R, sB_R, false]] as const) {
    const rect: PolyWithHoles = { outer: [[sA, f.z0], [sB, f.z0], [sB, f.z1], [sA, f.z1]], holes: [] }
    const polys = cutRects.length ? differencePolygons([rect], cutRects) : [rect]
    for (const poly of polys) sideFace(mb, f, poly, o, left)
  }
  // top / bottom
  const ring = bandRing(f, band, sA_R, sB_R, sB_L, sA_L)
  const topSub: Ring[] = [...solve.subtractTop]
  const botSub: Ring[] = [...solve.subtractBottom]
  for (const c of cuts) {
    if (c.z1 >= f.z1 - 1e-6) topSub.push(cutRing(f, band.oR, band.oL, c.s0, c.s1))
    if (c.z0 <= f.z0 + 1e-6) botSub.push(cutRing(f, band.oR, band.oL, c.s0, c.s1))
  }
  const topPolys = topSub.length ? differencePolygons([ring], topSub) : nestRings([ring])
  const botPolys = botSub.length ? differencePolygons([ring], botSub) : topPolys
  for (const p of topPolys) mb.face(lift(p.outer, f.z1), p.holes.map((h) => lift(h, f.z1)), [0, 0, 1])
  for (const p of botPolys) mb.face(lift(p.outer, f.z0), p.holes.map((h) => lift(h, f.z0)), [0, 0, -1])
  // end caps (kept even when joined: closed solids for sections; they are buried in the neighbour)
  for (const [sR, sL, s, sign] of [[sA_R, sA_L, 0, -1], [sB_R, sB_L, f.L, 1]] as const) {
    const pr = f.point(sR, band.oR), pl = f.point(sL, band.oL)
    const t = f.tangent(s)
    mb.face([[pr[0], pr[1], f.z0], [pl[0], pl[1], f.z0], [pl[0], pl[1], f.z1], [pr[0], pr[1], f.z1]], [], [t[0] * sign, t[1] * sign, 0])
  }
  // reveals
  for (const c of cuts) {
    for (const [s, sign] of [[c.s0, 1], [c.s1, -1]] as const) {
      const pr = f.point(s, band.oR), pl = f.point(s, band.oL)
      const t = f.tangent(s)
      mb.face([[pr[0], pr[1], c.z0], [pl[0], pl[1], c.z0], [pl[0], pl[1], c.z1], [pr[0], pr[1], c.z1]], [], [t[0] * sign, t[1] * sign, 0])
    }
    const lower = f.sample(band.oR, c.s0, c.s1), upper = f.sample(band.oL, c.s0, c.s1)
    if (c.z1 < f.z1 - 1e-6) strip(mb, lower, upper, c.z1, -1)
    if (c.z0 > f.z0 + 1e-6) strip(mb, lower, upper, c.z0, 1)
  }
  return mb.build()
}

/**
 * Feature edges of the wall shell minus what joined neighbours make invisible: the end caps of joined
 * ends (mitre/butt planes buried in the neighbour) lose their horizontal edges, horizontal edges are
 * clipped to the outside of neighbour footprints (a face line gaps where a stem butts in) and other
 * edges are dropped only when they lie strictly inside a neighbour — so the vertical corner edges on
 * the shared face lines survive.
 */
function wallEdges(f: WallFrame, solve: WallSolve, shell: MeshBuffers): Float32Array {
  const raw = computeFeatureEdges(shell, DEFAULT_CREASE)
  const half = f.t / 2
  const caps: [Vec2, Vec2][] = []
  for (const e of [solve.a, solve.b]) if (e.kind !== 'free') caps.push([f.point(e.sR, -half), f.point(e.sL, half)])
  const clipPolys: PolyWithHoles[] = solve.neighborFootprints.map((r) => ({ outer: r, holes: [] }))
  if (!caps.length && !clipPolys.length) return raw
  const inner = clipPolys.length ? offsetPolygons(clipPolys, -1e-3) : []
  const near = (p: Vec2, x: number, y: number) => Math.abs(p[0] - x) < 1e-4 && Math.abs(p[1] - y) < 1e-4
  const out = new Seg3Buf(raw.length / 6)
  for (let i = 0; i < raw.length; i += 6) {
    const x0 = raw[i]!, y0 = raw[i + 1]!, z0 = raw[i + 2]!, x1 = raw[i + 3]!, y1 = raw[i + 4]!, z1 = raw[i + 5]!
    if (Math.abs(z0 - z1) < 1e-6) {
      if (caps.some(([p, q]) => (near(p, x0, y0) && near(q, x1, y1)) || (near(p, x1, y1) && near(q, x0, y0)))) continue
      if (!clipPolys.length) {
        out.seg(x0, y0, z0, x1, y1, z1)
        continue
      }
      const segs = clipSegmentsAgainst([x0, y0, x1, y1], clipPolys, false, 1e-4)
      for (let k = 0; k < segs.length; k += 4) out.seg(segs[k]!, segs[k + 1]!, z0, segs[k + 2]!, segs[k + 3]!, z0)
    } else if (!inner.length || !(pointInPolys([x0, y0], inner) && pointInPolys([x1, y1], inner))) out.seg(x0, y0, z0, x1, y1, z1)
  }
  return out.toArray()
}
