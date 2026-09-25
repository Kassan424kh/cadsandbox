// Analysis: DIN 277 + WoFlV areas, zoning (GRZ/GFZ/BMZ), DIN 276 cost estimate, GEG energy basics and
// compliance checks — computed on the client from the model (@cadsandbox/geometry analyzeBuilding).
// CSV export per tab (UTF-8 BOM, ';' or ','), printable PDF summary. Planning estimates only.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Download, FileText, RefreshCw } from 'lucide-react'
import type { BuildingType, CostCatalog, DocChangeEvent, NodeBase, RoomOutdoorKind, SiteInfo } from '@cadsandbox/doc'
import {
  DEFAULT_COST_ITEMS,
  DELTA_UWB,
  DELTA_UWB_NO_PROOF,
  LBO_PROFILES,
  analyzeBuilding,
  computeThermal,
  type AnalysisReport,
  type AnalysisStatus,
  type CheckCategory,
  type CheckResult,
  type CostLine,
  type EnvelopeRow,
  type ThermalResult,
} from '@cadsandbox/geometry'
import { useT } from '../../i18n'
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  NumberField,
  ScrollArea,
  SegmentedControl,
  Select,
  Spinner,
  Switch,
  cx,
  downloadBlob,
  toast,
  useLocalStorage,
  type BadgeTone,
} from '../../ui'
import { onNodes, useDocVersion, useEditorCtx } from '../EditorContext'
import { PanelFrame } from './LeftRail'
import panels from './panels.module.css'
import styles from './AnalysisPanel.module.css'
import {
  buildReport,
  buildUpText,
  categoryLabel,
  checkMessage,
  costLabel,
  disclaimer,
  envelopeLabel,
  kgLabel,
  money,
  num,
  pct,
  reasonLabel,
  sourceLabel,
  statusLabel,
  tabTables,
  tablesToCsv,
  unitLabel,
  zoningLabel,
  type AnalysisTab,
} from './analysis/tables'

const TABS: AnalysisTab[] = ['areas', 'zoning', 'costs', 'energy', 'checks']
const onAnalysisChange = (e: DocChangeEvent) => onNodes(e) || e.meta || e.materials.size > 0
const TONE: Record<AnalysisStatus, BadgeTone> = { pass: 'success', warn: 'warning', fail: 'danger', info: 'info' }
/** JSON round-trip drops undefined keys before writing to the CRDT. */
const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

function StatusBadge({ status }: { status: AnalysisStatus }) {
  return (
    <Badge tone={TONE[status]} dot>
      {statusLabel(status)}
    </Badge>
  )
}

function Stat({ label, value, extra }: { label: string; value: ReactNode; extra?: ReactNode }) {
  return (
    <div className={styles.stat}>
      <div className={styles.statLabel} title={label}>
        {label}
      </div>
      <div className={styles.statValue}>
        {value}
        {extra}
      </div>
    </div>
  )
}

function Section({ title, actions, children }: { title: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>
        <span>{title}</span>
        {actions}
      </h3>
      {children}
    </section>
  )
}

export function AnalysisPanel() {
  const t = useT()
  const { doc, editor, readOnly } = useEditorCtx()
  const version = useDocVersion(onAnalysisChange)
  const [tab, setTab] = useLocalStorage<AnalysisTab>('cs.analysis.tab', 'areas')
  const [report, setReport] = useState<AnalysisReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const [deltaUwb, setDeltaUwb] = useLocalStorage<number>('cs.analysis.deltaUwb', DELTA_UWB)

  useEffect(() => {
    let cancelled = false
    setBusy(true)
    const timer = setTimeout(() => {
      void (async () => {
        try {
          await editor.geometry.idle()
          if (cancelled) return
          const r = analyzeBuilding(doc, editor.geometry)
          if (!cancelled) {
            setReport(r)
            setError(null)
          }
        } catch (e) {
          if (!cancelled) setError(e instanceof Error ? e.message : String(e))
        } finally {
          if (!cancelled) setBusy(false)
        }
      })()
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [doc, editor, version, nonce])

  const thermal = useMemo(() => (report ? computeThermal(report.model, { deltaUwb }) : null), [report, deltaUwb])
  const site: SiteInfo = doc.meta.site ?? {}
  const activeTab: AnalysisTab = TABS.includes(tab) ? tab : 'areas'

  const select = (ids: string[]) => {
    const live = ids.filter((id) => doc.hasNode(id))
    if (!live.length) return
    editor.select(live)
    editor.zoomToFit(live, true)
  }
  const exportCsv = (delimiter: ';' | ',') => {
    if (!report || !thermal) return
    const csv = tablesToCsv(tabTables(activeTab, report, site, thermal), delimiter)
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${doc.meta.name}-${activeTab}.csv`)
  }
  const exportPdf = async () => {
    if (!report || !thermal) return
    try {
      const io = await import('@cadsandbox/io')
      const { blob, fileName } = await io.exportReportPdf(buildReport(report, doc.meta.name, site, thermal))
      downloadBlob(blob, fileName)
    } catch (e) {
      toast.error(t('analysis.pdfFailed', 'PDF export failed: {error}', { error: e instanceof Error ? e.message : String(e) }))
    }
  }

  const labels: Record<AnalysisTab, string> = {
    areas: t('analysis.tab.areas', 'Areas'),
    zoning: t('analysis.tab.zoning', 'Zoning'),
    costs: t('analysis.tab.costs', 'Costs'),
    energy: t('analysis.tab.energy', 'Energy'),
    checks: t('analysis.tab.checks', 'Checks'),
  }
  const issues = report ? report.summary.fail + report.summary.warn : 0

  return (
    <PanelFrame
      title={t('panel.analysis', 'Analysis')}
      actions={
        <>
          {busy && <Spinner size={12} />}
          <IconButton size="sm" label={t('analysis.recompute', 'Recompute')} icon={<RefreshCw />} onClick={() => setNonce((n) => n + 1)} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton size="sm" label={t('analysis.export', 'Export')} icon={<Download />} disabled={!report} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => exportCsv(';')} hint="; ,">
                {t('analysis.csvSemicolon', 'CSV for Excel (semicolon, decimal comma)')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => exportCsv(',')} hint=", .">
                {t('analysis.csvComma', 'CSV (comma, decimal point)')}
              </DropdownMenuItem>
              <DropdownMenuItem icon={<FileText />} onSelect={() => void exportPdf()}>
                {t('analysis.pdf', 'PDF summary report')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
    >
      <div className={styles.root}>
        <div className={panels.schedTabs} role="tablist" aria-label={t('panel.analysis', 'Analysis')}>
          {TABS.map((k) => (
            <button key={k} type="button" role="tab" aria-selected={activeTab === k} className={cx(panels.libTab, activeTab === k && panels.libTabActive)} onClick={() => setTab(k)}>
              {labels[k]}
              {k === 'checks' && issues > 0 && ` · ${issues}`}
            </button>
          ))}
        </div>
        <div className={styles.body}>
          <ScrollArea>
            {error && <div className={styles.error}>{t('analysis.error', 'Analysis failed: {error}', { error })}</div>}
            {!report ? (
              <EmptyState compact title={t('analysis.computing', 'Analysing the model…')} />
            ) : !report.model.levels.length ? (
              <EmptyState compact title={t('analysis.empty', 'Add levels, walls and rooms to analyse the building.')} />
            ) : activeTab === 'areas' ? (
              <AreasTab report={report} readOnly={readOnly} onSelect={select} />
            ) : activeTab === 'zoning' ? (
              <ZoningTab report={report} site={site} readOnly={readOnly} />
            ) : activeTab === 'costs' ? (
              <CostsTab report={report} readOnly={readOnly} />
            ) : activeTab === 'energy' && thermal ? (
              <EnergyTab thermal={thermal} deltaUwb={deltaUwb} setDeltaUwb={setDeltaUwb} readOnly={readOnly} onSelect={select} />
            ) : (
              <ChecksTab report={report} onSelect={select} />
            )}
            <p className={styles.disclaimer}>{disclaimer()}</p>
          </ScrollArea>
        </div>
      </div>
    </PanelFrame>
  )
}

// ------------------------------------------------------------------ Areas (DIN 277 + WoFlV)
function AreasTab({ report, readOnly, onSelect }: { report: AnalysisReport; readOnly: boolean; onSelect(ids: string[]): void }) {
  const t = useT()
  const { doc } = useEditorCtx()
  const [active, setActive] = useState<string | null>(null)
  const d = report.din277
  const metrics: { key: string; label: string; get(v: (typeof d.levels)[number] | typeof d.total): number; unit: string }[] = [
    { key: 'bgf', label: t('analysis.col.bgf', 'BGF (R)'), get: (v) => v.bgf, unit: 'm²' },
    { key: 'bgfS', label: t('analysis.col.bgfS', 'BGF (S)'), get: (v) => v.bgfS, unit: 'm²' },
    { key: 'kgf', label: t('analysis.col.kgf', 'KGF'), get: (v) => v.kgf, unit: 'm²' },
    { key: 'nrf', label: t('analysis.col.nrf', 'NRF'), get: (v) => v.nrf, unit: 'm²' },
    { key: 'nuf', label: t('analysis.col.nuf', 'NUF'), get: (v) => v.nuf, unit: 'm²' },
    { key: 'tf', label: t('analysis.col.tf', 'TF'), get: (v) => v.tf, unit: 'm²' },
    { key: 'vf', label: t('analysis.col.vf', 'VF'), get: (v) => v.vf, unit: 'm²' },
    { key: 'bri', label: t('analysis.col.bri', 'BRI'), get: (v) => v.bri, unit: 'm³' },
  ]
  const rows = report.woflv.rows
  const activeRoom = active ? doc.getNode<'room'>(active) : undefined
  const setRoom = (patch: Partial<NodeBase<'room'>['params']>) => active && doc.setParams<'room'>(active, patch)
  const tri = (v: boolean | undefined) => (v === undefined ? 'auto' : v ? 'yes' : 'no')
  const fromTri = (v: string) => (v === 'auto' ? undefined : v === 'yes')
  const triOptions = [
    { value: 'auto', label: t('analysis.auto', 'Automatic') },
    { value: 'yes', label: t('analysis.yes', 'yes') },
    { value: 'no', label: t('analysis.no', 'no') },
  ]

  return (
    <>
      <Section title={t('analysis.section.summary', 'Summary')}>
        <div className={styles.stats}>
          <Stat label={t('analysis.stat.bgf', 'Gross floor area BGF')} value={`${num(d.total.bgf)} m²`} />
          <Stat label={t('analysis.stat.nrf', 'Net room area NRF')} value={`${num(d.total.nrf)} m²`} />
          <Stat label={t('analysis.stat.bri', 'Gross volume BRI')} value={`${num(d.total.bri, 1)} m³`} />
          <Stat label={t('analysis.stat.woflv', 'Living area (WoFlV)')} value={`${num(report.woflv.total)} m²`} />
        </div>
      </Section>
      <Section title={t('analysis.table.din277', 'DIN 277 areas and volumes per level')}>
        <div className={styles.scrollX}>
          <table className={styles.mini}>
            <thead>
              <tr>
                <th />
                {d.levels.map((l) => (
                  <th key={l.levelId} className={styles.num}>
                    {l.name}
                  </th>
                ))}
                <th className={styles.num}>{t('analysis.total', 'Total')}</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((m) => (
                <tr key={m.key}>
                  <td title={m.unit}>{m.label}</td>
                  {d.levels.map((l) => (
                    <td key={l.levelId} className={styles.num}>
                      {num(m.get(l), m.key === 'bri' ? 1 : 2)}
                    </td>
                  ))}
                  <td className={styles.num}>
                    <strong>{num(m.get(d.total), m.key === 'bri' ? 1 : 2)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.note}>{t('analysis.note.din277', 'BGF (R) from the outer wall faces per level; BGF (S) = balconies/terraces; NRF from rooms (usage NUF 1–7, TF, VF); BRI follows roofs above the top storey. Values in m² / m³.')}</p>
      </Section>
      <Section title={t('analysis.table.woflv', 'Living area (WoFlV)')}>
        {!rows.length ? (
          <div className={styles.muted}>{t('analysis.noRooms', 'No rooms yet — use Build › Room.')}</div>
        ) : (
          <table className={styles.mini}>
            <thead>
              <tr>
                <th>{t('analysis.col.counts', 'WoFl')}</th>
                <th>{t('analysis.col.room', 'Room')}</th>
                <th className={styles.num}>{t('analysis.col.floorArea', 'Floor area')}</th>
                <th className={styles.num}>{t('analysis.col.livingArea', 'Living area')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className={cx(styles.clickRow, active === r.id && styles.rowActive)}
                  onClick={() => {
                    setActive(r.id)
                    onSelect([r.id])
                  }}
                >
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={r.counted}
                      disabled={readOnly}
                      aria-label={t('analysis.countsToggle', 'Counts toward the living area')}
                      title={r.auto ? t('analysis.autoFlag', 'Derived from usage and name — click to set explicitly') : undefined}
                      onChange={(e) => doc.setParams<'room'>(r.id, { livingSpace: e.target.checked })}
                    />
                  </td>
                  <td className={styles.grow} title={`${r.number} ${r.name} · ${r.level}`}>
                    {[r.number, r.name].filter(Boolean).join(' ') || '—'}
                    {r.outdoor && <span className={styles.muted}> · {pct(r.factor, 0)}</span>}
                    {r.half > 0.005 && <span className={styles.muted}> · {t('analysis.sloped', 'sloped')}</span>}
                  </td>
                  <td className={styles.num}>{num(r.floorArea)}</td>
                  <td className={styles.num}>{r.counted ? num(r.livingArea) : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td />
                <td>{t('analysis.total', 'Total')}</td>
                <td className={styles.num}>{num(rows.reduce((a, r) => a + r.floorArea, 0))}</td>
                <td className={styles.num}>{num(report.woflv.total)}</td>
              </tr>
            </tfoot>
          </table>
        )}
        {activeRoom?.type === 'room' && (
          <div className={styles.flags}>
            <label className={styles.field}>
              {t('analysis.flag.living', 'Living space')}
              <Select size="sm" disabled={readOnly} value={tri(activeRoom.params.livingSpace)} options={triOptions} onChange={(v) => setRoom({ livingSpace: fromTri(v) })} />
            </label>
            <label className={styles.field}>
              {t('analysis.flag.habitable', 'Habitable room')}
              <Select size="sm" disabled={readOnly} value={tri(activeRoom.params.habitable)} options={triOptions} onChange={(v) => setRoom({ habitable: fromTri(v) })} />
            </label>
            <label className={styles.field}>
              {t('analysis.flag.outdoor', 'Outdoor area')}
              <Select
                size="sm"
                disabled={readOnly}
                value={activeRoom.params.outdoor ?? 'none'}
                options={[
                  { value: 'none', label: t('analysis.outdoor.none', 'No') },
                  { value: 'balcony', label: t('analysis.outdoor.balcony', 'Balcony') },
                  { value: 'loggia', label: t('analysis.outdoor.loggia', 'Loggia') },
                  { value: 'terrace', label: t('analysis.outdoor.terrace', 'Terrace') },
                  { value: 'roof-garden', label: t('analysis.outdoor.roof-garden', 'Roof garden') },
                ]}
                onChange={(v) => setRoom({ outdoor: v === 'none' ? undefined : (v as RoomOutdoorKind) })}
              />
            </label>
            <label className={styles.field}>
              {t('analysis.flag.share', 'WoFlV share')}
              <Select
                size="sm"
                disabled={readOnly || !activeRoom.params.outdoor}
                value={String(activeRoom.params.outdoorFactor ?? 0.25)}
                options={[
                  { value: '0.25', label: '25 %' },
                  { value: '0.5', label: '50 %' },
                ]}
                onChange={(v) => setRoom({ outdoorFactor: Number(v) })}
              />
            </label>
          </div>
        )}
        <p className={styles.note}>{t('analysis.note.woflv', 'WoFlV § 4: clear height ≥ 2 m counts fully, 1–2 m half, < 1 m not at all (sampled every 10 cm under slabs and roofs); balconies/terraces 25 % (max. 50 %); stairs with more than 3 risers and pillars > 0.1 m² are not counted.')}</p>
      </Section>
    </>
  )
}

// ------------------------------------------------------------------ Zoning
function ZoningTab({ report, site, readOnly }: { report: AnalysisReport; site: SiteInfo; readOnly: boolean }) {
  const t = useT()
  const { doc } = useEditorCtx()
  const z = report.zoning
  const setSite = (patch: Partial<SiteInfo>) => doc.setMeta({ site: clean({ ...(doc.meta.site ?? {}), ...patch }) })
  const setLimit = (key: keyof NonNullable<SiteInfo['zoning']>, v: number) => setSite({ zoning: { ...(site.zoning ?? {}), [key]: v > 0 ? v : undefined } })
  const numField = (label: string, value: number | undefined, onChange: (v: number) => void, opts: { unit?: string; step?: number; precision?: number; min?: number } = {}) => (
    <label className={styles.field}>
      {label}
      <NumberField size="sm" value={value ?? null} mixedLabel="—" placeholder="—" disabled={readOnly} min={opts.min ?? 0} step={opts.step ?? 0.1} precision={opts.precision ?? 2} unit={opts.unit} onChange={onChange} />
    </label>
  )
  return (
    <>
      <Section title={t('analysis.section.site', 'Plot & development plan')}>
        <div className={styles.form}>
          {numField(t('analysis.site.plotArea', 'Plot area (m²)'), site.plotArea, (v) => setSite({ plotArea: v > 0 ? v : undefined }), { unit: 'm²', step: 1, precision: 1 })}
          {numField(t('analysis.site.groundLevel', 'Ground level (m)'), site.groundLevel ?? 0, (v) => setSite({ groundLevel: v || undefined }), { unit: 'm', step: 0.05, min: -100 })}
          {numField('GRZ', site.zoning?.grz, (v) => setLimit('grz', v), { step: 0.05 })}
          {numField('GFZ', site.zoning?.gfz, (v) => setLimit('gfz', v), { step: 0.05 })}
          {numField('BMZ', site.zoning?.bmz, (v) => setLimit('bmz', v), { step: 0.1 })}
          {numField(t('analysis.site.maxStoreys', 'Max. full storeys (Z)'), site.zoning?.maxStoreys, (v) => setLimit('maxStoreys', Math.round(v)), { step: 1, precision: 0 })}
          {numField(t('analysis.site.maxHeight', 'Max. height (m)'), site.zoning?.maxHeight, (v) => setLimit('maxHeight', v), { unit: 'm', step: 0.1 })}
          <label className={styles.field}>
            {t('analysis.site.buildingType', 'Building type')}
            <Select
              size="sm"
              disabled={readOnly}
              value={site.buildingType ?? 'residential'}
              options={[
                { value: 'residential', label: t('analysis.type.residential', 'Residential') },
                { value: 'office', label: t('analysis.type.office', 'Office') },
                { value: 'public', label: t('analysis.type.public', 'Public') },
                { value: 'other', label: t('analysis.type.other', 'Other') },
              ]}
              onChange={(v) => setSite({ buildingType: v as BuildingType })}
            />
          </label>
          <label className={cx(styles.field, styles.full)}>
            {t('analysis.site.state', 'Federal state')}
            <Select
              size="sm"
              disabled={readOnly}
              value={site.state ?? ''}
              options={[{ value: '', label: t('analysis.site.mbo', 'MBO (model code)') }, ...LBO_PROFILES.map((p) => ({ value: p.code, label: `${p.name} (${p.law})` }))]}
              onChange={(v) => setSite({ state: v || undefined })}
            />
          </label>
          <div className={styles.full}>
            <Switch size="sm" between disabled={readOnly} checked={!!site.barrierFree} onChange={(v) => setSite({ barrierFree: v || undefined })} label={t('analysis.site.barrierFree', 'Must be barrier-free (DIN 18040-2)')} />
          </div>
        </div>
      </Section>
      <Section title={t('analysis.table.zoning', 'Zoning (BauNVO)')}>
        <table className={styles.mini}>
          <thead>
            <tr>
              <th>{t('analysis.col.metric', 'Metric')}</th>
              <th className={styles.num}>{t('analysis.col.value', 'Value')}</th>
              <th className={styles.num}>{t('analysis.col.limit', 'Limit')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {z.rows.map((r) => (
              <tr key={r.key} title={r.rule}>
                <td>{zoningLabel(r.key)}</td>
                <td className={styles.num}>{r.value == null ? '—' : r.key === 'storeys' ? r.value : r.key === 'height' ? `${num(r.value)} m` : num(r.value, 2)}</td>
                <td className={styles.num}>{r.limit == null ? '—' : r.key === 'height' ? `${num(r.limit)} m` : r.limit}</td>
                <td>{r.limit != null && r.value != null ? <StatusBadge status={r.status} /> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {z.plotArea == null && <p className={styles.note}>{t('analysis.check.zoning.noplot', 'Enter the plot area to check GRZ, GFZ and BMZ')}</p>}
        <p className={styles.note}>
          {t('analysis.note.zoning', 'GRZ from the footprint of storeys above ground (main building, BauNVO § 19 (2)); GFZ/BMZ from full storeys (§§ 20, 21); height from ground level to the highest point.')}
        </p>
      </Section>
      <Section title={t('analysis.table.storeys', 'Storeys (full storey after MBO § 2 (6))')}>
        {z.storeys.map((s) => (
          <div key={s.levelId} className={styles.row} style={{ cursor: 'default' }}>
            <span className={styles.grow} title={reasonLabel(s.reason)}>
              {s.name} <span className={styles.muted}>· {num(s.bgf)} m² · {reasonLabel(s.reason)}</span>
            </span>
            <Select
              size="sm"
              disabled={readOnly}
              value={s.auto ? 'auto' : s.full ? 'yes' : 'no'}
              options={[
                { value: 'auto', label: s.full ? t('analysis.storey.autoFull', 'Auto: full') : t('analysis.storey.autoNot', 'Auto: not full') },
                { value: 'yes', label: t('analysis.storey.setFull', 'Full storey') },
                { value: 'no', label: t('analysis.storey.setNotFull', 'Not a full storey') },
              ]}
              onChange={(v) => doc.setParams<'level'>(s.levelId, { fullStorey: v === 'auto' ? undefined : v === 'yes' })}
            />
          </div>
        ))}
      </Section>
    </>
  )
}

// ------------------------------------------------------------------ Costs (DIN 276)
function CostsTab({ report, readOnly }: { report: AnalysisReport; readOnly: boolean }) {
  const t = useT()
  const { doc } = useEditorCtx()
  const c = report.costs
  const catalog: CostCatalog = doc.meta.costCatalog ?? {}
  const setCatalog = (patch: Partial<CostCatalog>) => doc.setMeta({ costCatalog: clean({ ...(doc.meta.costCatalog ?? {}), ...patch }) })
  const setPrice = (line: CostLine, value: number) => {
    const def = DEFAULT_COST_ITEMS.find((d) => d.id === line.id)
    const items = { ...(catalog.items ?? {}) }
    const next = { ...items[line.id], price: def && Math.abs(def.price - value) < 1e-9 ? undefined : value }
    if (next.price === undefined && next.kg === undefined && next.label === undefined) delete items[line.id]
    else items[line.id] = next
    setCatalog({ items })
  }
  const groups = new Map<string, CostLine[]>()
  for (const l of c.lines) {
    const g = `${l.kg.slice(0, 2)}0`
    groups.set(g, [...(groups.get(g) ?? []), l])
  }
  const cur = c.currency
  return (
    <>
      <Section title={t('analysis.section.summary', 'Summary')}>
        <div className={styles.stats}>
          <Stat label={kgLabel('300')} value={money(c.kg300, cur)} />
          <Stat label={kgLabel('400')} value={money(c.kg400, cur)} />
          <Stat label={t('analysis.cost.kg300400', 'KG 300 + 400')} value={money(c.total, cur)} />
          <Stat label={t('analysis.cost.perBgf', 'per m² BGF')} value={c.perBgf == null ? '—' : money(c.perBgf, cur)} />
          <Stat label={t('analysis.cost.perBri', 'per m³ BRI')} value={c.perBri == null ? '—' : money(c.perBri, cur)} />
          <Stat label={t('analysis.cost.perLiving', 'per m² living area')} value={c.perLivingArea == null ? '—' : money(c.perLivingArea, cur)} />
        </div>
      </Section>
      <Section
        title={t('analysis.section.costSettings', 'Price settings')}
        actions={
          <Button size="sm" variant="ghost" disabled={readOnly || !doc.meta.costCatalog} onClick={() => doc.setMeta({ costCatalog: {} })}>
            {t('analysis.cost.reset', 'Reset prices')}
          </Button>
        }
      >
        <div className={styles.form}>
          <label className={styles.field}>
            {t('analysis.cost.servicesRatio', 'KG 400 as % of KG 300')}
            <NumberField size="sm" disabled={readOnly} value={c.servicesRatio * 100} min={0} max={200} step={1} precision={1} unit="%" onChange={(v) => setCatalog({ servicesRatio: v / 100 })} />
          </label>
          <label className={styles.field}>
            {t('analysis.cost.regionFactor', 'Regional factor')}
            <NumberField size="sm" disabled={readOnly} value={c.regionFactor} min={0.1} max={5} step={0.01} precision={2} onChange={(v) => setCatalog({ regionFactor: v })} />
          </label>
          <div className={styles.full}>
            <Switch size="sm" between disabled={readOnly} checked={c.vatIncluded} onChange={(v) => setCatalog({ vatIncluded: v })} label={t('analysis.cost.vatIncluded', 'Unit prices include VAT ({rate} %)', { rate: num(c.vatRate * 100, 0) })} />
          </div>
        </div>
        <p className={styles.note}>
          {t('analysis.cost.totals', 'Net {net} · VAT {vat} · gross {gross}', { net: money(c.net, cur), vat: money(c.vat, cur), gross: money(c.gross, cur) })}
        </p>
      </Section>
      <Section title={t('analysis.table.costs', 'DIN 276 cost estimate (Kostenschätzung)')}>
        {[...groups.entries()].map(([g, lines]) => (
          <div key={g}>
            <div className={styles.group}>
              <span>
                {g} {kgLabel(g)}
              </span>
              <span className={styles.value}>{money(lines.reduce((a, l) => a + l.total, 0), cur)}</span>
            </div>
            {lines.map((l) => (
              <div key={l.id} className={styles.costLine}>
                <div className={styles.costHead}>
                  <span className={styles.kgCode}>{l.kg}</span>
                  <span className={styles.grow}>{costLabel(l)}</span>
                  {l.estimated && (
                    <Badge tone="outline" title={t('analysis.cost.estimatedHint', 'Not modelled — estimated from BGF / NRF')}>
                      {t('analysis.cost.estimated', 'est.')}
                    </Badge>
                  )}
                  <span className={styles.value}>{money(l.total, cur)}</span>
                </div>
                <div className={styles.costCalc}>
                  {l.unit === 'pct' ? (
                    l.id.startsWith('services-') ? (
                      <span>
                        {pct(l.unitPrice)} × {money(l.quantity, cur)}
                      </span>
                    ) : (
                      <>
                        <NumberField className={styles.priceField} size="sm" disabled={readOnly} value={l.unitPrice * 100} min={0} max={100} step={0.5} precision={1} unit="%" onChange={(v) => setPrice(l, v / 100)} />
                        <span>× {money(l.quantity, cur)}</span>
                      </>
                    )
                  ) : (
                    <>
                      <span>
                        {num(l.quantity)} {unitLabel(l.unit)} ×
                      </span>
                      <NumberField
                        className={styles.priceField}
                        size="sm"
                        disabled={readOnly}
                        value={l.unitPrice / c.regionFactor}
                        min={0}
                        step={5}
                        precision={0}
                        unit={cur === 'EUR' ? '€' : cur}
                        aria-label={t('analysis.col.unitPrice', 'Unit price')}
                        onChange={(v) => setPrice(l, v)}
                      />
                      {l.overridden && <span title={t('analysis.cost.default', 'Default {price}', { price: money(l.defaultPrice, cur) })}>*</span>}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}
        <p className={styles.note}>{t('analysis.note.costs', 'Default unit prices: Germany average, price basis ≈ 2025, gross incl. VAT (BKI-type reference values). KG 400 is estimated as a share of KG 300. Adjust prices and the regional factor to your project; * = changed price.')}</p>
      </Section>
    </>
  )
}

// ------------------------------------------------------------------ Energy (GEG basics)
function EnergyTab({ thermal, deltaUwb, setDeltaUwb, readOnly, onSelect }: { thermal: ThermalResult; deltaUwb: number; setDeltaUwb(v: number): void; readOnly: boolean; onSelect(ids: string[]): void }) {
  const t = useT()
  const { doc } = useEditorCtx()
  const setU = (e: EnvelopeRow, u: number) => {
    const patches = e.nodeIds
      .map((id) => doc.getNode(id))
      .filter((n): n is NonNullable<typeof n> => !!n && n.type !== 'level')
      .map((n) => {
        const meta = { ...n.meta }
        if (u > 0) meta.uValue = u
        else delete meta.uValue
        return { id: n.id, patch: { meta } }
      })
    if (patches.length) doc.updateNodes(patches)
  }
  const editable = (e: EnvelopeRow) => e.kind !== 'wall' && e.kind !== 'wallGround' && e.nodeIds.some((id) => doc.getNode(id)?.type !== 'level')
  return (
    <>
      <Section title={t('analysis.section.summary', 'Summary')}>
        <div className={styles.stats}>
          <Stat label="H'T (W/m²K)" value={num(thermal.htPrime, 3)} extra={thermal.status !== 'info' ? <StatusBadge status={thermal.status} /> : undefined} />
          <Stat label={t('analysis.energy.htRef', "H'T reference building (W/m²K)")} value={num(thermal.htPrimeRef, 3)} />
          <Stat label={t('analysis.energy.ratio', 'Ratio to reference')} value={thermal.area > 0 ? `${num(thermal.ratio, 2)} ×` : '—'} />
          <Stat label={t('analysis.energy.area', 'Envelope area A')} value={`${num(thermal.area, 1)} m²`} />
        </div>
        <label className={styles.field} style={{ marginTop: 8 }}>
          {t('analysis.energy.deltaUwb', 'Thermal bridge surcharge ΔU_WB (W/m²K)')}
          <Select
            size="sm"
            value={String(deltaUwb)}
            options={[
              { value: String(DELTA_UWB), label: t('analysis.energy.uwbDetails', '0.05 — details after DIN 4108 Beiblatt 2') },
              { value: String(DELTA_UWB_NO_PROOF), label: t('analysis.energy.uwbNone', '0.10 — without proof') },
            ]}
            onChange={(v) => setDeltaUwb(Number(v))}
          />
        </label>
      </Section>
      <Section title={t('analysis.table.buildUps', 'External wall build-ups (DIN EN ISO 6946)')}>
        {!thermal.buildUps.length && <div className={styles.muted}>{t('analysis.energy.noWalls', 'No external walls found.')}</div>}
        {thermal.buildUps.map((b) => (
          <div key={b.key} className={styles.row} onClick={() => onSelect(b.wallIds)} title={t('analysis.energy.selectWalls', 'Select these walls')}>
            <span className={styles.grow}>
              {buildUpText(b.layers)}
              <span className={styles.muted}>
                {' '}
                · {num(b.area, 1)} m²{b.groundContact ? ` · ${t('analysis.envelope.wallGround', 'Walls against ground')}` : ''}
                {b.assumed ? ` · ${t('analysis.energy.lambdaAssumed', 'λ partly assumed')}` : ''}
              </span>
            </span>
            <span className={styles.value}>U {num(b.u, 2)}</span>
            <StatusBadge status={b.status} />
          </div>
        ))}
        <p className={styles.note}>{t('analysis.note.buildUps', 'U = 1/(Rsi + Σ d/λ + Rse), Rsi 0.13, Rse 0.04 (0 against ground). λ from the material library (DIN 4108-4 / DIN EN ISO 10456). Reference: U ≤ 0.28 W/(m²K) (GEG Anlage 1). Single-layer walls use the wall material — add wall layers for real build-ups.')}</p>
      </Section>
      <Section title={t('analysis.table.envelope', 'Thermal envelope')}>
        <table className={styles.mini}>
          <thead>
            <tr>
              <th>{t('analysis.col.element', 'Element')}</th>
              <th className={styles.num}>m²</th>
              <th className={styles.num}>U</th>
              <th className={styles.num}>{t('analysis.col.uRef', 'U ref.')}</th>
            </tr>
          </thead>
          <tbody>
            {thermal.elements.map((e, i) => (
              <tr key={`${e.kind}-${i}`} className={styles.clickRow} onClick={() => onSelect(e.nodeIds)} title={sourceLabel(e.source)}>
                <td>
                  {envelopeLabel(e.kind)}
                  <div className={styles.muted}>{sourceLabel(e.source)}</div>
                </td>
                <td className={styles.num}>{num(e.area, 1)}</td>
                <td className={styles.num} onClick={(ev) => editable(e) && ev.stopPropagation()}>
                  {editable(e) ? (
                    <NumberField className={styles.priceField} size="sm" disabled={readOnly} value={e.u} min={0} max={10} step={0.01} precision={2} aria-label={t('analysis.energy.uInput', 'U-value (0 = default)')} onChange={(v) => setU(e, v)} />
                  ) : (
                    num(e.u, 2)
                  )}
                </td>
                <td className={styles.num}>{num(e.uRef, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={styles.note}>{t('analysis.note.envelope', "Roof and floor-slab build-ups are not modelled: the GEG reference U is assumed until you enter a value (0 resets). Windows default to Uw 1.1, doors 1.3. HT' = (Σ Fx·U·A + ΔU_WB·A) / A, Fx 0.6 against ground, compared with the GEG reference building (§ 16: ≤ 1.0 ×, residential).")}</p>
      </Section>
    </>
  )
}

// ------------------------------------------------------------------ Checks
const CATEGORY_ORDER: CheckCategory[] = ['accessibility', 'stairs', 'fall', 'rooms', 'daylight', 'escape', 'zoning', 'energy']
const STATUS_ORDER: AnalysisStatus[] = ['fail', 'warn', 'info', 'pass']

function ChecksTab({ report, onSelect }: { report: AnalysisReport; onSelect(ids: string[]): void }) {
  const t = useT()
  const [filter, setFilter] = useLocalStorage<'issues' | 'all'>('cs.analysis.checkFilter', 'issues')
  const s = report.summary
  const visible = report.checks.filter((c) => filter === 'all' || c.status === 'fail' || c.status === 'warn' || c.status === 'info')
  const byCat = new Map<CheckCategory, CheckResult[]>()
  for (const c of visible) byCat.set(c.category, [...(byCat.get(c.category) ?? []), c])
  return (
    <Section
      title={
        <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <Badge tone="danger">{`${s.fail} ${statusLabel('fail')}`}</Badge>
          <Badge tone="warning">{`${s.warn} ${statusLabel('warn')}`}</Badge>
          <Badge tone="success">{`${s.pass} ${statusLabel('pass')}`}</Badge>
        </span>
      }
      actions={
        <SegmentedControl<'issues' | 'all'>
          size="sm"
          value={filter}
          onChange={(v) => setFilter(v)}
          options={[
            { value: 'issues', label: t('analysis.filter.issues', 'Issues') },
            { value: 'all', label: t('analysis.filter.all', 'All') },
          ]}
        />
      }
    >
      {!visible.length && <div className={styles.muted}>{t('analysis.noIssues', 'No issues found — switch to “All” to see passed checks.')}</div>}
      {CATEGORY_ORDER.filter((c) => byCat.has(c)).map((cat) => {
        const items = [...byCat.get(cat)!].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status))
        return (
          <div key={cat}>
            <div className={styles.groupHead}>{categoryLabel(cat)}</div>
            {items.map((c) => (
              <div key={c.id} className={styles.check} onClick={() => onSelect(c.nodeIds)} role={c.nodeIds.length ? 'button' : undefined} title={c.nodeIds.length ? t('analysis.zoomTo', 'Select and zoom to') : undefined}>
                <span className={cx(styles.dot, styles[c.status])} aria-label={statusLabel(c.status)} />
                <div>
                  <div className={styles.checkText}>{checkMessage(c)}</div>
                  <div className={styles.rule}>{c.rule}</div>
                </div>
              </div>
            ))}
          </div>
        )
      })}
    </Section>
  )
}
