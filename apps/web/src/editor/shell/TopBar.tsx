// Top chrome: Back + project name menu (left), mode pill (center), presence/share/export (right).
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, Building, ChevronDown, CircleQuestionMark, Clock, Copy, Download, FilePlus, Files, Keyboard, Monitor, Moon, MousePointer2, PenLine, Plus, Ruler, Settings2, Share2, Sun, Upload, Wrench } from 'lucide-react'
import { useT } from '../../i18n'
import {
  AvatarStack,
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  RoundButton,
  ToolButton,
  ToolbarPill,
  ToolbarSeparator,
  Tooltip,
  cx,
  toast,
  useTheme,
} from '../../ui'
import { useEditorCtx, useEditorState, useDocSelector, onMeta } from '../EditorContext'
import { toolMode } from '../engine/tools'
import { useActions } from '../commands/actions'
import { EXPORT_FORMATS } from '../io/formats'
import { useImportExport } from '../io/useImportExport'
import { useUiStore } from '../ui-store'
import styles from '../editor.module.css'
import { useStage, useSyncStatus, usePhone } from './hooks'
import { AddMenu, AnnotateMenu, BuildMenu, DrawMenu, ModifyMenu } from './ToolMenus'

// ------------------------------------------------------------------ left: back + name
export function TopLeft() {
  const t = useT()
  const { onExit, doc, editor, readOnly, session, fileId, onOpenFile } = useEditorCtx()
  const name = useDocSelector((d) => d.meta.name, onMeta)
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const { theme, setTheme } = useTheme()
  const ui = useUiStore()
  const designs = session.manifest.designFiles()
  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  // Keep the engine's view cube below this chrome (back button + name pill) whatever its size.
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const place = () => {
      const stage = el.offsetParent as HTMLElement | null
      const r = el.getBoundingClientRect()
      const top = stage ? r.bottom - stage.getBoundingClientRect().top : r.height + el.offsetTop
      editor.setViewCubeOffset({ top: top + 10, left: Math.max(12, el.offsetLeft) })
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(el)
    return () => ro.disconnect()
  }, [editor])

  const commitName = (v: string) => {
    const next = v.trim()
    if (next && next !== name && !readOnly) {
      doc.setMeta({ name: next })
      const f = session.manifest.getFile(fileId)
      if (f && f.name !== next) session.manifest.rename(fileId, next)
    }
    setEditing(false)
  }

  return (
    <div ref={rootRef} className={cx(styles.topLeft, styles.enter)}>
      <RoundButton label={t('editor.back', 'Back to projects')} icon={<ArrowLeft />} onClick={onExit} tooltipSide="bottom" />
      <div className={styles.namePill}>
        {editing ? (
          <input
            ref={inputRef}
            className={styles.nameInput}
            defaultValue={name}
            aria-label={t('editor.renameFile', 'Design name')}
            onBlur={(e) => commitName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName(e.currentTarget.value)
              if (e.key === 'Escape') setEditing(false)
            }}
          />
        ) : (
          <span className={styles.nameText} onDoubleClick={() => !readOnly && setEditing(true)} title={name}>
            {name}
          </span>
        )}
        {readOnly && (
          <Badge tone="outline" className={styles.readOnlyBadge}>
            {t('editor.viewOnly', 'View only')}
          </Badge>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={styles.nameChevron} aria-label={t('editor.projectMenu', 'Project menu')}>
              <ChevronDown />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" sideOffset={10}>
            {!readOnly && (
              <>
            <DropdownMenuItem icon={<PenLine />} disabled={readOnly} onSelect={() => setEditing(true)}>
              {t('menu.project.rename', 'Rename')}
            </DropdownMenuItem>
            <DropdownMenuItem
              icon={<Copy />}
              disabled={readOnly}
              onSelect={() => {
                void session.duplicateFile(fileId).then((id) => {
                  toast.success(t('menu.project.duplicated', 'File duplicated'))
                  onOpenFile(id)
                })
              }}
            >
              {t('menu.project.duplicateFile', 'Duplicate file')}
            </DropdownMenuItem>
            <DropdownMenuItem
              icon={<FilePlus />}
              disabled={readOnly}
              onSelect={() => {
                void session.createDesign(t('files.newDesignName', 'Untitled design')).then((id) => onOpenFile(id))
              }}
            >
              {t('menu.project.newDesign', 'New design')}
            </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger icon={<Files />}>{t('menu.project.switchFile', 'Switch file')}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {designs.map((f) => (
                  <DropdownMenuItem key={f.id} onSelect={() => f.id !== fileId && onOpenFile(f.id)} hint={f.id === fileId ? t('menu.project.current', 'Current') : undefined}>
                    {f.name}
                  </DropdownMenuItem>
                ))}
                {designs.length === 0 && <DropdownMenuItem disabled>{t('menu.project.noFiles', 'No other designs')}</DropdownMenuItem>}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {!readOnly && <DropdownMenuSeparator />}
            {!readOnly && (
            <>
            <DropdownMenuItem icon={<Clock />} onSelect={() => ui.openDialog('versions')}>
              {t('menu.project.versions', 'Version history')}
            </DropdownMenuItem>
            <DropdownMenuItem
              icon={<Settings2 />}
              onSelect={() => {
                editor.select([])
                ui.setRightOpen(true)
              }}
            >
              {t('menu.project.settings', 'Document settings')}
            </DropdownMenuItem>
            </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t('menu.project.theme', 'Theme')}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as 'dark' | 'light' | 'system')}>
              <DropdownMenuRadioItem value="dark" icon={<Moon />}>
                {t('theme.dark', 'Dark')}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="light" icon={<Sun />}>
                {t('theme.light', 'Light')}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system" icon={<Monitor />}>
                {t('theme.system', 'System')}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            {!readOnly && (
            <DropdownMenuItem icon={<Keyboard />} shortcut="?" onSelect={() => ui.openDialog('shortcuts')}>
              {t('menu.project.shortcuts', 'Keyboard shortcuts')}
            </DropdownMenuItem>
            )}
            <DropdownMenuItem icon={<CircleQuestionMark />} onSelect={() => ui.openDialog('support')}>
              {t('menu.project.help', 'Get help')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ center: mode pill
type Mode = 'select' | 'draw' | 'add' | 'build' | 'annotate' | 'modify'

function ModeButton({ mode, icon, label, active, compact, children }: { mode: Mode; icon: ReactNode; label: string; active: boolean; compact?: boolean; children: ReactNode | ((close: () => void) => ReactNode) }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ToolButton icon={icon} label={label} showLabel={!compact} active={active} hasMenu tooltip={compact ? label : false} data-mode={mode} />
      </PopoverTrigger>
      <PopoverContent tight sideOffset={12} align="center" onOpenAutoFocus={(e) => e.preventDefault()}>
        {typeof children === 'function' ? (children as (close: () => void) => ReactNode)(() => setOpen(false)) : children}
      </PopoverContent>
    </Popover>
  )
}

export function ModePill() {
  const t = useT()
  const actions = useActions()
  const { readOnly } = useEditorCtx()
  const tool = useEditorState((s) => s.tool)
  const mode = toolMode(tool)
  const phone = usePhone()
  const { compact } = useStage()
  if (phone) return null
  return (
    <ToolbarPill label={t('editor.modes', 'Modes')} className={styles.enter}>
      <ToolButton icon={<MousePointer2 />} label={t('mode.select', 'Select')} showLabel={!compact} shortcut="V" active={mode === 'select'} onClick={() => actions.setTool('select')} />
      {!readOnly && (
        <>
          <ToolbarSeparator />
          <ModeButton mode="draw" icon={<PenLine />} label={t('mode.draw', 'Draw')} active={mode === 'draw'} compact={compact}>
            {(close: () => void) => <DrawMenu onPick={close} />}
          </ModeButton>
          <ModeButton mode="add" icon={<Plus />} label={t('mode.add', 'Add')} active={mode === 'add'} compact={compact}>
            {(close: () => void) => <AddMenu onPick={close} />}
          </ModeButton>
          <ModeButton mode="build" icon={<Building />} label={t('mode.build', 'Build')} active={mode === 'build'} compact={compact}>
            {(close: () => void) => <BuildMenu onPick={close} />}
          </ModeButton>
        </>
      )}
      <ToolbarSeparator />
      <ModeButton mode="annotate" icon={<Ruler />} label={t('mode.annotate', 'Annotate')} active={mode === 'annotate'} compact={compact}>
        {(close: () => void) => <AnnotateMenu onPick={close} />}
      </ModeButton>
      {!readOnly && (
        <ModeButton mode="modify" icon={<Wrench />} label={t('mode.modify', 'Modify')} active={mode === 'modify'} compact={compact}>
          {(close: () => void) => <ModifyMenu onPick={close} />}
        </ModeButton>
      )}
    </ToolbarPill>
  )
}

// ------------------------------------------------------------------ right: presence, share, export
const SYNC_CLASS = { synced: styles.syncSynced, syncing: styles.syncSyncing, connecting: styles.syncConnecting, offline: styles.syncOffline, error: styles.syncError, local: styles.syncLocal } as const

export function SyncDot({ className }: { className?: string }) {
  const t = useT()
  const status = useSyncStatus()
  const labels: Record<typeof status, string> = {
    synced: t('sync.synced', 'Synced'),
    syncing: t('sync.syncing', 'Syncing…'),
    connecting: t('sync.connecting', 'Connecting…'),
    offline: t('sync.offline', 'Offline — changes are saved locally'),
    error: t('sync.error', 'Sync error'),
    local: t('sync.local', 'Saved on this device'),
  }
  return (
    <Tooltip content={labels[status]}>
      <span className={cx(styles.syncDot, SYNC_CLASS[status], className)} role="status" aria-label={labels[status]} />
    </Tooltip>
  )
}

export function TopRight() {
  const t = useT()
  const { editor, session, readOnly, onOpenFile } = useEditorCtx()
  const ui = useUiStore()
  const remote = useEditorState((s) => s.remoteUsers)
  const following = useEditorState((s) => s.following)
  const { exportAs, openImportDialog } = useImportExport()
  const phone = usePhone()
  const { compact, tight } = useStage()
  const users = remote.map((r) => ({ id: r.clientId, name: r.user.name, color: r.user.color, hint: r.tool ? t('presence.usingTool', 'using {tool}', { tool: r.tool }) : undefined }))

  return (
    <div className={cx(styles.topRight, styles.enter)}>
      {users.length > 0 && (
        <div className={styles.presence}>
          <AvatarStack users={users} size={30} highlight={following} onClick={(u) => editor.follow(following === u.id ? null : (u.id as number))} />
        </div>
      )}
      {!phone && !tight && !readOnly && (
        <ToolbarPill label={t('editor.newMenu', 'New')}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <ToolButton icon={<Plus />} label={t('topbar.new', 'New')} showLabel={!compact} hasMenu tooltip={compact ? t('topbar.new', 'New') : false} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem icon={<FilePlus />} onSelect={() => void session.createDesign(t('files.newDesignName', 'Untitled design')).then(onOpenFile)}>
                {t('menu.new.design', 'New design file')}
              </DropdownMenuItem>
              <DropdownMenuItem icon={<Upload />} onSelect={openImportDialog}>
                {t('menu.new.import', 'Import file…')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ToolbarPill>
      )}
      <ToolbarPill label={t('editor.shareMenu', 'Share & export')}>
        {session.mode === 'local' ? (
          <Tooltip content={t('share.signInHint', 'Sign in to share this project and collaborate live')}>
            <ToolButton icon={<Share2 />} label={t('topbar.share', 'Share')} showLabel={!compact} tooltip={false} onClick={() => ui.openDialog('share')} />
          </Tooltip>
        ) : (
          <ToolButton icon={<Share2 />} label={t('topbar.share', 'Share')} showLabel={!compact} tooltip={compact ? t('topbar.share', 'Share') : false} onClick={() => ui.openDialog('share')} />
        )}
        {!phone && (
          <>
            <ToolbarSeparator />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <ToolButton icon={<Download />} label={t('topbar.export', 'Export')} showLabel={!compact} hasMenu tooltip={compact ? t('topbar.export', 'Export') : false} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {!readOnly && (
                  <>
                    <DropdownMenuItem icon={<Upload />} onSelect={openImportDialog}>
                      {t('menu.io.import', 'Import…')}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuLabel>{t('menu.io.export3d', '3D')}</DropdownMenuLabel>
                {EXPORT_FORMATS.filter((f) => f.kind === '3d' || f.kind === 'bim').map((f) => (
                  <DropdownMenuItem key={f.id} hint={f.extensions[0]?.toUpperCase()} onSelect={() => void exportAs(f.id)}>
                    {f.label}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>{t('menu.io.export2d', 'Drawings & data')}</DropdownMenuLabel>
                {EXPORT_FORMATS.filter((f) => f.kind === '2d' || f.kind === 'data').map((f) => (
                  <DropdownMenuItem key={f.id} hint={f.extensions[0]?.toUpperCase()} onSelect={() => (f.id === 'pdf' ? ui.setLeftTab('sheets') : f.id === 'csv' ? ui.setLeftTab('schedules') : void exportAs(f.id, { levelId: editor.getState().activeLevel }))}>
                    {f.label}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => ui.openDialog('renderImage')} hint="PNG">
                  {t('menu.io.renderImage', 'Render image…')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void exportAs('csb')} hint="CSB">
                  {t('menu.io.downloadDesign', 'Download design file')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void exportAs('csbx')} hint="CSBX">
                  {t('menu.io.downloadProject', 'Download project archive')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
        <div style={{ display: 'grid', placeItems: 'center', width: 26, height: 40 }}>
          <SyncDot />
        </div>
      </ToolbarPill>
    </div>
  )
}
