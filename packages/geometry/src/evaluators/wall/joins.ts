// Automatic wall joins: L (miter), T (butt into a through-wall), X (crossing), collinear continuation.
import type { Vec2 } from '@cadsandbox/doc'
import { TAU, angleOf, dist2, polygonArea } from '../../core/math2d'
import { intersectPolygons, type Ring } from '../../core/polygon'
import type { WallFrame } from './frame'
import { intersectFaces } from './frame'

export interface NeighborFrame {
  id: string
  frame: WallFrame
}

export interface EndSolve {
  /** face end parameters (centerline arc length); left = o > 0, right = o < 0 */
  sL: number
  sR: number
  kind: 'free' | 'node' | 'butt'
  partners: string[]
  /** faces that were mitered/trimmed against a partner face (false = plain perpendicular cap) */
  miteredL: boolean
  miteredR: boolean
}

export interface WallSolve {
  a: EndSolve
  b: EndSolve
  /** our footprint after joins (CCW) */
  footprint: Ring
  /** raw footprints of every neighbour (plan line clipping) */
  neighborFootprints: Ring[]
  /** crossing neighbours we yield to: their footprints are subtracted from coplanar top/bottom faces & poché */
  subtractTop: Ring[]
  subtractBottom: Ring[]
  subtractPlan: Ring[]
}

/** Unjoined footprint of a frame (CCW). */
export function rawFootprint(f: WallFrame, sa = 0, sb = f.L): Ring {
  const right = f.sample(-f.t / 2, sa, sb)
  const left = f.sample(f.t / 2, sb, sa)
  const ring = right.concat(left)
  return polygonArea(ring) < 0 ? ring.reverse() : ring
}

/** Footprint given per-face end parameters. */
export function joinedFootprint(f: WallFrame, a: EndSolve, b: EndSolve): Ring {
  const right = f.sample(-f.t / 2, a.sR, b.sR)
  const left = f.sample(f.t / 2, b.sL, a.sL)
  const ring = right.concat(left)
  return polygonArea(ring) < 0 ? ring.reverse() : ring
}

const tolNode = (ta: number, tb: number): number => Math.max(ta, tb) * 0.5 + 0.005
const tolButt = (tw: number): number => Math.max(0.02, tw * 0.25)

/** Offset (o) of an end's outgoing-left / outgoing-right face. */
function faceOffset(f: WallFrame, end: 'a' | 'b', side: 'left' | 'right'): number {
  const half = f.t / 2
  return end === 'b' ? (side === 'left' ? half : -half) : side === 'left' ? -half : half
}

function solveEnd(self: WallFrame, end: 'a' | 'b', neighbors: NeighborFrame[], cutZ: [number, number]): EndSolve {
  const ef = self.endFrame(end)
  const sEnd = ef.s
  const th0 = angleOf(ef.u)
  type Partner = { n: NeighborFrame; end: 'a' | 'b'; ang: number }
  const partners: Partner[] = []
  for (const nb of neighbors) {
    const f = nb.frame
    if (f.z1 <= cutZ[0] + 1e-6 || f.z0 >= cutZ[1] - 1e-6) continue // no vertical overlap → no join
    let best: Partner | null = null
    for (const e of ['a', 'b'] as const) {
      const nf = f.endFrame(e)
      if (dist2(nf.p, ef.p) > tolNode(self.t, f.t)) continue
      let ang = (angleOf(nf.u) - th0) % TAU
      if (ang < 0) ang += TAU
      if (ang < 1e-3 || ang > TAU - 1e-3) continue // duplicate wall leaving in our direction
      const cand = { n: nb, end: e, ang }
      if (!best || dist2(nf.p, ef.p) < dist2(f.endFrame(best.end).p, ef.p)) best = cand
    }
    if (best) partners.push(best)
  }
  const maxExt = (tn: number) => 2 * (self.t + tn) + 0.05
  const clampS = (s: number, tn: number): number => (Math.abs(s - sEnd) <= maxExt(tn) ? s : sEnd)
  if (partners.length) {
    partners.sort((p, q) => p.ang - q.ang)
    const ccw = partners[0]!
    const cw = partners[partners.length - 1]!
    const miter = (side: 'left' | 'right', partner: Partner): number | null => {
      const ours = self.face(faceOffset(self, end, side))
      const theirs = partner.n.frame.face(faceOffset(partner.n.frame, partner.end, side === 'left' ? 'right' : 'left'))
      const p = intersectFaces(ours, theirs, ef.p)
      if (!p) return null
      const s = self.toWall(p)[0]
      return Math.abs(s - sEnd) <= maxExt(partner.n.frame.t) ? s : null
    }
    const mOutLeft = miter('left', ccw)
    const mOutRight = miter('right', cw)
    // map outgoing sides back to wall sides
    const mL = end === 'b' ? mOutLeft : mOutRight
    const mR = end === 'b' ? mOutRight : mOutLeft
    return { sL: mL ?? sEnd, sR: mR ?? sEnd, kind: 'node', partners: [...new Set(partners.map((p) => p.n.id))], miteredL: mL !== null, miteredR: mR !== null }
  }
  // T: our end inside a through-wall band
  let through: { nb: NeighborFrame; pen: number } | null = null
  for (const nb of neighbors) {
    const f = nb.frame
    if (f.z1 <= cutZ[0] + 1e-6 || f.z0 >= cutZ[1] - 1e-6) continue
    const [s, o] = f.toWall(ef.p)
    const tn = tolNode(self.t, f.t)
    if (s < tn || s > f.L - tn) continue
    const pen = Math.abs(o)
    if (pen > f.t / 2 + tolButt(self.t)) continue
    if (!through || pen < through.pen) through = { nb, pen }
  }
  if (through) {
    const f = through.nb.frame
    const step = Math.min(self.L * 0.5, f.t + 0.05)
    const q = self.point(end === 'b' ? self.L - step : step, 0)
    const side = f.toWall(q)[1] >= 0 ? f.t / 2 : -f.t / 2
    const face = f.face(side)
    const hit = (o: number): number => {
      const p = intersectFaces(self.face(o), face, ef.p)
      return p ? clampS(self.toWall(p)[0], f.t) : sEnd
    }
    return { sL: hit(self.t / 2), sR: hit(-self.t / 2), kind: 'butt', partners: [through.nb.id], miteredL: true, miteredR: true }
  }
  return { sL: sEnd, sR: sEnd, kind: 'free', partners: [], miteredL: false, miteredR: false }
}

export function solveJoins(selfId: string, self: WallFrame, neighbors: NeighborFrame[]): WallSolve {
  const zr: [number, number] = [self.z0, self.z1]
  const a = solveEnd(self, 'a', neighbors, zr)
  const b = solveEnd(self, 'b', neighbors, zr)
  // keep faces from crossing over on very short walls
  const minLen = Math.min(0.001, self.L * 0.1)
  if (b.sL < a.sL + minLen) b.sL = a.sL + minLen
  if (b.sR < a.sR + minLen) b.sR = a.sR + minLen
  const footprint = joinedFootprint(self, a, b)
  const neighborFootprints: Ring[] = []
  const subtractTop: Ring[] = []
  const subtractBottom: Ring[] = []
  const subtractPlan: Ring[] = []
  const partnerIds = new Set([...a.partners, ...b.partners])
  for (const nb of neighbors) {
    const fp = rawFootprint(nb.frame)
    neighborFootprints.push(fp)
    if (partnerIds.has(nb.id)) continue
    if (nb.frame.z1 <= self.z0 + 1e-6 || nb.frame.z0 >= self.z1 - 1e-6) continue
    // crossing: real area overlap, and we yield to the lexicographically smaller id
    if (selfId <= nb.id) continue
    const inter = intersectPolygons([footprint], [fp])
    let area = 0
    for (const p of inter) area += Math.abs(polygonArea(p.outer))
    if (area < 1e-6) continue
    if (Math.abs(nb.frame.z1 - self.z1) < 1e-6) subtractTop.push(fp)
    if (Math.abs(nb.frame.z0 - self.z0) < 1e-6) subtractBottom.push(fp)
    subtractPlan.push(fp)
  }
  return { a, b, footprint, neighborFootprints, subtractTop, subtractBottom, subtractPlan }
}

/** Interpolated end parameter of the cap segment at offset o (cap runs from (sR, -t/2) to (sL, +t/2)). */
export function endParam(f: WallFrame, e: EndSolve, o: number): number {
  const k = (o + f.t / 2) / f.t
  return e.sR + (e.sL - e.sR) * k
}

export function centerOf(ring: Ring): Vec2 {
  let x = 0, y = 0
  for (const p of ring) {
    x += p[0]
    y += p[1]
  }
  return ring.length ? [x / ring.length, y / ring.length] : [0, 0]
}
