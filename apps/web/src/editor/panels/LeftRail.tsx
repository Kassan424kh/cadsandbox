// Left side: icon rail + the active panel (resizable; a drawer on narrow screens).
import { useState, type ReactNode } from 'react'
import { Boxes, Camera, ClipboardCheck, Folder, Layers, ListTree, MessageSquare, Sheet as SheetIcon, Table2 } from 'lucide-react'
import { useT } from '../../i18n'
import { ResizablePanel, Sheet, SheetContent, Tooltip, cx } from '../../ui'
import { onComments, useDocSelector } from '../EditorContext'
import { IconLevel } from '../library/icons'
import { useUiStore, type LeftTab } from '../ui-store'
import { AnalysisPanel } from './AnalysisPanel'
import { CommentsPanel } from './CommentsPanel'
import { FilesPanel } from './FilesPanel'
import { LayersPanel } from './LayersPanel'
import { LevelsPanel } from './LevelsPanel'
import { LibraryPanel } from './LibraryPanel'
import { OutlinerPanel } from './OutlinerPanel'
import { SchedulesPanel } from './SchedulesPanel'
import { SheetsPanel } from './SheetsPanel'
import { ViewsPanel } from './ViewsPanel'
import styles from './panels.module.css'

interface TabDef {
  id: LeftTab
  icon: ReactNode
  key: string
  fallback: string
  shortcut?: string
}

const TABS: TabDef[] = [
  { id: 'scene', icon: <ListTree />, key: 'panel.scene', fallback: 'Scene', shortcut: 'Alt+S' },
  { id: 'files', icon: <Folder />, key: 'panel.files', fallback: 'Files', shortcut: 'Alt+F' },
  { id: 'library', icon: <Boxes />, key: 'panel.library', fallback: 'Library', shortcut: 'Alt+L' },
  { id: 'layers', icon: <Layers />, key: 'panel.layers', fallback: 'Layers' },
  { id: 'levels', icon: <IconLevel />, key: 'panel.levels', fallback: 'Levels' },
  { id: 'views', icon: <Camera />, key: 'panel.views', fallback: 'Views' },
  { id: 'comments', icon: <MessageSquare />, key: 'panel.comments', fallback: 'Comments', shortcut: 'Alt+C' },
  { id: 'sheets', icon: <SheetIcon />, key: 'panel.sheets', fallback: 'Sheets' },
  { id: 'schedules', icon: <Table2 />, key: 'panel.schedules', fallback: 'Schedules' },
  { id: 'analysis', icon: <ClipboardCheck />, key: 'panel.analysis', fallback: 'Analysis' },
]

export function panelTitle(t: ReturnType<typeof useT>, tab: LeftTab): string {
  const d = TABS.find((x) => x.id === tab)!
  return t(d.key, d.fallback)
}

function PanelBody({ tab }: { tab: LeftTab }) {
  switch (tab) {
    case 'scene':
      return <OutlinerPanel />
    case 'files':
      return <FilesPanel />
    case 'library':
      return <LibraryPanel />
    case 'layers':
      return <LayersPanel />
    case 'levels':
      return <LevelsPanel />
    case 'views':
      return <ViewsPanel />
    case 'comments':
      return <CommentsPanel />
    case 'sheets':
      return <SheetsPanel />
    case 'schedules':
      return <SchedulesPanel />
    case 'analysis':
      return <AnalysisPanel />
  }
}

export function PanelFrame({ title, actions, children }: { title: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className={styles.panel}>
      <header className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>{title}</h2>
        {actions}
      </header>
      <div className={styles.panelBody}>{children}</div>
    </section>
  )
}

export function LeftRail({ drawer }: { drawer: boolean }) {
  const t = useT()
  const tab = useUiStore((s) => s.leftTab)
  const toggle = useUiStore((s) => s.toggleLeftTab)
  const setTab = useUiStore((s) => s.setLeftTab)
  const unresolved = useDocSelector((d) => d.listComments().filter((c) => !c.resolved).length, onComments)
  // In drawer mode the panel opens only on an explicit tap (never on load).
  const [drawerOpen, setDrawerOpen] = useState(false)
  const onTab = (id: LeftTab) => {
    if (drawer) {
      if (tab === id && drawerOpen) setDrawerOpen(false)
      else {
        setTab(id)
        setDrawerOpen(true)
      }
    } else toggle(id)
  }

  return (
    <aside className={styles.left} aria-label={t('editor.leftRail', 'Panels')}>
      <nav className={styles.rail} aria-label={t('editor.panelTabs', 'Panel tabs')}>
        {TABS.map((d) => (
          <Tooltip key={d.id} content={t(d.key, d.fallback)} shortcut={d.shortcut} side="right">
            <button type="button" aria-label={t(d.key, d.fallback)} aria-pressed={tab === d.id && (!drawer || drawerOpen)} className={cx(styles.railBtn, tab === d.id && (!drawer || drawerOpen) && styles.railBtnActive)} onClick={() => onTab(d.id)}>
              {d.icon}
              {d.id === 'comments' && unresolved > 0 && <span className={styles.railBadge}>{unresolved}</span>}
            </button>
          </Tooltip>
        ))}
        <div className={styles.railSpacer} />
      </nav>
      {tab && !drawer && (
        <ResizablePanel handle="right" defaultSize={300} min={220} max={560} storageKey="cs.editor.leftWidth" handleLabel={t('editor.resizePanel', 'Resize panel')}>
          <PanelBody tab={tab} />
        </ResizablePanel>
      )}
      {drawer && (
        <Sheet open={!!tab && drawerOpen} onOpenChange={(o) => !o && setDrawerOpen(false)}>
          {tab && (
            <SheetContent side="left" width={360} title={panelTitle(t, tab)} flush bodyClassName={styles.drawerBody}>
              <PanelBody tab={tab} />
            </SheetContent>
          )}
        </Sheet>
      )}
    </aside>
  )
}
