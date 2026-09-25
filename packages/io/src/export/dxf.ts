// DXF export (AutoCAD R2018 via @tarikjabiri/dxf): layers with ACI + true colors, lineweights and
// linetypes; LWPOLYLINEs with bulges, circles, arcs, ellipses, Bézier splines, TEXT/MTEXT, HATCH with
// embedded pattern definitions, and true DIMENSION entities referencing anonymous *D blocks that
// hold their exploded graphics (so every viewer shows them). Units via $INSUNITS.
import type { Dxfier, DxfWriter } from '@tarikjabiri/dxf'
import type { LineType, PathPoint, Vec2 } from '@cadsandbox/doc'
import { METERS_PER_UNIT } from '@cadsandbox/shared'
import type { LengthUnit } from '@cadsandbox/shared'
import type { ExportContext, ExportOptions, ExportResult } from '../api'
import { INSUNITS } from '../import/units'
import { blobOf, safeFileName } from '../util/bytes'
import { PATTERN_UNIT_M, patternDef, transformFamily } from './hatch-patterns'
import { collectPlan, type VItem, type VectorScene } from './vector'

type DxfModule = typeof import('@tarikjabiri/dxf')

const LINEWEIGHTS = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211]
const snapWeight = (mm: number) => LINEWEIGHTS.reduce((b, w) => (Math.abs(w - mm * 100) < Math.abs(b - mm * 100) ? w : b), 25)

/** Linetypes (paper mm at 1:1, scaled by the plan scale). */
const LTYPES: Record<Exclude<LineType, 'continuous'>, { name: string; desc: string; el: number[] }> = {
  dashed: { name: 'DASHED', desc: 'Dashed __ __ __', el: [6, -3] },
  hidden: { name: 'HIDDEN', desc: 'Hidden _ _ _', el: [3, -1.5] },
  center: { name: 'CENTER', desc: 'Center ____ _ ____', el: [12, -3, 3, -3] },
  dotted: { name: 'DOT', desc: 'Dot . . . .', el: [0, -2] },
  dashdot: { name: 'DASHDOT', desc: 'Dash dot __ . __', el: [6, -2, 0, -2] },
}

const hexInt = (hex: string) => parseInt(hex.replace('#', '').slice(0, 6), 16)

/** Insert group 370 (lineweight) after the entity's layer (8) group when it is written. */
function withLineweight<T extends { dxfy(dx: Dxfier): void }>(e: T, weight: number | null | undefined): T {
  if (weight === null || weight === undefined) return e
  const orig = e.dxfy.bind(e)
  e.dxfy = (dx: Dxfier) => {
    const start = dx.lines.length
    orig(dx)
    for (let i = start; i < dx.lines.length; i += 2) {
      if (dx.lines[i] === 8) {
        dx.lines.splice(i + 2, 0, 370, snapWeight(weight))
        break
      }
    }
  }
  return e
}

function aciTable(D: DxfModule): [number, number, number][] {
  const out: [number, number, number][] = []
  for (let i = 1; i < 256; i++) {
    const h = D.aciHex(i)
    out[i] = h ? [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)] : [0, 0, 0]
  }
  return out
}
function nearestAci(table: [number, number, number][], hex: string): number {
  const v = hexInt(hex)
  const r = (v >> 16) & 255,
    g = (v >> 8) & 255,
    b = v & 255
  if (r === g && g === b && (r > 240 || r < 16)) return 7 // white/black follow the background
  let best = 7,
    bd = Infinity
  for (let i = 1; i < 256; i++) {
    const c = table[i]!
    const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2
    if (d < bd) (bd = d), (best = i)
  }
  return best
}

const cleanName = (s: string) => s.replace(/[<>/\\":;?*|=`,]/g, '_').trim() || 'Layer'

export async function writeDxf(scene: VectorScene, unit: LengthUnit): Promise<string> {
  const D = await import('@tarikjabiri/dxf')
  const w: DxfWriter = new D.DxfWriter()
  const f = 1 / METERS_PER_UNIT[unit]
  // round to 0.1 µm first: plan geometry arrives as float32 (e.g. 0.15000000596 m)
  const q = (v: number) => (Math.round(v * 1e7) / 1e7) * f
  const P = (p: Vec2) => D.point3d(q(p[0]), q(p[1]), 0)
  w.setUnits(INSUNITS[unit] as number)
  w.setVariable('$ACADVER', { 1: 'AC1032' }) // AutoCAD 2018 (UTF-8 strings)
  w.setVariable('$MEASUREMENT', { 70: unit === 'in' || unit === 'ft' ? 0 : 1 })
  w.setVariable('$LWDISPLAY', { 290: 1 })
  w.setVariable('$LTSCALE', { 40: 1 })
  const aci = aciTable(D)
  const paperToUnits = (scene.scale / 1000) * f // paper mm → drawing units
  const ltName: Partial<Record<LineType, string>> = {}
  for (const [k, lt] of Object.entries(LTYPES)) {
    w.addLType(lt.name, lt.desc, lt.el.map((e) => e * paperToUnits))
    ltName[k as LineType] = lt.name
  }

  // layers (true color + ACI, linetype, lineweight)
  const layerNames = new Map<string, string>()
  for (const l of scene.layers.values()) {
    const name = cleanName(l.name)
    layerNames.set(l.name, name)
    const lt = l.lineType === 'continuous' ? 'Continuous' : (ltName[l.lineType] ?? 'Continuous')
    const rec = w.layer(name) ?? w.addLayer(name, nearestAci(aci, l.color), lt)
    rec.colorNumber = nearestAci(aci, l.color)
    rec.trueColor = hexInt(l.color)
    const weight = snapWeight(l.lineWeight)
    const orig = rec.dxfy.bind(rec)
    rec.dxfy = (dx: Dxfier) => {
      const start = dx.lines.length
      orig(dx)
      for (let i = start; i < dx.lines.length; i += 2) if (dx.lines[i] === 370) dx.lines[i + 1] = weight
      if (!l.printable) dx.push(290, 0)
    }
  }

  const opts = (it: VItem) => {
    const o: { layerName: string; colorNumber?: number; trueColor?: string; lineType?: string } = { layerName: layerNames.get(it.layer) ?? '0' }
    if (it.color) {
      o.colorNumber = nearestAci(aci, it.color)
      o.trueColor = String(hexInt(it.color))
    }
    if (it.lineType && it.lineType !== 'continuous') o.lineType = ltName[it.lineType]
    return o
  }

  let dimSeq = 0
  const text = (target: DxfWriter['modelSpace'], p: Vec2, size: number, value: string, rotation: number, align: 'left' | 'center' | 'right', baseline: 'top' | 'middle' | 'bottom', o: ReturnType<typeof opts>) => {
    if (value.includes('\n')) {
      const attach = (baseline === 'top' ? 0 : baseline === 'middle' ? 3 : 6) + (align === 'left' ? 1 : align === 'center' ? 2 : 3)
      const m = target.addMText(P(p), size * f, value.replace(/\n/g, '\\P'), { ...o, rotation: (rotation * 180) / Math.PI, attachmentPoint: attach })
      return m
    }
    const h = align === 'left' ? D.TextHorizontalAlignment.Left : align === 'center' ? D.TextHorizontalAlignment.Center : D.TextHorizontalAlignment.Right
    const v = baseline === 'top' ? D.TextVerticalAlignment.Top : baseline === 'middle' ? D.TextVerticalAlignment.Middle : D.TextVerticalAlignment.BaseLine
    const aligned = h !== D.TextHorizontalAlignment.Left || v !== D.TextVerticalAlignment.BaseLine
    return target.addText(P(p), size * f, value, { ...o, rotation: (rotation * 180) / Math.PI, horizontalAlignment: h, verticalAlignment: v, ...(aligned ? { secondAlignmentPoint: P(p) } : {}) })
  }

  for (const it of scene.items) {
    const o = opts(it)
    switch (it.kind) {
      case 'poly': {
        if (it.points.length === 2 && !it.closed && !it.bulges?.[0]) withLineweight(w.addLine(P(it.points[0]!), P(it.points[1]!), o), it.weight)
        else
          withLineweight(
            w.addLWPolyline(
              it.points.map((p, i) => ({ point: D.point2d(q(p[0]), q(p[1])), bulge: it.bulges?.[i] ?? 0 })),
              { ...o, flags: it.closed ? D.LWPolylineFlags.Closed : D.LWPolylineFlags.None },
            ),
            it.weight,
          )
        break
      }
      case 'circle':
        withLineweight(w.addCircle(P(it.c), it.r * f, o), it.weight)
        break
      case 'arc':
        withLineweight(w.addArc(P(it.c), it.r * f, (it.start * 180) / Math.PI, (it.end * 180) / Math.PI, o), it.weight)
        break
      case 'ellipse': {
        const major = it.rx >= it.ry
        const r = major ? it.rx : it.ry
        const a = it.rotation + (major ? 0 : Math.PI / 2)
        withLineweight(w.addEllipse(P(it.c), D.point3d(Math.cos(a) * r * f, Math.sin(a) * r * f, 0), Math.min(it.rx, it.ry) / Math.max(it.rx, it.ry), 0, Math.PI * 2, o), it.weight)
        break
      }
      case 'path':
        for (const c of it.contours) {
          const ctrl = bezierControl(c.points, c.closed)
          if (ctrl.length < 4) continue
          const segs = (ctrl.length - 1) / 3
          const knots = [0, 0, 0, 0]
          for (let s = 1; s < segs; s++) knots.push(s, s, s)
          knots.push(segs, segs, segs, segs)
          withLineweight(w.addSpline({ controlPoints: ctrl.map((p) => P(p)), degreeCurve: 3, knots, flags: D.SplineFlags.Planar }, o), it.weight)
        }
        break
      case 'text':
        text(w.modelSpace, it.p, it.size, it.text, it.rotation, it.align, it.baseline, o)
        break
      case 'hatch': {
        const solid = it.pattern === 'solid'
        const def = patternDef(it.pattern)
        if (!solid && !def) break
        const ho = { ...o }
        if (it.fill && solid) {
          ho.colorNumber = nearestAci(aci, it.fill)
          ho.trueColor = String(hexInt(it.fill))
        }
        const h = PatternHatch(D, [it.outer, ...it.holes].map((ring) => ring.map((p) => [q(p[0]), q(p[1])] as Vec2)), solid ? null : { name: def!.dxf, families: def!.families }, it.scale * PATTERN_UNIT_M * f, it.angle, ho)
        w.modelSpace.addEntity(h)
        break
      }
      case 'dim': {
        const g = it.geom
        const name = `*D${++dimSeq}`
        const blk = w.document.blocks.addBlock(name, w.document.objects, false)
        blk.flags = D.BlockFlags.AnonymousBlock
        const bo = { ...o }
        for (const [a, b] of [...g.lines, ...g.ticks]) blk.addLine(P(a), P(b), bo)
        if (g.arc) {
          const a0 = (g.arc.start * 180) / Math.PI
          blk.addArc(P(g.arc.c), g.arc.r * f, a0, a0 + (g.arc.sweep * 180) / Math.PI, bo)
        }
        text(blk, g.textPos, g.textSize, g.text, g.textAngle, 'center', 'bottom', bo)
        const common = { ...o, blockName: name, middlePoint: P(g.textPos), text: g.text }
        let dim: object | null = null
        if (g.kind === 'aligned' || g.kind === 'arc-length') dim = w.modelSpace.addAlignedDim(P(g.p1), P(g.p2), { ...common, definitionPoint: P(g.d2) })
        else if (g.kind === 'linear') dim = w.modelSpace.addLinearDim(P(g.p1), P(g.p2), { ...common, definitionPoint: P(g.d2), angle: (g.angle * 180) / Math.PI })
        else if (g.kind === 'radius') dim = w.modelSpace.addRadialDim(P(g.p2), P(g.center ?? g.p1), common)
        else if (g.kind === 'diameter') dim = w.modelSpace.addDiameterDim(P(g.p2), P(g.p1), common)
        else if (g.kind === 'angular' && g.center && g.arc) {
          const mid = g.arc.start + g.arc.sweep / 2
          dim = w.modelSpace.addAngularPointsDim(P(g.center), P(g.p1), P(g.p2), { ...common, definitionPoint: P([g.center[0] + g.arc.r * Math.cos(mid), g.center[1] + g.arc.r * Math.sin(mid)]) })
        }
        // bit 32: the block is referenced by this dimension only
        const typed = dim as { dimensionType?: number } | null
        if (typed && typeof typed.dimensionType === 'number') typed.dimensionType |= 32
        break
      }
    }
  }
  if (scene.bounds) {
    w.setVariable('$EXTMIN', { 10: scene.bounds.min[0] * f, 20: scene.bounds.min[1] * f, 30: 0 })
    w.setVariable('$EXTMAX', { 10: scene.bounds.max[0] * f, 20: scene.bounds.max[1] * f, 30: 0 })
  }
  return w.stringify()
}

/** Cubic Bézier control polygon of a path contour (straight segments get 1/3–2/3 handles). */
function bezierControl(points: PathPoint[], closed: boolean): Vec2[] {
  const out: Vec2[] = []
  const n = points.length
  if (n < 2) return out
  const segs = closed ? n : n - 1
  out.push(points[0]!.p)
  for (let i = 0; i < segs; i++) {
    const a = points[i]!,
      b = points[(i + 1) % n]!
    const h1: Vec2 = a.ho ?? [a.p[0] + (b.p[0] - a.p[0]) / 3, a.p[1] + (b.p[1] - a.p[1]) / 3]
    const h2: Vec2 = b.hi ?? [a.p[0] + ((b.p[0] - a.p[0]) * 2) / 3, a.p[1] + ((b.p[1] - a.p[1]) * 2) / 3]
    out.push(h1, h2, b.p)
  }
  return out
}

/** HATCH with polyline loops (holes as odd-parity islands) and correctly transformed pattern lines. */
function PatternHatchClass(D: DxfModule) {
  return class extends D.Hatch {
    constructor(
      private readonly loops: Vec2[][],
      private readonly pat: { name: string; families: import('./hatch-patterns').PatFamily[] } | null,
      private readonly patScale: number,
      private readonly patAngle: number,
      options: Record<string, unknown>,
    ) {
      super(new D.HatchBoundaryPaths(), { name: D.HatchPredefinedPatterns.SOLID }, options)
    }
    protected override dxfyChild(dx: Dxfier): void {
      dx.point3d(D.point3d(0, 0, 0))
      dx.push(210, 0)
      dx.push(220, 0)
      dx.push(230, 1)
      dx.name(this.pat ? this.pat.name : 'SOLID')
      dx.push(70, this.pat ? 0 : 1)
      dx.push(71, 0)
      dx.push(91, this.loops.length)
      this.loops.forEach((ring, i) => {
        dx.push(92, i === 0 ? 1 | 2 | 16 : 2)
        dx.push(72, 0)
        dx.push(73, 1)
        dx.push(93, ring.length)
        for (const p of ring) {
          dx.push(10, p[0])
          dx.push(20, p[1])
        }
        dx.push(97, 0)
      })
      dx.push(75, 0)
      dx.push(76, 1)
      if (this.pat) {
        dx.push(52, (this.patAngle * 180) / Math.PI)
        dx.push(41, this.patScale)
        dx.push(77, 0)
        dx.push(78, this.pat.families.length)
        for (const fam of this.pat.families) {
          const t = transformFamily(fam, this.patScale, this.patAngle)
          dx.push(53, (t.angle * 180) / Math.PI)
          dx.push(43, t.base[0])
          dx.push(44, t.base[1])
          dx.push(45, t.offset[0])
          dx.push(46, t.offset[1])
          dx.push(79, t.dashes.length)
          for (const d of t.dashes) dx.push(49, d)
        }
      }
      dx.push(98, 0)
    }
  }
}
let HatchCtor: ReturnType<typeof PatternHatchClass> | null = null
function PatternHatch(D: DxfModule, loops: Vec2[][], pat: { name: string; families: import('./hatch-patterns').PatFamily[] } | null, scale: number, angle: number, options: Record<string, unknown>) {
  HatchCtor ??= PatternHatchClass(D)
  return new HatchCtor(loops, pat, scale, angle, options)
}

export async function exportDxf(ctx: ExportContext, opts: ExportOptions): Promise<ExportResult> {
  const levelId = opts.levelId === undefined ? (ctx.doc.meta.activeLevel ?? ctx.doc.levels()[0]?.id ?? null) : opts.levelId
  const scene = await collectPlan(ctx, { levelId, selection: opts.selection, scale: opts.scale })
  const text = await writeDxf(scene, opts.units ?? ctx.doc.meta.units.length)
  const name = safeFileName(levelId ? `${ctx.doc.meta.name} - ${scene.title}` : ctx.doc.meta.name, 'plan')
  return { blob: blobOf([text], 'image/vnd.dxf'), fileName: `${name}.dxf` }
}
