// Dimensions: linear / aligned / angular / radius / diameter / arc-length with ticks or arrows.
import type { NodeBase, Vec2, Vec3 } from '@cadsandbox/doc'
import { formatAngle, formatLength } from '@cadsandbox/shared'
import type { GeometryResult, SnapPoint } from '../api'
import { ANNO, DrawingBuilder, readableRotation } from '../core/drawing'
import { add2, angleOf, dist2, dot2, fromAngle, mid2, normalize2, perp2, scale2, sub2, wrapAngle } from '../core/math2d'
import type { EvalContext } from './context'
import { drawChainDimension } from './dimensionChain'
import { arrowHead } from './drafting'
import { drawingBounds, emptyResult, snap } from './result'

type Terminator = 'tick' | 'arrow'

function terminatorOf(node: NodeBase<'dimension'>): Terminator {
  const m = (node.meta as Record<string, unknown>).terminator
  if (m === 'arrow' || m === 'tick') return m
  return node.params.kind === 'linear' || node.params.kind === 'aligned' ? 'tick' : 'arrow'
}

function tick(d: DrawingBuilder, at: Vec2, dir: Vec2): void {
  // architectural tick: 45° slash across the dimension line
  const t = normalize2(add2(dir, perp2(dir)))
  const h = ANNO.tick / 2
  d.seg('annotation', at[0] - t[0] * h, at[1] - t[1] * h, at[0] + t[0] * h, at[1] + t[1] * h)
}

function terminate(d: DrawingBuilder, kind: Terminator, at: Vec2, inward: Vec2): void {
  if (kind === 'tick') tick(d, at, inward)
  else arrowHead(d, at, scale2(inward, -1))
}

function measuredText(node: NodeBase<'dimension'>, value: string): string {
  const t = node.params.text
  if (!t) return value
  return t.includes('<>') ? t.replace(/<>/g, value) : t
}

/** Place text along direction `dir` at `pos`, above the line in reading orientation. */
function placeText(d: DrawingBuilder, text: string, pos: Vec2, dir: Vec2, size: number, gap = ANNO.textGap): void {
  const rot = readableRotation(angleOf(dir))
  const n = perp2(fromAngle(rot))
  const p: Vec2 = [pos[0] + n[0] * gap, pos[1] + n[1] * gap]
  d.text(text, p, size, { rotation: rot, align: 'center', baseline: 'bottom', style: 'annotation' })
}

export function evaluateDimension(node: NodeBase<'dimension'>, ctx: EvalContext): GeometryResult {
  const p = node.params
  const pts: Vec2[] = (p.points ?? []).map((q, i) => {
    const a = ctx.anchors?.[i]
    const src: Vec3 = a ?? q
    return [src[0], src[1]] as Vec2
  })
  const d = new DrawingBuilder()
  const size = typeof (node.meta as Record<string, unknown>).textSize === 'number' ? ((node.meta as Record<string, unknown>).textSize as number) : ANNO.textSize
  const snaps: SnapPoint[] = pts.map((q) => snap('endpoint', q[0], q[1]))
  const term = terminatorOf(node)
  const units = ctx.units
  const fmt = (m: number) => formatLength(m, units.length, units.precision)
  const quantities: Record<string, number> = {}
  const gap = ANNO.extensionGap, over = ANNO.overshoot

  switch (p.kind) {
    case 'linear':
    case 'aligned': {
      if (pts.length < 2) break
      const p1 = pts[0]!, p2 = pts[1]!
      let dir: Vec2
      if (p.kind === 'aligned') dir = normalize2(sub2(p2, p1))
      else {
        const dx = Math.abs(p2[0] - p1[0]), dy = Math.abs(p2[1] - p1[1])
        const axis = p.axis && p.axis !== 'auto' ? p.axis : dx >= dy ? 'x' : 'y'
        dir = axis === 'x' ? [1, 0] : [0, 1]
      }
      const n = perp2(dir)
      const value = dot2(sub2(p2, p1), dir)
      const q1: Vec2 = add2(p1, scale2(n, p.offset))
      const q2: Vec2 = add2(q1, scale2(dir, value))
      const sgn = p.offset >= 0 ? 1 : -1
      d.segP('annotation', q1, q2)
      // extension lines from the measured points to just past the dimension line
      for (const [pt, q] of [[p1, q1], [p2, q2]] as const) {
        const dist = dot2(sub2(q, pt), n)
        const s = dist >= 0 ? 1 : -1
        const start = add2(pt, scale2(n, Math.min(Math.abs(dist), gap) * s))
        const end = add2(q, scale2(n, over * s))
        d.segP('annotation', start, end)
      }
      const inward = value >= 0 ? dir : scale2(dir, -1)
      terminate(d, term, q1, inward)
      terminate(d, term, q2, scale2(inward, -1))
      const abs = Math.abs(value)
      quantities.value = abs
      placeText(d, measuredText(node, fmt(abs)), mid2(q1, q2), dir, size, ANNO.textGap * sgn)
      snaps.push(snap('endpoint', q1[0], q1[1]), snap('endpoint', q2[0], q2[1]))
      const m = mid2(q1, q2)
      snaps.push(snap('midpoint', m[0], m[1]))
      break
    }
    case 'angular': {
      if (pts.length < 3) break
      const v = pts[0]!, p1 = pts[1]!, p2 = pts[2]!
      const a1 = angleOf(sub2(p1, v))
      const sweep = wrapAngle(angleOf(sub2(p2, v)) - a1)
      const r = p.offset > 0 ? p.offset : Math.max(dist2(p1, v), dist2(p2, v))
      d.arc('annotation', v, r, a1, sweep)
      for (const [pt, ang] of [[p1, a1], [p2, a1 + sweep]] as const) {
        const rp = dist2(pt, v)
        const ray = fromAngle(ang)
        const from = rp < r ? add2(v, scale2(ray, rp + gap)) : add2(v, scale2(ray, r - gap))
        const to = add2(v, scale2(ray, rp < r ? r + over : rp))
        if (Math.abs(rp - r) > gap) d.segP('annotation', from, to)
      }
      const e1 = add2(v, fromAngle(a1, r)), e2 = add2(v, fromAngle(a1 + sweep, r))
      terminate(d, term, e1, perp2(fromAngle(a1)))
      terminate(d, term, e2, scale2(perp2(fromAngle(a1 + sweep)), -1))
      const midAng = a1 + sweep / 2
      const tpos = add2(v, fromAngle(midAng, r))
      quantities.value = sweep
      placeText(d, measuredText(node, formatAngle(sweep, units.angle)), tpos, perp2(fromAngle(midAng)), size)
      snaps.push(snap('center', v[0], v[1]), snap('midpoint', tpos[0], tpos[1]))
      break
    }
    case 'radius':
    case 'diameter': {
      if (pts.length < 2) break
      const c = pts[0]!, pt = pts[1]!
      const r = dist2(c, pt)
      const dir = normalize2(sub2(pt, c))
      const start: Vec2 = p.kind === 'diameter' ? sub2(c, scale2(dir, r)) : c
      const ext = Math.max(0, p.offset)
      const end = add2(pt, scale2(dir, ext))
      d.segP('annotation', start, end)
      arrowHead(d, pt, dir)
      if (p.kind === 'diameter') arrowHead(d, start, scale2(dir, -1))
      const value = p.kind === 'diameter' ? 2 * r : r
      quantities.value = value
      const label = (p.kind === 'diameter' ? 'Ø ' : 'R ') + fmt(value)
      const tpos = ext > 0 ? mid2(pt, end) : mid2(start, pt)
      placeText(d, measuredText(node, label), tpos, dir, size)
      snaps.push(snap('center', c[0], c[1]))
      break
    }
    case 'arc-length': {
      if (pts.length < 3) break
      const c = pts[0]!, p1 = pts[1]!, p2 = pts[2]!
      const r0 = dist2(p1, c)
      const a1 = angleOf(sub2(p1, c))
      const sweep = wrapAngle(angleOf(sub2(p2, c)) - a1)
      const r = r0 + p.offset
      d.arc('annotation', c, r, a1, sweep)
      for (const ang of [a1, a1 + sweep]) {
        const ray = fromAngle(ang)
        const s = p.offset >= 0 ? 1 : -1
        d.segP('annotation', add2(c, scale2(ray, r0 + gap * s)), add2(c, scale2(ray, r + over * s)))
      }
      const e1 = add2(c, fromAngle(a1, r)), e2 = add2(c, fromAngle(a1 + sweep, r))
      terminate(d, term, e1, perp2(fromAngle(a1)))
      terminate(d, term, e2, scale2(perp2(fromAngle(a1 + sweep)), -1))
      const value = r0 * sweep
      quantities.value = value
      const midAng = a1 + sweep / 2
      placeText(d, measuredText(node, '⌒ ' + fmt(value)), add2(c, fromAngle(midAng, r)), perp2(fromAngle(midAng)), size)
      snaps.push(snap('center', c[0], c[1]))
      break
    }
    case 'chain': {
      // Maßkette: every interval between consecutive stations gets its own text (see dimensionChain.ts).
      drawChainDimension(d, pts, p.offset, p.axis, { size, terminator: term, format: fmt }, snaps, quantities)
      break
    }
  }
  const drawing = d.build()
  const res = emptyResult({ drawing })
  res.bounds = drawingBounds(drawing) ?? res.bounds
  if (snaps.length) res.snaps = snaps
  res.quantities = quantities
  return res
}
