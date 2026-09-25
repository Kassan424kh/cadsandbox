// Vector plan source for DXF / SVG / PDF: editor.vectorize() when an editor is available, otherwise
// the geometry engine's plan/drawing results + drafting node params (exact arcs, bulges, splines,
// hatches, dimensions). Output: a flat list of 2D items in plan coordinates (meters) with layers.
import type { AnyNode, CadDocument, Contour, HatchPattern, LayerDef, LineType, NodeBase, PathPoint, SheetViewSource, Vec2 } from '@cadsandbox/doc'
import { DRAFTING_TYPES, invertMatrix, multiplyMatrices } from '@cadsandbox/doc'
import type { Drawing2D, GeometryService, LineStyle } from '@cadsandbox/geometry'
import { formatLength } from '@cadsandbox/shared'
import type { LengthUnit } from '@cadsandbox/shared'
import type { ExportContext } from '../api'
import { dimGeometry, type DimGeom } from './dims'
import { chainDimGeometry } from './dimsChain'

export interface VLayer {
  name: string
  color: string
  lineWeight: number // mm on paper
  lineType: LineType
  printable: boolean
}

interface Base {
  layer: string
  color?: string | null
  weight?: number | null
  lineType?: LineType | null
}
export type VItem = Base &
  (
    | { kind: 'poly'; points: Vec2[]; bulges?: number[]; closed: boolean }
    | { kind: 'circle'; c: Vec2; r: number }
    | { kind: 'arc'; c: Vec2; r: number; start: number; end: number }
    | { kind: 'ellipse'; c: Vec2; rx: number; ry: number; rotation: number }
    | { kind: 'path'; contours: Contour[] }
    | { kind: 'text'; text: string; p: Vec2; size: number; rotation: number; align: 'left' | 'center' | 'right'; baseline: 'top' | 'middle' | 'bottom' }
    | { kind: 'hatch'; outer: Vec2[]; holes: Vec2[][]; pattern: HatchPattern; scale: number; angle: number; fill?: string | null }
    | { kind: 'dim'; geom: DimGeom }
  )

export interface VectorScene {
  title: string
  layers: Map<string, VLayer>
  items: VItem[]
  bounds: { min: Vec2; max: Vec2 } | null
  unit: LengthUnit
  /** plan scale denominator used for text/tick sizes (1:scale) */
  scale: number
  northAngle: number
}

export const STYLE_LAYERS: Record<LineStyle | 'fill' | 'text', VLayer> = {
  cut: { name: 'A-CUT', color: '#ffffff', lineWeight: 0.5, lineType: 'continuous', printable: true },
  visible: { name: 'A-VISIBLE', color: '#c8c8c8', lineWeight: 0.25, lineType: 'continuous', printable: true },
  overhead: { name: 'A-OVERHEAD', color: '#9ca3af', lineWeight: 0.18, lineType: 'dashed', printable: true },
  hidden: { name: 'A-HIDDEN', color: '#9ca3af', lineWeight: 0.18, lineType: 'hidden', printable: true },
  thin: { name: 'A-THIN', color: '#a8a29e', lineWeight: 0.13, lineType: 'continuous', printable: true },
  symbol: { name: 'A-SYMBOL', color: '#7dd3fc', lineWeight: 0.18, lineType: 'continuous', printable: true },
  annotation: { name: 'A-ANNO', color: '#86efac', lineWeight: 0.18, lineType: 'continuous', printable: true },
  drafting: { name: 'A-DRAFT', color: '#e6e6e6', lineWeight: 0.25, lineType: 'continuous', printable: true },
  fill: { name: 'A-HATCH', color: '#a8a29e', lineWeight: 0.09, lineType: 'continuous', printable: true },
  text: { name: 'A-TEXT', color: '#e6e6e6', lineWeight: 0.18, lineType: 'continuous', printable: true },
}

const STYLE_WEIGHT: Record<LineStyle, number | null> = { cut: 0.5, visible: 0.25, overhead: 0.18, hidden: 0.18, thin: 0.13, symbol: 0.18, annotation: 0.18, drafting: null }
const STYLE_TYPE: Partial<Record<LineStyle, LineType>> = { overhead: 'dashed', hidden: 'hidden' }

/** 2D affine [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f. */
type Aff = [number, number, number, number, number, number]
const affOf = (m: Float64Array): Aff => [m[0]!, m[1]!, m[4]!, m[5]!, m[12]!, m[13]!]
const ap = (t: Aff, p: readonly number[]): Vec2 => [t[0] * p[0]! + t[2] * p[1]! + t[4], t[1] * p[0]! + t[3] * p[1]! + t[5]]
const similarity = (t: Aff) => Math.abs(t[0] * t[0] + t[1] * t[1] - (t[2] * t[2] + t[3] * t[3])) < 1e-9 * (1 + t[0] * t[0] + t[1] * t[1]) && Math.abs(t[0] * t[2] + t[1] * t[3]) < 1e-9
const scaleOf = (t: Aff) => Math.hypot(t[0], t[1])
const rotOf = (t: Aff) => Math.atan2(t[1], t[0])
const mirrored = (t: Aff) => t[0] * t[3] - t[1] * t[2] < 0

/** Join consecutive segments sharing end points into polylines. */
export function chainSegments(seg: ArrayLike<number>, t: Aff | null): { points: Vec2[]; closed: boolean }[] {
  const out: { points: Vec2[]; closed: boolean }[] = []
  let cur: Vec2[] | null = null
  for (let i = 0; i + 3 < seg.length; i += 4) {
    const a: Vec2 = t ? ap(t, [seg[i]!, seg[i + 1]!]) : [seg[i]!, seg[i + 1]!]
    const b: Vec2 = t ? ap(t, [seg[i + 2]!, seg[i + 3]!]) : [seg[i + 2]!, seg[i + 3]!]
    const last = cur?.[cur.length - 1]
    if (cur && last && Math.abs(last[0] - a[0]) < 1e-9 && Math.abs(last[1] - a[1]) < 1e-9) cur.push(b)
    else {
      if (cur) out.push({ points: cur, closed: false })
      cur = [a, b]
    }
  }
  if (cur) out.push({ points: cur, closed: false })
  for (const pl of out) {
    const f = pl.points[0]!,
      l = pl.points[pl.points.length - 1]!
    if (pl.points.length > 3 && Math.abs(f[0] - l[0]) < 1e-9 && Math.abs(f[1] - l[1]) < 1e-9) {
      pl.points.pop()
      pl.closed = true
    }
  }
  return out
}

class Collector {
  readonly layers = new Map<string, VLayer>()
  readonly items: VItem[] = []
  private readonly docLayers: Map<string, LayerDef>
  readonly fmt: (m: number) => string

  constructor(
    readonly doc: CadDocument,
    readonly geometry: GeometryService | null,
    readonly textSize: number,
  ) {
    this.docLayers = new Map(doc.listLayers().map((l) => [l.id, l]))
    const u = doc.meta.units
    this.fmt = (m: number) => formatLength(m, u.length, u.length === 'mm' ? 0 : u.length === 'cm' ? 1 : u.length === 'm' ? 2 : u.precision, false)
  }

  layerFor(id: string | null): string {
    const l = this.docLayers.get(id ?? 'layer-0') ?? this.docLayers.get('layer-0')
    const name = l?.name ?? '0'
    if (!this.layers.has(name)) this.layers.set(name, { name, color: l?.color ?? '#e6e6e6', lineWeight: l?.lineWeight ?? 0.25, lineType: l?.lineType ?? 'continuous', printable: l?.printable ?? true })
    return name
  }
  styleLayer(key: keyof typeof STYLE_LAYERS): string {
    const l = STYLE_LAYERS[key]
    if (!this.layers.has(l.name)) this.layers.set(l.name, l)
    return l.name
  }

  drawing(d: Drawing2D, t: Aff | null, layer: (style: LineStyle) => string, color: string | null, fillLayer: string, textLayer: string): void {
    for (const lines of d.lines) {
      for (const pl of chainSegments(lines.segments, t)) {
        this.items.push({ kind: 'poly', layer: layer(lines.style), points: pl.points, closed: pl.closed, color, weight: STYLE_WEIGHT[lines.style], lineType: STYLE_TYPE[lines.style] ?? null })
      }
    }
    for (const f of d.fills) {
      for (const poly of f.polygons) {
        const outer = t ? poly.outer.map((p) => ap(t, p)) : poly.outer
        const holes = poly.holes.map((h) => (t ? h.map((p) => ap(t, p)) : h))
        this.items.push({ kind: 'hatch', layer: fillLayer, outer, holes, pattern: f.pattern, scale: f.scale ?? 1, angle: (f.angle ?? 0) + (t ? rotOf(t) : 0), fill: f.color ?? color })
      }
    }
    for (const tx of d.texts) {
      const s = t ? scaleOf(t) : 1
      this.items.push({ kind: 'text', layer: textLayer, text: tx.text, p: t ? ap(t, tx.position) : tx.position, size: tx.size * s, rotation: tx.rotation + (t ? rotOf(t) : 0), align: tx.align, baseline: tx.baseline, color })
    }
  }

  /** Drafting node from its params (exact geometry). Returns false if the type is not drafting. */
  drafting(n: AnyNode, t: Aff): boolean {
    const layer = this.layerFor(n.layer)
    const color = n.color
    const sim = similarity(t)
    const s = scaleOf(t)
    const poly = (points: Vec2[], closed: boolean, bulges?: number[]) => {
      const pts = points.map((p) => ap(t, p))
      const b = bulges?.some((x) => x) ? (sim ? bulges.map((x) => (mirrored(t) ? -x : x)) : undefined) : undefined
      this.items.push({ kind: 'poly', layer, color, points: pts, closed, ...(b ? { bulges: b } : {}) })
    }
    switch (n.type) {
      case 'line':
        poly([n.params.a, n.params.b], false)
        return true
      case 'polyline': {
        const p = n.params
        if (p.points.length < 2) return true
        poly(p.points, p.closed, p.bulges)
        if (p.fill && p.closed && p.points.length >= 3) this.items.push({ kind: 'hatch', layer, outer: p.points.map((q) => ap(t, q)), holes: [], pattern: 'solid', scale: 1, angle: 0, fill: p.fill })
        return true
      }
      case 'rect': {
        const { width: w, height: h } = n.params
        const r = Math.min(n.params.cornerRadius ?? 0, w / 2, h / 2)
        const x = w / 2,
          y = h / 2
        if (r > 1e-9) {
          const k = Math.tan(Math.PI / 8)
          poly(
            [
              [-x + r, -y],
              [x - r, -y],
              [x, -y + r],
              [x, y - r],
              [x - r, y],
              [-x + r, y],
              [-x, y - r],
              [-x, -y + r],
            ],
            true,
            [0, k, 0, k, 0, k, 0, k],
          )
        } else
          poly(
            [
              [-x, -y],
              [x, -y],
              [x, y],
              [-x, y],
            ],
            true,
          )
        return true
      }
      case 'circle': {
        const c = ap(t, [0, 0])
        if (sim) this.items.push({ kind: 'circle', layer, color, c, r: n.params.radius * s })
        else this.items.push({ kind: 'ellipse', layer, color, c, rx: Math.hypot(t[0], t[1]) * n.params.radius, ry: Math.hypot(t[2], t[3]) * n.params.radius, rotation: rotOf(t) })
        if (n.params.fill) this.items.push({ kind: 'hatch', layer, outer: circlePts(c, n.params.radius * s), holes: [], pattern: 'solid', scale: 1, angle: 0, fill: n.params.fill })
        return true
      }
      case 'arc': {
        const { radius, start, end } = n.params
        if (sim) {
          const rot = rotOf(t)
          const [a0, a1] = mirrored(t) ? [rot - end, rot - start] : [start + rot, end + rot]
          this.items.push({ kind: 'arc', layer, color, c: ap(t, [0, 0]), r: radius * s, start: a0, end: a1 })
        } else {
          let sweep = end - start
          if (sweep <= 0) sweep += Math.PI * 2
          const pts: Vec2[] = []
          for (let i = 0; i <= 48; i++) pts.push([Math.cos(start + (sweep * i) / 48) * radius, Math.sin(start + (sweep * i) / 48) * radius])
          poly(pts, false)
        }
        return true
      }
      case 'ellipse':
        this.items.push({ kind: 'ellipse', layer, color, c: ap(t, [0, 0]), rx: n.params.rx * Math.hypot(t[0], t[1]), ry: n.params.ry * Math.hypot(t[2], t[3]), rotation: rotOf(t) })
        return true
      case 'spline': {
        const tp = (q: Vec2) => ap(t, q)
        const contours = n.params.path.contours.map((c) => ({
          closed: c.closed,
          points: c.points.map((q): PathPoint => ({ p: tp(q.p), ...(q.hi ? { hi: tp(q.hi) } : {}), ...(q.ho ? { ho: tp(q.ho) } : {}) })),
        }))
        this.items.push({ kind: 'path', layer, color, contours })
        return true
      }
      case 'hatch': {
        const p = n.params
        if (p.boundary.length < 3 || p.pattern === 'none') return true
        this.items.push({ kind: 'hatch', layer, color, outer: p.boundary.map((q) => ap(t, q)), holes: (p.holes ?? []).map((h) => h.map((q) => ap(t, q))), pattern: p.pattern, scale: p.scale, angle: p.angle + rotOf(t), fill: p.color ?? color })
        return true
      }
      case 'dimension': {
        const p = n.params
        const pts = p.points.map((q) => ap(t, q))
        if (p.kind === 'chain') {
          // Maßkette: one dimension entity per interval on the shared dimension line
          for (const geom of chainDimGeometry(pts, p.offset * s, p.axis, this.fmt, this.textSize)) this.items.push({ kind: 'dim', layer, color, geom })
          return true
        }
        const geom = dimGeometry(p.kind, pts, p.offset * s, p.axis, p.text, this.fmt, this.textSize)
        if (geom) this.items.push({ kind: 'dim', layer, color, geom })
        return true
      }
      case 'leader': {
        const p = n.params
        if (p.points.length < 2) return true
        poly(p.points, false)
        const last = ap(t, p.points[p.points.length - 1]!)
        const prev = ap(t, p.points[p.points.length - 2]!)
        this.items.push({ kind: 'text', layer, color, text: p.text, p: [last[0] + (last[0] >= prev[0] ? 1 : -1) * this.textSize * 0.3, last[1]], size: this.textSize, rotation: 0, align: last[0] >= prev[0] ? 'left' : 'right', baseline: 'middle' })
        return true
      }
      default:
        return false
    }
  }
}

const circlePts = (c: Vec2, r: number, n = 64): Vec2[] => Array.from({ length: n }, (_, i) => [c[0] + r * Math.cos((i / n) * Math.PI * 2), c[1] + r * Math.sin((i / n) * Math.PI * 2)])

function sceneBounds(items: VItem[]): { min: Vec2; max: Vec2 } | null {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity
  const grow = (p: Vec2, r = 0) => {
    x0 = Math.min(x0, p[0] - r)
    y0 = Math.min(y0, p[1] - r)
    x1 = Math.max(x1, p[0] + r)
    y1 = Math.max(y1, p[1] + r)
  }
  for (const it of items) {
    if (it.kind === 'poly') it.points.forEach((p) => grow(p))
    else if (it.kind === 'circle' || it.kind === 'arc') grow(it.c, it.r)
    else if (it.kind === 'ellipse') grow(it.c, Math.max(it.rx, it.ry))
    else if (it.kind === 'path') it.contours.forEach((c) => c.points.forEach((p) => grow(p.p)))
    else if (it.kind === 'text') grow(it.p, it.size)
    else if (it.kind === 'hatch') it.outer.forEach((p) => grow(p))
    else if (it.kind === 'dim') it.geom.lines.forEach(([a, b]) => (grow(a), grow(b)))
  }
  return Number.isFinite(x0) ? { min: [x0, y0], max: [x1, y1] } : null
}

const DRAFTING = new Set<string>(DRAFTING_TYPES)

/** Collect a plan (levelId) or the whole-model top view (levelId null) as vector items. */
export async function collectPlan(ctx: ExportContext, opts: { levelId?: string | null; selection?: string[]; scale?: number }): Promise<VectorScene> {
  const doc = ctx.doc
  const scale = opts.scale ?? 100
  const textSize = (2.5 * scale) / 1000
  const levelId = opts.levelId ?? null
  const level = levelId ? (doc.getNode(levelId) as NodeBase<'level'> | undefined) : undefined
  const title = level ? level.name : doc.meta.name
  const c = new Collector(doc, ctx.geometry, textSize)
  if (ctx.editor && levelId && !opts.selection?.length) {
    const d = await ctx.editor.vectorize({ kind: 'plan', levelId } as SheetViewSource)
    c.drawing(d, null, (s) => c.styleLayer(s), null, c.styleLayer('fill'), c.styleLayer('text'))
  } else {
    await ctx.geometry.idle()
    const base = level ? invertMatrix(doc.getWorldMatrix(level.id)) : null
    const visit = (id: string, pre: Float64Array | null, depth: number) => {
      if (depth > 48) return
      const n = doc.getNode(id) as AnyNode | undefined
      if (!n || !n.visible) return
      if (!pre && !doc.isEffectivelyVisible(id)) return
      const world = pre ? multiplyMatrices(pre, doc.getWorldMatrix(id)) : doc.getWorldMatrix(id)
      const m = base ? multiplyMatrices(base, world) : world
      const t = affOf(m)
      if (n.type === 'instance') {
        const def = doc.getComponent(n.params.component)
        if (def && doc.hasNode(def.root)) visit(def.root, multiplyMatrices(world, invertMatrix(doc.getWorldMatrix(def.root))), depth + 1)
        return
      }
      if (DRAFTING.has(n.type)) c.drafting(n, t)
      else if (n.type === 'text' && n.params.depth === 0) {
        const p = n.params
        c.items.push({ kind: 'text', layer: c.layerFor(n.layer), color: n.color, text: p.text, p: ap(t, [0, 0]), size: p.size * scaleOf(t), rotation: rotOf(t), align: p.align, baseline: 'bottom' })
      } else if (!ctx.geometry.isConsumed(id)) {
        const r = ctx.geometry.get(id)
        const layer = c.layerFor(n.layer)
        const d = r?.plan ?? r?.drawing
        if (d) c.drawing(d, t, () => layer, n.color, layer, layer)
        else if (r?.edges?.length && n.type !== 'level' && n.type !== 'group') {
          const e = r.edges
          const seg: number[] = []
          for (let i = 0; i + 5 < e.length; i += 6) {
            const a = [m[0]! * e[i]! + m[4]! * e[i + 1]! + m[8]! * e[i + 2]! + m[12]!, m[1]! * e[i]! + m[5]! * e[i + 1]! + m[9]! * e[i + 2]! + m[13]!]
            const b = [m[0]! * e[i + 3]! + m[4]! * e[i + 4]! + m[8]! * e[i + 5]! + m[12]!, m[1]! * e[i + 3]! + m[5]! * e[i + 4]! + m[9]! * e[i + 5]! + m[13]!]
            if (Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!) > 1e-9) seg.push(a[0]!, a[1]!, b[0]!, b[1]!)
          }
          for (const pl of chainSegments(seg, null)) c.items.push({ kind: 'poly', layer, color: n.color, points: pl.points, closed: pl.closed, weight: 0.18 })
        }
      }
      for (const ch of doc.getChildren(id)) visit(ch, pre, depth + 1)
    }
    const roots = opts.selection?.length ? doc.topLevel(opts.selection) : level ? [...doc.getChildren(level.id)] : [...doc.getChildren(null)]
    for (const r of roots) visit(r, null, 0)
  }
  return { title, layers: c.layers, items: c.items, bounds: sceneBounds(c.items), unit: doc.meta.units.length, scale, northAngle: doc.meta.geo?.northAngle ?? 0 }
}

/** Colors that disappear on white paper (the UI uses light layer colors on dark) print black. */
export function paperColor(hex: string | null | undefined): string {
  const h = (hex ?? '#000000').replace('#', '')
  const r = parseInt(h.slice(0, 2), 16) / 255,
    g = parseInt(h.slice(2, 4), 16) / 255,
    b = parseInt(h.slice(4, 6), 16) / 255
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return lum > 0.72 ? '#000000' : `#${h.slice(0, 6)}`
}
