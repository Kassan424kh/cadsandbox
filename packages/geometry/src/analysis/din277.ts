// DIN 277:2021 areas and volumes per level + total:
//   BGF (R) = area inside the outer boundary of the joined wall footprints (outer faces, no holes),
//   BGF (S) = balconies / loggias / terraces (outdoor rooms, balcony slabs) outside BGF (R),
//   NRF = Σ room areas split into NUF 1–7, TF, VF (from RoomParams.usage), KGF = BGF − NRF,
//   BRI (R) = sampled columns from the underside of the lowest floor slab to the storey top or the
//   roof surface above (attic volumes follow the roof; overhangs are excluded).
import type { RoomUsage } from '@cadsandbox/doc'
import { differencePolygons, polygonsArea, unionPolygons, type PolyWithHoles } from '../core/polygon'
import { insideOutline, samplePolys, type BuildingModel } from './building'

export interface Din277Values {
  /** Brutto-Grundfläche, Regelfall (enclosed on all sides, full height) */
  bgf: number
  /** Brutto-Grundfläche, Sonderfall (balconies, loggias, terraces) */
  bgfS: number
  /** Konstruktions-Grundfläche = BGF − NRF */
  kgf: number
  /** Netto-Raumfläche (R) = NUF + TF + VF */
  nrf: number
  nuf: number
  tf: number
  vf: number
  /** Netto-Raumfläche of outdoor (S) rooms */
  nrfS: number
  /** Brutto-Rauminhalt (R), m³ */
  bri: number
  rooms: number
}

export interface Din277Level extends Din277Values {
  levelId: string
  name: string
  elevation: number
  height: number
}

export interface Din277Result {
  levels: Din277Level[]
  total: Din277Values
  /** NRF (R) per usage group */
  usage: { usage: RoomUsage; area: number }[]
  /** Building footprint: union of the outlines of levels above ground (m²) */
  footprint: number
  /** Union outline of all above-ground levels (world XY) */
  footprintPolys: PolyWithHoles[]
}

const USAGES: RoomUsage[] = ['NUF1', 'NUF2', 'NUF3', 'NUF4', 'NUF5', 'NUF6', 'NUF7', 'TF', 'VF']

const zero = (): Din277Values => ({ bgf: 0, bgfS: 0, kgf: 0, nrf: 0, nuf: 0, tf: 0, vf: 0, nrfS: 0, bri: 0, rooms: 0 })

export function computeDin277(model: BuildingModel, opts: { spacing?: number } = {}): Din277Result {
  const byUsage = new Map<RoomUsage, number>()
  const levels: Din277Level[] = model.levels.map((l) => {
    const v: Din277Level = { levelId: l.id, name: l.name, elevation: l.elevation, height: l.height, ...zero(), bgf: l.bgf }
    const sPolys: PolyWithHoles[] = []
    for (const r of model.rooms) {
      if (r.levelId !== l.id) continue
      v.rooms++
      if (r.outdoor) {
        v.nrfS += r.area
        sPolys.push(...r.polys)
        continue
      }
      v.nrf += r.area
      if (r.usage === 'TF') v.tf += r.area
      else if (r.usage === 'VF') v.vf += r.area
      else v.nuf += r.area
      byUsage.set(r.usage, (byUsage.get(r.usage) ?? 0) + r.area)
    }
    for (const s of model.slabs) if (s.levelId === l.id && s.kind === 'balcony') sPolys.push(...s.polys)
    if (sPolys.length) {
      const u = unionPolygons(sPolys)
      v.bgfS = polygonsArea(l.outline.length ? differencePolygons(u, l.outline) : u)
    }
    v.kgf = Math.max(0, v.bgf - v.nrf)
    return v
  })

  // BRI (R): vertical columns over the union of all level outlines
  const all = model.levels.flatMap((l) => l.outline)
  const union = all.length ? unionPolygons(all) : []
  if (union.length) {
    const exact = polygonsArea(union)
    const { points } = samplePolys(union, opts.spacing ?? 0.25, 30_000)
    const n = points.length / 2
    const sorted = [...model.levels].sort((a, b) => a.elevation - b.elevation)
    const baseSlab = new Map<string, number>()
    for (const s of model.slabs) if (s.levelId && (s.kind === 'floor' || s.kind === 'foundation')) baseSlab.set(s.levelId, Math.max(baseSlab.get(s.levelId) ?? 0, s.thickness))
    const acc = new Map<string, number>()
    const roofsOnly = (o: { type: string }) => o.type === 'roof'
    for (let i = 0; i < n; i++) {
      const p: [number, number] = [points[i * 2]!, points[i * 2 + 1]!]
      let lowest: (typeof sorted)[number] | null = null
      let zTop = -Infinity
      for (const l of sorted) {
        if (!insideOutline(p, l.outline)) continue
        if (!lowest) lowest = l
        zTop = Math.max(zTop, l.elevation + l.height)
      }
      if (!lowest) continue
      const zBottom = lowest.elevation - (baseSlab.get(lowest.id) ?? 0)
      const roof = model.cover.highestAt(p[0], p[1], roofsOnly)
      if (Number.isFinite(roof) && roof > zBottom) zTop = roof
      if (zTop <= zBottom) continue
      // split the column into storey slices [elev_i, elev_i+1) (lowest open below, highest open above)
      for (let k = 0; k < sorted.length; k++) {
        const lo = k === 0 ? -Infinity : sorted[k]!.elevation
        const hi = k === sorted.length - 1 ? Infinity : sorted[k + 1]!.elevation
        const len = Math.min(hi, zTop) - Math.max(lo, zBottom)
        if (len > 0) acc.set(sorted[k]!.id, (acc.get(sorted[k]!.id) ?? 0) + len)
      }
    }
    const cellArea = n ? exact / n : 0
    for (const v of levels) v.bri = (acc.get(v.levelId) ?? 0) * cellArea
  }

  const total = zero()
  for (const v of levels) for (const k of Object.keys(total) as (keyof Din277Values)[]) total[k] += v[k]
  const above = model.levels.filter((l) => !l.belowGround).flatMap((l) => l.outline)
  const footprintPolys = above.length ? unionPolygons(above).map((u) => ({ outer: u.outer, holes: [] })) : []
  return {
    levels,
    total,
    usage: USAGES.filter((u) => (byUsage.get(u) ?? 0) > 0).map((u) => ({ usage: u, area: byUsage.get(u)! })),
    footprint: polygonsArea(footprintPolys),
    footprintPolys,
  }
}
