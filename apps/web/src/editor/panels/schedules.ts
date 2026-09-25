// Schedules: uses @cadsandbox/geometry computeSchedules when exported; otherwise a document-level
// fallback (room polygon areas, wall lengths, opening lists) so tables work before geometry lands.
import type { CadDocument, RoomUsage } from '@cadsandbox/doc'
import { polygonArea, polygonPerimeter } from '@cadsandbox/doc'
import type { GeometryService, Schedules } from '@cadsandbox/geometry'

type GeometryModule = Partial<{ computeSchedules: (doc: CadDocument, geometry?: GeometryService) => Schedules | Promise<Schedules> }>

let geomPromise: Promise<GeometryModule> | null = null
function loadGeometry(): Promise<GeometryModule> {
  if (!geomPromise) geomPromise = import('@cadsandbox/geometry').then((m) => m as unknown as GeometryModule).catch(() => ({}) as GeometryModule)
  return geomPromise
}

export const DIN277_LABELS: Record<RoomUsage, string> = {
  NUF1: 'Living / lounging',
  NUF2: 'Office work',
  NUF3: 'Production / experiments',
  NUF4: 'Storage / distribution',
  NUF5: 'Education / culture',
  NUF6: 'Healing / care',
  NUF7: 'Other uses',
  TF: 'Technical areas',
  VF: 'Circulation',
}

export function computeSchedulesLocal(doc: CadDocument): Schedules {
  const levelName = (id: string) => {
    const l = doc.getLevelOf(id)
    return l ? doc.getNode(l)?.name ?? '' : ''
  }
  const rooms = doc.nodesOfType('room').map((r) => {
    const area = Math.abs(polygonArea(r.params.outline))
    const perimeter = polygonPerimeter(r.params.outline)
    const levelId = doc.getLevelOf(r.id)
    const level = levelId ? doc.getNode<'level'>(levelId) : undefined
    const height = r.params.ceilingHeight ?? (level ? level.params.height - 0.2 : 2.5)
    return { id: r.id, number: r.params.number, name: r.name, level: levelName(r.id), usage: r.params.usage, area, perimeter, height, volume: area * height }
  })
  const openings = doc.nodesOfType('opening').map((o) => ({
    id: o.id,
    kind: o.params.kind,
    style: o.params.style,
    level: levelName(o.id),
    wall: o.parent ? doc.getNode(o.parent)?.name ?? '' : '',
    width: o.params.width,
    height: o.params.height,
    sill: o.params.sill,
    count: 1,
  }))
  const walls = doc.nodesOfType('wall').map((w) => {
    const dx = w.params.b[0] - w.params.a[0]
    const dy = w.params.b[1] - w.params.a[1]
    const length = Math.hypot(dx, dy)
    const grossArea = length * w.params.height
    const cut = doc
      .getChildren(w.id)
      .map((c) => doc.getNode<'opening'>(c))
      .filter((c): c is NonNullable<typeof c> => !!c && c.type === 'opening')
      .reduce((s, o) => s + o.params.width * o.params.height, 0)
    const netArea = Math.max(0, grossArea - cut)
    return { id: w.id, level: levelName(w.id), length, height: w.params.height, thickness: w.params.thickness, grossArea, netArea, volume: netArea * w.params.thickness, material: doc.getMaterial(w.material)?.name ?? '' }
  })
  const areaMap = new Map<string, number>()
  for (const r of rooms) areaMap.set(r.usage, (areaMap.get(r.usage) ?? 0) + r.area)
  const areas = [...areaMap.entries()].map(([usage, area]) => ({ usage, area }))
  const netFloorArea = rooms.reduce((s, r) => s + r.area, 0)
  const slabArea = doc.nodesOfType('slab').filter((s) => s.params.kind === 'floor').reduce((s, sl) => s + Math.abs(polygonArea(sl.params.outline)), 0)
  const grossFloorArea = slabArea || netFloorArea * 1.15
  const grossVolume = doc.levels().reduce((s, l) => s + l.params.height, 0) * (grossFloorArea / Math.max(1, doc.levels().length))
  return {
    rooms,
    doors: openings.filter((o) => o.kind === 'door'),
    windows: openings.filter((o) => o.kind === 'window'),
    walls,
    areas,
    totals: { netFloorArea, grossFloorArea, grossVolume },
  }
}

export async function computeSchedules(doc: CadDocument, geometry?: GeometryService): Promise<{ schedules: Schedules; source: 'geometry' | 'document' }> {
  const mod = await loadGeometry()
  if (typeof mod.computeSchedules === 'function') {
    try {
      return { schedules: await mod.computeSchedules(doc, geometry), source: 'geometry' }
    } catch {
      /* fall back */
    }
  }
  return { schedules: computeSchedulesLocal(doc), source: 'document' }
}

export type ScheduleKind = 'rooms' | 'doors' | 'windows' | 'walls' | 'areas'

const csvCell = (v: unknown) => {
  const s = typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(3)) : String(v ?? '')
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function scheduleToCsv(s: Schedules, kind: ScheduleKind): string {
  const rows: unknown[][] = []
  if (kind === 'rooms') {
    rows.push(['Number', 'Name', 'Level', 'Usage (DIN 277)', 'Area m²', 'Perimeter m', 'Height m', 'Volume m³'])
    for (const r of s.rooms) rows.push([r.number, r.name, r.level, r.usage, r.area, r.perimeter, r.height, r.volume])
  } else if (kind === 'doors' || kind === 'windows') {
    rows.push(['Id', 'Style', 'Level', 'Wall', 'Width m', 'Height m', 'Sill m', 'Count'])
    for (const o of s[kind]) rows.push([o.id, o.style, o.level, o.wall, o.width, o.height, o.sill, o.count])
  } else if (kind === 'walls') {
    rows.push(['Id', 'Level', 'Length m', 'Height m', 'Thickness m', 'Gross area m²', 'Net area m²', 'Volume m³', 'Material'])
    for (const w of s.walls) rows.push([w.id, w.level, w.length, w.height, w.thickness, w.grossArea, w.netArea, w.volume, w.material])
  } else {
    rows.push(['Usage', 'Area m²'])
    for (const a of s.areas) rows.push([a.usage, a.area])
    rows.push(['NRF (net floor area)', s.totals.netFloorArea])
    rows.push(['BGF (gross floor area)', s.totals.grossFloorArea])
    rows.push(['BRI (gross volume)', s.totals.grossVolume])
  }
  return rows.map((r) => r.map(csvCell).join(';')).join('\n')
}
