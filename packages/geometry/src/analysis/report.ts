// One-call architecture analysis: DIN 277 areas/volumes, WoFlV living area, zoning (GRZ/GFZ/BMZ),
// DIN 276 cost estimate, GEG thermal basics and compliance checks — all computed on the client from
// the document + GeometryService results. Planning estimates, not a legal certificate.
import type { CadDocument } from '@cadsandbox/doc'
import type { GeometryService } from '../api'
import { collectBuilding, type BuildingModel, type CollectOptions, type Status } from './building'
import { runChecks, type CheckResult } from './checks'
import { estimateCosts, type CostEstimate } from './din276'
import { computeDin277, type Din277Result } from './din277'
import { computeThermal, type ThermalResult } from './thermal'
import { computeWoflv, type WoflvResult } from './woflv'
import { computeZoning, type ZoningResult } from './zoning'

export interface AnalysisReport {
  generatedAt: number
  model: BuildingModel
  din277: Din277Result
  woflv: WoflvResult
  zoning: ZoningResult
  costs: CostEstimate
  thermal: ThermalResult
  checks: CheckResult[]
  /** Check counts by status */
  summary: Record<Status, number>
  /** Duration of the analysis (ms) */
  ms: number
}

/** Analyze the building; call after `await service.idle()` for current geometry. */
export function analyzeBuilding(doc: CadDocument, service: GeometryService, opts: CollectOptions = {}): AnalysisReport {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const model = collectBuilding(doc, service, opts)
  const din277 = computeDin277(model)
  const woflv = computeWoflv(model, { spacing: opts.spacing })
  const zoning = computeZoning(model, din277)
  const costs = estimateCosts(model, din277, woflv, doc.meta.costCatalog ?? {})
  const thermal = computeThermal(model)
  const checks = runChecks(model, { zoning, thermal })
  const summary: Record<Status, number> = { pass: 0, warn: 0, fail: 0, info: 0 }
  for (const c of checks) summary[c.status]++
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now()
  return { generatedAt: Date.now(), model, din277, woflv, zoning, costs, thermal, checks, summary, ms: t1 - t0 }
}
