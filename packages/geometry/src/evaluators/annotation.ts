// Drafting symbols for architects: structural grid lines (Achsraster) with label bubbles, height
// markers (Höhenkoten), north arrows and graphic scale bars. Pure 2D drawings in the node's local
// XY plane; sizes are model meters (ANNO defaults ≈ paper mm at 1:100, node.meta.textSize overrides).
import type { AnyNode, NodeBase, Vec2 } from '@cadsandbox/doc'
import { formatLength } from '@cadsandbox/shared'
import type { GeometryResult, SnapPoint } from '../api'
import { ANNO, DrawingBuilder, readableRotation } from '../core/drawing'
import { add2, dist2, fromAngle, mid2, normalize2, scale2, sub2 } from '../core/math2d'
import type { EvalContext } from './context'
import { drawingBounds, emptyResult, errorResult, snap } from './result'

const textSizeOf = (node: AnyNode, fallback = ANNO.textSize): number => {
  const m = (node.meta as Record<string, unknown>).textSize
  return typeof m === 'number' && m > 0 ? m : fallback
}

function done(d: DrawingBuilder, snaps: SnapPoint[], quantities?: Record<string, number>, edges?: Float32Array): GeometryResult {
  const drawing = d.build()
  const res = emptyResult({ drawing })
  res.bounds = drawingBounds(drawing) ?? res.bounds
  if (snaps.length) res.snaps = snaps
  if (quantities) res.quantities = quantities
  if (edges && edges.length) res.edges = edges
  return res
}

/** Sign-prefixed elevation text: "+2.75 m", "−1.20 m", "±0.00 m". Meter documents always show at
 *  least two fixed decimals (Höhenkoten convention); other units use the doc formatting. */
export function formatElevation(meters: number, units: EvalContext['units']): string {
  const eps = 0.0005
  const sign = meters > eps ? '+' : meters < -eps ? '−' : '±'
  const abs = Math.abs(meters) < eps ? 0 : Math.abs(meters)
  if (units.length === 'm') return `${sign}${abs.toFixed(Math.max(2, units.precision))} m`
  return sign + formatLength(abs, units.length, units.precision)
}

// ------------------------------------------------------------------ grid line
export function evaluateGridline(node: NodeBase<'gridline'>): GeometryResult {
  const p = node.params
  const a: Vec2 = [p.a?.[0] ?? 0, p.a?.[1] ?? 0]
  const b: Vec2 = [p.b?.[0] ?? 0, p.b?.[1] ?? 0]
  const len = dist2(a, b)
  if (len < 1e-9) return errorResult('Grid line has zero length')
  const dir = normalize2(sub2(b, a))
  const ext = p.extension ?? 0.6
  const r = p.radius ?? 0.35
  const label = p.label ?? ''
  const d = new DrawingBuilder()
  d.segP('annotation', a, b)
  const snaps: SnapPoint[] = [snap('endpoint', a[0], a[1]), snap('endpoint', b[0], b[1])]
  const m = mid2(a, b)
  snaps.push(snap('midpoint', m[0], m[1]))
  // Bubble text fits the circle; long labels ("A1", "12") shrink.
  const size = Math.min(textSizeOf(node, r * 1.1), r * 1.1) * (label.length > 2 ? 2 / label.length : 1)
  const bubble = (end: Vec2, out: Vec2): void => {
    const stub = add2(end, scale2(out, ext))
    const c = add2(end, scale2(out, ext + r))
    d.segP('annotation', end, stub)
    d.circle('annotation', c, r)
    d.text(label, c, size, { align: 'center', baseline: 'middle', style: 'annotation' })
    snaps.push(snap('center', c[0], c[1]))
  }
  if (p.bubble === 'start' || p.bubble === 'both') bubble(a, scale2(dir, -1))
  if (p.bubble === 'end' || p.bubble === 'both') bubble(b, dir)
  // Feature edge of the axis so the snap engine offers nearest / perpendicular / intersection snaps.
  const edges = new Float32Array([a[0], a[1], 0, b[0], b[1], 0])
  return done(d, snaps, { length: len }, edges)
}

// ------------------------------------------------------------------ height marker
/** Elevation shown by a level mark: node world elevation (ctx.elevation) relative to project zero,
 *  or absolute NN height when the doc asks for it. */
export function levelmarkValue(node: NodeBase<'levelmark'>, ctx: EvalContext): number {
  const elevation = typeof ctx.elevation === 'number' ? ctx.elevation : node.t.p[2]
  const u = ctx.units
  return u.elevationDisplay === 'absolute' ? elevation + (u.elevationDatum ?? 0) : elevation
}

export function levelmarkText(node: NodeBase<'levelmark'>, ctx: EvalContext): string {
  const value = levelmarkValue(node, ctx)
  const prefix = node.params.prefix?.trim()
  return (prefix ? `${prefix} ` : '') + formatElevation(value, ctx.units)
}

export function evaluateLevelmark(node: NodeBase<'levelmark'>, ctx: EvalContext): GeometryResult {
  const size = textSizeOf(node)
  const text = levelmarkText(node, ctx)
  const d = new DrawingBuilder()
  // Plan symbol: base line with an open triangle standing on it (apex on the line), text to the right.
  const h = size * 0.9
  const w = h * 0.58
  const half = size * 2.2
  d.seg('annotation', -half, 0, half, 0)
  d.polyline('annotation', [[0, 0], [-w, h], [w, h]], true)
  d.text(text, [w + size * 0.3, size * 0.12], size, { align: 'left', baseline: 'bottom', style: 'annotation' })
  const snaps: SnapPoint[] = [snap('insertion', 0, 0), snap('endpoint', -half, 0), snap('endpoint', half, 0)]
  return done(d, snaps, { elevation: levelmarkValue(node, ctx) })
}

// ------------------------------------------------------------------ north arrow
export function evaluateNorthArrow(node: NodeBase<'northarrow'>): GeometryResult {
  const p = node.params
  const s = Math.max(0.05, p.size || 1)
  const r = s / 2
  const angle = p.angle ?? 0
  const north = fromAngle(Math.PI / 2 + angle)
  const east: Vec2 = [north[1], -north[0]]
  const c: Vec2 = [0, 0]
  const d = new DrawingBuilder()
  const tip = add2(c, scale2(north, r * 0.9))
  const tail = add2(c, scale2(north, -r * 0.35))
  const w = r * 0.22
  const bl = add2(tail, scale2(east, -w))
  const br = add2(tail, scale2(east, w))
  // Left half open, right half filled (classic north arrow).
  d.polyline('annotation', [tip, bl, c], true)
  d.polyline('annotation', [tip, br, c], true)
  d.fill([{ outer: [tip, br, c], holes: [] }], 'solid')
  if (p.style === 'compass') {
    d.circle('annotation', c, r)
    for (let i = 0; i < 4; i++) {
      const dir = fromAngle(Math.PI / 2 + angle + (i * Math.PI) / 2)
      d.segP('annotation', add2(c, scale2(dir, r)), add2(c, scale2(dir, r * (i === 0 ? 1.15 : 1.08))))
    }
  }
  const size = Math.min(textSizeOf(node, r * 0.45), r * 0.5)
  const tpos = add2(c, scale2(north, r * (p.style === 'compass' ? 1.2 : 1.0) + size * 0.2))
  d.text('N', tpos, size, { align: 'center', baseline: 'bottom', rotation: readableRotation(angle), style: 'annotation' })
  const snaps: SnapPoint[] = [snap('center', 0, 0), snap('endpoint', tip[0], tip[1])]
  return done(d, snaps, { angleDeg: (angle * 180) / Math.PI })
}

// ------------------------------------------------------------------ scale bar
export function evaluateScaleBar(node: NodeBase<'scalebar'>, ctx: EvalContext): GeometryResult {
  const p = node.params
  const L = Math.max(0.01, p.length || 1)
  const n = Math.max(1, Math.min(50, Math.floor(p.segments || 1)))
  const seg = L / n
  const size = textSizeOf(node)
  const h = size * 0.9
  const x0 = -L / 2
  const d = new DrawingBuilder()
  const u = ctx.units
  for (let i = 0; i < n; i++) {
    const xa = x0 + i * seg
    const xb = xa + seg
    d.rect('annotation', xa, 0, xb, h)
    if (i % 2 === 0) d.fill([{ outer: [[xa, 0], [xb, 0], [xb, h], [xa, h]], holes: [] }], 'solid')
  }
  const labelSize = size * 0.75
  for (let i = 0; i <= n; i++) {
    const x = x0 + i * seg
    const last = i === n
    const text = last ? formatLength(L, u.length, u.precision) : formatLength(i * seg, u.length, u.precision, false)
    d.text(text, [x, -size * 0.25], labelSize, { align: last ? 'left' : 'center', baseline: 'top', style: 'annotation' })
  }
  const scale = Math.max(1, Math.round(p.scale || 100))
  d.text(`1:${scale}`, [x0 + L + size * 0.5, h / 2], size, { align: 'left', baseline: 'middle', style: 'annotation' })
  const snaps: SnapPoint[] = [snap('endpoint', x0, 0), snap('endpoint', x0 + L, 0), snap('midpoint', 0, 0)]
  return done(d, snaps, { length: L, scale })
}

// ------------------------------------------------------------------ section-view marker (shared with the vectorizer)
/** Height marker as drawn in sections/elevations: horizontal line with a (half-filled) triangle whose
 *  apex touches the marked height, text above the line. Coordinates: view plane (u right, v up),
 *  origin = marked point. */
export function sectionLevelmarkDrawing(text: string, size = ANNO.textSize, flip = false): ReturnType<DrawingBuilder['build']> {
  const d = new DrawingBuilder()
  const h = size * 0.9
  const w = h * 0.58
  const sgn = flip ? -1 : 1
  const half = size * 2.4
  d.seg('annotation', -half * 0.4, 0, half, 0)
  const apex: Vec2 = [0, 0]
  const l: Vec2 = [-w, h * sgn]
  const r: Vec2 = [w, h * sgn]
  d.polyline('annotation', [apex, l, r], true)
  d.fill([{ outer: [apex, r, [0, h * sgn]], holes: [] }], 'solid')
  d.text(text, [w + size * 0.3, sgn > 0 ? size * 0.12 : -size * 0.12], size, { align: 'left', baseline: sgn > 0 ? 'bottom' : 'top', style: 'annotation' })
  return d.build()
}
