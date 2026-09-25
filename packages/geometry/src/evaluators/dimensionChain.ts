// Chain dimensions (Maßketten): N measured points projected onto ONE dimension line; every interval
// carries its own text, ticks at every division. Used by evaluateDimension for kind 'chain'.
import type { NodeBase, Vec2 } from '@cadsandbox/doc'
import type { SnapPoint } from '../api'
import { ANNO, DrawingBuilder, readableRotation } from '../core/drawing'
import { add2, angleOf, dot2, fromAngle, mid2, normalize2, perp2, scale2, sub2 } from '../core/math2d'
import { arrowHead } from './drafting'
import { snap } from './result'

export interface ChainStyle {
  size: number
  terminator: 'tick' | 'arrow'
  format: (meters: number) => string
}

function tick(d: DrawingBuilder, at: Vec2, dir: Vec2): void {
  const t = normalize2(add2(dir, perp2(dir)))
  const h = ANNO.tick / 2
  d.seg('annotation', at[0] - t[0] * h, at[1] - t[1] * h, at[0] + t[0] * h, at[1] + t[1] * h)
}

function placeText(d: DrawingBuilder, text: string, pos: Vec2, dir: Vec2, size: number, gap: number): void {
  const rot = readableRotation(angleOf(dir))
  const n = perp2(fromAngle(rot))
  d.text(text, [pos[0] + n[0] * gap, pos[1] + n[1] * gap], size, { rotation: rot, align: 'center', baseline: 'bottom', style: 'annotation' })
}

/** Direction of a chain's dimension line: forced axis, otherwise first → last point. */
export function chainDirection(pts: readonly Vec2[], axis: NodeBase<'dimension'>['params']['axis']): Vec2 {
  if (axis === 'x') return [1, 0]
  if (axis === 'y') return [0, 1]
  const first = pts[0], last = pts[pts.length - 1]
  if (!first || !last) return [1, 0]
  const dir = sub2(last, first)
  return Math.hypot(dir[0], dir[1]) < 1e-9 ? [1, 0] : normalize2(dir)
}

/** Sorted, de-duplicated chain stations (parameters along `dir` measured from the first point). */
export function chainStations(pts: readonly Vec2[], dir: Vec2): number[] {
  const first = pts[0]
  if (!first) return []
  const ts = pts.map((p) => dot2(sub2(p, first), dir)).sort((a, b) => a - b)
  const out: number[] = []
  for (const t of ts) if (!out.length || t - out[out.length - 1]! > 1e-6) out.push(t)
  return out
}

/**
 * Draw a chain dimension into `d`. Returns the total length; appends snaps (divisions + interval
 * midpoints) and the interval lengths to `quantities` (value = total, segments = count).
 */
export function drawChainDimension(
  d: DrawingBuilder,
  pts: readonly Vec2[],
  offset: number,
  axis: NodeBase<'dimension'>['params']['axis'],
  style: ChainStyle,
  snaps: SnapPoint[],
  quantities: Record<string, number>,
): number {
  if (pts.length < 2) return 0
  const dir = chainDirection(pts, axis)
  const n = perp2(dir)
  const first = pts[0]!
  const base = add2(first, scale2(n, offset))
  const stations = chainStations(pts, dir)
  if (stations.length < 2) return 0
  const q = stations.map((t) => add2(base, scale2(dir, t)))
  const gap = ANNO.extensionGap, over = ANNO.overshoot
  const sgn = offset >= 0 ? 1 : -1
  // dimension line with overshoot
  d.segP('annotation', add2(q[0]!, scale2(dir, -over)), add2(q[q.length - 1]!, scale2(dir, over)))
  // extension lines from every measured point to just past the line
  for (const pt of pts) {
    const t = dot2(sub2(pt, first), dir)
    const qi = add2(base, scale2(dir, t))
    const dist = dot2(sub2(qi, pt), n)
    const s = dist >= 0 ? 1 : -1
    const start = add2(pt, scale2(n, Math.min(Math.abs(dist), gap) * s))
    const end = add2(qi, scale2(n, over * s))
    d.segP('annotation', start, end)
  }
  // terminators: arrows only at the chain ends, ticks at every division
  for (let i = 0; i < q.length; i++) {
    const at = q[i]!
    if (style.terminator === 'arrow' && (i === 0 || i === q.length - 1)) arrowHead(d, at, i === 0 ? scale2(dir, -1) : dir)
    else tick(d, at, dir)
    snaps.push(snap('endpoint', at[0], at[1]))
  }
  for (let i = 0; i + 1 < q.length; i++) {
    const value = stations[i + 1]! - stations[i]!
    const m = mid2(q[i]!, q[i + 1]!)
    placeText(d, style.format(value), m, dir, style.size, ANNO.textGap * sgn)
    snaps.push(snap('midpoint', m[0], m[1]))
    quantities[`segment${i + 1}`] = value
  }
  const total = stations[stations.length - 1]! - stations[0]!
  quantities.value = total
  quantities.segments = q.length - 1
  return total
}
