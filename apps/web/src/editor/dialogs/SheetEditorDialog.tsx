// Sheet editor: paper preview with draggable viewports, title block, viewport list/props, PDF export.
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { FileDown, Plus, Trash } from 'lucide-react'
import type { PaperSize, SheetDef, SheetViewSource, SheetViewport } from '@cadsandbox/doc'
import { useT } from '../../i18n'
import { Button, Dialog, DialogContent, FieldRow, IconButton, Input, NumberField, Select, cx } from '../../ui'
import { onNodes, onSheets, onViews, useDocSelector, useEditorCtx } from '../EditorContext'
import { useImportExport } from '../io/useImportExport'
import { PAPER_MM } from '../panels/SheetsPanel'
import { useUiStore } from '../ui-store'
import styles from './sheets.module.css'

const PAPERS: PaperSize[] = ['A4', 'A3', 'A2', 'A1', 'A0', 'Letter', 'Tabloid']
const SCALES = [20, 50, 100, 200, 500]
const newId = () => `vp-${Math.random().toString(36).slice(2, 9)}`

function ViewportPreview({ vp, pxPerMm }: { vp: SheetViewport; pxPerMm: number }) {
  const { editor } = useEditorCtx()
  const [img, setImg] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const version = useDocSelector(() => Date.now(), onNodes)
  const key = JSON.stringify([vp.source, vp.style, vp.scale, Math.round(vp.w), Math.round(vp.h)])
  useEffect(() => {
    let cancelled = false
    let url: string | null = null
    const timer = setTimeout(async () => {
      const w = Math.max(64, Math.round(vp.w * pxPerMm * 2))
      const h = Math.max(64, Math.round(vp.h * pxPerMm * 2))
      try {
        if (vp.style === 'lines') {
          const d = await editor.vectorize(vp.source)
          if (cancelled) return
          const c = canvasRef.current
          if (!c) return
          c.width = w
          c.height = h
          const ctx = c.getContext('2d')!
          ctx.clearRect(0, 0, w, h)
          const bw = d.bounds.max[0] - d.bounds.min[0] || 1
          const bh = d.bounds.max[1] - d.bounds.min[1] || 1
          const s = Math.min(w / bw, h / bh) * 0.92
          const ox = (w - bw * s) / 2 - d.bounds.min[0] * s
          const oy = (h + bh * s) / 2 + d.bounds.min[1] * s
          ctx.strokeStyle = '#111'
          for (const l of d.lines) {
            ctx.lineWidth = l.style === 'cut' ? 2 : l.style === 'overhead' || l.style === 'hidden' ? 0.6 : 1
            ctx.setLineDash(l.style === 'overhead' || l.style === 'hidden' ? [4, 3] : [])
            ctx.beginPath()
            for (let i = 0; i + 3 < l.segments.length; i += 4) {
              ctx.moveTo(l.segments[i]! * s + ox, oy - l.segments[i + 1]! * s)
              ctx.lineTo(l.segments[i + 2]! * s + ox, oy - l.segments[i + 3]! * s)
            }
            ctx.stroke()
          }
          setImg(null)
        } else {
          const blob = await editor.renderView(vp.source, { width: w, height: h, style: vp.style })
          if (cancelled) return
          url = URL.createObjectURL(blob)
          setImg(url)
        }
      } catch {
        /* preview is best effort */
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
      if (url) URL.revokeObjectURL(url)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, editor, version, pxPerMm])
  return vp.style === 'lines' ? <canvas ref={canvasRef} className={styles.vpCanvas} /> : img ? <img src={img} alt="" className={styles.vpImg} /> : null
}

export function SheetEditorDialog() {
  const t = useT()
  const { doc, readOnly } = useEditorCtx()
  const { exportAs, busy } = useImportExport()
  const open = useUiStore((s) => s.dialog === 'sheetEditor')
  const sheetId = useUiStore((s) => s.editingSheet)
  const close = useUiStore((s) => s.closeDialog)
  const sheet = useDocSelector((d) => (sheetId ? d.getSheet(sheetId) : undefined), onSheets, [sheetId])
  const levels = useDocSelector((d) => d.levels(), onNodes)
  const sections = useDocSelector((d) => d.nodesOfType('section'), onNodes)
  const views = useDocSelector((d) => d.listViews(), onViews)
  const [selected, setSelected] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [wrapSize, setWrapSize] = useState({ w: 800, h: 500 })
  useEffect(() => {
    if (!open) return
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWrapSize({ w: el.clientWidth - 40, h: el.clientHeight - 40 }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [open])

  const paperMm = useMemo(() => {
    if (!sheet) return [420, 297] as [number, number]
    const [a, b] = PAPER_MM[sheet.paper]
    return (sheet.orientation === 'landscape' ? [a, b] : [b, a]) as [number, number]
  }, [sheet])
  const pxPerMm = Math.min(wrapSize.w / paperMm[0], wrapSize.h / paperMm[1]) * zoom
  // viewport drag state — a hook, so it must stay above the early return below
  const drag = useRef<{ id: string; startX: number; startY: number; x: number; y: number } | null>(null)

  if (!sheet) return null
  const update = (patch: Partial<Omit<SheetDef, 'id'>>) => !readOnly && doc.putSheet({ ...sheet, ...patch })
  const updateVp = (id: string, patch: Partial<SheetViewport>) => update({ viewports: sheet.viewports.map((v) => (v.id === id ? { ...v, ...patch } : v)) })
  const addViewport = (source: SheetViewSource, title: string) => {
    const vp: SheetViewport = { id: newId(), x: 15, y: 15, w: Math.min(180, paperMm[0] - 90), h: Math.min(120, paperMm[1] - 70), source, scale: 100, style: source.kind === 'view' ? 'shaded' : 'lines', title }
    update({ viewports: [...sheet.viewports, vp] })
    setSelected(vp.id)
  }
  const sel = sheet.viewports.find((v) => v.id === selected)

  // drag viewports on the paper
  const onVpDown = (e: PointerEvent<HTMLDivElement>, v: SheetViewport) => {
    if (readOnly) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { id: v.id, startX: e.clientX, startY: e.clientY, x: v.x, y: v.y }
    setSelected(v.id)
  }
  const onVpMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const x = Math.max(0, Math.round(d.x + (e.clientX - d.startX) / pxPerMm))
    const y = Math.max(0, Math.round(d.y + (e.clientY - d.startY) / pxPerMm))
    updateVp(d.id, { x, y })
  }
  const onVpUp = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  const dirLabel = (d: string) => t(`sheets.dir.${d}`, cap(d))
  const scheduleLabel = (k: string) => t(`schedule.${k}`, cap(k))
  const sourceLabel = (s: SheetViewSource) => {
    switch (s.kind) {
      case 'plan':
        return t('sheets.source.plan', 'Plan · {level}', { level: doc.getNode(s.levelId)?.name ?? '?' })
      case 'ceiling-plan':
        return t('sheets.source.ceiling', 'Ceiling plan · {level}', { level: doc.getNode(s.levelId)?.name ?? '?' })
      case 'section':
        return t('sheets.source.section', 'Section {label}', { label: doc.getNode<'section'>(s.sectionId)?.params.label ?? '?' })
      case 'elevation':
        return t('sheets.source.elevation', 'Elevation {dir}', { dir: dirLabel(s.direction) })
      case 'view':
        return t('sheets.source.view', '3D view · {name}', { name: views.find((v) => v.id === s.viewId)?.name ?? '?' })
      case 'schedule':
        return t('sheets.source.schedule', 'Schedule · {kind}', { kind: scheduleLabel(s.schedule) })
    }
  }
  const tb = sheet.titleBlock
  const tbW = Math.min(180, paperMm[0] * 0.42)
  const fs = Math.max(6, 3 * pxPerMm)

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent
        title={`${sheet.number} · ${sheet.name}`}
        size="full"
        headerActions={
          <Button variant="primary" size="sm" icon={<FileDown />} loading={busy} onClick={() => void exportAs('pdf', { sheetId: sheet.id })}>
            {t('sheets.exportPdf', 'Export PDF')}
          </Button>
        }
      >
        <div className={styles.layout}>
          <div ref={wrapRef} className={styles.paperWrap}>
            <div className={styles.paper} style={{ width: paperMm[0] * pxPerMm, height: paperMm[1] * pxPerMm, ['--paper-fs' as string]: `${fs}px` }} onPointerDown={() => setSelected(null)}>
              <div className={styles.frame} style={{ left: 10 * pxPerMm, top: 10 * pxPerMm, right: 10 * pxPerMm, bottom: 10 * pxPerMm }} />
              {sheet.viewports.map((v) => (
                <div
                  key={v.id}
                  className={cx(styles.vp, v.id === selected && styles.vpSelected)}
                  style={{ left: v.x * pxPerMm, top: v.y * pxPerMm, width: v.w * pxPerMm, height: v.h * pxPerMm }}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    onVpDown(e, v)
                  }}
                  onPointerMove={onVpMove}
                  onPointerUp={onVpUp}
                >
                  <ViewportPreview vp={v} pxPerMm={pxPerMm} />
                  <div className={styles.vpTitle}>
                    {v.title || sourceLabel(v.source)} · 1:{v.scale}
                  </div>
                </div>
              ))}
              <div className={styles.titleBlock} style={{ width: tbW * pxPerMm, right: 10 * pxPerMm, bottom: 10 * pxPerMm }}>
                <div className={cx(styles.tbCell, styles.tbProject)}>{tb.project || sheet.name}</div>
                <div className={styles.tbCell}>
                  <span className={styles.tbLabel}>{t('sheets.tb.client', 'Client')}</span>
                  {tb.client}
                </div>
                <div className={styles.tbCell}>
                  <span className={styles.tbLabel}>{t('sheets.tb.phase', 'Phase')}</span>
                  {tb.phase}
                </div>
                <div className={styles.tbCell}>
                  <span className={styles.tbLabel}>{t('sheets.tb.drawnBy', 'Drawn')}</span>
                  {tb.drawnBy}
                </div>
                <div className={styles.tbCell}>
                  <span className={styles.tbLabel}>{t('sheets.tb.checkedBy', 'Checked')}</span>
                  {tb.checkedBy}
                </div>
                <div className={styles.tbCell}>
                  <span className={styles.tbLabel}>{t('sheets.tb.date', 'Date')}</span>
                  {tb.date}
                </div>
                <div className={styles.tbCell}>
                  <span className={styles.tbLabel}>{t('sheets.tb.sheet', 'Sheet')}</span>
                  {sheet.number} · {tb.revision}
                </div>
              </div>
            </div>
            <div className={styles.zoomBar}>
              <Button size="sm" variant="glass" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} aria-label={t('sheets.zoomOut', 'Zoom out')}>
                −
              </Button>
              <Button size="sm" variant="glass" onClick={() => setZoom(1)}>
                {Math.round(zoom * 100)}%
              </Button>
              <Button size="sm" variant="glass" onClick={() => setZoom((z) => Math.min(3, z + 0.25))} aria-label={t('sheets.zoomIn', 'Zoom in')}>
                +
              </Button>
            </div>
          </div>

          <div className={styles.side}>
            <div className={styles.sideSection}>
              <div className={styles.sideHead}>
                <strong>{t('sheets.props', 'Sheet')}</strong>
              </div>
              <div className={styles.grid2}>
                <Input size="sm" value={sheet.number} onChange={(e) => update({ number: e.target.value })} aria-label={t('sheets.number', 'Number')} disabled={readOnly} />
                <Input size="sm" value={sheet.name} onChange={(e) => update({ name: e.target.value })} aria-label={t('sheets.name', 'Name')} disabled={readOnly} />
                <Select size="sm" value={sheet.paper} options={PAPERS.map((p) => ({ value: p, label: p }))} onChange={(v) => update({ paper: v })} aria-label={t('sheets.paper', 'Paper')} disabled={readOnly} />
                <Select size="sm" value={sheet.orientation} options={[{ value: 'landscape', label: t('sheets.landscape', 'Landscape') }, { value: 'portrait', label: t('sheets.portrait', 'Portrait') }]} onChange={(v) => update({ orientation: v })} aria-label={t('sheets.orientation', 'Orientation')} disabled={readOnly} />
              </div>
            </div>
            <div className={styles.sideSection}>
              <div className={styles.sideHead}>
                <strong>{t('sheets.titleBlock', 'Title block')}</strong>
              </div>
              {(['project', 'client', 'address', 'company', 'phase', 'drawnBy', 'checkedBy', 'date', 'revision'] as (keyof typeof tb)[]).map((k) => (
                <FieldRow key={k} label={t(`sheets.tb.${k}`, k.replace(/By$/, ' by').replace(/^\w/, (c) => c.toUpperCase()))}>
                  <Input size="sm" value={tb[k]} onChange={(e) => update({ titleBlock: { ...tb, [k]: e.target.value } })} disabled={readOnly} />
                </FieldRow>
              ))}
            </div>
            <div className={styles.sideSection}>
              <div className={styles.sideHead}>
                <strong>{t('sheets.viewportsTitle', 'Viewports')}</strong>
                {!readOnly && (
                  <Select
                    size="sm"
                    value={null}
                    placeholder={t('sheets.addViewport', '+ Add')}
                    className={styles.addSelect}
                    options={[
                      ...levels.map((l) => ({ value: `plan:${l.id}`, label: t('sheets.source.plan', 'Plan · {level}', { level: l.name }), group: t('sheets.group.plans', 'Plans') })),
                      ...levels.map((l) => ({ value: `ceiling:${l.id}`, label: t('sheets.source.ceiling', 'Ceiling plan · {level}', { level: l.name }), group: t('sheets.group.plans', 'Plans') })),
                      ...sections.map((s) => ({ value: `section:${s.id}`, label: t('sheets.source.section', 'Section {label}', { label: s.params.label }), group: t('sheets.group.sections', 'Sections') })),
                      ...(['north', 'south', 'east', 'west'] as const).map((d) => ({ value: `elevation:${d}`, label: t('sheets.source.elevation', 'Elevation {dir}', { dir: dirLabel(d) }), group: t('sheets.group.elevations', 'Elevations') })),
                      ...views.map((v) => ({ value: `view:${v.id}`, label: t('sheets.source.view', '3D view · {name}', { name: v.name }), group: t('sheets.group.views', '3D views') })),
                      ...(['rooms', 'doors', 'windows', 'areas', 'materials'] as const).map((s) => ({ value: `schedule:${s}`, label: t('sheets.source.schedule', 'Schedule · {kind}', { kind: scheduleLabel(s) }), group: t('sheets.group.schedules', 'Schedules') })),
                    ]}
                    onChange={(v) => {
                      const [kind, id] = v.split(':') as [string, string]
                      if (kind === 'plan') addViewport({ kind: 'plan', levelId: id }, '')
                      else if (kind === 'ceiling') addViewport({ kind: 'ceiling-plan', levelId: id }, '')
                      else if (kind === 'section') addViewport({ kind: 'section', sectionId: id }, '')
                      else if (kind === 'elevation') addViewport({ kind: 'elevation', direction: id as 'north' }, '')
                      else if (kind === 'view') addViewport({ kind: 'view', viewId: id }, '')
                      else if (kind === 'schedule') addViewport({ kind: 'schedule', schedule: id as 'rooms' }, '')
                    }}
                    aria-label={t('sheets.addViewport', '+ Add')}
                  />
                )}
              </div>
              {sheet.viewports.length === 0 && <div style={{ fontSize: 'var(--cs-text-xs)', color: 'var(--cs-text-3)' }}>{t('sheets.noViewports', 'Add a plan, section, elevation or 3D view.')}</div>}
              {sheet.viewports.map((v) => (
                <div key={v.id} className={cx(styles.vpRow, v.id === selected && styles.vpRowActive)} onClick={() => setSelected(v.id)}>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.title || sourceLabel(v.source)}</span>
                  <span style={{ color: 'var(--cs-text-3)', fontSize: 'var(--cs-text-xs)' }}>1:{v.scale}</span>
                  {!readOnly && <IconButton size="sm" label={t('common.delete', 'Delete')} icon={<Trash />} onClick={(e) => (e.stopPropagation(), update({ viewports: sheet.viewports.filter((x) => x.id !== v.id) }))} />}
                </div>
              ))}
            </div>
            {sel && (
              <div className={styles.sideSection}>
                <div className={styles.sideHead}>
                  <strong>{t('sheets.viewport', 'Viewport')}</strong>
                  <span style={{ color: 'var(--cs-text-3)', fontSize: 'var(--cs-text-xs)' }}>{sourceLabel(sel.source)}</span>
                </div>
                <FieldRow label={t('sheets.vp.title', 'Title')}>
                  <Input size="sm" value={sel.title ?? ''} onChange={(e) => updateVp(sel.id, { title: e.target.value })} disabled={readOnly} />
                </FieldRow>
                <FieldRow label={t('sheets.vp.scale', 'Scale')}>
                  <Select size="sm" value={String(sel.scale)} options={SCALES.map((s) => ({ value: String(s), label: `1:${s}` }))} onChange={(v) => updateVp(sel.id, { scale: Number(v) })} disabled={readOnly} />
                </FieldRow>
                <FieldRow label={t('sheets.vp.style', 'Style')}>
                  <Select size="sm" value={sel.style} options={[{ value: 'lines', label: t('sheets.style.lines', 'Lines') }, { value: 'hidden-line', label: t('sheets.style.hiddenLine', 'Hidden line') }, { value: 'shaded', label: t('sheets.style.shaded', 'Shaded') }, { value: 'realistic', label: t('sheets.style.realistic', 'Realistic') }]} onChange={(v) => updateVp(sel.id, { style: v })} disabled={readOnly} />
                </FieldRow>
                <div className={styles.grid2}>
                  <NumberField size="sm" prefix="X" value={sel.x} min={0} max={paperMm[0]} precision={0} unit="mm" onChange={(v) => updateVp(sel.id, { x: v })} disabled={readOnly} />
                  <NumberField size="sm" prefix="Y" value={sel.y} min={0} max={paperMm[1]} precision={0} unit="mm" onChange={(v) => updateVp(sel.id, { y: v })} disabled={readOnly} />
                  <NumberField size="sm" prefix="W" value={sel.w} min={10} max={paperMm[0]} precision={0} unit="mm" onChange={(v) => updateVp(sel.id, { w: v })} disabled={readOnly} />
                  <NumberField size="sm" prefix="H" value={sel.h} min={10} max={paperMm[1]} precision={0} unit="mm" onChange={(v) => updateVp(sel.id, { h: v })} disabled={readOnly} />
                </div>
              </div>
            )}
            {!readOnly && (
              <Button size="sm" variant="secondary" icon={<Plus />} onClick={() => levels[0] && addViewport({ kind: 'plan', levelId: levels[0].id }, '')} disabled={levels.length === 0}>
                {t('sheets.addPlanQuick', 'Add plan of first level')}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
