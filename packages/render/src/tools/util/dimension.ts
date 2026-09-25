// Dimension → Drawing2D generator (architectural ticks, extension lines, centered text). Used for
// live previews and as the vectorize fallback when the geometry engine has no drawing yet.
import type { DimensionParams, Vec2 } from '@cadsandbox/doc'
import type { Drawing2D, Lines2D, Text2D } from '@cadsandbox/geometry'
import { chainDrawing, chainTotal } from './dimensionChain'
import { positiveAngle, v2 } from './vec'

export interface DimensionStyle {
  /** Text cap height (m) */
  textSize: number
  /** Extension line gap from the measured point and overshoot beyond the dimension line */
  gap: number
  overshoot: number
  /** Tick half-length (45° architectural tick) */
  tick: number
  format: (meters: number) => string
  formatAngle?: (rad: number) => string
}

export const DEFAULT_DIM_STYLE: DimensionStyle = {
  textSize: 0.2,
  gap: 0.05,
  overshoot: 0.1,
  tick: 0.08,
  format: (m) => `${Math.round(m * 1000)}`,
  formatAngle: (a) => `${((a * 180) / Math.PI).toFixed(1).replace(/\.0$/, '')}°`,
}

function seg(segments: number[], a: Vec2, b: Vec2): void {
  segments.push(a[0], a[1], b[0], b[1])
}

function measuredText(params: DimensionParams, value: string): string {
  if (!params.text) return value
  return params.text.includes('<>') ? params.text.replace(/<>/g, value) : params.text
}

/** Build the 2D drawing of a dimension in its node-local XY plane (points' z ignored). */
export function dimensionDrawing(params: DimensionParams, style: DimensionStyle = DEFAULT_DIM_STYLE): Drawing2D {
  if (params.kind === 'chain') return chainDrawing(params, style)
  const pts = params.points.map((p) => [p[0], p[1]] as Vec2)
  const segments: number[] = []
  const texts: Text2D[] = []
  const lines: Lines2D = { style: 'annotation', segments: new Float32Array(0) }
  const p1 = pts[0],
    p2 = pts[1]
  if (!p1 || !p2) return { lines: [], fills: [], texts: [] }

  switch (params.kind) {
    case 'linear':
    case 'aligned': {
      let dir: Vec2
      if (params.kind === 'aligned') dir = v2.norm(v2.sub(p2, p1))
      else {
        const axis = params.axis === 'y' ? 'y' : params.axis === 'x' ? 'x' : Math.abs(p2[0] - p1[0]) >= Math.abs(p2[1] - p1[1]) ? 'x' : 'y'
        dir = axis === 'x' ? [1, 0] : [0, 1]
      }
      if (!Number.isFinite(dir[0]) || (dir[0] === 0 && dir[1] === 0)) dir = [1, 0]
      const n = v2.perp(dir)
      // Dimension line passes through p1 + n·offset; points are projected onto it.
      const base = v2.add(p1, v2.scale(n, params.offset))
      const project = (p: Vec2): Vec2 => v2.add(base, v2.scale(dir, v2.dot(v2.sub(p, base), dir)))
      const d1 = project(p1),
        d2 = project(p2)
      const value = Math.abs(v2.dot(v2.sub(p2, p1), dir))
      // extension lines
      for (const [p, d] of [
        [p1, d1],
        [p2, d2],
      ] as [Vec2, Vec2][]) {
        const toDim = v2.sub(d, p)
        const len = v2.len(toDim)
        if (len < 1e-9) continue
        const u = v2.scale(toDim, 1 / len)
        seg(segments, v2.add(p, v2.scale(u, Math.min(style.gap, len))), v2.add(d, v2.scale(u, style.overshoot)))
      }
      // dimension line with overshoot
      const ext = v2.scale(dir, style.overshoot)
      seg(segments, v2.sub(d1, ext), v2.add(d2, ext))
      // 45° ticks
      const t = v2.scale(v2.norm(v2.add(dir, n)), style.tick)
      seg(segments, v2.sub(d1, t), v2.add(d1, t))
      seg(segments, v2.sub(d2, t), v2.add(d2, t))
      // text above the line (flip so it reads left-to-right / bottom-to-top)
      let rot = Math.atan2(dir[1], dir[0])
      let up = n
      if (rot > Math.PI / 2 + 1e-9 || rot <= -Math.PI / 2 + 1e-9) {
        rot += Math.PI
        up = v2.scale(n, -1)
      }
      // keep the text on the side away from the measured points when possible
      const side = v2.dot(v2.sub(base, p1), up) >= 0 ? 1 : -1
      const mid = v2.add(v2.mid(d1, d2), v2.scale(up, side * style.textSize * 0.35))
      texts.push({ text: measuredText(params, style.format(value)), position: mid, size: style.textSize, rotation: rot, align: 'center', baseline: side > 0 ? 'bottom' : 'top', style: 'annotation' })
      break
    }
    case 'angular': {
      const vertex = p1
      const a = p2,
        b = pts[2]
      if (!b) break
      const r = Math.abs(params.offset) > 1e-9 ? Math.abs(params.offset) : Math.min(v2.dist(vertex, a), v2.dist(vertex, b)) * 0.6
      const a0 = v2.angle(v2.sub(a, vertex))
      const a1 = v2.angle(v2.sub(b, vertex))
      let sweep = positiveAngle(a1 - a0)
      let start = a0
      if (sweep > Math.PI) {
        start = a1
        sweep = Math.PI * 2 - sweep
      }
      const steps = Math.max(8, Math.ceil(sweep / (Math.PI / 24)))
      let prev = v2.add(vertex, v2.fromAngle(start, r))
      for (let i = 1; i <= steps; i++) {
        const p = v2.add(vertex, v2.fromAngle(start + (sweep * i) / steps, r))
        seg(segments, prev, p)
        prev = p
      }
      for (const p of [a, b]) {
        const d = v2.sub(p, vertex)
        const l = v2.len(d)
        if (l < r) seg(segments, p, v2.add(vertex, v2.scale(d, (r + style.overshoot) / l)))
        else seg(segments, vertex, p)
      }
      const midAng = start + sweep / 2
      const tp = v2.add(vertex, v2.fromAngle(midAng, r + style.textSize * 0.6))
      const fa = style.formatAngle ?? DEFAULT_DIM_STYLE.formatAngle!
      texts.push({ text: measuredText(params, fa(sweep)), position: tp, size: style.textSize, rotation: 0, align: 'center', baseline: 'middle', style: 'annotation' })
      break
    }
    case 'radius':
    case 'diameter':
    case 'arc-length': {
      const center = p1,
        on = p2
      const r = v2.dist(center, on)
      const d = r > 1e-9 ? v2.norm(v2.sub(on, center)) : ([1, 0] as Vec2)
      const isDia = params.kind === 'diameter'
      const from = isDia ? v2.sub(center, v2.scale(d, r)) : center
      seg(segments, from, on)
      const t = v2.scale(v2.perp(d), style.tick)
      seg(segments, v2.sub(on, t), v2.add(on, t))
      if (isDia) seg(segments, v2.sub(from, t), v2.add(from, t))
      const value = isDia ? `Ø ${style.format(r * 2)}` : params.kind === 'radius' ? `R ${style.format(r)}` : style.format(r)
      let rot = Math.atan2(d[1], d[0])
      if (rot > Math.PI / 2 || rot <= -Math.PI / 2) rot += Math.PI
      const mid = v2.add(v2.mid(from, on), v2.scale(v2.perp(d), style.textSize * 0.4))
      texts.push({ text: measuredText(params, value), position: mid, size: style.textSize, rotation: rot, align: 'center', baseline: 'bottom', style: 'annotation' })
      break
    }
  }
  lines.segments = new Float32Array(segments)
  return { lines: [lines], fills: [], texts }
}

/** Measured value (m or rad) of a dimension. */
export function dimensionValue(params: DimensionParams): number {
  if (params.kind === 'chain') return chainTotal(params)
  const pts = params.points.map((p) => [p[0], p[1]] as Vec2)
  const [p1, p2, p3] = pts
  if (!p1 || !p2) return 0
  switch (params.kind) {
    case 'aligned':
      return v2.dist(p1, p2)
    case 'linear': {
      const axis = params.axis === 'y' ? 'y' : params.axis === 'x' ? 'x' : Math.abs(p2[0] - p1[0]) >= Math.abs(p2[1] - p1[1]) ? 'x' : 'y'
      return axis === 'x' ? Math.abs(p2[0] - p1[0]) : Math.abs(p2[1] - p1[1])
    }
    case 'angular': {
      if (!p3) return 0
      const s = positiveAngle(v2.angle(v2.sub(p3, p1)) - v2.angle(v2.sub(p2, p1)))
      return s > Math.PI ? Math.PI * 2 - s : s
    }
    case 'diameter':
      return v2.dist(p1, p2) * 2
    default:
      return v2.dist(p1, p2)
  }
}
