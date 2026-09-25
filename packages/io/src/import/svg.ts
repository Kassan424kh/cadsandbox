// SVG import (SVGLoader, browser DOMParser): filled paths → flat 'shape' nodes (profile 'path', depth 0,
// holes preserved), stroked paths → 'polyline' (straight) or 'spline' (curved) nodes. Exact Bézier
// handles are kept; arcs become cubic Béziers. SVG's y-down is flipped to plan y-up.
import type { Curve, Path, Shape, ShapePath, Vector2 } from 'three'
import type { Contour, PathPoint, Vec2 } from '@cadsandbox/doc'
import type { ImportOptions, ImportResult } from '../api'
import { SnapshotBuilder } from '../builder'
import { decodeText, stem } from '../util/bytes'
import { catmullRomPath, ellipseArcPath } from '../util/geom2d'
import { unitScale } from './units'

const PX = 0.0254 / 96
const ABS_UNITS: Record<string, number> = { mm: 0.001, cm: 0.01, in: 0.0254, pt: 0.0254 / 72, pc: 0.0254 / 6, px: PX, '': PX, q: 0.00025 }

/** Meters per SVG user unit from the root width + viewBox. */
export function svgUserUnit(text: string): number {
  const tag = /<svg\b[^>]*>/i.exec(text)?.[0] ?? ''
  const attr = (n: string) => new RegExp(`\\s${n}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1]
  const vb = attr('viewBox')
    ?.split(/[\s,]+/)
    .map(Number)
    .filter((x) => Number.isFinite(x))
  const w = /^\s*([\d.eE+-]+)\s*([a-zA-Z%]*)\s*$/.exec(attr('width') ?? '')
  if (vb && vb.length === 4 && vb[2]! > 0 && w && w[2] !== '%') {
    const unit = ABS_UNITS[w[2]!.toLowerCase()]
    if (unit) return (parseFloat(w[1]!) * unit) / vb[2]!
  }
  return PX
}

type P = [number, number]

class ContourBuilder {
  readonly points: PathPoint[] = []
  private straight = true
  constructor(private readonly map: (v: Vector2 | P) => Vec2) {}

  private start(p: Vec2) {
    if (!this.points.length) this.points.push({ p })
  }
  private last(): PathPoint {
    return this.points[this.points.length - 1]!
  }
  private to(p: Vec2, hi?: Vec2) {
    const pt: PathPoint = { p }
    if (hi) pt.hi = hi
    this.points.push(pt)
  }

  add(c: Curve<Vector2>): void {
    const t = (c as Curve<Vector2> & { type: string }).type
    const anyc = c as unknown as Record<string, Vector2 | number | boolean | Vector2[]>
    if (t === 'LineCurve') {
      this.start(this.map(anyc.v1 as Vector2))
      this.to(this.map(anyc.v2 as Vector2))
    } else if (t === 'CubicBezierCurve') {
      this.straight = false
      this.start(this.map(anyc.v0 as Vector2))
      this.last().ho = this.map(anyc.v1 as Vector2)
      this.to(this.map(anyc.v3 as Vector2), this.map(anyc.v2 as Vector2))
    } else if (t === 'QuadraticBezierCurve') {
      this.straight = false
      const v0 = anyc.v0 as Vector2,
        v1 = anyc.v1 as Vector2,
        v2 = anyc.v2 as Vector2
      this.start(this.map(v0))
      this.last().ho = this.map([v0.x + (2 / 3) * (v1.x - v0.x), v0.y + (2 / 3) * (v1.y - v0.y)])
      this.to(this.map(v2), this.map([v2.x + (2 / 3) * (v1.x - v2.x), v2.y + (2 / 3) * (v1.y - v2.y)]))
    } else if (t === 'EllipseCurve' || t === 'ArcCurve') {
      this.straight = false
      const cw = !!anyc.aClockwise
      const a0 = anyc.aStartAngle as number,
        a1 = anyc.aEndAngle as number
      let arc = cw ? ellipseArcPath(anyc.aX as number, anyc.aY as number, anyc.xRadius as number, anyc.yRadius as number, (anyc.aRotation as number) ?? 0, a1, a0) : ellipseArcPath(anyc.aX as number, anyc.aY as number, anyc.xRadius as number, anyc.yRadius as number, (anyc.aRotation as number) ?? 0, a0, a1)
      if (cw) arc = arc.reverse().map((q) => ({ p: q.p, ...(q.ho ? { hi: q.ho } : {}), ...(q.hi ? { ho: q.hi } : {}) }))
      const mapped = arc.map((q) => ({ p: this.map(q.p), ...(q.hi ? { hi: this.map(q.hi) } : {}), ...(q.ho ? { ho: this.map(q.ho) } : {}) }))
      if (!this.points.length) this.points.push({ p: mapped[0]!.p })
      if (mapped[0]!.ho) this.last().ho = mapped[0]!.ho
      for (const q of mapped.slice(1)) this.points.push(q)
    } else if (t === 'SplineCurve') {
      this.straight = false
      const pts = (anyc.points as Vector2[]).map((v) => this.map(v))
      const cr = catmullRomPath(pts)
      if (!this.points.length) this.points.push({ p: cr[0]!.p })
      if (cr[0]!.ho) this.last().ho = cr[0]!.ho
      for (const q of cr.slice(1)) this.points.push(q)
    } else {
      this.straight = false
      for (const v of c.getPoints(12).slice(this.points.length ? 1 : 0)) this.points.push({ p: this.map(v) })
    }
  }

  contour(closedHint: boolean): Contour & { straight: boolean } {
    const pts = this.points
    let closed = closedHint
    if (pts.length > 2) {
      const f = pts[0]!,
        l = pts[pts.length - 1]!
      if (Math.hypot(f.p[0] - l.p[0], f.p[1] - l.p[1]) < 1e-12) {
        closed = true
        if (l.hi) f.hi = l.hi
        pts.pop()
      }
    }
    return { points: pts, closed, straight: this.straight }
  }
}

function contourOf(path: Path, map: (v: Vector2 | P) => Vec2, closed: boolean) {
  const cb = new ContourBuilder(map)
  for (const c of path.curves) cb.add(c)
  if (!path.curves.length) {
    const pts = path.getPoints()
    for (const v of pts) cb.points.push({ p: map(v) })
  }
  return cb.contour(closed)
}

function cssColor(three: typeof import('three'), value: string | undefined): string | null {
  if (!value || value === 'none' || value === 'transparent' || value.startsWith('url(')) return null
  try {
    return `#${new three.Color().setStyle(value).getHexString()}`
  } catch {
    return null
  }
}

export async function importSvg(name: string, bytes: Uint8Array, opts: ImportOptions): Promise<ImportResult> {
  if (typeof DOMParser === 'undefined') throw new Error('SVG import needs a browser environment.')
  const text = decodeText(bytes)
  const [three, { SVGLoader }] = await Promise.all([import('three'), import('three/examples/jsm/loaders/SVGLoader.js')])
  const loader = new SVGLoader()
  loader.defaultDPI = 96
  loader.defaultUnit = 'px'
  const data = loader.parse(text)
  const s = opts.units ? unitScale(opts.units) : svgUserUnit(text)
  const b = new SnapshotBuilder()
  const root = b.add('group', { name: stem(name), parent: null, meta: { source: { format: 'svg' } } })
  const map = (v: Vector2 | P): Vec2 => (Array.isArray(v) ? [v[0] * s, -v[1] * s] : [v.x * s, -v.y * s])
  let count = 0
  for (const sp of data.paths as (ShapePath & { userData?: { style?: Record<string, string>; node?: Element } })[]) {
    const style = sp.userData?.style ?? {}
    const id = sp.userData?.node?.getAttribute?.('id') ?? undefined
    const fill = style.fill !== undefined ? cssColor(three, style.fill) : null
    const stroke = cssColor(three, style.stroke)
    if (style.visibility === 'hidden' || style.display === 'none') continue
    if (fill) {
      for (const shape of SVGLoader.createShapes(sp) as Shape[]) {
        const contours = [contourOf(shape, map, true), ...shape.holes.map((h) => contourOf(h, map, true))].filter((c) => c.points.length >= 3)
        if (!contours.length) continue
        const [c, w, h] = centre(contours)
        b.add('shape', {
          name: id ?? 'Shape',
          parent: root.id,
          color: fill,
          t: { p: [c[0], c[1], 0], r: [0, 0, 0, 1], s: [1, 1, 1] },
          meta: style.fillOpacity && Number(style.fillOpacity) < 1 ? { svg: { fillOpacity: Number(style.fillOpacity) } } : {},
          params: { profile: 'path', width: w, height: h, depth: 0, bevel: 0, path: { contours: contours.map(({ points, closed }) => ({ points, closed })) } },
        })
        b.expand(contours.flatMap((ct) => ct.points.map((p) => [p.p[0] + c[0], p.p[1] + c[1], 0] as [number, number, number])))
        count++
      }
    }
    if (stroke && (!fill || stroke !== fill)) {
      for (const sub of sp.subPaths) {
        const ct = contourOf(sub, map, !!(sub as Path & { autoClose?: boolean }).autoClose)
        if (ct.points.length < 2) continue
        if (ct.straight) b.add('polyline', { name: id ?? 'Polyline', parent: root.id, color: stroke, params: { points: ct.points.map((p) => p.p), closed: ct.closed } })
        else b.add('spline', { name: id ?? 'Curve', parent: root.id, color: stroke, params: { path: { contours: [{ points: ct.points, closed: ct.closed }] } } })
        b.expand(ct.points.map((p) => [p.p[0], p.p[1], 0]))
        count++
      }
    }
  }
  if (!count) b.warn('The SVG contains no visible paths.')
  return b.result()
}

/** Re-centre contours on their bounds center (nicer pivot); returns [center, width, height]. */
function centre(contours: Contour[]): [Vec2, number, number] {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity
  for (const c of contours)
    for (const p of c.points) {
      x0 = Math.min(x0, p.p[0])
      y0 = Math.min(y0, p.p[1])
      x1 = Math.max(x1, p.p[0])
      y1 = Math.max(y1, p.p[1])
    }
  const cx = (x0 + x1) / 2,
    cy = (y0 + y1) / 2
  const sh = (v: Vec2): Vec2 => [v[0] - cx, v[1] - cy]
  for (const c of contours)
    for (const p of c.points) {
      p.p = sh(p.p)
      if (p.hi) p.hi = sh(p.hi)
      if (p.ho) p.ho = sh(p.ho)
    }
  return [[cx, cy], x1 - x0, y1 - y0]
}
