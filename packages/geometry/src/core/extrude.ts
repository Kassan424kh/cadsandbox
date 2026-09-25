// Prismatic extrusion of polygons with holes (optional rounded bevel), watertight, creased normals.
import type { Vec2, Vec3 } from '@cadsandbox/doc'
import type { MeshBuffers } from '../api'
import { DEFAULT_CREASE, MeshBuilder } from './mesh'
import { cross2, dot2, normalize2, perp2, polygonArea, sub2 } from './math2d'
import type { PolyWithHoles, Ring } from './polygon'

export interface ExtrudeOptions {
  z0: number
  z1: number
  bevel?: number
  bevelSegments?: number
  capBottom?: boolean
  capTop?: boolean
  /** Crease angle deciding smooth vs. sharp side normals at ring vertices. */
  crease?: number
}

interface RingInfo {
  pts: Ring
  /** outward (away from the solid) unit normals per edge i → i+1 */
  edgeN: Vec2[]
  /** per-vertex smooth flags (true = share normal across the two edges) */
  smooth: boolean[]
  /** cumulative arc length per vertex */
  arc: number[]
  /** inward bisector offset direction per vertex scaled so that a unit inset moves the edges by 1 */
  inset: Vec2[]
}

function ringInfo(pts: Ring, isHole: boolean, crease: number): RingInfo {
  const n = pts.length
  const ccw = polygonArea(pts) > 0
  // the solid lies to the left of a CCW outer ring and to the right of a CW hole ring; outward is the other side
  const outwardSign = (ccw ? 1 : -1) * (isHole ? -1 : 1)
  const edgeN: Vec2[] = new Array(n)
  const arc: number[] = new Array(n)
  let acc = 0
  for (let i = 0; i < n; i++) {
    const a = pts[i]!, b = pts[(i + 1) % n]!
    const d = sub2(b, a)
    const l = Math.hypot(d[0], d[1])
    const nn = perp2(normalize2(d))
    edgeN[i] = [-nn[0] * outwardSign, -nn[1] * outwardSign]
    arc[i] = acc
    acc += l
  }
  const cosC = Math.cos(crease)
  const smooth: boolean[] = new Array(n)
  const inset: Vec2[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const nPrev = edgeN[(i + n - 1) % n]!
    const nNext = edgeN[i]!
    smooth[i] = dot2(nPrev, nNext) > cosC
    // vertex moves along -(nPrev + nNext) so both adjacent edges shift inward by the same amount
    const s: Vec2 = [nPrev[0] + nNext[0], nPrev[1] + nNext[1]]
    const l2 = dot2(s, s)
    if (l2 < 1e-12) inset[i] = [-nNext[0], -nNext[1]]
    else {
      const k = 2 / l2 // |s|² = 2 + 2cos → factor gives 1/cos(half-angle) length
      inset[i] = [-s[0] * k, -s[1] * k]
    }
  }
  return { pts, edgeN, smooth, arc, inset }
}

function insetRing(r: RingInfo, d: number): Ring {
  if (d === 0) return r.pts
  const out: Ring = new Array(r.pts.length)
  for (let i = 0; i < r.pts.length; i++) {
    const p = r.pts[i]!
    const v = r.inset[i]!
    // clamp very sharp corners to avoid spikes
    const l = Math.hypot(v[0], v[1])
    const k = l > 4 ? 4 / l : 1
    out[i] = [p[0] + v[0] * d * k, p[1] + v[1] * d * k]
  }
  return out
}

/** Side band between two rings with the same topology; normals blend horizontal/vertical parts. */
function band(mb: MeshBuilder, r: RingInfo, lower: Ring, zLo: number, upper: Ring, zHi: number, nHoriz: number, nZ: number, vLo: number, vHi: number): void {
  const n = r.pts.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const eN = r.edgeN[i]!
    const nA = r.smooth[i] ? normalize2([eN[0] + r.edgeN[(i + n - 1) % n]![0], eN[1] + r.edgeN[(i + n - 1) % n]![1]]) : eN
    const nB = r.smooth[j] ? normalize2([eN[0] + r.edgeN[j]![0], eN[1] + r.edgeN[j]![1]]) : eN
    const uA = r.arc[i]!
    const uB = i + 1 < n ? r.arc[i + 1]! : r.arc[n - 1]! + Math.hypot(r.pts[0]![0] - r.pts[n - 1]![0], r.pts[0]![1] - r.pts[n - 1]![1])
    const a = mb.vertex(lower[i]![0], lower[i]![1], zLo, nA[0] * nHoriz, nA[1] * nHoriz, nZ, uA, vLo)
    const b = mb.vertex(lower[j]![0], lower[j]![1], zLo, nB[0] * nHoriz, nB[1] * nHoriz, nZ, uB, vLo)
    const c = mb.vertex(upper[j]![0], upper[j]![1], zHi, nB[0] * nHoriz, nB[1] * nHoriz, nZ, uB, vHi)
    const d = mb.vertex(upper[i]![0], upper[i]![1], zHi, nA[0] * nHoriz, nA[1] * nHoriz, nZ, uA, vHi)
    // outward orientation: ring runs so that outward = right side for outer CCW rings
    const outwardIsLeft = cross2(sub2(r.pts[j]!, r.pts[i]!), eN) > 0
    if (outwardIsLeft) mb.quad(a, d, c, b)
    else mb.quad(a, b, c, d)
  }
}

const to3 = (ring: Ring, z: number): Vec3[] => ring.map((p) => [p[0], p[1], z] as Vec3)

/** Extrude polygons (outer CCW, holes CW) between z0 and z1. */
export function extrudePolygons(polys: readonly PolyWithHoles[], opts: ExtrudeOptions): MeshBuffers {
  const mb = new MeshBuilder(256)
  extrudeInto(mb, polys, opts)
  return mb.build()
}

/** Same as extrudePolygons, appending into an existing builder. */
export function extrudeInto(mb: MeshBuilder, polys: readonly PolyWithHoles[], opts: ExtrudeOptions): void {
  const crease = opts.crease ?? DEFAULT_CREASE
  const height = opts.z1 - opts.z0
  const bevelSeg = Math.max(1, Math.round(opts.bevelSegments ?? 3))
  const bevel = Math.max(0, Math.min(opts.bevel ?? 0, height / 2 - 1e-6))
  for (const poly of polys) {
    if (poly.outer.length < 3) continue
    const rings = [ringInfo(poly.outer, false, crease), ...poly.holes.filter((h) => h.length >= 3).map((h) => ringInfo(h, true, crease))]
    if (height <= 1e-9) {
      mb.face(to3(poly.outer, opts.z0), poly.holes.map((h) => to3(h, opts.z0)), [0, 0, 1])
      continue
    }
    if (bevel > 1e-9) {
      // bottom cap (inset), bevel rings, wall, top bevel, top cap
      const botRings = rings.map((r) => insetRing(r, bevel))
      if (opts.capBottom !== false) mb.face(to3(botRings[0]!, opts.z0), botRings.slice(1).map((h) => to3(h, opts.z0)), [0, 0, -1])
      for (let ri = 0; ri < rings.length; ri++) {
        const r = rings[ri]!
        let prev = botRings[ri]!
        let prevZ = opts.z0
        let prevV = 0
        for (let k = 1; k <= bevelSeg; k++) {
          const t = k / bevelSeg
          const ang = (t * Math.PI) / 2
          const ring = insetRing(r, bevel * (1 - Math.sin(ang)))
          const z = opts.z0 + bevel * (1 - Math.cos(ang))
          const tm = ((k - 0.5) / bevelSeg) * (Math.PI / 2)
          band(mb, r, prev, prevZ, ring, z, Math.sin(tm), -Math.cos(tm), prevV, prevV + (bevel * Math.PI) / 2 / bevelSeg)
          prev = ring
          prevZ = z
          prevV += (bevel * Math.PI) / 2 / bevelSeg
        }
        // straight wall
        band(mb, r, r.pts, opts.z0 + bevel, r.pts, opts.z1 - bevel, 1, 0, prevV, prevV + (height - 2 * bevel))
        prevV += height - 2 * bevel
        prev = r.pts
        prevZ = opts.z1 - bevel
        for (let k = 1; k <= bevelSeg; k++) {
          const t = k / bevelSeg
          const ang = (t * Math.PI) / 2
          const ring = insetRing(r, bevel * (1 - Math.cos(ang)))
          const z = opts.z1 - bevel * (1 - Math.sin(ang))
          const tm = ((k - 0.5) / bevelSeg) * (Math.PI / 2)
          band(mb, r, prev, prevZ, ring, z, Math.cos(tm), Math.sin(tm), prevV, prevV + (bevel * Math.PI) / 2 / bevelSeg)
          prev = ring
          prevZ = z
          prevV += (bevel * Math.PI) / 2 / bevelSeg
        }
      }
      const topRings = rings.map((r) => insetRing(r, bevel))
      if (opts.capTop !== false) mb.face(to3(topRings[0]!, opts.z1), topRings.slice(1).map((h) => to3(h, opts.z1)), [0, 0, 1])
    } else {
      if (opts.capBottom !== false) mb.face(to3(poly.outer, opts.z0), poly.holes.map((h) => to3(h, opts.z0)), [0, 0, -1])
      for (const r of rings) band(mb, r, r.pts, opts.z0, r.pts, opts.z1, 1, 0, 0, height)
      if (opts.capTop !== false) mb.face(to3(poly.outer, opts.z1), poly.holes.map((h) => to3(h, opts.z1)), [0, 0, 1])
    }
  }
}

/** Convenience: extrude a single ring without holes. */
export function extrudeRing(ring: Ring, z0: number, z1: number): MeshBuffers {
  return extrudePolygons([{ outer: polygonArea(ring) < 0 ? ring.slice().reverse() : ring, holes: [] }], { z0, z1 })
}

export function extrudeRingInto(mb: MeshBuilder, ring: Ring, z0: number, z1: number): void {
  extrudeInto(mb, [{ outer: polygonArea(ring) < 0 ? ring.slice().reverse() : ring, holes: [] }], { z0, z1 })
}
