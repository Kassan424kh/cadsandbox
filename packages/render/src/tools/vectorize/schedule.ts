// Schedule tables (rooms, doors, windows, areas, materials) as 2D linework + texts. Uses the
// geometry engine's computeSchedules when it exists, otherwise computes rows from the document.
// Layout is in model meters for a 1:100 sheet viewport (row 0.6 m ≙ 6 mm, text 0.25 m ≙ 2.5 mm).
import type { AnyNode, CadDocument, NodeBase } from '@cadsandbox/doc'
import { BUILTIN_MATERIAL_MAP, TYPE_DEFAULT_MATERIAL, polygonArea, polygonPerimeter } from '@cadsandbox/doc'
import type { Schedules } from '@cadsandbox/geometry'
import { DrawingBuilder, type VectorDrawing, type VectorizeDeps } from './common'

export type ScheduleKind = 'rooms' | 'doors' | 'windows' | 'areas' | 'materials'

const ROW = 0.6
const TEXT = 0.25
const PAD = 0.15

interface Table {
  title: string
  columns: { label: string; width: number; align?: 'left' | 'right' }[]
  rows: string[][]
}

const USAGE_NAMES: Record<string, string> = {
  NUF1: 'Living / lounge',
  NUF2: 'Office',
  NUF3: 'Production',
  NUF4: 'Storage / sales',
  NUF5: 'Education / culture',
  NUF6: 'Healthcare',
  NUF7: 'Other',
  TF: 'Technical',
  VF: 'Circulation',
}

const f2 = (x: number) => x.toFixed(2)
const mm = (m: number) => `${Math.round(m * 1000)}`

/** Try the engine's schedule computation (optional export), else compute locally. */
export async function loadSchedules(deps: VectorizeDeps): Promise<Schedules> {
  try {
    const mod = (await import('@cadsandbox/geometry')) as unknown as Record<string, unknown>
    const fn = mod.computeSchedules
    if (typeof fn === 'function') {
      const res = (fn as (doc: CadDocument, geometry?: unknown) => Schedules | Promise<Schedules>)(deps.doc, deps.geometry)
      const s = await res
      if (s && Array.isArray(s.rooms)) return fillMissingQuantities(s, deps.doc)
    }
  } catch {
    // fall through to the local computation
  }
  return computeSchedulesLocal(deps.doc)
}

/**
 * The engine's schedule reads quantities from evaluated geometry results; nodes that have no result
 * yet (freshly added, still in the worker queue, or a headless context) come back with zero area /
 * length. Fill those rows from the document (outline / wall axis) so schedules are never empty.
 */
function fillMissingQuantities(s: Schedules, doc: CadDocument): Schedules {
  const needsRooms = s.rooms.some((r) => !(r.area > 0))
  const needsWalls = s.walls.some((w) => !(w.length > 0))
  if (!needsRooms && !needsWalls) return s
  const local = computeSchedulesLocal(doc)
  const localRooms = new Map(local.rooms.map((r) => [r.id, r]))
  const localWalls = new Map(local.walls.map((w) => [w.id, w]))
  const rooms = s.rooms.map((r) => (r.area > 0 ? r : (localRooms.get(r.id) ?? r)))
  const walls = s.walls.map((w) => (w.length > 0 ? w : (localWalls.get(w.id) ?? w)))
  if (!needsRooms) return { ...s, walls }
  const areaByUsage = new Map<string, number>()
  for (const r of rooms) areaByUsage.set(r.usage, (areaByUsage.get(r.usage) ?? 0) + r.area)
  const areas = [...areaByUsage.entries()].filter(([, a]) => a > 0).map(([usage, area]) => ({ usage, area }))
  const netFloorArea = rooms.reduce((sum, r) => sum + r.area, 0)
  const grossVolume = rooms.reduce((sum, r) => sum + r.volume, 0)
  const grossFloorArea = s.totals.grossFloorArea > 0 ? s.totals.grossFloorArea : local.totals.grossFloorArea
  return { ...s, rooms, walls, areas, totals: { ...s.totals, netFloorArea, grossFloorArea, grossVolume } }
}

export function computeSchedulesLocal(doc: CadDocument): Schedules {
  const levelName = (id: string) => {
    const lvl = doc.getLevelOf(id)
    return lvl ? (doc.getNode(lvl)?.name ?? '') : ''
  }
  const levelHeight = (id: string) => {
    const lvl = doc.getLevelOf(id)
    const n = lvl ? doc.getNode<'level'>(lvl) : undefined
    return n && n.type === 'level' ? n.params.height : 3
  }
  const rooms = doc.nodesOfType('room').map((r) => {
    const area = Math.abs(polygonArea(r.params.outline))
    const height = r.params.ceilingHeight ?? Math.max(0, levelHeight(r.id) - 0.25)
    return { id: r.id, number: r.params.number, name: r.name, level: levelName(r.id), usage: r.params.usage, area, perimeter: polygonPerimeter(r.params.outline), height, volume: area * height }
  })
  const openings = doc.nodesOfType('opening')
  const groupOpenings = (kind: 'door' | 'window'): Schedules['doors'] => {
    const groups = new Map<string, Schedules['doors'][number]>()
    for (const o of openings) {
      if (o.params.kind !== kind) continue
      const wall = o.parent ?? ''
      const key = `${o.params.style}|${mm(o.params.width)}|${mm(o.params.height)}|${mm(o.params.sill)}|${levelName(o.id)}`
      const g = groups.get(key)
      if (g) g.count++
      else groups.set(key, { id: o.id, kind, style: o.params.style, level: levelName(o.id), wall, width: o.params.width, height: o.params.height, sill: o.params.sill, count: 1 })
    }
    return [...groups.values()]
  }
  const walls: Schedules['walls'] = doc.nodesOfType('wall').map((w) => {
    const length = Math.hypot(w.params.b[0] - w.params.a[0], w.params.b[1] - w.params.a[1])
    const grossArea = length * w.params.height
    const openingArea = doc
      .getChildren(w.id)
      .map((id) => doc.getNode<'opening'>(id))
      .filter((o): o is NodeBase<'opening'> => !!o && o.type === 'opening')
      .reduce((s, o) => s + o.params.width * o.params.height, 0)
    return { id: w.id, level: levelName(w.id), length, height: w.params.height, thickness: w.params.thickness, grossArea, netArea: Math.max(0, grossArea - openingArea), volume: Math.max(0, grossArea - openingArea) * w.params.thickness, material: w.material ?? TYPE_DEFAULT_MATERIAL.wall ?? '' }
  })
  const areaByUsage = new Map<string, number>()
  for (const r of rooms) areaByUsage.set(r.usage, (areaByUsage.get(r.usage) ?? 0) + r.area)
  const areas = [...areaByUsage.entries()].map(([usage, area]) => ({ usage, area }))
  const netFloorArea = rooms.reduce((s, r) => s + r.area, 0)
  const grossFloorArea = netFloorArea * 1.15 + walls.reduce((s, w) => s + w.length * w.thickness, 0)
  const grossVolume = rooms.reduce((s, r) => s + r.volume, 0)
  return { rooms, doors: groupOpenings('door'), windows: groupOpenings('window'), walls, areas, totals: { netFloorArea, grossFloorArea, grossVolume } }
}

function materialRows(doc: CadDocument): string[][] {
  const counts = new Map<string, { name: string; count: number; types: Set<string> }>()
  for (const n of doc.allNodes() as AnyNode[]) {
    if (doc.isDefinitionNode(n.id)) continue
    const id = n.material ?? TYPE_DEFAULT_MATERIAL[n.type]
    if (!id) continue
    const mat = doc.getMaterial(id) ?? BUILTIN_MATERIAL_MAP.get(id)
    const rec = counts.get(id) ?? { name: mat?.name ?? id, count: 0, types: new Set<string>() }
    rec.count++
    rec.types.add(n.type)
    counts.set(id, rec)
  }
  return [...counts.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([id, r]) => [r.name, id, String(r.count), [...r.types].join(', ')])
}

export function buildTable(kind: ScheduleKind, s: Schedules, doc: CadDocument): Table {
  switch (kind) {
    case 'rooms':
      return {
        title: 'Room schedule',
        columns: [
          { label: 'No.', width: 1.4 },
          { label: 'Name', width: 4 },
          { label: 'Level', width: 3 },
          { label: 'Usage', width: 3.2 },
          { label: 'Area m²', width: 2, align: 'right' },
          { label: 'Perimeter m', width: 2.4, align: 'right' },
          { label: 'Height m', width: 2, align: 'right' },
          { label: 'Volume m³', width: 2.2, align: 'right' },
        ],
        rows: [...s.rooms].sort((a, b) => a.number.localeCompare(b.number)).map((r) => [r.number, r.name, r.level, `${r.usage} ${USAGE_NAMES[r.usage] ?? ''}`.trim(), f2(r.area), f2(r.perimeter), f2(r.height), f2(r.volume)]),
      }
    case 'doors':
    case 'windows': {
      const rows = kind === 'doors' ? s.doors : s.windows
      return {
        title: kind === 'doors' ? 'Door schedule' : 'Window schedule',
        columns: [
          { label: 'Type', width: 3.2 },
          { label: 'Level', width: 3 },
          { label: 'Width mm', width: 2.2, align: 'right' },
          { label: 'Height mm', width: 2.2, align: 'right' },
          { label: kind === 'doors' ? 'Threshold mm' : 'Sill mm', width: 2.4, align: 'right' },
          { label: 'Count', width: 1.6, align: 'right' },
        ],
        rows: rows.map((r) => [r.style, r.level, mm(r.width), mm(r.height), mm(r.sill), String(r.count)]),
      }
    }
    case 'areas':
      return {
        title: 'Areas (DIN 277)',
        columns: [
          { label: 'Usage', width: 2 },
          { label: 'Description', width: 5 },
          { label: 'Area m²', width: 2.4, align: 'right' },
        ],
        rows: [
          ...s.areas.map((a) => [a.usage, USAGE_NAMES[a.usage] ?? '', f2(a.area)]),
          ['NRF', 'Net floor area', f2(s.totals.netFloorArea)],
          ['BGF', 'Gross floor area (est.)', f2(s.totals.grossFloorArea)],
          ['BRI', 'Gross volume m³', f2(s.totals.grossVolume)],
        ],
      }
    default:
      return {
        title: 'Materials',
        columns: [
          { label: 'Material', width: 4 },
          { label: 'Id', width: 3.6 },
          { label: 'Objects', width: 1.8, align: 'right' },
          { label: 'Used by', width: 5 },
        ],
        rows: materialRows(doc),
      }
  }
}

/** Table → lines + texts. Origin at the top-left corner, rows grow downward (−y). */
export function tableDrawing(table: Table): VectorDrawing {
  const b = new DrawingBuilder()
  const width = table.columns.reduce((s, c) => s + c.width, 0)
  const rows = table.rows.length ? table.rows : [table.columns.map((_, i) => (i === 0 ? '—' : ''))]
  const totalRows = rows.length + 2 // title + header
  const height = totalRows * ROW
  b.polyline('annotation', [[0, 0], [width, 0], [width, -height], [0, -height]], true)
  // title
  b.text({ text: table.title, position: [PAD, -ROW / 2], size: TEXT * 1.2, rotation: 0, align: 'left', baseline: 'middle', style: 'title' })
  b.segment('annotation', [0, -ROW], [width, -ROW])
  b.segment('annotation', [0, -2 * ROW], [width, -2 * ROW])
  // column separators (below the title row)
  let x = 0
  for (const c of table.columns.slice(0, -1)) {
    x += c.width
    b.segment('annotation', [x, -ROW], [x, -height])
  }
  const cell = (row: number, col: number, text: string, style: 'label' | 'annotation') => {
    let x0 = 0
    for (let i = 0; i < col; i++) x0 += table.columns[i].width
    const c = table.columns[col]
    const align = c.align ?? 'left'
    const px = align === 'right' ? x0 + c.width - PAD : x0 + PAD
    b.text({ text, position: [px, -(row + 0.5) * ROW], size: TEXT, rotation: 0, align, baseline: 'middle', style })
  }
  table.columns.forEach((c, i) => cell(1, i, c.label, 'label'))
  rows.forEach((r, ri) => {
    if (ri > 0) b.segment('annotation', [0, -(ri + 2) * ROW], [width, -(ri + 2) * ROW])
    r.forEach((text, ci) => cell(ri + 2, ci, text, 'annotation'))
  })
  return b.build()
}
