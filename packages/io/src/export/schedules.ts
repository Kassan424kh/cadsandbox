// Schedules (rooms, doors, windows, walls, DIN 277 areas) and their CSV export. Prefers
// computeSchedules from @cadsandbox/geometry when exported; otherwise a local implementation from the
// document + geometry quantities.
import type { AnyNode, CadDocument, NodeBase } from '@cadsandbox/doc'
import { polygonArea, polygonPerimeter } from '@cadsandbox/doc'
import type { GeometryService, OpeningRow, RoomRow, Schedules, WallRow } from '@cadsandbox/geometry'
import type { ExportContext, ExportOptions, ExportResult } from '../api'
import { blobOf, safeFileName } from '../util/bytes'

type ComputeSchedules = (doc: CadDocument, geometry: GeometryService) => Schedules

/** computeSchedules from @cadsandbox/geometry once it is exported there (looked up at runtime). */
async function resolveCompute(): Promise<ComputeSchedules | null> {
  const mod: object = await import('@cadsandbox/geometry')
  const fn: unknown = Reflect.get(mod, 'computeSchedules')
  return typeof fn === 'function' ? (fn as ComputeSchedules) : null
}

export async function getSchedules(ctx: Pick<ExportContext, 'doc' | 'geometry'>): Promise<Schedules> {
  await ctx.geometry.idle()
  const fn = await resolveCompute()
  return fn ? fn(ctx.doc, ctx.geometry) : computeSchedulesLocal(ctx.doc, ctx.geometry)
}

const bulgeLength = (a: [number, number], b: [number, number], bulge = 0) => {
  const c = Math.hypot(b[0] - a[0], b[1] - a[1])
  if (!bulge) return c
  const theta = 4 * Math.atan(Math.abs(bulge))
  return (c / (2 * Math.sin(theta / 2))) * theta
}

/** Local schedule computation (used until @cadsandbox/geometry exports computeSchedules). */
export function computeSchedulesLocal(doc: CadDocument, geometry: GeometryService): Schedules {
  const levelOf = (id: string) => doc.getNode(doc.getLevelOf(id)) as NodeBase<'level'> | undefined
  const visible = (n: AnyNode) => doc.isEffectivelyVisible(n.id) && !doc.isDefinitionNode(n.id)
  const rooms: RoomRow[] = doc
    .nodesOfType('room')
    .filter(visible)
    .map((r) => {
      const q = geometry.get(r.id)?.quantities ?? {}
      const lv = levelOf(r.id)
      const area = q.area ?? Math.abs(polygonArea(r.params.outline))
      const height = q.height ?? r.params.ceilingHeight ?? lv?.params.height ?? 3
      return {
        id: r.id,
        number: r.params.number,
        name: r.name,
        level: lv?.name ?? '',
        usage: r.params.usage,
        area,
        perimeter: q.perimeter ?? polygonPerimeter(r.params.outline),
        height,
        volume: q.volume ?? area * height,
      }
    })
  const openings = doc.nodesOfType('opening').filter(visible)
  const openingRow = (o: NodeBase<'opening'>): OpeningRow => ({
    id: o.id,
    kind: o.params.kind,
    style: o.params.style,
    level: levelOf(o.id)?.name ?? '',
    wall: doc.getNode(o.parent)?.name ?? '',
    width: o.params.width,
    height: o.params.height,
    sill: o.params.sill,
    count: 1,
  })
  const walls: WallRow[] = doc
    .nodesOfType('wall')
    .filter(visible)
    .map((w) => {
      const q = geometry.get(w.id)?.quantities ?? {}
      const length = q.length ?? bulgeLength(w.params.a, w.params.b, w.params.bulge)
      const gross = q.grossArea ?? length * w.params.height
      const holes = openings.filter((o) => o.parent === w.id).reduce((s, o) => s + o.params.width * o.params.height, 0)
      const net = q.netArea ?? Math.max(0, gross - holes)
      const matId = w.material ?? w.params.layers?.[0]?.material ?? 'mat-plaster'
      return {
        id: w.id,
        level: levelOf(w.id)?.name ?? '',
        length,
        height: w.params.height,
        thickness: w.params.thickness,
        grossArea: gross,
        netArea: net,
        volume: q.volume ?? net * w.params.thickness,
        material: doc.getMaterial(matId)?.name ?? '',
      }
    })
  const byUsage = new Map<string, number>()
  for (const r of rooms) byUsage.set(r.usage, (byUsage.get(r.usage) ?? 0) + r.area)
  const netFloorArea = rooms.reduce((s, r) => s + r.area, 0)
  // BGF: floor slabs where modelled, else NRF × 1.15 (typical construction-area share)
  const slabs = doc.nodesOfType('slab').filter((s) => visible(s) && (s.params.kind === 'floor' || s.params.kind === 'foundation'))
  const slabArea = slabs.reduce((s, x) => s + Math.abs(polygonArea(x.params.outline)) - (x.params.holes ?? []).reduce((h, r) => h + Math.abs(polygonArea(r)), 0), 0)
  const grossFloorArea = slabArea > 0 ? slabArea : netFloorArea * 1.15
  const levels = doc.levels()
  const avgHeight = levels.length ? levels.reduce((s, l) => s + l.params.height, 0) / levels.length : 3
  const areas = ['NUF1', 'NUF2', 'NUF3', 'NUF4', 'NUF5', 'NUF6', 'NUF7', 'TF', 'VF'].filter((u) => byUsage.has(u)).map((usage) => ({ usage, area: byUsage.get(usage)! }))
  return {
    rooms,
    doors: openings.filter((o) => o.params.kind === 'door').map(openingRow),
    windows: openings.filter((o) => o.params.kind === 'window').map(openingRow),
    walls,
    areas,
    totals: { netFloorArea, grossFloorArea, grossVolume: grossFloorArea * avgHeight },
  }
}

// ------------------------------------------------------------------ tables
export type ScheduleKind = 'rooms' | 'doors' | 'windows' | 'walls' | 'areas'

export interface Table {
  title: string
  headers: string[]
  rows: (string | number)[][]
  /** number of decimals per numeric column */
  decimals: number[]
}

const DIN277: Record<string, string> = {
  NUF1: 'NUF 1 Wohnen und Aufenthalt',
  NUF2: 'NUF 2 Büroarbeit',
  NUF3: 'NUF 3 Produktion, Hand- und Maschinenarbeit',
  NUF4: 'NUF 4 Lagern, Verteilen und Verkaufen',
  NUF5: 'NUF 5 Bildung, Unterricht und Kultur',
  NUF6: 'NUF 6 Heilen und Pflegen',
  NUF7: 'NUF 7 Sonstige Nutzungen',
  TF: 'TF Technikfläche',
  VF: 'VF Verkehrsfläche',
}

export function scheduleTable(s: Schedules, kind: ScheduleKind): Table {
  switch (kind) {
    case 'rooms':
      return {
        title: 'Rooms',
        headers: ['Number', 'Name', 'Level', 'Usage (DIN 277)', 'Area (m²)', 'Perimeter (m)', 'Height (m)', 'Volume (m³)'],
        rows: s.rooms.map((r) => [r.number, r.name, r.level, r.usage, r.area, r.perimeter, r.height, r.volume]),
        decimals: [0, 0, 0, 0, 2, 2, 2, 2],
      }
    case 'doors':
    case 'windows':
      return {
        title: kind === 'doors' ? 'Doors' : 'Windows',
        headers: ['Type', 'Style', 'Level', 'Wall', 'Width (m)', 'Height (m)', 'Sill (m)', 'Count'],
        rows: s[kind].map((o) => [o.kind, o.style, o.level, o.wall, o.width, o.height, o.sill, o.count]),
        decimals: [0, 0, 0, 0, 3, 3, 3, 0],
      }
    case 'walls':
      return {
        title: 'Walls',
        headers: ['Level', 'Material', 'Length (m)', 'Height (m)', 'Thickness (m)', 'Gross area (m²)', 'Net area (m²)', 'Volume (m³)'],
        rows: s.walls.map((w) => [w.level, w.material, w.length, w.height, w.thickness, w.grossArea, w.netArea, w.volume]),
        decimals: [0, 0, 2, 2, 3, 2, 2, 2],
      }
    case 'areas':
      return {
        title: 'Areas (DIN 277)',
        headers: ['Usage group', 'Area (m²)'],
        rows: [
          ...s.areas.map((a) => [DIN277[a.usage] ?? a.usage, a.area]),
          ['NRF (net floor area)', s.totals.netFloorArea],
          ['BGF (gross floor area)', s.totals.grossFloorArea],
          ['BRI (gross volume, m³)', s.totals.grossVolume],
        ],
        decimals: [0, 2],
      }
  }
}

/** RFC 4180 CSV, UTF-8 with BOM, CRLF. ';' separator writes decimal commas (German Excel). */
export function tableCsv(t: Table, sep: ',' | ';' = ','): string {
  const cell = (v: string | number, i: number) => {
    let s = typeof v === 'number' ? v.toFixed(t.decimals[i] ?? 2) : v
    if (typeof v === 'number' && sep === ';') s = s.replace('.', ',')
    return s.includes(sep) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [t.headers.map(cell).join(sep), ...t.rows.map((r) => r.map(cell).join(sep))]
  return `﻿${lines.join('\r\n')}\r\n`
}

export async function exportCsv(ctx: ExportContext, opts: ExportOptions): Promise<ExportResult> {
  const kind = opts.schedule ?? 'rooms'
  const table = scheduleTable(await getSchedules(ctx), kind)
  return { blob: blobOf([tableCsv(table, opts.csvSeparator ?? ',')], 'text/csv;charset=utf-8'), fileName: `${safeFileName(`${ctx.doc.meta.name} - ${table.title}`, 'schedule')}.csv` }
}
