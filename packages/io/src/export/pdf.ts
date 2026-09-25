// PDF export (jsPDF): layout sheets (SheetDef) with frame, German title block (Schriftfeld incl.
// Leistungsphase), vector or raster viewports, scale bars and north arrows — and a quick scaled plan.
import type { jsPDF as JsPdf } from 'jspdf'
import type { PaperSize, PathPoint, SheetDef, SheetViewport, Vec2 } from '@cadsandbox/doc'
import type { ExportContext, ExportOptions, ExportResult } from '../api'
import { blobOf, safeFileName } from '../util/bytes'
import { ellipseArcPath, bulgeArc } from '../util/geom2d'
import { PATTERN_UNIT_M, hatchSegments, patternDef } from './hatch-patterns'
import { getSchedules, scheduleTable, type ScheduleKind, type Table } from './schedules'
import { STYLE_LAYERS, chainSegments, collectPlan, paperColor, type VItem, type VectorScene } from './vector'

export const PAPER_MM: Record<PaperSize, [number, number]> = {
  A4: [297, 210],
  A3: [420, 297],
  A2: [594, 420],
  A1: [841, 594],
  A0: [1189, 841],
  Letter: [279.4, 215.9],
  Tabloid: [431.8, 279.4],
}
const PT_PER_MM = 72 / 25.4
const DASH: Record<string, number[]> = { dashed: [3, 1.5], hidden: [1.5, 1], center: [8, 1.5, 1.5, 1.5], dotted: [0.1, 1], dashdot: [4, 1.5, 0.1, 1.5] }
const MARGIN = { left: 20, top: 10, right: 10, bottom: 10 } // DIN 824: 20 mm filing edge
const TITLE_W = 180,
  TITLE_H = 58

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Draws a VectorScene into a paper rectangle at 1:scale, centered on the scene bounds (or `center`). */
class Painter {
  private readonly k: number
  private readonly cx: number
  private readonly cy: number
  constructor(
    private readonly pdf: JsPdf,
    private readonly scene: VectorScene,
    private readonly rect: Rect,
    scale: number,
  ) {
    this.k = 1000 / scale
    const b = scene.bounds ?? { min: [0, 0], max: [0, 0] }
    this.cx = (b.min[0] + b.max[0]) / 2
    this.cy = (b.min[1] + b.max[1]) / 2
  }
  X = (x: number) => this.rect.x + this.rect.w / 2 + (x - this.cx) * this.k
  Y = (y: number) => this.rect.y + this.rect.h / 2 - (y - this.cy) * this.k

  private style(it: VItem): void {
    const l = this.scene.layers.get(it.layer)
    this.pdf.setDrawColor(paperColor(it.color ?? l?.color))
    this.pdf.setLineWidth(Math.max(0.05, it.weight ?? l?.lineWeight ?? 0.25))
    const lt = it.lineType ?? l?.lineType ?? 'continuous'
    this.pdf.setLineDashPattern(lt === 'continuous' ? [] : (DASH[lt] ?? []), 0)
  }
  private bez(points: PathPoint[], closed: boolean, move = true): void {
    const p = this.pdf
    if (!points.length) return
    if (move) p.moveTo(this.X(points[0]!.p[0]), this.Y(points[0]!.p[1]))
    const segs = closed ? points.length : points.length - 1
    for (let i = 0; i < segs; i++) {
      const a = points[i]!,
        b = points[(i + 1) % points.length]!
      if (!a.ho && !b.hi) p.lineTo(this.X(b.p[0]), this.Y(b.p[1]))
      else {
        const c1 = a.ho ?? a.p,
          c2 = b.hi ?? b.p
        p.curveTo(this.X(c1[0]), this.Y(c1[1]), this.X(c2[0]), this.Y(c2[1]), this.X(b.p[0]), this.Y(b.p[1]))
      }
    }
  }
  private arc(c: Vec2, r: number, start: number, sweep: number, move: boolean): void {
    const pts = sweep >= 0 ? ellipseArcPath(c[0], c[1], r, r, 0, start, start + sweep) : ellipseArcPath(c[0], c[1], r, r, 0, start + sweep, start).reverse().map((q) => ({ p: q.p, ...(q.ho ? { hi: q.ho } : {}), ...(q.hi ? { ho: q.hi } : {}) }))
    this.bez(pts, false, move)
  }
  private ring(points: Vec2[], bulges: number[] | undefined, closed: boolean): void {
    const p = this.pdf
    p.moveTo(this.X(points[0]![0]), this.Y(points[0]![1]))
    const segs = closed ? points.length : points.length - 1
    for (let i = 0; i < segs; i++) {
      const a = points[i]!,
        b = points[(i + 1) % points.length]!
      const arc = bulges?.[i] ? bulgeArc(a, b, bulges[i]!) : null
      if (arc) this.arc(arc.c, arc.r, arc.start, arc.sweep, false)
      else p.lineTo(this.X(b[0]), this.Y(b[1]))
    }
    if (closed) p.close()
  }
  /** Text with alignment/baseline resolved here (jsPDF ignores `align` for rotated text). */
  private text(p: Vec2, size: number, text: string, rotation: number, align: 'left' | 'center' | 'right', baseline: 'top' | 'middle' | 'bottom', color: string): void {
    const cap = size * this.k // cap height, paper mm
    const pt = (cap / 0.72) * PT_PER_MM
    if (pt < 1) return
    this.pdf.setTextColor(color)
    this.pdf.setFontSize(pt)
    const lines = text.split('\n')
    const lead = (cap / 0.72) * 1.2
    // paper axes: text direction (cos a, −sin a), "down the page of the text" (sin a, cos a)
    const c = Math.cos(rotation),
      s = Math.sin(rotation)
    const block = lead * (lines.length - 1)
    const drop = baseline === 'top' ? cap : baseline === 'middle' ? cap / 2 - block / 2 : -block
    lines.forEach((line, i) => {
      const w = this.pdf.getTextWidth(line)
      const along = align === 'center' ? -w / 2 : align === 'right' ? -w : 0
      const down = drop + i * lead
      this.pdf.text(line, this.X(p[0]) + along * c + down * s, this.Y(p[1]) - along * s + down * c, { angle: (rotation * 180) / Math.PI, baseline: 'alphabetic' })
    })
  }

  draw(): void {
    const p = this.pdf
    p.saveGraphicsState()
    p.rect(this.rect.x, this.rect.y, this.rect.w, this.rect.h, null)
    p.clip()
    p.discardPath()
    p.setLineCap('round')
    p.setLineJoin('round')
    // hatches first, then linework, then text on top
    for (const it of this.scene.items) {
      if (it.kind !== 'hatch' || !this.scene.layers.get(it.layer)?.printable) continue
      if (it.pattern === 'solid') {
        p.setFillColor(paperColor(it.fill ?? it.color ?? this.scene.layers.get(it.layer)?.color))
        for (const r of [it.outer, ...it.holes]) this.ring(r, undefined, true)
        p.fillEvenOdd()
        continue
      }
      const def = patternDef(it.pattern)
      if (!def) continue
      p.setDrawColor(paperColor(it.fill ?? it.color ?? this.scene.layers.get(it.layer)?.color))
      p.setLineWidth(0.1)
      p.setLineDashPattern([], 0)
      for (const [a, b] of hatchSegments(it.outer, it.holes, def, it.scale * PATTERN_UNIT_M, it.angle, 0.15 / this.k)) p.line(this.X(a[0]), this.Y(a[1]), this.X(b[0]), this.Y(b[1]))
    }
    for (const it of this.scene.items) {
      if (it.kind === 'hatch' || it.kind === 'text' || !this.scene.layers.get(it.layer)?.printable) continue
      this.style(it)
      switch (it.kind) {
        case 'poly':
          this.ring(it.points, it.bulges, it.closed)
          p.stroke()
          break
        case 'circle':
          p.circle(this.X(it.c[0]), this.Y(it.c[1]), it.r * this.k, 'S')
          break
        case 'arc': {
          let sweep = it.end - it.start
          while (sweep <= 0) sweep += Math.PI * 2
          this.arc(it.c, it.r, it.start, sweep, true)
          p.stroke()
          break
        }
        case 'ellipse':
          this.bez(ellipseArcPath(it.c[0], it.c[1], it.rx, it.ry, it.rotation, 0, Math.PI * 2), true)
          p.stroke()
          break
        case 'path':
          for (const c of it.contours) this.bez(c.points, c.closed)
          p.stroke()
          break
        case 'dim': {
          const g = it.geom
          for (const [a, b] of [...g.lines, ...g.ticks]) p.line(this.X(a[0]), this.Y(a[1]), this.X(b[0]), this.Y(b[1]))
          if (g.arc) {
            this.arc(g.arc.c, g.arc.r, g.arc.start, g.arc.sweep, true)
            p.stroke()
          }
          this.text(g.textPos, g.textSize, g.text, g.textAngle, 'center', 'bottom', paperColor(it.color ?? this.scene.layers.get(it.layer)?.color))
          break
        }
      }
    }
    for (const it of this.scene.items) {
      if (it.kind !== 'text' || !this.scene.layers.get(it.layer)?.printable) continue
      this.text(it.p, it.size, it.text, it.rotation, it.align, it.baseline, paperColor(it.color ?? this.scene.layers.get(it.layer)?.color))
    }
    p.restoreGraphicsState()
    p.setLineDashPattern([], 0)
  }
}

// ------------------------------------------------------------------ sheet furniture
function label(pdf: JsPdf, x: number, y: number, w: number, caption: string, value: string, bold = false): void {
  pdf.setTextColor('#6b7280')
  pdf.setFontSize(5.5)
  pdf.text(caption, x + 1.5, y + 2.8)
  pdf.setTextColor('#000000')
  pdf.setFont('helvetica', bold ? 'bold' : 'normal')
  pdf.setFontSize(bold ? 10 : 8)
  const v = pdf.splitTextToSize(value || '–', w - 3) as string[]
  pdf.text(v.slice(0, 2), x + 1.5, y + 6.6)
  pdf.setFont('helvetica', 'normal')
}

/** German architectural title block (Schriftfeld), bottom-right. */
export function titleBlock(pdf: JsPdf, sheet: Pick<SheetDef, 'name' | 'number' | 'titleBlock'>, scaleText: string, x: number, y: number): void {
  const t = sheet.titleBlock
  pdf.setDrawColor('#000000')
  pdf.setLineDashPattern([], 0)
  pdf.setLineWidth(0.5)
  pdf.rect(x, y, TITLE_W, TITLE_H)
  pdf.setLineWidth(0.18)
  const rows = [10, 9, 9, 10, 10, 10]
  let yy = y
  const cells: [number, string, string, boolean?][][] = [
    [[180, 'Büro / Company', t.company, true]],
    [[180, 'Projekt / Project', t.project]],
    [
      [90, 'Bauherr / Client', t.client],
      [90, 'Adresse / Address', t.address],
    ],
    [[180, 'Planinhalt / Drawing', sheet.name, true]],
    [
      [80, 'Leistungsphase / Phase', t.phase],
      [50, 'Maßstab / Scale', scaleText],
      [50, 'Plan-Nr. / Sheet no.', sheet.number, true],
    ],
    [
      [45, 'Gezeichnet / Drawn', t.drawnBy],
      [45, 'Geprüft / Checked', t.checkedBy],
      [45, 'Datum / Date', t.date],
      [45, 'Index / Revision', t.revision],
    ],
  ]
  cells.forEach((row, r) => {
    let xx = x
    row.forEach(([w, cap, val, bold], i) => {
      if (i > 0) pdf.line(xx, yy, xx, yy + rows[r]!)
      label(pdf, xx, yy, w, cap, val, bold)
      xx += w
    })
    yy += rows[r]!
    if (r < rows.length - 1) pdf.line(x, yy, x + TITLE_W, yy)
  })
}

/** Scale bar with alternating blocks (left end at x, baseline y). */
export function scaleBar(pdf: JsPdf, x: number, y: number, scale: number, maxMm = 50): void {
  const mPerMm = scale / 1000
  const nice = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]
  const len = nice.filter((v) => v / mPerMm <= maxMm).pop() ?? 0.5
  const w = len / mPerMm
  pdf.setLineDashPattern([], 0)
  pdf.setLineWidth(0.18)
  pdf.setDrawColor('#000000')
  for (let i = 0; i < 4; i++) {
    pdf.setFillColor(i % 2 ? '#ffffff' : '#000000')
    pdf.rect(x + (w / 4) * i, y - 1.5, w / 4, 1.5, 'FD')
  }
  pdf.setTextColor('#000000')
  pdf.setFontSize(6)
  pdf.text('0', x, y + 3, { align: 'center' })
  pdf.text(`${len / 2}`, x + w / 2, y + 3, { align: 'center' })
  pdf.text(`${len} m`, x + w, y + 3, { align: 'center' })
}

/** North arrow; northAngle = angle from plan +Y to true north (CCW, radians). */
export function northArrow(pdf: JsPdf, cx: number, cy: number, northAngle: number, r = 6): void {
  const dx = -Math.sin(northAngle),
    dy = -Math.cos(northAngle) // paper y is down
  const px = -dy,
    py = dx
  pdf.setDrawColor('#000000')
  pdf.setLineDashPattern([], 0)
  pdf.setLineWidth(0.25)
  pdf.circle(cx, cy, r, 'S')
  pdf.setFillColor('#000000')
  pdf.triangle(cx + dx * r, cy + dy * r, cx - dx * r * 0.6 + px * r * 0.45, cy - dy * r * 0.6 + py * r * 0.45, cx - dx * r * 0.3, cy - dy * r * 0.3, 'F')
  pdf.triangle(cx + dx * r, cy + dy * r, cx - dx * r * 0.6 - px * r * 0.45, cy - dy * r * 0.6 - py * r * 0.45, cx - dx * r * 0.3, cy - dy * r * 0.3, 'S')
  pdf.setTextColor('#000000')
  pdf.setFontSize(7)
  pdf.text('N', cx + dx * (r + 3), cy + dy * (r + 3), { align: 'center', baseline: 'middle' })
}

function drawTable(pdf: JsPdf, t: Table, rect: Rect): void {
  const fs = 7
  const rowH = 4.5
  const colW = t.headers.map((h, i) => Math.max(h.length, ...t.rows.slice(0, 200).map((r) => (typeof r[i] === 'number' ? (r[i] as number).toFixed(t.decimals[i] ?? 2) : String(r[i])).length)))
  const total = colW.reduce((s, w) => s + w, 0) || 1
  const widths = colW.map((w) => (w / total) * rect.w)
  pdf.setFontSize(fs)
  pdf.setLineWidth(0.1)
  pdf.setDrawColor('#000000')
  pdf.setLineDashPattern([], 0)
  const maxRows = Math.max(0, Math.floor(rect.h / rowH) - 1)
  const rows = t.rows.slice(0, maxRows)
  const draw = (cells: (string | number)[], y: number, bold: boolean) => {
    let x = rect.x
    pdf.setFont('helvetica', bold ? 'bold' : 'normal')
    cells.forEach((c, i) => {
      const s = typeof c === 'number' ? c.toFixed(t.decimals[i] ?? 2) : String(c)
      const num = typeof c === 'number'
      pdf.text(s, num ? x + widths[i]! - 1 : x + 1, y + rowH - 1.3, { align: num ? 'right' : 'left', maxWidth: widths[i]! - 2 })
      x += widths[i]!
    })
    pdf.line(rect.x, y + rowH, rect.x + rect.w, y + rowH)
  }
  pdf.setTextColor('#000000')
  draw(t.headers, rect.y, true)
  rows.forEach((r, i) => draw(r, rect.y + rowH * (i + 1), false))
  pdf.setFont('helvetica', 'normal')
  if (t.rows.length > rows.length) pdf.text(`… ${t.rows.length - rows.length} more`, rect.x + 1, rect.y + rowH * (rows.length + 1) + 3)
}

function viewportTitle(ctx: ExportContext, vp: SheetViewport): string {
  if (vp.title) return vp.title
  const s = vp.source
  switch (s.kind) {
    case 'plan':
      return `Grundriss ${ctx.doc.getNode(s.levelId)?.name ?? ''}`.trim()
    case 'ceiling-plan':
      return `Deckenspiegel ${ctx.doc.getNode(s.levelId)?.name ?? ''}`.trim()
    case 'section':
      return `Schnitt ${(ctx.doc.getNode(s.sectionId)?.params as { label?: string } | undefined)?.label ?? ''}`.trim()
    case 'elevation':
      return `Ansicht ${{ north: 'Nord', south: 'Süd', east: 'Ost', west: 'West' }[s.direction]}`
    case 'view':
      return ctx.doc.listViews().find((v) => v.id === s.viewId)?.name ?? 'View'
    case 'schedule':
      return scheduleTableTitle(s.schedule)
  }
}
const scheduleTableTitle = (k: string) => ({ rooms: 'Raumliste', doors: 'Türliste', windows: 'Fensterliste', areas: 'Flächen DIN 277', materials: 'Materialliste' })[k] ?? k

async function drawViewport(pdf: JsPdf, ctx: ExportContext, vp: SheetViewport): Promise<void> {
  const rect: Rect = { x: vp.x, y: vp.y, w: vp.w, h: vp.h }
  const src = vp.source
  if (src.kind === 'schedule') {
    if (src.schedule === 'materials') {
      const used = new Map<string, number>()
      for (const n of ctx.doc.allNodes()) if (n.material) used.set(n.material, (used.get(n.material) ?? 0) + 1)
      drawTable(pdf, { title: 'Materials', headers: ['Material', 'Category', 'Elements'], rows: [...used].map(([id, c]) => [ctx.doc.getMaterial(id)?.name ?? id, ctx.doc.getMaterial(id)?.category ?? '', c]), decimals: [0, 0, 0] }, rect)
    } else drawTable(pdf, scheduleTable(await getSchedules(ctx), src.schedule as ScheduleKind), rect)
  } else if ((vp.style === 'shaded' || vp.style === 'realistic') && ctx.editor) {
    const dpi = 200
    const w = Math.min(4096, Math.round((vp.w / 25.4) * dpi)),
      h = Math.min(4096, Math.round((vp.h / 25.4) * dpi))
    const blob = await ctx.editor.renderView(src, { width: w, height: h, style: vp.style })
    pdf.addImage(new Uint8Array(await blob.arrayBuffer()), 'PNG', vp.x, vp.y, vp.w, vp.h)
  } else {
    let scene: VectorScene | null = null
    if (ctx.editor) {
      const d = await ctx.editor.vectorize(src)
      const layers = new Map(Object.values(STYLE_LAYERS).map((l) => [l.name, l]))
      const items: VItem[] = []
      for (const lines of d.lines) for (const pl of chainSegments(lines.segments, null)) items.push({ kind: 'poly', layer: (STYLE_LAYERS[lines.style] ?? STYLE_LAYERS.visible).name, points: pl.points, closed: pl.closed })
      for (const f of d.fills) for (const poly of f.polygons) items.push({ kind: 'hatch', layer: STYLE_LAYERS.fill.name, outer: poly.outer, holes: poly.holes, pattern: f.pattern, scale: f.scale ?? 1, angle: f.angle ?? 0, fill: f.color ?? null })
      for (const t of d.texts) items.push({ kind: 'text', layer: STYLE_LAYERS.text.name, text: t.text, p: t.position, size: t.size, rotation: t.rotation, align: t.align, baseline: t.baseline })
      scene = { title: '', layers, items, bounds: d.bounds, unit: ctx.doc.meta.units.length, scale: vp.scale, northAngle: ctx.doc.meta.geo?.northAngle ?? 0 }
    } else if (src.kind === 'plan' || src.kind === 'ceiling-plan') scene = await collectPlan(ctx, { levelId: src.levelId, scale: vp.scale })
    if (scene) new Painter(pdf, scene, rect, vp.scale).draw()
    else {
      pdf.setDrawColor('#9ca3af')
      pdf.setLineDashPattern([2, 1], 0)
      pdf.rect(vp.x, vp.y, vp.w, vp.h)
      pdf.setLineDashPattern([], 0)
      pdf.setTextColor('#6b7280')
      pdf.setFontSize(8)
      pdf.text('This view needs the 3D editor to be rendered.', vp.x + vp.w / 2, vp.y + vp.h / 2, { align: 'center' })
    }
    if (src.kind === 'plan') {
      scaleBar(pdf, vp.x + 2, vp.y + vp.h - 4, vp.scale, Math.min(50, vp.w / 3))
      northArrow(pdf, vp.x + vp.w - 9, vp.y + 9, ctx.doc.meta.geo?.northAngle ?? 0)
    }
  }
  pdf.setTextColor('#000000')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(9)
  pdf.text(viewportTitle(ctx, vp), vp.x, vp.y + vp.h + 5)
  pdf.setFont('helvetica', 'normal')
  if (src.kind !== 'schedule') {
    pdf.setFontSize(7)
    pdf.text(`M 1:${vp.scale}`, vp.x + vp.w, vp.y + vp.h + 5, { align: 'right' })
  }
}

async function newPdf(paper: PaperSize, orientation: 'landscape' | 'portrait', title: string): Promise<{ pdf: JsPdf; W: number; H: number }> {
  const { jsPDF } = await import('jspdf')
  const [a, b] = PAPER_MM[paper]
  const W = orientation === 'landscape' ? a : b,
    H = orientation === 'landscape' ? b : a
  const pdf = new jsPDF({ orientation, unit: 'mm', format: [W, H], compress: true })
  pdf.setProperties({ title, creator: 'CadSandbox', subject: title })
  pdf.setFont('helvetica', 'normal')
  return { pdf, W, H }
}

function frame(pdf: JsPdf, W: number, H: number): void {
  pdf.setDrawColor('#000000')
  pdf.setLineDashPattern([], 0)
  pdf.setLineWidth(0.7)
  pdf.rect(MARGIN.left, MARGIN.top, W - MARGIN.left - MARGIN.right, H - MARGIN.top - MARGIN.bottom)
  // fold/trim marks at the corners
  pdf.setLineWidth(0.25)
  for (const [x, y, dx, dy] of [
    [0, 0, 1, 1],
    [W, 0, -1, 1],
    [0, H, 1, -1],
    [W, H, -1, -1],
  ] as const) {
    pdf.line(x, y + dy * 5, x + dx * 5, y + dy * 5)
    pdf.line(x + dx * 5, y, x + dx * 5, y + dy * 5)
  }
}

/** Render a layout sheet to PDF. */
export async function exportSheetPdf(ctx: ExportContext, sheetId: string): Promise<ExportResult> {
  const sheet = ctx.doc.getSheet(sheetId)
  if (!sheet) throw new Error('Sheet not found.')
  await ctx.geometry.idle()
  const { pdf, W, H } = await newPdf(sheet.paper, sheet.orientation, `${sheet.number} ${sheet.name}`)
  frame(pdf, W, H)
  for (const vp of sheet.viewports) await drawViewport(pdf, ctx, vp)
  const scales = [...new Set(sheet.viewports.filter((v) => v.source.kind !== 'schedule').map((v) => v.scale))]
  const scaleText = scales.length === 1 ? `1:${scales[0]}` : scales.length ? 'wie angegeben' : '–'
  titleBlock(pdf, sheet, scaleText, W - MARGIN.right - TITLE_W, H - MARGIN.bottom - TITLE_H)
  const bytes = new Uint8Array(pdf.output('arraybuffer'))
  return { blob: blobOf([bytes], 'application/pdf'), fileName: `${safeFileName(`${sheet.number ? `${sheet.number} ` : ''}${sheet.name}`, 'sheet')}.pdf` }
}

const STANDARD_SCALES = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000]

/** Quick PDF of a level plan at a scale on the smallest fitting A-size (landscape). */
export async function exportPlanPdf(ctx: ExportContext, opts: ExportOptions): Promise<ExportResult> {
  const levelId = opts.levelId === undefined ? (ctx.doc.meta.activeLevel ?? ctx.doc.levels()[0]?.id ?? null) : opts.levelId
  let scale = opts.scale ?? 100
  let scene = await collectPlan(ctx, { levelId, selection: opts.selection, scale })
  const b = scene.bounds ?? { min: [0, 0], max: [1, 1] }
  const size = (s: number): [number, number] => [((b.max[0] - b.min[0]) * 1000) / s + 20, ((b.max[1] - b.min[1]) * 1000) / s + 20]
  const avail = (p: PaperSize): [number, number] => [PAPER_MM[p][0] - MARGIN.left - MARGIN.right, PAPER_MM[p][1] - MARGIN.top - MARGIN.bottom - TITLE_H - 5]
  const papers: PaperSize[] = ['A4', 'A3', 'A2', 'A1', 'A0']
  const fits = (p: PaperSize, s: number) => size(s)[0] <= avail(p)[0] && size(s)[1] <= avail(p)[1]
  const paper: PaperSize = opts.paper ?? papers.find((p) => fits(p, scale)) ?? 'A0'
  if (!opts.scale && !fits(paper, scale)) {
    scale = STANDARD_SCALES.find((s) => s >= scale && fits(paper, s)) ?? scale
    scene = await collectPlan(ctx, { levelId, selection: opts.selection, scale })
  }
  const { pdf, W, H } = await newPdf(paper, 'landscape', scene.title)
  frame(pdf, W, H)
  const area: Rect = { x: MARGIN.left + 5, y: MARGIN.top + 5, w: W - MARGIN.left - MARGIN.right - 10, h: H - MARGIN.top - MARGIN.bottom - TITLE_H - 10 }
  new Painter(pdf, scene, area, scale).draw()
  scaleBar(pdf, MARGIN.left + 8, H - MARGIN.bottom - TITLE_H - 3, scale)
  northArrow(pdf, W - MARGIN.right - 12, MARGIN.top + 12, scene.northAngle)
  const today = new Date().toISOString().slice(0, 10)
  titleBlock(
    pdf,
    { name: levelId ? `Grundriss ${scene.title}` : scene.title, number: '', titleBlock: { project: ctx.doc.meta.name, client: '', address: '', drawnBy: '', checkedBy: '', date: today, revision: '', company: '', phase: '' } },
    `1:${scale}`,
    W - MARGIN.right - TITLE_W,
    H - MARGIN.bottom - TITLE_H,
  )
  const bytes = new Uint8Array(pdf.output('arraybuffer'))
  return { blob: blobOf([bytes], 'application/pdf'), fileName: `${safeFileName(`${ctx.doc.meta.name} - ${scene.title} 1-${scale}`, 'plan')}.pdf` }
}
