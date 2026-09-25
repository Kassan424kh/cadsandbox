// DIN 276:2018-12 cost estimate (Kostenschätzung) from model quantities × unit prices.
// KG 300 (construction) per element with 3-digit cost groups; KG 390 site setup/scaffolding as a
// share of 310–380; KG 400 (building services) as a share of KG 300 split by typical proportions.
// Default unit prices: Germany average, price basis ≈ 2025, gross incl. 19 % VAT (BKI-type reference
// values) — planning figures only; override them per project in DocMeta.costCatalog.
import type { BuildingType, CostCatalog } from '@cadsandbox/doc'
import type { BuildingModel } from './building'
import type { Din277Result } from './din277'
import type { WoflvResult } from './woflv'

/** m2 / m3 / m / pieces; 'pct' = share of a base amount (quantity = base in currency). */
export type CostUnit = 'm2' | 'm3' | 'm' | 'pcs' | 'pct'

export interface CostItemDef {
  id: string
  /** DIN 276 cost group */
  kg: string
  label: string
  unit: CostUnit
  /** Unit price (currency per unit) or share for 'pct' */
  price: number
}

export const DEFAULT_COST_ITEMS: readonly CostItemDef[] = [
  { id: 'excavation', kg: '311', label: 'Excavation (basement volume)', unit: 'm3', price: 45 },
  { id: 'base-slab', kg: '322', label: 'Ground slab / foundations', unit: 'm2', price: 190 },
  { id: 'ext-wall-load', kg: '331', label: 'Load-bearing external walls', unit: 'm2', price: 230 },
  { id: 'ext-wall-nonload', kg: '332', label: 'Non-load-bearing external walls', unit: 'm2', price: 170 },
  { id: 'windows', kg: '334', label: 'Windows', unit: 'm2', price: 650 },
  { id: 'ext-doors', kg: '334', label: 'External doors', unit: 'pcs', price: 3000 },
  { id: 'ext-cladding', kg: '335', label: 'External wall finish (ETICS / render)', unit: 'm2', price: 150 },
  { id: 'ext-lining', kg: '336', label: 'Internal finish of external walls', unit: 'm2', price: 38 },
  { id: 'int-wall-load', kg: '341', label: 'Load-bearing internal walls', unit: 'm2', price: 170 },
  { id: 'int-wall-nonload', kg: '342', label: 'Non-load-bearing internal walls', unit: 'm2', price: 100 },
  { id: 'columns', kg: '343', label: 'Columns', unit: 'm', price: 320 },
  { id: 'int-doors', kg: '344', label: 'Internal doors', unit: 'pcs', price: 950 },
  { id: 'int-lining', kg: '345', label: 'Internal wall finishes (both faces)', unit: 'm2', price: 32 },
  { id: 'floor-slab', kg: '351', label: 'Floor slabs / ceilings', unit: 'm2', price: 200 },
  { id: 'stairs', kg: '351', label: 'Stairs (per flight)', unit: 'pcs', price: 7500 },
  { id: 'floor-finish', kg: '353', label: 'Floor finishes (screed + covering)', unit: 'm2', price: 110 },
  { id: 'ceiling-finish', kg: '354', label: 'Ceiling finishes', unit: 'm2', price: 35 },
  { id: 'railings', kg: '359', label: 'Railings / balustrades', unit: 'm', price: 380 },
  { id: 'roof-structure', kg: '361', label: 'Roof structure', unit: 'm2', price: 150 },
  { id: 'skylights', kg: '362', label: 'Roof windows / skylights', unit: 'm2', price: 1400 },
  { id: 'roof-covering', kg: '363', label: 'Roof covering incl. insulation', unit: 'm2', price: 170 },
  { id: 'roof-lining', kg: '364', label: 'Roof lining (inside)', unit: 'm2', price: 50 },
  { id: 'site-setup', kg: '390', label: 'Site setup, scaffolding (share of 310–380)', unit: 'pct', price: 0.05 },
]

/** DIN 276 cost group titles (English; German via the UI dictionary `analysis.kg.<code>`). */
export const KG_LABELS: Readonly<Record<string, string>> = {
  '300': 'Building – construction',
  '310': 'Excavation / earthworks',
  '320': 'Foundations / substructure',
  '330': 'External walls',
  '340': 'Internal walls',
  '350': 'Floors / ceilings',
  '360': 'Roofs',
  '390': 'Other construction measures',
  '400': 'Building – services',
  '410': 'Sewage, water, gas',
  '420': 'Heat supply',
  '430': 'Ventilation / air conditioning',
  '440': 'Electrical systems',
  '450': 'Communication, security, IT',
  '460': 'Conveyor systems / lifts',
  '470': 'Use-specific systems',
  '480': 'Building automation',
}

/** KG 400 ÷ KG 300 by building type (typical German reference ratios). */
export const DEFAULT_SERVICES_RATIO: Readonly<Record<BuildingType, number>> = { residential: 0.28, office: 0.4, public: 0.4, other: 0.3 }

/** Typical split of KG 400 into its 2nd-level groups. */
export const SERVICES_SPLIT: Readonly<Record<'residential' | 'nonresidential', Readonly<Record<string, number>>>> = {
  residential: { '410': 0.22, '420': 0.26, '430': 0.08, '440': 0.3, '450': 0.08, '460': 0, '470': 0.02, '480': 0.04 },
  nonresidential: { '410': 0.15, '420': 0.2, '430': 0.2, '440': 0.25, '450': 0.1, '460': 0.04, '470': 0.02, '480': 0.04 },
}

export interface CostLine {
  id: string
  kg: string
  label: string
  unit: CostUnit
  quantity: number
  /** Effective unit price (override × region factor) or share for 'pct' */
  unitPrice: number
  /** Catalog default before overrides / region factor */
  defaultPrice: number
  total: number
  overridden: boolean
  /** Quantity estimated from BGF/NRF because the elements are not modelled */
  estimated: boolean
}

export interface CostGroupTotal {
  kg: string
  label: string
  total: number
}

export interface CostEstimate {
  lines: CostLine[]
  /** 2nd-level groups (310 … 390, 410 … 480) */
  groups: CostGroupTotal[]
  kg300: number
  kg400: number
  /** KG 300 + 400 (Bauwerkskosten) as priced (gross when vatIncluded) */
  total: number
  net: number
  vat: number
  gross: number
  currency: string
  servicesRatio: number
  regionFactor: number
  vatIncluded: boolean
  vatRate: number
  /** Cost indicators (Kostenkennwerte) based on KG 300+400 */
  perBgf: number | null
  perBri: number | null
  perNuf: number | null
  perLivingArea: number | null
}

/** Model quantities per catalog element. */
export function costQuantities(model: BuildingModel, din277: Din277Result): Record<string, { q: number; estimated: boolean }> {
  const Q: Record<string, { q: number; estimated: boolean }> = {}
  const set = (id: string, q: number, estimated = false) => (Q[id] = { q, estimated })
  const lowest = model.levels[0]
  const ground = model.groundLevel
  set('excavation', model.levels.filter((l) => l.elevation < ground).reduce((a, l) => a + l.bgf * Math.min(l.height, ground - l.elevation), 0))
  const baseSlabs = model.slabs.filter((s) => s.levelId === lowest?.id && (s.kind === 'floor' || s.kind === 'foundation'))
  if (baseSlabs.length) set('base-slab', baseSlabs.reduce((a, s) => a + s.area, 0))
  else set('base-slab', lowest?.bgf ?? 0, true)
  let extLoad = 0, extNon = 0, intLoad = 0, intNon = 0
  for (const w of model.walls) {
    if (w.side === 'exterior') {
      if (w.structural) extLoad += w.netArea
      else extNon += w.netArea
    } else if (w.structural) intLoad += w.netArea
    else intNon += w.netArea
  }
  set('ext-wall-load', extLoad)
  set('ext-wall-nonload', extNon)
  set('ext-cladding', extLoad + extNon)
  set('ext-lining', extLoad + extNon)
  set('int-wall-load', intLoad)
  set('int-wall-nonload', intNon)
  set('int-lining', 2 * (intLoad + intNon))
  let windows = 0, skylights = 0, extDoors = 0, intDoors = 0
  for (const o of model.openings) {
    if (o.kind === 'window') {
      if (o.style === 'skylight') skylights += o.area
      else windows += o.area
    } else if (o.kind === 'door') {
      if (o.exterior) extDoors++
      else intDoors++
    }
  }
  set('windows', windows)
  set('skylights', skylights)
  set('ext-doors', extDoors)
  set('int-doors', intDoors)
  set('columns', model.columns.reduce((a, c) => a + c.height, 0))
  const upperSlabs = model.slabs.filter((s) => s.levelId !== lowest?.id && (s.kind === 'floor' || s.kind === 'ceiling' || s.kind === 'balcony'))
  if (upperSlabs.length) set('floor-slab', upperSlabs.reduce((a, s) => a + s.area, 0))
  else set('floor-slab', model.levels.slice(1).reduce((a, l) => a + l.bgf, 0), true)
  set('stairs', model.stairs.length)
  const nrf = din277.total.nrf
  if (nrf > 0) {
    set('floor-finish', nrf)
    set('ceiling-finish', nrf)
  } else {
    set('floor-finish', din277.total.bgf * 0.8, true)
    set('ceiling-finish', din277.total.bgf * 0.8, true)
  }
  set('railings', model.railings.reduce((a, r) => a + r.length, 0))
  const roofArea = model.roofs.reduce((a, r) => a + r.area, 0) + model.slabs.filter((s) => s.kind === 'roof').reduce((a, s) => a + s.area, 0)
  set('roof-structure', roofArea)
  set('roof-covering', roofArea)
  set('roof-lining', roofArea)
  return Q
}

export function estimateCosts(model: BuildingModel, din277: Din277Result, woflv: WoflvResult | null, catalog: CostCatalog = {}): CostEstimate {
  const Q = costQuantities(model, din277)
  const region = catalog.regionFactor && catalog.regionFactor > 0 ? catalog.regionFactor : 1
  const lines: CostLine[] = []
  for (const def of DEFAULT_COST_ITEMS) {
    if (def.unit === 'pct') continue
    const o = catalog.items?.[def.id]
    const price = o?.price ?? def.price
    const q = Q[def.id] ?? { q: 0, estimated: false }
    lines.push({
      id: def.id,
      kg: o?.kg ?? def.kg,
      label: o?.label ?? def.label,
      unit: def.unit,
      quantity: q.q,
      unitPrice: price * region,
      defaultPrice: def.price,
      total: q.q * price * region,
      overridden: o?.price !== undefined || o?.kg !== undefined || o?.label !== undefined,
      estimated: q.estimated && q.q > 0,
    })
  }
  const base = lines.reduce((a, l) => a + l.total, 0)
  for (const def of DEFAULT_COST_ITEMS) {
    if (def.unit !== 'pct') continue
    const o = catalog.items?.[def.id]
    const share = o?.price ?? def.price
    lines.push({ id: def.id, kg: o?.kg ?? def.kg, label: o?.label ?? def.label, unit: 'pct', quantity: base, unitPrice: share, defaultPrice: def.price, total: base * share, overridden: o?.price !== undefined, estimated: false })
  }
  const kg300 = lines.reduce((a, l) => a + l.total, 0)
  const servicesRatio = catalog.servicesRatio ?? DEFAULT_SERVICES_RATIO[model.buildingType] ?? 0.3
  const split = SERVICES_SPLIT[model.buildingType === 'residential' ? 'residential' : 'nonresidential']
  for (const [kg, share] of Object.entries(split)) {
    if (share <= 0) continue
    lines.push({ id: `services-${kg}`, kg, label: KG_LABELS[kg] ?? kg, unit: 'pct', quantity: kg300, unitPrice: servicesRatio * share, defaultPrice: servicesRatio * share, total: kg300 * servicesRatio * share, overridden: false, estimated: false })
  }
  const kg400 = kg300 * servicesRatio
  const groupMap = new Map<string, number>()
  for (const l of lines) {
    const g = `${l.kg.slice(0, 2)}0`
    groupMap.set(g, (groupMap.get(g) ?? 0) + l.total)
  }
  const groups = [...groupMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([kg, total]) => ({ kg, label: KG_LABELS[kg] ?? kg, total }))
  const total = kg300 + kg400
  const vatRate = catalog.vatRate ?? 0.19
  const vatIncluded = catalog.vatIncluded ?? true
  const gross = vatIncluded ? total : total * (1 + vatRate)
  const net = vatIncluded ? total / (1 + vatRate) : total
  const per = (d: number | undefined) => (d && d > 0 ? total / d : null)
  return {
    lines,
    groups,
    kg300,
    kg400,
    total,
    net,
    vat: gross - net,
    gross,
    currency: catalog.currency ?? 'EUR',
    servicesRatio,
    regionFactor: region,
    vatIncluded,
    vatRate,
    perBgf: per(din277.total.bgf),
    perBri: per(din277.total.bri),
    perNuf: per(din277.total.nuf),
    perLivingArea: per(woflv?.total),
  }
}
