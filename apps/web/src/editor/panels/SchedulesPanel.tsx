// Schedules: rooms / doors / windows / walls / DIN 277 areas as sortable tables + CSV export.
import { useEffect, useState } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import { formatArea, formatLength, formatVolume } from '@cadsandbox/shared'
import type { Schedules } from '@cadsandbox/geometry'
import { useT } from '../../i18n'
import { Badge, Button, EmptyState, IconButton, ScrollArea, Spinner, Table, cx, downloadBlob, type TableColumn } from '../../ui'
import { onNodes, useDocVersion, useEditorCtx, useUnits } from '../EditorContext'
import { PanelFrame } from './LeftRail'
import styles from './panels.module.css'
import { DIN277_LABELS, computeSchedules, scheduleToCsv, type ScheduleKind } from './schedules'

const KINDS: ScheduleKind[] = ['rooms', 'doors', 'windows', 'walls', 'areas']

export function SchedulesPanel() {
  const t = useT()
  const { doc, editor } = useEditorCtx()
  const units = useUnits()
  const version = useDocVersion(onNodes)
  const [kind, setKind] = useState<ScheduleKind>('rooms')
  const [data, setData] = useState<{ schedules: Schedules; source: 'geometry' | 'document' } | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(() => {
      void computeSchedules(doc, editor.geometry).then((r) => {
        if (!cancelled) {
          setData(r)
          setLoading(false)
        }
      })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [doc, editor, version])

  const labels: Record<ScheduleKind, string> = {
    rooms: t('schedule.rooms', 'Rooms'),
    doors: t('schedule.doors', 'Doors'),
    windows: t('schedule.windows', 'Windows'),
    walls: t('schedule.walls', 'Walls'),
    areas: t('schedule.areas', 'Areas (DIN 277)'),
  }
  const len = (m: number) => formatLength(m, units.length, units.precision)
  const area = (m2: number) => formatArea(m2, units.area)
  const select = (id: string) => {
    if (doc.hasNode(id)) {
      editor.select([id])
      editor.zoomToFit([id], true)
    }
  }
  const exportCsv = () => {
    if (!data) return
    const csv = scheduleToCsv(data.schedules, kind)
    downloadBlob(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }), `${doc.meta.name}-${kind}.csv`)
  }

  const s = data?.schedules
  const roomCols: TableColumn<Schedules['rooms'][number]>[] = [
    { key: 'number', label: t('schedule.col.number', 'No.'), sortable: true, width: 56 },
    { key: 'name', label: t('schedule.col.name', 'Name'), sortable: true },
    { key: 'level', label: t('schedule.col.level', 'Level'), sortable: true },
    { key: 'usage', label: t('schedule.col.usage', 'Usage'), sortable: true, render: (r) => <Badge tone="outline" title={DIN277_LABELS[r.usage as keyof typeof DIN277_LABELS]}>{r.usage}</Badge> },
    { key: 'area', label: t('schedule.col.area', 'Area'), align: 'right', sortable: true, render: (r) => area(r.area), footer: s ? area(s.rooms.reduce((a, r) => a + r.area, 0)) : '' },
    { key: 'height', label: t('schedule.col.height', 'Height'), align: 'right', sortable: true, render: (r) => len(r.height) },
    { key: 'volume', label: t('schedule.col.volume', 'Volume'), align: 'right', sortable: true, render: (r) => formatVolume(r.volume) },
  ]
  const openingCols: TableColumn<Schedules['doors'][number]>[] = [
    { key: 'style', label: t('schedule.col.style', 'Style'), sortable: true },
    { key: 'level', label: t('schedule.col.level', 'Level'), sortable: true },
    { key: 'wall', label: t('schedule.col.wall', 'Wall'), sortable: true },
    { key: 'width', label: t('schedule.col.width', 'Width'), align: 'right', sortable: true, render: (r) => len(r.width) },
    { key: 'height', label: t('schedule.col.height', 'Height'), align: 'right', sortable: true, render: (r) => len(r.height) },
    { key: 'sill', label: t('schedule.col.sill', 'Sill'), align: 'right', sortable: true, render: (r) => len(r.sill) },
  ]
  const wallCols: TableColumn<Schedules['walls'][number]>[] = [
    { key: 'level', label: t('schedule.col.level', 'Level'), sortable: true },
    { key: 'length', label: t('schedule.col.length', 'Length'), align: 'right', sortable: true, render: (r) => len(r.length), footer: s ? len(s.walls.reduce((a, w) => a + w.length, 0)) : '' },
    { key: 'height', label: t('schedule.col.height', 'Height'), align: 'right', sortable: true, render: (r) => len(r.height) },
    { key: 'thickness', label: t('schedule.col.thickness', 'Thickness'), align: 'right', sortable: true, render: (r) => len(r.thickness) },
    { key: 'netArea', label: t('schedule.col.netArea', 'Net area'), align: 'right', sortable: true, render: (r) => area(r.netArea), footer: s ? area(s.walls.reduce((a, w) => a + w.netArea, 0)) : '' },
    { key: 'volume', label: t('schedule.col.volume', 'Volume'), align: 'right', sortable: true, render: (r) => formatVolume(r.volume), footer: s ? formatVolume(s.walls.reduce((a, w) => a + w.volume, 0)) : '' },
    { key: 'material', label: t('schedule.col.material', 'Material'), sortable: true },
  ]
  const areaCols: TableColumn<Schedules['areas'][number]>[] = [
    { key: 'usage', label: t('schedule.col.usage', 'Usage'), sortable: true, render: (r) => `${r.usage} · ${DIN277_LABELS[r.usage as keyof typeof DIN277_LABELS] ?? ''}` },
    { key: 'area', label: t('schedule.col.area', 'Area'), align: 'right', sortable: true, render: (r) => area(r.area), footer: s ? area(s.totals.netFloorArea) : '' },
  ]

  return (
    <PanelFrame
      title={t('panel.schedules', 'Schedules')}
      actions={
        <>
          {loading && <Spinner size={12} />}
          <IconButton size="sm" label={t('schedule.refresh', 'Recompute')} icon={<RefreshCw />} onClick={() => void computeSchedules(doc, editor.geometry).then(setData)} />
          <IconButton size="sm" label={t('schedule.exportCsv', 'Export CSV')} icon={<Download />} onClick={exportCsv} disabled={!data} />
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div className={styles.schedTabs} role="tablist">
          {KINDS.map((k) => (
            <button key={k} type="button" role="tab" aria-selected={kind === k} className={cx(styles.libTab, kind === k && styles.libTabActive)} onClick={() => setKind(k)}>
              {labels[k]}
            </button>
          ))}
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <ScrollArea>
            {s && (
              <div className={styles.schedSummary}>
                <div className={styles.stat}>
                  <div className={styles.statLabel}>{t('schedule.nrf', 'Net floor area (NRF)')}</div>
                  <div className={styles.statValue}>{area(s.totals.netFloorArea)}</div>
                </div>
                <div className={styles.stat}>
                  <div className={styles.statLabel}>{t('schedule.bgf', 'Gross floor area (BGF)')}</div>
                  <div className={styles.statValue}>{area(s.totals.grossFloorArea)}</div>
                </div>
                <div className={styles.stat}>
                  <div className={styles.statLabel}>{t('schedule.bri', 'Gross volume (BRI)')}</div>
                  <div className={styles.statValue}>{formatVolume(s.totals.grossVolume)}</div>
                </div>
                <div className={styles.stat}>
                  <div className={styles.statLabel}>{t('schedule.counts', 'Rooms · Doors · Windows')}</div>
                  <div className={styles.statValue}>
                    {s.rooms.length} · {s.doors.length} · {s.windows.length}
                  </div>
                </div>
              </div>
            )}
            <div style={{ padding: '0 8px 8px' }}>
              {!s ? (
                <EmptyState compact title={t('schedule.computing', 'Computing…')} />
              ) : kind === 'rooms' ? (
                <Table dense rows={s.rooms} columns={roomCols} rowKey={(r) => r.id} onRowDoubleClick={(r) => select(r.id)} footer emptyLabel={t('schedule.noRooms', 'No rooms yet — use Build › Room.')} defaultSort={{ key: 'number', dir: 'asc' }} />
              ) : kind === 'doors' || kind === 'windows' ? (
                <Table dense rows={s[kind]} columns={openingCols} rowKey={(r) => r.id} onRowDoubleClick={(r) => select(r.id)} emptyLabel={t('schedule.noOpenings', 'No {kind} yet.', { kind: labels[kind].toLowerCase() })} />
              ) : kind === 'walls' ? (
                <Table dense rows={s.walls} columns={wallCols} rowKey={(r) => r.id} onRowDoubleClick={(r) => select(r.id)} footer emptyLabel={t('schedule.noWalls', 'No walls yet — use Build › Wall.')} />
              ) : (
                <Table dense rows={s.areas} columns={areaCols} rowKey={(r) => r.usage} footer emptyLabel={t('schedule.noAreas', 'Areas appear once rooms exist.')} />
              )}
              {data?.source === 'document' && <div style={{ marginTop: 8, fontSize: 'var(--cs-text-xs)', color: 'var(--cs-text-3)' }}>{t('schedule.fallbackNote', 'Computed from document parameters; geometry-accurate quantities arrive with the geometry engine.')}</div>}
              <div style={{ marginTop: 8 }}>
                <Button size="sm" icon={<Download />} onClick={exportCsv} disabled={!data}>
                  {t('schedule.exportCsvLong', 'Export {kind} as CSV', { kind: labels[kind] })}
                </Button>
              </div>
            </div>
          </ScrollArea>
        </div>
      </div>
    </PanelFrame>
  )
}
