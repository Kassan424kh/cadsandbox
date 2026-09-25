// Saved views, section planes and sheets overview.
import { useState } from 'react'
import { Bookmark, Camera, Plus, Trash } from 'lucide-react'
import { useT } from '../../i18n'
import { Button, DropdownMenuItem, DropdownMenuSeparator, EmptyState, IconButton, ScrollArea, SectionLabel, Switch, cx } from '../../ui'
import { onNodes, onSheets, onViews, useDocSelector, useEditorCtx, useEditorState } from '../EditorContext'
import { PointMenu } from '../commands/PointMenu'
import { useUiStore } from '../ui-store'
import { PanelFrame } from './LeftRail'
import styles from './panels.module.css'

export function ViewsPanel() {
  const t = useT()
  const { doc, editor, readOnly } = useEditorCtx()
  const views = useDocSelector((d) => d.listViews(), onViews)
  const sections = useDocSelector((d) => d.nodesOfType('section'), onNodes)
  const sheets = useDocSelector((d) => d.listSheets(), onSheets)
  const vp = useEditorState((s) => s.viewports[s.activeViewport])
  const activeLevel = useEditorState((s) => s.activeLevel)
  const openDialog = useUiStore((s) => s.openDialog)
  const setLeftTab = useUiStore((s) => s.setLeftTab)
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)

  const saveView = () => {
    if (readOnly) return
    const id = doc.saveView({ name: t('views.defaultName', 'View {n}', { n: views.length + 1 }), camera: editor.getCamera(), renderMode: vp?.renderMode, levelId: activeLevel })
    setRenaming(id)
  }
  const restore = (id: string) => {
    const v = views.find((x) => x.id === id)
    if (!v) return
    editor.setCamera(v.camera, true)
    if (v.renderMode) editor.setRenderMode(v.renderMode)
    if (v.levelId !== undefined) editor.setActiveLevel(v.levelId)
  }

  return (
    <PanelFrame title={t('panel.views', 'Views')} actions={!readOnly && <IconButton size="sm" label={t('views.save', 'Save current view')} icon={<Plus />} onClick={saveView} />}>
      <ScrollArea>
        <div className={styles.panelSection}>
          <SectionLabel>{t('views.saved', 'Saved views')}</SectionLabel>
        </div>
        {views.length === 0 ? (
          <EmptyState compact icon={<Camera />} title={t('views.empty', 'No saved views')} description={t('views.emptyHint', 'Save camera positions to jump back later or place them on sheets.')} actions={!readOnly && <Button size="sm" icon={<Bookmark />} onClick={saveView}>{t('views.save', 'Save current view')}</Button>} />
        ) : (
          <div className={styles.list} role="list">
            {views.map((v) => (
              <div
                key={v.id}
                role="listitem"
                className={cx(styles.listRow)}
                onClick={() => restore(v.id)}
                onDoubleClick={() => !readOnly && setRenaming(v.id)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setMenu({ x: e.clientX, y: e.clientY, id: v.id })
                }}
              >
                <Camera size={15} style={{ color: 'var(--cs-text-3)', flex: 'none' }} />
                <div className={styles.listRowMain}>
                  {renaming === v.id ? (
                    <input
                      className={styles.inlineInput}
                      autoFocus
                      defaultValue={v.name}
                      onFocus={(e) => e.target.select()}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={(e) => {
                        const name = e.target.value.trim() || v.name
                        doc.saveView({ ...v, name })
                        setRenaming(null)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur()
                        if (e.key === 'Escape') setRenaming(null)
                      }}
                    />
                  ) : (
                    <span className={styles.listRowTitle}>{v.name}</span>
                  )}
                  <span className={styles.listRowMeta}>
                    {v.camera.projection === 'perspective' ? t('views.persp', 'Perspective') : t('views.ortho', 'Orthographic')}
                    {v.renderMode ? ` · ${v.renderMode}` : ''}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className={styles.panelSection}>
          <SectionLabel>{t('views.sections', 'Section planes')}</SectionLabel>
        </div>
        {sections.length === 0 ? (
          <div className={styles.emptyPad} style={{ fontSize: 'var(--cs-text-xs)', color: 'var(--cs-text-3)' }}>{t('views.noSections', 'Use Annotate › Section to cut the model.')}</div>
        ) : (
          <div className={styles.list} role="list">
            {sections.map((s) => (
              <div key={s.id} role="listitem" className={styles.listRow} onClick={() => editor.select([s.id])} onDoubleClick={() => editor.zoomToFit([s.id], true)}>
                <div className={styles.listRowMain}>
                  <span className={styles.listRowTitle}>
                    {s.name} · {s.params.label}
                  </span>
                  <span className={styles.listRowMeta}>{s.params.enabled ? t('views.sectionOn', 'Cutting') : t('views.sectionOff', 'Disabled')}</span>
                </div>
                <Switch size="sm" checked={s.params.enabled} disabled={readOnly} onChange={(v) => doc.setParams(s.id, { enabled: v })} aria-label={t('views.sectionToggle', 'Enable section')} />
              </div>
            ))}
          </div>
        )}

        <div className={styles.panelSection}>
          <SectionLabel>{t('views.sheets', 'Sheets')}</SectionLabel>
          <Button size="sm" variant="ghost" onClick={() => setLeftTab('sheets')}>
            {t('views.manageSheets', 'Manage')}
          </Button>
        </div>
        <div className={styles.list}>
          {sheets.slice(0, 5).map((s) => (
            <div key={s.id} className={styles.listRow} onClick={() => openDialog('sheetEditor', { sheetId: s.id })}>
              <span className={cx(styles.sheetThumb, s.orientation === 'portrait' && styles.sheetThumbPortrait)} />
              <div className={styles.listRowMain}>
                <span className={styles.listRowTitle}>
                  {s.number} {s.name}
                </span>
                <span className={styles.listRowMeta}>
                  {s.paper} · {s.viewports.length} {t('sheets.viewports', 'viewports')}
                </span>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
      <PointMenu anchor={menu} onClose={() => setMenu(null)}>
        {menu && (
          <>
            <DropdownMenuItem onSelect={() => restore(menu.id)}>{t('views.restore', 'Go to view')}</DropdownMenuItem>
            {!readOnly && (
              <>
                <DropdownMenuItem shortcut="F2" onSelect={() => setRenaming(menu.id)}>{t('common.rename', 'Rename')}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => doc.saveView({ ...views.find((v) => v.id === menu.id)!, camera: editor.getCamera() })}>{t('views.update', 'Update with current camera')}</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem danger icon={<Trash />} onSelect={() => doc.removeView(menu.id)}>{t('common.delete', 'Delete')}</DropdownMenuItem>
              </>
            )}
          </>
        )}
      </PointMenu>
    </PanelFrame>
  )
}
