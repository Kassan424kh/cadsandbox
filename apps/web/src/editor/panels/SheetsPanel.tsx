// Sheets: list, create (paper/orientation/title block defaults), open the sheet editor, export PDF.
import { useState } from 'react'
import { Copy, FileDown, Plus, Trash } from 'lucide-react'
import type { PaperSize, SheetDef } from '@cadsandbox/doc'
import { tn, useT } from '../../i18n'
import { Button, DropdownMenuItem, DropdownMenuSeparator, EmptyState, IconButton, ScrollArea, cx } from '../../ui'
import { onSheets, useDocSelector, useEditorCtx, useEditorState } from '../EditorContext'
import { PointMenu } from '../commands/PointMenu'
import { useImportExport } from '../io/useImportExport'
import { useUiStore } from '../ui-store'
import { PanelFrame } from './LeftRail'
import styles from './panels.module.css'

export const PAPER_MM: Record<PaperSize, [number, number]> = {
  A4: [297, 210],
  A3: [420, 297],
  A2: [594, 420],
  A1: [841, 594],
  A0: [1189, 841],
  Letter: [279.4, 215.9],
  Tabloid: [431.8, 279.4],
}

export function newSheetDef(
  doc: { meta: { name: string } },
  existing: readonly Pick<SheetDef, 'number'>[],
  projectName: string,
  activeLevel: string | null,
  t: (key: string, fallback: string, vars?: Record<string, string | number>) => string,
): Omit<SheetDef, 'id' | 'order'> {
  // First free A-nn number (deleting a sheet must not make the next one collide with a survivor).
  const taken = new Set(existing.map((s) => s.number))
  let n = existing.length + 1
  for (let i = 1; i <= existing.length + 1; i++) {
    if (!taken.has(`A-${String(i).padStart(2, '0')}`)) {
      n = i
      break
    }
  }
  const number = `A-${String(n).padStart(2, '0')}`
  const [w, h] = PAPER_MM.A3
  const margin = 10
  const viewports: SheetDef['viewports'] = activeLevel
    ? [{ id: `vp-${Date.now().toString(36)}`, x: margin, y: margin, w: w - 2 * margin - 60, h: h - 2 * margin - 40, source: { kind: 'plan', levelId: activeLevel }, scale: 100, style: 'lines', title: t('sheets.default.viewportTitle', 'Floor plan') }]
    : []
  return {
    name: existing.length === 0 ? t('sheets.default.firstName', 'Floor plan') : t('sheets.default.name', 'Sheet {n}', { n }),
    number,
    paper: 'A3',
    orientation: 'landscape',
    titleBlock: { project: projectName || doc.meta.name, client: '', address: '', drawnBy: '', checkedBy: '', date: new Date().toISOString().slice(0, 10), revision: 'A', company: '', phase: t('sheets.default.phase', 'Design development') },
    viewports,
  }
}

export function SheetsPanel() {
  const t = useT()
  const { doc, readOnly, session } = useEditorCtx()
  const sheets = useDocSelector((d) => [...d.listSheets()].sort((a, b) => a.order - b.order), onSheets)
  const activeLevel = useEditorState((s) => s.activeLevel)
  const openDialog = useUiStore((s) => s.openDialog)
  const { exportAs, busy } = useImportExport()
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)

  const create = () => {
    if (readOnly) return
    const id = doc.putSheet(newSheetDef(doc, sheets, session.project?.name ?? session.manifest.info.name, activeLevel, t))
    openDialog('sheetEditor', { sheetId: id })
  }

  return (
    <PanelFrame title={t('panel.sheets', 'Sheets')} actions={!readOnly && <IconButton size="sm" label={t('sheets.new', 'New sheet')} icon={<Plus />} onClick={create} />}>
      <ScrollArea>
        {sheets.length === 0 ? (
          <EmptyState compact title={t('sheets.empty', 'No sheets yet')} description={t('sheets.emptyHint', 'Compose plans, sections, elevations and 3D views on paper sizes with a title block, then export PDF.')} actions={!readOnly && <Button size="sm" variant="primary" icon={<Plus />} onClick={create}>{t('sheets.createFirst', 'Create a sheet')}</Button>} />
        ) : (
          <div className={styles.list} role="list">
            {sheets.map((s) => (
              <div
                key={s.id}
                role="listitem"
                className={styles.listRow}
                onClick={() => openDialog('sheetEditor', { sheetId: s.id })}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setMenu({ x: e.clientX, y: e.clientY, id: s.id })
                }}
              >
                <span className={cx(styles.sheetThumb, s.orientation === 'portrait' && styles.sheetThumbPortrait)} />
                <div className={styles.listRowMain}>
                  <span className={styles.listRowTitle}>
                    {s.number} · {s.name}
                  </span>
                  <span className={styles.listRowMeta}>
                    {s.paper} {s.orientation === 'portrait' ? t('sheets.portrait', 'Portrait') : t('sheets.landscape', 'Landscape')} · {tn('sheets.viewportCount', s.viewports.length, '{count} viewport', '{count} viewports')}
                  </span>
                </div>
                <span className={styles.listRowActions}>
                  <IconButton
                    size="sm"
                    label={t('sheets.exportPdf', 'Export PDF')}
                    icon={<FileDown />}
                    disabled={busy}
                    onClick={(e) => {
                      e.stopPropagation()
                      void exportAs('pdf', { sheetId: s.id })
                    }}
                  />
                </span>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
      <PointMenu anchor={menu} onClose={() => setMenu(null)}>
        {menu && (
          <>
            <DropdownMenuItem onSelect={() => openDialog('sheetEditor', { sheetId: menu.id })}>{t('sheets.edit', 'Edit sheet')}</DropdownMenuItem>
            <DropdownMenuItem icon={<FileDown />} onSelect={() => void exportAs('pdf', { sheetId: menu.id })}>{t('sheets.exportPdf', 'Export PDF')}</DropdownMenuItem>
            {!readOnly && (
              <>
                <DropdownMenuItem
                  icon={<Copy />}
                  onSelect={() => {
                    const s = doc.getSheet(menu.id)
                    if (s) {
                      const { id: _id, order: _order, ...rest } = s
                      doc.putSheet({ ...rest, name: t('sheets.copyName', '{name} copy', { name: s.name }), number: `${s.number}b`, viewports: s.viewports.map((v) => ({ ...v, id: `${v.id}-${Math.random().toString(36).slice(2, 6)}` })) })
                    }
                  }}
                >
                  {t('sheets.duplicate', 'Duplicate')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem danger icon={<Trash />} onSelect={() => doc.removeSheet(menu.id)}>{t('common.delete', 'Delete')}</DropdownMenuItem>
              </>
            )}
          </>
        )}
      </PointMenu>
    </PanelFrame>
  )
}
