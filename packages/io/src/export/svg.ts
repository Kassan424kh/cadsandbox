// SVG export of a plan at a paper scale (1 SVG unit = 1 mm on paper). Geometry is emitted in plan
// meters inside one y-flipped group so bulges/arcs/Béziers stay exact; hatches are SVG <pattern>s
// (one per pattern-line family, skewed lattices); texts are placed unflipped in paper millimeters.
import type { PathPoint, Vec2 } from '@cadsandbox/doc'
import type { ExportContext, ExportOptions, ExportResult } from '../api'
import { blobOf, safeFileName } from '../util/bytes'
import { bulgeArc } from '../util/geom2d'
import { PATTERN_UNIT_M, patternDef, transformFamily } from './hatch-patterns'
import { xmlEscape } from './threemf'
import { collectPlan, paperColor, type VItem, type VectorScene } from './vector'

const n = (v: number) => {
  const r = Math.round(v * 1e5) / 1e5
  return Object.is(r, -0) ? '0' : String(r)
}
const DASH: Record<string, number[]> = { dashed: [3, 1.5], hidden: [1.5, 1], center: [8, 1.5, 1.5, 1.5], dotted: [0.1, 1], dashdot: [4, 1.5, 0.1, 1.5] }

function polyD(points: Vec2[], bulges: number[] | undefined, closed: boolean): string {
  if (!points.length) return ''
  let d = `M${n(points[0]![0])} ${n(points[0]![1])}`
  const segs = closed ? points.length : points.length - 1
  for (let i = 0; i < segs; i++) {
    const a = points[i]!,
      b = points[(i + 1) % points.length]!
    const bg = bulges?.[i] ?? 0
    const arc = Math.abs(bg) > 1e-12 ? bulgeArc(a, b, bg) : null
    // user space is y-up here (flipped group), so SVG's sweep flag 1 = counter-clockwise in plan
    if (arc) d += `A${n(arc.r)} ${n(arc.r)} 0 ${Math.abs(arc.sweep) > Math.PI ? 1 : 0} ${arc.sweep > 0 ? 1 : 0} ${n(b[0])} ${n(b[1])}`
    else d += `L${n(b[0])} ${n(b[1])}`
  }
  return closed ? `${d}Z` : d
}

function pathD(points: PathPoint[], closed: boolean): string {
  if (!points.length) return ''
  let d = `M${n(points[0]!.p[0])} ${n(points[0]!.p[1])}`
  const segs = closed ? points.length : points.length - 1
  for (let i = 0; i < segs; i++) {
    const a = points[i]!,
      b = points[(i + 1) % points.length]!
    if (!a.ho && !b.hi) d += `L${n(b.p[0])} ${n(b.p[1])}`
    else {
      const c1 = a.ho ?? a.p,
        c2 = b.hi ?? b.p
      d += `C${n(c1[0])} ${n(c1[1])} ${n(c2[0])} ${n(c2[1])} ${n(b.p[0])} ${n(b.p[1])}`
    }
  }
  return closed ? `${d}Z` : d
}

const ringD = (r: Vec2[]) => polyD(r, undefined, true)

export function writeSvg(scene: VectorScene, margin = 10): string {
  const k = 1000 / scene.scale // paper mm per plan meter
  const b = scene.bounds ?? { min: [0, 0] as Vec2, max: [1, 1] as Vec2 }
  const W = (b.max[0] - b.min[0]) * k + 2 * margin
  const H = (b.max[1] - b.min[1]) * k + 2 * margin
  const X = (x: number) => (x - b.min[0]) * k + margin
  const Y = (y: number) => (b.max[1] - y) * k + margin
  const mm = (v: number) => v / k // paper mm → plan meters (user units inside the flipped group)
  const defs: string[] = []
  const patternIds = new Map<string, string[]>()
  const geo = new Map<string, string[]>()
  const texts: string[] = []
  const layerOf = (name: string) => scene.layers.get(name)
  const push = (layer: string, s: string) => {
    let a = geo.get(layer)
    if (!a) geo.set(layer, (a = []))
    a.push(s)
  }
  const strokeAttrs = (it: VItem) => {
    const l = layerOf(it.layer)
    const parts: string[] = []
    if (it.color) parts.push(`stroke="${paperColor(it.color)}"`)
    if (it.weight !== null && it.weight !== undefined) parts.push(`stroke-width="${n(mm(it.weight))}"`)
    const lt = it.lineType ?? null
    if (lt && lt !== 'continuous' && lt !== l?.lineType) parts.push(`stroke-dasharray="${DASH[lt]!.map((d) => n(mm(d))).join(' ')}"`)
    return parts.length ? ` ${parts.join(' ')}` : ''
  }
  const text = (p: Vec2, size: number, value: string, rotation: number, align: 'left' | 'center' | 'right', baseline: 'top' | 'middle' | 'bottom', color: string) => {
    const x = X(p[0]),
      y = Y(p[1])
    const fs = (size * k) / 0.72 // cap height → font size
    const anchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start'
    const base = baseline === 'top' ? ' dominant-baseline="hanging"' : baseline === 'middle' ? ' dominant-baseline="central"' : ''
    const rot = Math.abs(rotation) > 1e-9 ? ` transform="rotate(${n((-rotation * 180) / Math.PI)} ${n(x)} ${n(y)})"` : ''
    const lines = value.split('\n')
    const body = lines.length === 1 ? xmlEscape(value) : lines.map((ln, i) => `<tspan x="${n(x)}" dy="${i ? n(fs * 1.2) : 0}">${xmlEscape(ln)}</tspan>`).join('')
    texts.push(`<text x="${n(x)}" y="${n(y)}" font-size="${n(fs)}" text-anchor="${anchor}"${base} fill="${color}"${rot}>${body}</text>`)
  }

  const patternFor = (pattern: VItem & { kind: 'hatch' }, color: string): string[] => {
    const def = patternDef(pattern.pattern)
    if (!def) return []
    const key = `${pattern.pattern}|${pattern.scale}|${pattern.angle}|${color}`
    const cached = patternIds.get(key)
    if (cached) return cached
    const ids: string[] = []
    const sw = mm(0.13)
    def.families.forEach((fam, i) => {
      const t = transformFamily(fam, pattern.scale * PATTERN_UNIT_M, pattern.angle) // user units = meters
      const u: Vec2 = [Math.cos(t.angle), Math.sin(t.angle)]
      const along = t.offset[0] * u[0] + t.offset[1] * u[1]
      const across = -t.offset[0] * u[1] + t.offset[1] * u[0]
      if (Math.abs(across) < 1e-12) return
      const h = Math.abs(across)
      const period = t.dashes.reduce((s, d) => s + Math.abs(d), 0) || h
      const skew = (Math.atan(along / across) * 180) / Math.PI
      const id = `hp${patternIds.size}_${i}`
      const content: string[] = []
      for (const y of [0, h]) {
        if (!t.dashes.length) content.push(`<line x1="0" y1="${n(y)}" x2="${n(period)}" y2="${n(y)}"/>`)
        else {
          let x = 0
          for (const d of t.dashes) {
            if (d > 0) content.push(`<line x1="${n(x)}" y1="${n(y)}" x2="${n(x + d)}" y2="${n(y)}"/>`)
            else if (d === 0) content.push(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(sw)}" fill="${color}" stroke="none"/>`)
            x += Math.abs(d)
          }
        }
      }
      defs.push(
        `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${n(period)}" height="${n(h)}" patternTransform="translate(${n(t.base[0])} ${n(t.base[1])}) rotate(${n((t.angle * 180) / Math.PI)}) skewX(${n(skew)})"><g stroke="${color}" stroke-width="${n(sw)}">${content.join('')}</g></pattern>`,
      )
      ids.push(id)
    })
    patternIds.set(key, ids)
    return ids
  }

  for (const it of scene.items) {
    const color = paperColor(it.color ?? layerOf(it.layer)?.color)
    switch (it.kind) {
      case 'poly':
        push(it.layer, `<path d="${polyD(it.points, it.bulges, it.closed)}"${strokeAttrs(it)}/>`)
        break
      case 'circle':
        push(it.layer, `<circle cx="${n(it.c[0])}" cy="${n(it.c[1])}" r="${n(it.r)}"${strokeAttrs(it)}/>`)
        break
      case 'arc': {
        let sweep = it.end - it.start
        while (sweep <= 0) sweep += Math.PI * 2
        const a: Vec2 = [it.c[0] + it.r * Math.cos(it.start), it.c[1] + it.r * Math.sin(it.start)]
        const e: Vec2 = [it.c[0] + it.r * Math.cos(it.start + sweep), it.c[1] + it.r * Math.sin(it.start + sweep)]
        push(it.layer, `<path d="M${n(a[0])} ${n(a[1])}A${n(it.r)} ${n(it.r)} 0 ${sweep > Math.PI ? 1 : 0} 1 ${n(e[0])} ${n(e[1])}"${strokeAttrs(it)}/>`)
        break
      }
      case 'ellipse':
        push(it.layer, `<ellipse cx="${n(it.c[0])}" cy="${n(it.c[1])}" rx="${n(it.rx)}" ry="${n(it.ry)}" transform="rotate(${n((it.rotation * 180) / Math.PI)} ${n(it.c[0])} ${n(it.c[1])})"${strokeAttrs(it)}/>`)
        break
      case 'path':
        push(it.layer, `<path d="${it.contours.map((c) => pathD(c.points, c.closed)).join('')}"${strokeAttrs(it)}/>`)
        break
      case 'hatch': {
        const d = [it.outer, ...it.holes].map(ringD).join('')
        if (it.pattern === 'solid') push(it.layer, `<path d="${d}" fill="${paperColor(it.fill ?? it.color ?? layerOf(it.layer)?.color)}" fill-rule="evenodd" stroke="none"/>`)
        else for (const id of patternFor(it, color)) push(it.layer, `<path d="${d}" fill="url(#${id})" fill-rule="evenodd" stroke="none"/>`)
        break
      }
      case 'text':
        text(it.p, it.size, it.text, it.rotation, it.align, it.baseline, color)
        break
      case 'dim': {
        const g = it.geom
        const segs = [...g.lines, ...g.ticks].map(([a, c]) => `M${n(a[0])} ${n(a[1])}L${n(c[0])} ${n(c[1])}`).join('')
        let arc = ''
        if (g.arc) {
          const s: Vec2 = [g.arc.c[0] + g.arc.r * Math.cos(g.arc.start), g.arc.c[1] + g.arc.r * Math.sin(g.arc.start)]
          const e: Vec2 = [g.arc.c[0] + g.arc.r * Math.cos(g.arc.start + g.arc.sweep), g.arc.c[1] + g.arc.r * Math.sin(g.arc.start + g.arc.sweep)]
          arc = `M${n(s[0])} ${n(s[1])}A${n(g.arc.r)} ${n(g.arc.r)} 0 ${g.arc.sweep > Math.PI ? 1 : 0} 1 ${n(e[0])} ${n(e[1])}`
        }
        push(it.layer, `<path d="${segs}${arc}"${strokeAttrs(it)}/>`)
        text(g.textPos, g.textSize, g.text, g.textAngle, 'center', 'bottom', color)
        break
      }
    }
  }

  const groups: string[] = []
  for (const [name, items] of geo) {
    const l = layerOf(name)
    if (l && !l.printable) continue
    const dash = l && l.lineType !== 'continuous' ? ` stroke-dasharray="${DASH[l.lineType]!.map((d) => n(mm(d))).join(' ')}"` : ''
    groups.push(`<g id="${xmlEscape(name.replace(/\s+/g, '_'))}" stroke="${paperColor(l?.color)}" stroke-width="${n(mm(l?.lineWeight ?? 0.25))}"${dash}>${items.join('')}</g>`)
  }
  const flip = `translate(${n(margin - b.min[0] * k)} ${n(margin + b.max[1] * k)}) scale(${n(k)} ${n(-k)})`
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(W)}mm" height="${n(H)}mm" viewBox="0 0 ${n(W)} ${n(H)}">`,
    `<title>${xmlEscape(scene.title)} — 1:${scene.scale}</title>`,
    `<defs>${defs.join('')}</defs>`,
    '<rect width="100%" height="100%" fill="#ffffff"/>',
    `<g transform="${flip}" fill="none" stroke-linecap="round" stroke-linejoin="round">${groups.join('')}</g>`,
    `<g font-family="Helvetica, Arial, sans-serif">${texts.join('')}</g>`,
    '</svg>',
    '',
  ].join('\n')
}

export async function exportSvg(ctx: ExportContext, opts: ExportOptions): Promise<ExportResult> {
  const levelId = opts.levelId === undefined ? (ctx.doc.meta.activeLevel ?? ctx.doc.levels()[0]?.id ?? null) : opts.levelId
  const scene = await collectPlan(ctx, { levelId, selection: opts.selection, scale: opts.scale ?? 100 })
  const name = safeFileName(levelId ? `${ctx.doc.meta.name} - ${scene.title}` : ctx.doc.meta.name, 'plan')
  return { blob: blobOf([writeSvg(scene)], 'image/svg+xml'), fileName: `${name}.svg` }
}
