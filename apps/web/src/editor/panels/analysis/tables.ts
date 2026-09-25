// Analysis panel data: localized labels, table models shared by the CSV export (raw numbers, UTF-8
// BOM, ';' → decimal comma) and the printable PDF report (@cadsandbox/io exportReportPdf).
import type { SiteInfo } from '@cadsandbox/doc'
import {
  DEFAULT_COST_ITEMS,
  KG_LABELS,
  lboProfile,
  type AnalysisReport,
  type AnalysisStatus,
  type CheckCategory,
  type CheckResult,
  type CostLine,
  type CostUnit,
  type EnvelopeKind,
  type StoreyReason,
  type ThermalResult,
  type USource,
  type ZoningKey,
} from '@cadsandbox/geometry'
import type { ReportDocument, ReportTable } from '@cadsandbox/io'
import { t } from '../../../i18n'
import { formatDate, formatNumber } from '../../../i18n/format'

export type AnalysisTab = 'areas' | 'zoning' | 'costs' | 'energy' | 'checks'

// ------------------------------------------------------------------ labels
export const statusLabel = (s: AnalysisStatus): string =>
  ({ pass: t('analysis.status.pass', 'Pass'), warn: t('analysis.status.warn', 'Check'), fail: t('analysis.status.fail', 'Fail'), info: t('analysis.status.info', 'Info') })[s]

const CATEGORY_EN: Record<CheckCategory, string> = {
  accessibility: 'Barrier-free (DIN 18040-2)',
  stairs: 'Stairs (DIN 18065)',
  fall: 'Fall protection',
  rooms: 'Room heights',
  daylight: 'Daylight',
  escape: 'Escape routes',
  zoning: 'Zoning',
  energy: 'Energy (GEG)',
}
export const categoryLabel = (c: CheckCategory): string => t(`analysis.category.${c}`, CATEGORY_EN[c])

export const kgLabel = (kg: string): string => t(`analysis.kg.${kg}`, KG_LABELS[kg] ?? kg)

export function costLabel(line: CostLine): string {
  if (line.id.startsWith('services-')) return kgLabel(line.kg)
  const def = DEFAULT_COST_ITEMS.find((d) => d.id === line.id)
  return def && def.label === line.label ? t(`analysis.cost.${line.id}`, line.label) : line.label
}

export const unitLabel = (u: CostUnit): string => ({ m2: 'm²', m3: 'm³', m: 'm', pcs: t('analysis.unit.pcs', 'pcs'), pct: '%' })[u]

const ENVELOPE_EN: Record<EnvelopeKind, string> = {
  wall: 'External walls',
  wallGround: 'Walls against ground',
  window: 'Windows',
  skylight: 'Roof windows',
  door: 'External doors',
  roof: 'Roofs',
  ground: 'Ground floor slab',
}
export const envelopeLabel = (k: EnvelopeKind): string => t(`analysis.envelope.${k}`, ENVELOPE_EN[k])

export const sourceLabel = (s: USource): string =>
  ({
    computed: t('analysis.usource.computed', 'computed (ISO 6946)'),
    override: t('analysis.usource.override', 'entered'),
    default: t('analysis.usource.default', 'default'),
    reference: t('analysis.usource.reference', 'assumed = GEG reference'),
  })[s]

const ZONING_EN: Record<ZoningKey, string> = { grz: 'GRZ (site coverage)', gfz: 'GFZ (floor area ratio)', bmz: 'BMZ (building mass ratio)', storeys: 'Full storeys', height: 'Building height' }
export const zoningLabel = (k: ZoningKey): string => t(`analysis.zoning.${k}`, ZONING_EN[k])

const REASON_EN: Record<StoreyReason, string> = {
  override: 'set manually',
  basement: 'basement (top ≤ 1.40 m above ground)',
  low: '< 2/3 of the area with 2.30 m clear height',
  empty: 'no floor area',
  full: 'full storey',
}
export const reasonLabel = (r: StoreyReason): string => t(`analysis.storey.${r}`, REASON_EN[r])

export function checkMessage(c: CheckResult): string {
  const vars: Record<string, string> = {}
  for (const [k, v] of Object.entries(c.vars)) vars[k] = typeof v === 'number' ? formatNumber(v, { maximumFractionDigits: 3 }) : v
  return t(`analysis.check.${c.code}`, c.template, vars)
}

export const disclaimer = (): string =>
  t(
    'analysis.disclaimer',
    'Planning estimates computed from the model — not a legal certificate. They do not replace the building permit documents, the GEG energy certificate or reviews by qualified professionals; verify against the applicable state building code (LBO) and development plan.',
  )

// ------------------------------------------------------------------ number formatting
export const num = (v: number, d = 2): string => formatNumber(v, { minimumFractionDigits: d, maximumFractionDigits: d })
export const money = (v: number, currency = 'EUR'): string => {
  try {
    return formatNumber(v, { style: 'currency', currency, maximumFractionDigits: 0 })
  } catch {
    return `${num(v, 0)} ${currency}`
  }
}
export const pct = (v: number, d = 1): string => `${num(v * 100, d)} %`

// ------------------------------------------------------------------ table model
export type Cell = string | number | null
export interface DataCol {
  label: string
  /** Decimals for numeric cells */
  decimals?: number
  align?: 'left' | 'right'
}
export interface DataTable {
  title: string
  cols: DataCol[]
  rows: Cell[][]
  footer?: Cell[]
}

const csvCell = (v: Cell, delimiter: string, decimals?: number): string => {
  if (v == null) return ''
  if (typeof v === 'number') {
    const s = decimals !== undefined ? v.toFixed(decimals) : String(Math.round(v * 1e6) / 1e6)
    return delimiter === ';' ? s.replace('.', ',') : s
  }
  return /[";,\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/** CSV with UTF-8 BOM; ';' uses decimal commas (German spreadsheets), ',' decimal points. */
export function tablesToCsv(tables: DataTable[], delimiter: ';' | ','): string {
  const lines: string[] = []
  for (const tb of tables) {
    if (lines.length) lines.push('')
    lines.push(csvCell(tb.title, delimiter))
    lines.push(tb.cols.map((c) => csvCell(c.label, delimiter)).join(delimiter))
    for (const r of tb.rows) lines.push(r.map((v, i) => csvCell(v, delimiter, tb.cols[i]?.decimals)).join(delimiter))
    if (tb.footer) lines.push(tb.footer.map((v, i) => csvCell(v, delimiter, tb.cols[i]?.decimals)).join(delimiter))
  }
  return `﻿${lines.join('\r\n')}\r\n`
}

const fmtCell = (v: Cell, col: DataCol | undefined): string => (v == null ? '' : typeof v === 'number' ? num(v, col?.decimals ?? 2) : v)

export function toReportTable(tb: DataTable): ReportTable {
  return {
    title: tb.title,
    columns: tb.cols.map((c) => c.label),
    align: tb.cols.map((c) => c.align ?? (c.decimals !== undefined ? 'right' : 'left')),
    rows: tb.rows.map((r) => r.map((v, i) => fmtCell(v, tb.cols[i]))),
    footer: tb.footer?.map((v, i) => fmtCell(v, tb.cols[i])),
  }
}

// ------------------------------------------------------------------ tables per tab
const m2 = (label: string): DataCol => ({ label: `${label} (m²)`, decimals: 2 })

export function areaTables(r: AnalysisReport): DataTable[] {
  const d = r.din277
  const total = t('analysis.total', 'Total')
  const din: DataTable = {
    title: t('analysis.table.din277', 'DIN 277 areas and volumes per level'),
    cols: [
      { label: t('analysis.col.level', 'Level') },
      m2(t('analysis.col.bgf', 'BGF (R)')),
      m2(t('analysis.col.bgfS', 'BGF (S)')),
      m2(t('analysis.col.kgf', 'KGF')),
      m2(t('analysis.col.nrf', 'NRF')),
      m2(t('analysis.col.nuf', 'NUF')),
      m2(t('analysis.col.tf', 'TF')),
      m2(t('analysis.col.vf', 'VF')),
      { label: `${t('analysis.col.bri', 'BRI')} (m³)`, decimals: 1 },
    ],
    rows: d.levels.map((l) => [l.name, l.bgf, l.bgfS, l.kgf, l.nrf, l.nuf, l.tf, l.vf, l.bri]),
    footer: [total, d.total.bgf, d.total.bgfS, d.total.kgf, d.total.nrf, d.total.nuf, d.total.tf, d.total.vf, d.total.bri],
  }
  const usage: DataTable = {
    title: t('analysis.table.usage', 'Net room area by usage group (DIN 277)'),
    cols: [{ label: t('analysis.col.usage', 'Usage group') }, m2(t('analysis.col.area', 'Area'))],
    rows: d.usage.map((u) => [u.usage, u.area]),
    footer: [t('analysis.col.nrf', 'NRF'), d.total.nrf],
  }
  const wf: DataTable = {
    title: t('analysis.table.woflv', 'Living area (WoFlV)'),
    cols: [
      { label: t('analysis.col.number', 'No.') },
      { label: t('analysis.col.room', 'Room') },
      { label: t('analysis.col.level', 'Level') },
      m2(t('analysis.col.floorArea', 'Floor area')),
      m2(t('analysis.col.full', '≥ 2 m (100 %)')),
      m2(t('analysis.col.half', '1–2 m (50 %)')),
      m2(t('analysis.col.low', '< 1 m (0 %)')),
      m2(t('analysis.col.excluded', 'Not counted')),
      { label: t('analysis.col.factor', 'Factor'), decimals: 2 },
      m2(t('analysis.col.livingArea', 'Living area')),
    ],
    rows: r.woflv.rows.filter((x) => x.counted).map((x) => [x.number, x.name, x.level, x.floorArea, x.full, x.half, x.low, x.excluded, x.factor, x.livingArea]),
    footer: [total, '', '', null, null, null, null, null, null, r.woflv.total],
  }
  return [din, usage, wf]
}

export function zoningTables(r: AnalysisReport, site: SiteInfo): DataTable[] {
  const z = r.zoning
  const yes = t('analysis.yes', 'yes'), no = t('analysis.no', 'no')
  const siteRows: Cell[][] = [
    [t('analysis.site.plotArea', 'Plot area (m²)'), z.plotArea],
    [t('analysis.site.footprint', 'Building footprint (m²)'), z.footprint],
    [t('analysis.site.floorArea', 'Floor area of full storeys (m²)'), z.floorArea],
    [t('analysis.site.mass', 'Building mass (m³)'), z.mass],
    [t('analysis.site.state', 'Federal state'), site.state ? `${lboProfile(site.state).name} (${lboProfile(site.state).law})` : t('analysis.site.mbo', 'MBO (model code)')],
  ]
  return [
    {
      title: t('analysis.table.zoning', 'Zoning (BauNVO)'),
      cols: [{ label: t('analysis.col.metric', 'Metric') }, { label: t('analysis.col.value', 'Value'), decimals: 2 }, { label: t('analysis.col.limit', 'Limit'), decimals: 2 }, { label: t('analysis.col.status', 'Status') }, { label: t('analysis.col.rule', 'Rule') }],
      rows: z.rows.map((x) => [zoningLabel(x.key), x.value, x.limit, statusLabel(x.status), x.rule]),
    },
    { title: t('analysis.table.site', 'Site data'), cols: [{ label: t('analysis.col.parameter', 'Parameter') }, { label: t('analysis.col.value', 'Value'), decimals: 2 }], rows: siteRows },
    {
      title: t('analysis.table.storeys', 'Storeys (full storey after MBO § 2 (6))'),
      cols: [{ label: t('analysis.col.level', 'Level') }, { label: `${t('analysis.col.elevation', 'Elevation')} (m)`, decimals: 2 }, { label: `${t('analysis.col.height', 'Height')} (m)`, decimals: 2 }, m2(t('analysis.col.bgf', 'BGF (R)')), { label: t('analysis.col.fullStorey', 'Full storey') }, { label: t('analysis.col.reason', 'Reason') }],
      rows: z.storeys.map((s) => [s.name, s.elevation, s.height, s.bgf, s.full ? yes : no, reasonLabel(s.reason)]),
    },
  ]
}

export function costTables(r: AnalysisReport): DataTable[] {
  const c = r.costs
  const cur = c.currency
  return [
    {
      title: t('analysis.table.costs', 'DIN 276 cost estimate (Kostenschätzung)'),
      cols: [
        { label: t('analysis.col.kg', 'KG') },
        { label: t('analysis.col.item', 'Item') },
        { label: t('analysis.col.quantity', 'Quantity'), decimals: 2 },
        { label: t('analysis.col.unit', 'Unit') },
        { label: `${t('analysis.col.unitPrice', 'Unit price')} (${cur})`, decimals: 2 },
        { label: `${t('analysis.col.total', 'Total')} (${cur})`, decimals: 0 },
      ],
      rows: c.lines.map((l) => [l.kg, costLabel(l), l.unit === 'pct' ? l.quantity : l.quantity, l.unit === 'pct' ? '%' : unitLabel(l.unit), l.unit === 'pct' ? l.unitPrice * 100 : l.unitPrice, l.total]),
      footer: [t('analysis.total', 'Total'), t('analysis.cost.kg300400', 'KG 300 + 400'), null, '', null, c.total],
    },
    {
      title: t('analysis.table.costGroups', 'Cost groups'),
      cols: [{ label: t('analysis.col.kg', 'KG') }, { label: t('analysis.col.item', 'Item') }, { label: `${t('analysis.col.total', 'Total')} (${cur})`, decimals: 0 }],
      rows: [
        ...c.groups.map((g) => [g.kg, kgLabel(g.kg), g.total] as Cell[]),
        ['300', kgLabel('300'), c.kg300],
        ['400', kgLabel('400'), c.kg400],
        ['', t('analysis.cost.net', 'Net'), c.net],
        ['', t('analysis.cost.vat', 'VAT {rate} %', { rate: num(c.vatRate * 100, 0) }), c.vat],
        ['', t('analysis.cost.gross', 'Gross'), c.gross],
      ],
    },
    {
      title: t('analysis.table.indicators', 'Cost indicators (KG 300 + 400)'),
      cols: [{ label: t('analysis.col.indicator', 'Indicator') }, { label: cur, decimals: 0 }],
      rows: [
        [t('analysis.cost.perBgf', 'per m² BGF'), c.perBgf],
        [t('analysis.cost.perBri', 'per m³ BRI'), c.perBri],
        [t('analysis.cost.perNuf', 'per m² NUF'), c.perNuf],
        [t('analysis.cost.perLiving', 'per m² living area'), c.perLivingArea],
      ],
    },
  ]
}

export const buildUpText = (layers: { name: string; thickness: number }[]): string => layers.map((l) => `${num(l.thickness * 100, 1)} ${l.name}`).join(' · ')

export function energyTables(th: ThermalResult): DataTable[] {
  return [
    {
      title: t('analysis.table.buildUps', 'External wall build-ups (DIN EN ISO 6946)'),
      cols: [
        { label: t('analysis.col.buildUp', 'Build-up (cm)') },
        { label: `${t('analysis.col.thickness', 'Thickness')} (m)`, decimals: 3 },
        { label: 'U (W/m²K)', decimals: 2 },
        { label: t('analysis.col.uRef', 'U ref.'), decimals: 2 },
        m2(t('analysis.col.area', 'Area')),
        { label: t('analysis.col.status', 'Status') },
      ],
      rows: th.buildUps.map((b) => [buildUpText(b.layers), b.thickness, b.u, b.uRef, b.area, statusLabel(b.status)]),
    },
    {
      title: t('analysis.table.envelope', 'Thermal envelope'),
      cols: [
        { label: t('analysis.col.element', 'Element') },
        m2(t('analysis.col.area', 'Area')),
        { label: 'U (W/m²K)', decimals: 2 },
        { label: t('analysis.col.uRef', 'U ref.'), decimals: 2 },
        { label: 'Fx', decimals: 2 },
        { label: 'H (W/K)', decimals: 1 },
        { label: t('analysis.col.source', 'Source') },
      ],
      rows: th.elements.map((e) => [envelopeLabel(e.kind), e.area, e.u, e.uRef, e.fx, e.h, sourceLabel(e.source)]),
      footer: [t('analysis.total', 'Total'), th.area, null, null, null, th.ht, ''],
    },
    {
      title: t('analysis.table.htprime', "Transmission heat loss H'T (GEG § 16)"),
      cols: [{ label: t('analysis.col.metric', 'Metric') }, { label: t('analysis.col.value', 'Value'), decimals: 3 }],
      rows: [
        ["H'T (W/m²K)", th.htPrime],
        [t('analysis.energy.htRef', "H'T reference building (W/m²K)"), th.htPrimeRef],
        [t('analysis.energy.ratio', 'Ratio to reference'), th.ratio],
        [t('analysis.energy.deltaUwb', 'Thermal bridge surcharge ΔU_WB (W/m²K)'), th.deltaUwb],
      ],
    },
  ]
}

export function checkTables(r: AnalysisReport): DataTable[] {
  const order: AnalysisStatus[] = ['fail', 'warn', 'info', 'pass']
  const rows = [...r.checks].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || a.category.localeCompare(b.category))
  return [
    {
      title: t('analysis.table.checks', 'Compliance checks'),
      cols: [{ label: t('analysis.col.status', 'Status') }, { label: t('analysis.col.category', 'Category') }, { label: t('analysis.col.finding', 'Finding') }, { label: t('analysis.col.rule', 'Rule') }],
      rows: rows.map((c) => [statusLabel(c.status), categoryLabel(c.category), checkMessage(c), c.rule]),
    },
  ]
}

export function tabTables(tab: AnalysisTab, r: AnalysisReport, site: SiteInfo, thermal: ThermalResult): DataTable[] {
  switch (tab) {
    case 'areas':
      return areaTables(r)
    case 'zoning':
      return zoningTables(r, site)
    case 'costs':
      return costTables(r)
    case 'energy':
      return energyTables(thermal)
    case 'checks':
      return checkTables(r)
  }
}

export function buildReport(r: AnalysisReport, name: string, site: SiteInfo, thermal: ThermalResult): ReportDocument {
  const s = r.summary
  return {
    title: t('analysis.report.title', 'Building analysis — {name}', { name }),
    subtitle: t('analysis.report.subtitle', 'DIN 277 · WoFlV · BauNVO · DIN 276 · GEG · DIN 18040-2 · DIN 18065'),
    meta: [
      [t('analysis.report.date', 'Date'), formatDate(r.generatedAt, { dateStyle: 'long', timeStyle: 'short' })],
      [t('analysis.report.checks', 'Checks'), `${s.fail} ${statusLabel('fail')} · ${s.warn} ${statusLabel('warn')} · ${s.pass} ${statusLabel('pass')}`],
      [t('analysis.site.state', 'Federal state'), site.state ? lboProfile(site.state).name : t('analysis.site.mbo', 'MBO (model code)')],
    ],
    disclaimer: disclaimer(),
    footerNote: t('analysis.report.footer', 'CadSandbox analysis — planning estimate, not a legal certificate.'),
    fileName: `${name}-analysis`,
    sections: [
      { title: t('analysis.tab.areas', 'Areas'), intro: t('analysis.report.areasIntro', 'Areas and volumes after DIN 277:2021 from wall outlines and rooms; living area after the WoFlV with clear heights sampled under slabs and roofs.'), tables: areaTables(r).map(toReportTable) },
      { title: t('analysis.tab.zoning', 'Zoning'), tables: zoningTables(r, site).map(toReportTable) },
      { title: t('analysis.tab.costs', 'Costs'), intro: t('analysis.report.costsIntro', 'Cost estimate after DIN 276:2018-12 from model quantities and editable unit prices (default prices: Germany average, gross).'), tables: costTables(r).map(toReportTable) },
      { title: t('analysis.tab.energy', 'Energy'), intro: t('analysis.report.energyIntro', 'U-values after DIN EN ISO 6946; roofs and floor slabs use the GEG reference values unless a U-value was entered.'), tables: energyTables(thermal).map(toReportTable) },
      { title: t('analysis.tab.checks', 'Checks'), tables: checkTables(r).map(toReportTable) },
    ],
  }
}
