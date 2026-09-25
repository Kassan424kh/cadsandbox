// Chain dimension (Maßkette) → Drawing2D for live previews and the vectorize fallback. Mirrors the
// geometry evaluator (evaluators/dimensionChain.ts): N points projected onto one dimension line,
// ticks at every station, one text per interval.
import type { DimensionParams, Vec2 } from '@cadsandbox/doc'
import type { Drawing2D, Text2D } from '@cadsandbox/geometry'
import type { DimensionStyle } from './dimension'
import { v2 } from './vec'

/** Direction of the dimension line: forced axis, else first → last point. */
export function chainDirection(pts: readonly Vec2[], axis: DimensionParams['axis']): Vec2 {
  if (axis === 'x') return [1, 0]
  if (axis === 'y') return [0, 1]
  const first = pts[0], last = pts[pts.length - 1]
  if (!first || !last) return [1, 0]
  const d = v2.sub(last, first)
  return v2.len(d) < 1e-9 ? [1, 0] : v2.norm(d)
}

/** Sorted unique stations (distance along `dir` from the first point). */
export function chainStations(pts: readonly Vec2[], dir: Vec2): number[] {
  const first = pts[0]
  if (!first) return []
  const ts = pts.map((p) => v2.dot(v2.sub(p, first), dir)).sort((a, b) => a - b)
  const out: number[] = []
  for (const t of ts) if (!out.length || t - out[out.length - 1]! > 1e-6) out.push(t)
  return out
}

/** Total measured length of a chain (first to last station along the line direction). */
export function chainTotal(params: DimensionParams): number {
  const pts = params.points.map((p) => [p[0], p[1]] as Vec2)
  const st = chainStations(pts, chainDirection(pts, params.axis))
  return st.length < 2 ? 0 : st[st.length - 1]! - st[0]!
}

export function chainDrawing(params: DimensionParams, style: DimensionStyle): Drawing2D {
  const pts = params.points.map((p) => [p[0], p[1]] as Vec2)
  const empty: Drawing2D = { lines: [], fills: [], texts: [] }
  if (pts.length < 2) return empty
  const dir = chainDirection(pts, params.axis)
  const n = v2.perp(dir)
  const first = pts[0]!
  const base = v2.add(first, v2.scale(n, params.offset))
  const stations = chainStations(pts, dir)
  if (stations.length < 2) return empty
  const q = stations.map((t) => v2.add(base, v2.scale(dir, t)))
  const segments: number[] = []
  const seg = (a: Vec2, b: Vec2) => segments.push(a[0], a[1], b[0], b[1])
  // dimension line with overshoot
  const ext = v2.scale(dir, style.overshoot)
  seg(v2.sub(q[0]!, ext), v2.add(q[q.length - 1]!, ext))
  // extension lines
  for (const p of pts) {
    const t = v2.dot(v2.sub(p, first), dir)
    const d = v2.add(base, v2.scale(dir, t))
    const toDim = v2.sub(d, p)
    const len = v2.len(toDim)
    if (len < 1e-9) continue
    const u = v2.scale(toDim, 1 / len)
    seg(v2.add(p, v2.scale(u, Math.min(style.gap, len))), v2.add(d, v2.scale(u, style.overshoot)))
  }
  // ticks
  const t = v2.scale(v2.norm(v2.add(dir, n)), style.tick)
  for (const p of q) seg(v2.sub(p, t), v2.add(p, t))
  // texts (readable orientation, on the side away from the measured points)
  let rot = Math.atan2(dir[1], dir[0])
  let up = n
  if (rot > Math.PI / 2 + 1e-9 || rot <= -Math.PI / 2 + 1e-9) {
    rot += Math.PI
    up = v2.scale(n, -1)
  }
  const side = v2.dot(v2.sub(base, first), up) >= 0 ? 1 : -1
  const texts: Text2D[] = []
  for (let i = 0; i + 1 < q.length; i++) {
    const mid = v2.add(v2.mid(q[i]!, q[i + 1]!), v2.scale(up, side * style.textSize * 0.35))
    texts.push({ text: style.format(stations[i + 1]! - stations[i]!), position: mid, size: style.textSize, rotation: rot, align: 'center', baseline: side > 0 ? 'bottom' : 'top', style: 'annotation' })
  }
  return { lines: [{ style: 'annotation', segments: new Float32Array(segments) }], fills: [], texts }
}
