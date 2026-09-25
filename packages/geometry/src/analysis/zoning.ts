// Zoning (Maß der baulichen Nutzung, BauNVO §§ 16–21) against the development-plan limits in
// DocMeta.site.zoning:
//   GRZ = building footprint (outlines of storeys above ground) ÷ plot area (§ 19, main building only)
//   GFZ = Σ BGF of full storeys (Vollgeschosse) ÷ plot area (§ 20 (3), outer dimensions)
//   BMZ = Σ BGF × storey height of full storeys ÷ plot area (§ 21 (2))
//   Z   = number of full storeys; H = highest point − ground level.
// Full storey (MBO § 2 (6)): top more than 1.40 m above ground on average and a clear height of
// ≥ 2.30 m over at least two thirds of the floor area (attics: of the storey below). Override per level
// with LevelParams.fullStorey.
import { polygonArea } from '../core/math2d'
import type { BuildingModel, Status } from './building'
import type { Din277Result } from './din277'

export type StoreyReason = 'override' | 'basement' | 'low' | 'empty' | 'full'

export interface StoreyInfo {
  levelId: string
  name: string
  elevation: number
  height: number
  bgf: number
  full: boolean
  auto: boolean
  reason: StoreyReason
  /** Share of the reference area with a clear height ≥ 2.30 m */
  share230: number
}

export type ZoningKey = 'grz' | 'gfz' | 'bmz' | 'storeys' | 'height'

export interface ZoningRow {
  key: ZoningKey
  value: number | null
  limit: number | null
  status: Status
  rule: string
}

export interface ZoningResult {
  /** Plot area (site.plotArea or the plotOutline area); null when unknown */
  plotArea: number | null
  footprint: number
  /** Geschossfläche: Σ BGF of full storeys */
  floorArea: number
  /** Baumasse: Σ BGF × height of full storeys (m³) */
  mass: number
  fullStoreys: number
  /** Highest point above ground level (m) */
  height: number
  storeys: StoreyInfo[]
  rows: ZoningRow[]
}

/** pass ≤ 97 % of the limit, warn up to the limit (model tolerance), fail above; info without limit. */
export function limitStatus(value: number | null, limit: number | null | undefined, integer = false): Status {
  if (value == null || limit == null || !Number.isFinite(limit)) return 'info'
  if (integer) return value <= limit ? 'pass' : 'fail'
  if (value <= limit * 0.97 + 1e-12) return 'pass'
  return value <= limit + 1e-9 ? 'warn' : 'fail'
}

export function computeZoning(model: BuildingModel, din277: Din277Result): ZoningResult {
  const site = model.site
  const zoning = site.zoning ?? {}
  const outlineArea = site.plotOutline && site.plotOutline.length >= 3 ? Math.abs(polygonArea(site.plotOutline)) : 0
  const plotArea = site.plotArea && site.plotArea > 0 ? site.plotArea : outlineArea > 0 ? outlineArea : null

  const storeys: StoreyInfo[] = model.levels.map((l, i) => {
    const info: StoreyInfo = { levelId: l.id, name: l.name, elevation: l.elevation, height: l.height, bgf: l.bgf, full: false, auto: l.fullStoreyOverride === undefined, reason: 'full', share230: 0 }
    const s = model.levelClearHeights(l.id)
    let ok = 0
    for (const h of s.heights) if (h >= 2.3 - 1e-9) ok++
    const below = i > 0 ? model.levels[i - 1]! : null
    const ownShare = s.heights.length ? ok / s.heights.length : 0
    // attic storeys (roof above) compare with the floor area of the storey below
    const ref = s.hits > 0 && below && below.bgf > 0 ? below.bgf : l.bgf
    info.share230 = ref > 0 ? Math.min(1, (ownShare * l.bgf) / ref) : 0
    if (l.fullStoreyOverride !== undefined) {
      info.full = l.fullStoreyOverride
      info.reason = 'override'
    } else if (l.bgf <= 0) info.reason = 'empty'
    else if (l.belowGround) info.reason = 'basement'
    else if (info.share230 < 2 / 3 - 1e-9) info.reason = 'low'
    else info.full = true
    return info
  })

  const full = storeys.filter((s) => s.full)
  const floorArea = full.reduce((a, s) => a + s.bgf, 0)
  const mass = full.reduce((a, s) => a + s.bgf * s.height, 0)
  const height = Math.max(0, model.top - model.groundLevel)
  const footprint = din277.footprint
  const ratio = (v: number) => (plotArea ? v / plotArea : null)
  const rows: ZoningRow[] = [
    { key: 'grz', value: ratio(footprint), limit: zoning.grz ?? null, status: limitStatus(ratio(footprint), zoning.grz), rule: 'BauNVO § 19' },
    { key: 'gfz', value: ratio(floorArea), limit: zoning.gfz ?? null, status: limitStatus(ratio(floorArea), zoning.gfz), rule: 'BauNVO § 20' },
    { key: 'bmz', value: ratio(mass), limit: zoning.bmz ?? null, status: limitStatus(ratio(mass), zoning.bmz), rule: 'BauNVO § 21' },
    { key: 'storeys', value: full.length, limit: zoning.maxStoreys ?? null, status: limitStatus(full.length, zoning.maxStoreys, true), rule: 'BauNVO § 20 (1), MBO § 2 (6)' },
    { key: 'height', value: height, limit: zoning.maxHeight ?? null, status: limitStatus(height, zoning.maxHeight), rule: 'BauNVO § 18' },
  ]
  return { plotArea, footprint, floorArea, mass, fullStoreys: full.length, height, storeys, rows }
}
