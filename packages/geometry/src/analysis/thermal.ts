// Thermal envelope basics (GEG): U-values after DIN EN ISO 6946 and a transmission-loss estimate HT'.
//   U = 1 / (Rsi + Σ d/λ + Rse); Rsi 0.13 (walls, horizontal heat flow), 0.10 (roofs, upward), 0.17
//   (floors, downward); Rse 0.04 to outside air, 0 against the ground; unventilated air layers after
//   ISO 6946 Table 8. Wall build-ups come from WallParams.layers (single-layer walls use the wall
//   material). Roof and slab build-ups are not modelled: node.meta.uValue overrides, otherwise the GEG
//   reference value is assumed. Windows default Uw 1.1, doors UD 1.3 (node.meta.uValue overrides).
//   HT = Σ Fx·U·A + ΔU_WB·ΣA (Fx 0.6 against the ground; ΔU_WB 0.05 assumes details after DIN 4108
//   Beiblatt 2, pass 0.10 when there is no thermal-bridge proof), compared with the GEG reference
//   building (Anlage 1 U-values, ΔU_WB 0.05) — GEG § 16 requires HT' ≤ 1.0 × reference for new
//   residential buildings.
import type { WallLayerFunction } from '@cadsandbox/doc'
import type { BuildingModel, LayerInfo, Status } from './building'

export type HeatFlow = 'horizontal' | 'up' | 'down'

export const RSI: Readonly<Record<HeatFlow, number>> = { horizontal: 0.13, up: 0.1, down: 0.17 }
export const RSE = 0.04

export type EnvelopeKind = 'wall' | 'wallGround' | 'window' | 'skylight' | 'door' | 'roof' | 'ground'

/** GEG Anlage 1 reference-building U-values, W/(m²K). */
export const GEG_REFERENCE_U: Readonly<Record<EnvelopeKind, number>> = { wall: 0.28, wallGround: 0.35, window: 1.3, skylight: 1.4, door: 1.8, roof: 0.2, ground: 0.35 }
/** Default U of openings when no override is set. */
export const DEFAULT_OPENING_U: Readonly<Record<'window' | 'skylight' | 'door', number>> = { window: 1.1, skylight: 1.3, door: 1.3 }
/** Temperature correction factors Fx (DIN V 4108-6, simplified). */
export const FX: Readonly<Record<EnvelopeKind, number>> = { wall: 1, wallGround: 0.6, window: 1, skylight: 1, door: 1, roof: 1, ground: 0.6 }
/** Thermal-bridge surcharge: DIN 4108 Beiblatt 2 details (default), without any proof, reference building. */
export const DELTA_UWB = 0.05
export const DELTA_UWB_NO_PROOF = 0.1
export const DELTA_UWB_REF = 0.05

// ISO 6946 Table 8: thermal resistance of unventilated air layers (m²K/W) by thickness (mm)
const AIR_D = [0, 5, 7, 10, 15, 25, 50, 100, 300]
const AIR_R: Record<HeatFlow, number[]> = {
  up: [0, 0.11, 0.13, 0.15, 0.16, 0.16, 0.16, 0.16, 0.16],
  horizontal: [0, 0.11, 0.13, 0.15, 0.17, 0.18, 0.18, 0.18, 0.18],
  down: [0, 0.11, 0.13, 0.15, 0.17, 0.19, 0.21, 0.22, 0.23],
}

/** Thermal resistance of an unventilated air layer (ISO 6946 Table 8, linear interpolation). */
export function airLayerResistance(thickness: number, flow: HeatFlow = 'horizontal'): number {
  const mm = Math.max(0, thickness * 1000)
  const R = AIR_R[flow]
  if (mm >= AIR_D[AIR_D.length - 1]!) return R[R.length - 1]!
  for (let i = 1; i < AIR_D.length; i++) {
    if (mm <= AIR_D[i]!) {
      const t = (mm - AIR_D[i - 1]!) / (AIR_D[i]! - AIR_D[i - 1]!)
      return R[i - 1]! + t * (R[i]! - R[i - 1]!)
    }
  }
  return R[R.length - 1]!
}

export interface ULayer {
  thickness: number
  lambda: number
  function?: WallLayerFunction
  name?: string
}

export interface UValueResult {
  u: number
  /** Total resistance R_T */
  rt: number
  rsi: number
  rse: number
  layers: { name: string; thickness: number; lambda: number; r: number }[]
  thickness: number
}

/** U-value of a layered build-up (DIN EN ISO 6946). */
export function uValue(layers: readonly ULayer[], flow: HeatFlow = 'horizontal', rse = RSE): UValueResult {
  const rsi = RSI[flow]
  let rt = rsi + rse
  let thickness = 0
  const out: UValueResult['layers'] = []
  for (const l of layers) {
    if (!(l.thickness > 0)) continue
    const r = l.function === 'air' ? airLayerResistance(l.thickness, flow) : l.thickness / Math.max(1e-6, l.lambda)
    rt += r
    thickness += l.thickness
    out.push({ name: l.name ?? '', thickness: l.thickness, lambda: l.lambda, r })
  }
  return { u: 1 / rt, rt, rsi, rse, layers: out, thickness }
}

export interface BuildUpRow {
  /** Signature of the build-up (materials + thicknesses) */
  key: string
  layers: LayerInfo[]
  thickness: number
  u: number
  uRef: number
  groundContact: boolean
  /** Net wall area (one face, centerline length × height − openings) */
  area: number
  wallIds: string[]
  /** U from node.meta.uValue */
  override: boolean
  /** Some λ came from a category fallback */
  assumed: boolean
  status: Status
}

export type USource = 'computed' | 'override' | 'default' | 'reference'

export interface EnvelopeRow {
  kind: EnvelopeKind
  /** Build-up key for walls */
  key?: string
  area: number
  /** Area-weighted U */
  u: number
  uRef: number
  fx: number
  /** Fx · U · A, W/K */
  h: number
  hRef: number
  source: USource
  status: Status
  nodeIds: string[]
}

export interface ThermalResult {
  buildUps: BuildUpRow[]
  elements: EnvelopeRow[]
  /** Envelope area A (m²) */
  area: number
  /** Transmission heat loss H_T incl. thermal bridges (W/K) */
  ht: number
  htRef: number
  /** H'T = H_T / A (W/(m²K)) */
  htPrime: number
  htPrimeRef: number
  /** H'T ÷ H'T,ref */
  ratio: number
  status: Status
  deltaUwb: number
}

const uStatus = (u: number, ref: number): Status => (u <= ref + 1e-9 ? 'pass' : 'warn')

export function computeThermal(model: BuildingModel, opts: { deltaUwb?: number } = {}): ThermalResult {
  const deltaUwb = opts.deltaUwb ?? DELTA_UWB
  // wall build-ups (envelope walls only)
  const groups = new Map<string, BuildUpRow>()
  for (const w of model.walls) {
    if (w.side !== 'exterior') continue
    const layerKey = w.layers.map((l) => `${l.material ?? '-'}:${l.thickness.toFixed(4)}:${l.function}`).join('|')
    const key = `${w.groundContact ? 'g' : 'a'}|${w.uOverride ?? ''}|${layerKey}`
    let row = groups.get(key)
    if (!row) {
      const res = uValue(w.layers, 'horizontal', w.groundContact ? 0 : RSE)
      const uRef = GEG_REFERENCE_U[w.groundContact ? 'wallGround' : 'wall']
      const u = w.uOverride ?? res.u
      row = { key, layers: w.layers, thickness: res.thickness, u, uRef, groundContact: w.groundContact, area: 0, wallIds: [], override: w.uOverride !== undefined, assumed: w.layers.some((l) => l.lambdaAssumed), status: uStatus(u, uRef) }
      groups.set(key, row)
    }
    row.area += w.netArea
    row.wallIds.push(w.id)
  }
  const buildUps = [...groups.values()].sort((a, b) => b.area - a.area)

  const elements: EnvelopeRow[] = []
  const push = (kind: EnvelopeKind, parts: { area: number; u: number; id: string; source: USource }[], key?: string) => {
    const area = parts.reduce((a, p) => a + p.area, 0)
    if (area <= 1e-9) return
    const ua = parts.reduce((a, p) => a + p.area * p.u, 0)
    const u = ua / area
    const uRef = GEG_REFERENCE_U[kind]
    const sources = new Set(parts.map((p) => p.source))
    const source: USource = sources.size === 1 ? [...sources][0]! : sources.has('reference') ? 'reference' : 'computed'
    elements.push({ kind, key, area, u, uRef, fx: FX[kind], h: FX[kind] * ua, hRef: FX[kind] * uRef * area, source, status: source === 'reference' ? 'info' : uStatus(u, uRef), nodeIds: parts.map((p) => p.id) })
  }
  for (const b of buildUps) push(b.groundContact ? 'wallGround' : 'wall', b.wallIds.map((id) => ({ id, area: model.walls.find((w) => w.id === id)!.netArea, u: b.u, source: b.override ? 'override' : 'computed' })), b.key)
  const wins: { area: number; u: number; id: string; source: USource }[] = []
  const skys: typeof wins = []
  const doors: typeof wins = []
  for (const o of model.openings) {
    if (!o.exterior || o.kind === 'opening') continue
    const kind = o.kind === 'door' ? 'door' : o.style === 'skylight' ? 'skylight' : 'window'
    const entry = { id: o.id, area: o.area, u: o.uOverride ?? DEFAULT_OPENING_U[kind], source: (o.uOverride !== undefined ? 'override' : 'default') as USource }
    ;(kind === 'door' ? doors : kind === 'skylight' ? skys : wins).push(entry)
  }
  push('window', wins)
  push('skylight', skys)
  push('door', doors)
  const roofParts = [
    ...model.roofs.map((r) => ({ id: r.id, area: r.area, u: r.uOverride ?? GEG_REFERENCE_U.roof, source: (r.uOverride !== undefined ? 'override' : 'reference') as USource })),
    ...model.slabs.filter((s) => s.kind === 'roof').map((s) => ({ id: s.id, area: s.area, u: s.uOverride ?? GEG_REFERENCE_U.roof, source: (s.uOverride !== undefined ? 'override' : 'reference') as USource })),
  ]
  push('roof', roofParts)
  const lowest = model.levels[0]
  if (lowest) {
    const base = model.slabs.filter((s) => s.levelId === lowest.id && (s.kind === 'floor' || s.kind === 'foundation'))
    if (base.length) push('ground', base.map((s) => ({ id: s.id, area: s.area, u: s.uOverride ?? GEG_REFERENCE_U.ground, source: (s.uOverride !== undefined ? 'override' : 'reference') as USource })))
    else if (lowest.bgf > 0) push('ground', [{ id: lowest.id, area: lowest.bgf, u: GEG_REFERENCE_U.ground, source: 'reference' }])
  }

  const area = elements.reduce((a, e) => a + e.area, 0)
  const ht = elements.reduce((a, e) => a + e.h, 0) + deltaUwb * area
  const htRef = elements.reduce((a, e) => a + e.hRef, 0) + DELTA_UWB_REF * area
  const htPrime = area > 0 ? ht / area : 0
  const htPrimeRef = area > 0 ? htRef / area : 0
  const ratio = htRef > 0 ? ht / htRef : 0
  const status: Status = area <= 0 || model.buildingType !== 'residential' ? 'info' : ratio <= 0.97 ? 'pass' : ratio <= 1 + 1e-9 ? 'warn' : 'fail'
  return { buildUps, elements, area, ht, htRef, htPrime, htPrimeRef, ratio, status, deltaUwb }
}
