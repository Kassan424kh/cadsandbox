// Command palette (Mod+K): engine commands, tools, catalog items, panels, files, theme.
import { useMemo } from 'react'
import { Command } from 'cmdk'
import { Boxes, Camera, FileBox, Folder, Keyboard, Layers, ListTree, MessageSquare, Monitor, Moon, Search, Sheet, Sun, Table2 } from 'lucide-react'
import { useT } from '../../i18n'
import { Dialog, DialogContent, Kbd, useTheme } from '../../ui'
import { useEditorCtx } from '../EditorContext'
import { TOOL_META, ALL_TOOLS } from '../engine/tools'
import { PaletteExtras } from './PaletteExtras'
import { ALL_CATALOG_ITEMS } from '../library/catalog'
import { IconLevel } from '../library/icons'
import { useUiStore, type LeftTab } from '../ui-store'
import { useActions } from './actions'
import styles from './palette.module.css'

export function CommandPalette() {
  const t = useT()
  const { editor, session, fileId, onOpenFile, readOnly } = useEditorCtx()
  const actions = useActions()
  const open = useUiStore((s) => s.paletteOpen)
  const setOpen = useUiStore((s) => s.setPaletteOpen)
  const setLeftTab = useUiStore((s) => s.setLeftTab)
  const openDialog = useUiStore((s) => s.openDialog)
  const { setTheme } = useTheme()
  const commands = useMemo(() => editor.commands.list(), [editor])
  const designs = session.manifest.designFiles()
  const close = () => setOpen(false)
  const run = (fn: () => void) => () => {
    close()
    fn()
  }
  const panels: { id: LeftTab; label: string; icon: React.ReactNode }[] = [
    { id: 'scene', label: t('panel.scene', 'Scene'), icon: <ListTree /> },
    { id: 'files', label: t('panel.files', 'Files'), icon: <Folder /> },
    { id: 'library', label: t('panel.library', 'Library'), icon: <Boxes /> },
    { id: 'layers', label: t('panel.layers', 'Layers'), icon: <Layers /> },
    { id: 'levels', label: t('panel.levels', 'Levels'), icon: <IconLevel /> },
    { id: 'views', label: t('panel.views', 'Views'), icon: <Camera /> },
    { id: 'comments', label: t('panel.comments', 'Comments'), icon: <MessageSquare /> },
    { id: 'sheets', label: t('panel.sheets', 'Sheets'), icon: <Sheet /> },
    { id: 'schedules', label: t('panel.schedules', 'Schedules'), icon: <Table2 /> },
  ]

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent title={t('palette.title', 'Command palette')} hideTitle size="md" flush>
        <Command className={styles.root} label={t('palette.title', 'Command palette')} loop>
          <div className={styles.inputRow}>
            <Search />
            <Command.Input className={styles.input} placeholder={t('palette.placeholder', 'Type a command, tool or object…')} autoFocus />
            <Kbd shortcut="Escape" />
          </div>
          <Command.List className={styles.list}>
            <Command.Empty className={styles.empty}>{t('palette.empty', 'No results')}</Command.Empty>
            <Command.Group heading={t('palette.commands', 'Commands')}>
              {commands
                .filter((c) => !readOnly || /^(view|render|edit\.select|level|gizmo)/.test(c.id))
                .map((c) => (
                  <Command.Item key={c.id} value={`${c.category} ${c.label} ${c.id}`} className={styles.item} disabled={!editor.commands.canExecute(c.id)} onSelect={run(() => actions.run(c.id))}>
                    <span className={styles.itemLabel}>{t(`command.${c.id}`, c.label)}</span>
                    <span className={styles.itemHint}>{t(`command.category.${c.category}`, c.category)}</span>
                    {c.shortcut && <Kbd shortcut={c.shortcut} />}
                  </Command.Item>
                ))}
            </Command.Group>
            {!readOnly && <PaletteExtras run={run} />}
            {!readOnly && (
              <Command.Group heading={t('palette.tools', 'Tools')}>
                {ALL_TOOLS.filter((id) => id !== 'place').map((id) => {
                  const m = TOOL_META[id]
                  return (
                    <Command.Item key={id} value={`tool ${t(m.key, m.fallback)} ${id}`} className={styles.item} onSelect={run(() => actions.setTool(id))}>
                      {m.icon}
                      <span className={styles.itemLabel}>{t(m.key, m.fallback)}</span>
                      {m.shortcut && <Kbd shortcut={m.shortcut} />}
                    </Command.Item>
                  )
                })}
              </Command.Group>
            )}
            {!readOnly && (
              <Command.Group heading={t('palette.add', 'Add')}>
                {ALL_CATALOG_ITEMS.map((it) => (
                  <Command.Item key={it.id} value={`add ${t(it.key, it.fallback)} ${it.keywords?.join(' ') ?? ''}`} className={styles.item} onSelect={run(() => actions.place(it.node, it.id))}>
                    {it.icon}
                    <span className={styles.itemLabel}>{t(it.key, it.fallback)}</span>
                    <span className={styles.itemHint}>{t('palette.place', 'Place')}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
            <Command.Group heading={t('palette.panels', 'Panels')}>
              {panels.map((p) => (
                <Command.Item key={p.id} value={`panel ${p.label}`} className={styles.item} onSelect={run(() => setLeftTab(p.id))}>
                  {p.icon}
                  <span className={styles.itemLabel}>{p.label}</span>
                </Command.Item>
              ))}
            </Command.Group>
            <Command.Group heading={t('palette.files', 'Files')}>
              {designs.map((f) => (
                <Command.Item key={f.id} value={`file ${f.name}`} className={styles.item} disabled={f.id === fileId} onSelect={run(() => onOpenFile(f.id))}>
                  <FileBox />
                  <span className={styles.itemLabel}>{f.name}</span>
                  {f.id === fileId && <span className={styles.itemHint}>{t('menu.project.current', 'Current')}</span>}
                </Command.Item>
              ))}
            </Command.Group>
            <Command.Group heading={t('palette.appearance', 'Appearance & help')}>
              <Command.Item value="theme dark" className={styles.item} onSelect={run(() => setTheme('dark'))}>
                <Moon />
                <span className={styles.itemLabel}>{t('theme.useDark', 'Use dark theme')}</span>
              </Command.Item>
              <Command.Item value="theme light" className={styles.item} onSelect={run(() => setTheme('light'))}>
                <Sun />
                <span className={styles.itemLabel}>{t('theme.useLight', 'Use light theme')}</span>
              </Command.Item>
              <Command.Item value="theme system" className={styles.item} onSelect={run(() => setTheme('system'))}>
                <Monitor />
                <span className={styles.itemLabel}>{t('theme.useSystem', 'Follow system theme')}</span>
              </Command.Item>
              <Command.Item value="keyboard shortcuts help" className={styles.item} onSelect={run(() => openDialog('shortcuts'))}>
                <Keyboard />
                <span className={styles.itemLabel}>{t('menu.project.shortcuts', 'Keyboard shortcuts')}</span>
                <Kbd shortcut="?" />
              </Command.Item>
            </Command.Group>
          </Command.List>
          <div className={styles.footer}>
            <span>
              <Kbd shortcut="ArrowUp" />
              <Kbd shortcut="ArrowDown" /> {t('palette.navigate', 'navigate')}
            </span>
            <span>
              <Kbd shortcut="Enter" /> {t('palette.run', 'run')}
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
