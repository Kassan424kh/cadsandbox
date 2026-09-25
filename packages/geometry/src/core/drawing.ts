// Drawing2D assembly helpers (lines by style, fills, texts) + annotation constants.
import type { HatchPattern, Vec2 } from '@cadsandbox/doc'
import type { Drawing2D, Fill2D, LineStyle, Lines2D, Text2D } from '../api'
import { SegBuf } from './buffers'
import { TAU, applyAffine, arcSegments, type Affine2 } from './math2d'
import { trianglesOf, type PolyWithHoles } from './polygon'

/** Annotation sizes in model meters (≈ 2 mm text at 1:100). Tools may override via node.meta.textSize. */
export const ANNO = {
  textSize: 0.2,
  tick: 0.1,
  arrow: 0.25,
  arrowWidth: 0.08,
  extensionGap: 0.06,
  overshoot: 0.1,
  textGap: 0.05,
  stampSize: 0.25,
}

export class DrawingBuilder {
  private lines = new Map<LineStyle, SegBuf>()
  readonly fills: Fill2D[] = []
  readonly texts: Text2D[] = []

  buf(style: LineStyle): SegBuf {
    let b = this.lines.get(style)
    if (!b) this.lines.set(style, (b = new SegBuf()))
    return b
  }
  seg(style: LineStyle, x0: number, y0: number, x1: number, y1: number): void {
    this.buf(style).seg(x0, y0, x1, y1)
  }
  segP(style: LineStyle, a: Vec2, b: Vec2): void {
    this.buf(style).seg(a[0], a[1], b[0], b[1])
  }
  polyline(style: LineStyle, pts: readonly Vec2[], closed = false): void {
    this.buf(style).polyline(pts, closed)
  }
  segments(style: LineStyle, segs: ArrayLike<number>): void {
    if (segs.length) this.buf(style).append(segs)
  }
  circle(style: LineStyle, c: Vec2, r: number, segments = arcSegments(r, TAU)): void {
    const b = this.buf(style)
    let px = c[0] + r, py = c[1]
    for (let i = 1; i <= segments; i++) {
      const t = (TAU * i) / segments
      const x = c[0] + Math.cos(t) * r, y = c[1] + Math.sin(t) * r
      b.seg(px, py, x, y)
      px = x
      py = y
    }
  }
  /** Arc from angle a0 sweeping `sweep` radians (positive = CCW). */
  arc(style: LineStyle, c: Vec2, r: number, a0: number, sweep: number, segments = arcSegments(r, sweep)): void {
    const b = this.buf(style)
    let px = c[0] + Math.cos(a0) * r, py = c[1] + Math.sin(a0) * r
    for (let i = 1; i <= segments; i++) {
      const t = a0 + (sweep * i) / segments
      const x = c[0] + Math.cos(t) * r, y = c[1] + Math.sin(t) * r
      b.seg(px, py, x, y)
      px = x
      py = y
    }
  }
  rect(style: LineStyle, x0: number, y0: number, x1: number, y1: number): void {
    const b = this.buf(style)
    b.seg(x0, y0, x1, y0)
    b.seg(x1, y0, x1, y1)
    b.seg(x1, y1, x0, y1)
    b.seg(x0, y1, x0, y0)
  }
  fill(polys: readonly PolyWithHoles[], pattern: HatchPattern, opts: { color?: string | null; scale?: number; angle?: number } = {}): void {
    if (!polys.length) return
    const tri = trianglesOf(polys)
    if (!tri.length) return
    const f: Fill2D = { triangles: tri, polygons: polys.map((p) => ({ outer: p.outer, holes: p.holes })), pattern }
    if (opts.color) f.color = opts.color
    if (opts.scale !== undefined) f.scale = opts.scale
    if (opts.angle !== undefined) f.angle = opts.angle
    this.fills.push(f)
  }
  text(text: string, position: Vec2, size: number, opts: Partial<Omit<Text2D, 'text' | 'position' | 'size'>> = {}): void {
    if (!text) return
    this.texts.push({ text, position: [position[0], position[1]], size, rotation: opts.rotation ?? 0, align: opts.align ?? 'center', baseline: opts.baseline ?? 'middle', style: opts.style ?? 'annotation' })
  }
  append(d: Drawing2D | undefined): void {
    if (!d) return
    for (const l of d.lines) this.segments(l.style, l.segments)
    this.fills.push(...d.fills)
    this.texts.push(...d.texts)
  }
  get isEmpty(): boolean {
    for (const b of this.lines.values()) if (b.count) return false
    return !this.fills.length && !this.texts.length
  }
  build(): Drawing2D {
    const lines: Lines2D[] = []
    for (const [style, b] of this.lines) if (b.count) lines.push({ style, segments: b.toArray() })
    return { lines, fills: this.fills, texts: this.texts }
  }
}

/** Apply a 2D affine transform to a drawing (new arrays). */
export function transformDrawing(d: Drawing2D, m: Affine2): Drawing2D {
  const rot = Math.atan2(m[1], m[0])
  const scale = Math.hypot(m[0], m[1]) || 1
  return {
    lines: d.lines.map((l) => {
      const s = new Float32Array(l.segments.length)
      for (let i = 0; i < s.length; i += 2) {
        const x = l.segments[i]!, y = l.segments[i + 1]!
        s[i] = m[0] * x + m[2] * y + m[4]
        s[i + 1] = m[1] * x + m[3] * y + m[5]
      }
      return { style: l.style, segments: s }
    }),
    fills: d.fills.map((f) => {
      const t = new Float32Array(f.triangles.length)
      for (let i = 0; i < t.length; i += 2) {
        const x = f.triangles[i]!, y = f.triangles[i + 1]!
        t[i] = m[0] * x + m[2] * y + m[4]
        t[i + 1] = m[1] * x + m[3] * y + m[5]
      }
      return { ...f, triangles: t, polygons: f.polygons.map((p) => ({ outer: p.outer.map((q) => applyAffine(m, q)), holes: p.holes.map((h) => h.map((q) => applyAffine(m, q))) })) }
    }),
    texts: d.texts.map((t) => ({ ...t, position: applyAffine(m, t.position), rotation: t.rotation + rot, size: t.size * scale })),
  }
}

export function drawingIsEmpty(d: Drawing2D | undefined): boolean {
  return !d || (!d.lines.length && !d.fills.length && !d.texts.length)
}

/** Keep text readable: rotation folded into (-90°, 90°]. */
export function readableRotation(rot: number): number {
  let r = rot % TAU
  if (r < 0) r += TAU
  if (r > Math.PI / 2 && r <= (3 * Math.PI) / 2) r -= Math.PI
  if (r > Math.PI) r -= TAU
  return r
}
