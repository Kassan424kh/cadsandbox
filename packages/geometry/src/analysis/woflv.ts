// Living area after the Wohnflächenverordnung (WoFlV 2004):
//   § 4: clear height ≥ 2 m → 100 %, 1–2 m → 50 %, < 1 m → 0 % (sampled on a ~0.1 m grid against the
//        slabs/roofs above the room, capped by the room's ceiling height); balconies, loggias, roof
//        gardens and terraces → 25 % (RoomParams.outdoorFactor, at most 50 %).
//   § 3 (3): stairs with more than three risers (incl. landings) and chimneys/pillars/columns with a
//        footprint > 0.1 m² and a height > 1.5 m are not counted. Door niches are outside the room
//        outline already (room outlines follow the wall faces).
//   § 2 (3): accessory rooms (cellars, garages, boiler/laundry rooms, attic storage) are not living
//        space — rooms default by name/usage/level unless RoomParams.livingSpace is set.
import type { RoomOutdoorKind } from '@cadsandbox/doc'
import { intersectPolygons, pointInPolys, polygonsArea, unionPolygons, nestRings, type PolyWithHoles } from '../core/polygon'
import type { BuildingModel } from './building'

export interface WoflvRow {
  id: string
  number: string
  name: string
  levelId: string
  level: string
  /** Counts toward the living area */
  counted: boolean
  /** true = `counted` was derived (RoomParams.livingSpace unset) */
  auto: boolean
  outdoor: RoomOutdoorKind | null
  /** Room floor area (inside the wall faces) */
  floorArea: number
  /** Not counted: stairs > 3 risers + landings, pillars/chimneys > 0.1 m² and > 1.5 m */
  excluded: number
  /** Area with clear height ≥ 2 m (100 %) */
  full: number
  /** Area with clear height 1–2 m (50 %) */
  half: number
  /** Area with clear height < 1 m (0 %) */
  low: number
  /** Share applied to outdoor areas (else 1) */
  factor: number
  livingArea: number
  minHeight: number
  maxHeight: number
  /** Clear height sampled against modelled geometry above (sloped ceilings / roofs) */
  sampled: boolean
}

export interface WoflvResult {
  rows: WoflvRow[]
  total: number
  byLevel: { levelId: string; name: string; area: number }[]
}

export function computeWoflv(model: BuildingModel, opts: { spacing?: number } = {}): WoflvResult {
  const levelName = new Map(model.levels.map((l) => [l.id, l.name]))
  const rows: WoflvRow[] = []
  for (const r of model.rooms) {
    const row: WoflvRow = {
      id: r.id,
      number: r.number,
      name: r.name,
      levelId: r.levelId,
      level: levelName.get(r.levelId) ?? '',
      counted: r.livingSpace,
      auto: r.livingSpaceAuto,
      outdoor: r.outdoor,
      floorArea: r.area,
      excluded: 0,
      full: 0,
      half: 0,
      low: 0,
      factor: r.outdoor ? r.outdoorFactor : 1,
      livingArea: 0,
      minHeight: r.height,
      maxHeight: r.height,
      sampled: false,
    }
    rows.push(row)
    if (!r.livingSpace) continue
    if (r.outdoor) {
      row.full = r.area
      row.livingArea = r.area * row.factor
      continue
    }
    // § 3 (3) exclusions on this level
    const excl: PolyWithHoles[] = []
    for (const s of model.stairs) if (s.levelId === r.levelId && s.risers > 3) excl.push(...nestRings([s.ring]))
    for (const c of model.columns) if (c.levelId === r.levelId && c.area > 0.1 && c.height > 1.5) excl.push(...nestRings([c.ring]))
    const exclPolys = excl.length ? intersectPolygons(r.polys, unionPolygons(excl)) : []
    row.excluded = polygonsArea(exclPolys)
    const net = Math.max(0, r.area - row.excluded)
    const s = model.roomClearHeights(r.id, opts.spacing)
    let n = 0, n2 = 0, n1 = 0
    let lo = Infinity, hi = -Infinity
    for (let i = 0; i < s.heights.length; i++) {
      if (exclPolys.length && pointInPolys([s.points[i * 2]!, s.points[i * 2 + 1]!], exclPolys)) continue
      const h = s.heights[i]!
      n++
      if (h >= 2 - 1e-9) n2++
      else if (h >= 1 - 1e-9) n1++
      lo = Math.min(lo, h)
      hi = Math.max(hi, h)
    }
    if (n) {
      row.full = (net * n2) / n
      row.half = (net * n1) / n
      row.low = net - row.full - row.half
      row.minHeight = lo
      row.maxHeight = hi
    } else row.full = net
    row.sampled = s.hits > 0
    row.livingArea = row.full + 0.5 * row.half
  }
  const byLevel = model.levels
    .map((l) => ({ levelId: l.id, name: l.name, area: rows.filter((r) => r.levelId === l.id).reduce((a, r) => a + r.livingArea, 0) }))
    .filter((l) => l.area > 0)
  return { rows, total: rows.reduce((a, r) => a + r.livingArea, 0), byLevel }
}
