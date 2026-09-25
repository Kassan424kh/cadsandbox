// Rooms: area/perimeter/volume + plan fill and stamp (name, number, area). Auto rooms follow walls.
import type { NodeBase, Vec2 } from '@cadsandbox/doc'
import { formatArea } from '@cadsandbox/shared'
import type { GeometryResult, SnapPoint } from '../api'
import { framesFromNeighbors, regionContaining, roomRegionsFromFrames } from '../analysis/rooms'
import { ANNO, DrawingBuilder } from '../core/drawing'
import { cleanPolygon, polygonCentroid, polygonPerimeter } from '../core/math2d'
import { labelPoint, nestRings, polygonsArea, type PolyWithHoles } from '../core/polygon'
import type { EvalContext } from './context'
import { drawingBounds, emptyResult, errorResult, snap } from './result'
import { metaNumber } from './util'

export function roomHeight(p: NodeBase<'room'>['params'], ctx: EvalContext): number {
  return p.ceilingHeight && p.ceilingHeight > 0 ? p.ceilingHeight : Math.max(0.1, ctx.level.height - 0.2)
}

export function evaluateRoom(node: NodeBase<'room'>, ctx: EvalContext): GeometryResult {
  const p = node.params
  let polys: PolyWithHoles[] = []
  let auto = false
  if (p.auto && ctx.levelWalls?.length) {
    const regions = roomRegionsFromFrames(framesFromNeighbors(ctx.levelWalls))
    const seed: Vec2 = p.outline?.length >= 3 ? polygonCentroid(p.outline) : [0, 0]
    const region = regionContaining(regions, seed) ?? regionContaining(regions, [0, 0])
    if (region) {
      polys = [region]
      auto = true
    }
  }
  if (!polys.length) {
    const outline = cleanPolygon(p.outline ?? [])
    if (outline.length < 3) return errorResult(p.auto ? 'Room is not enclosed by walls' : 'Room outline needs at least 3 points')
    polys = nestRings([outline])
  }
  const area = polygonsArea(polys)
  const perimeter = polys.reduce((s, poly) => s + polygonPerimeter(poly.outer), 0)
  const height = roomHeight(p, ctx)
  const d = new DrawingBuilder()
  d.fill(polys, p.fill ? 'solid' : 'none', { color: p.fill ?? undefined })
  if (p.showLabel !== false) {
    const at = labelPoint(polys[0]!)
    const size = metaNumber(node, 'textSize', ANNO.stampSize)
    const lines: { text: string; style: 'title' | 'label' | 'annotation' }[] = []
    if (node.name) lines.push({ text: node.name, style: 'title' })
    if (p.number) lines.push({ text: p.number, style: 'label' })
    lines.push({ text: formatArea(area, ctx.units.area), style: 'label' })
    const lineH = size * 1.6
    const y0 = at[1] + ((lines.length - 1) * lineH) / 2
    lines.forEach((l, i) => d.text(l.text, [at[0], y0 - i * lineH], l.style === 'title' ? size : size * 0.8, { align: 'center', baseline: 'middle', style: l.style }))
  }
  const plan = d.build()
  const snaps: SnapPoint[] = []
  for (const poly of polys) for (const q of poly.outer) snaps.push(snap('vertex', q[0], q[1], 0))
  const c = polygonCentroid(polys[0]!.outer)
  snaps.push(snap('center', c[0], c[1], 0))
  const res = emptyResult({ plan, snaps })
  res.bounds = drawingBounds(plan) ?? res.bounds
  res.bounds = { min: [res.bounds.min[0], res.bounds.min[1], 0], max: [res.bounds.max[0], res.bounds.max[1], height] }
  res.quantities = { area, perimeter, height, volume: area * height, auto: auto ? 1 : 0 }
  return res
}
