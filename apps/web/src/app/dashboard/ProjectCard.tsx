// Project card (grid), row (list) and the shared actions menu.
import { useRef, useState } from 'react'
import { Link } from 'react-router'
import {
  Box,
  CloudUpload,
  Copy,
  Download,
  ExternalLink,
  FolderInput,
  Globe,
  HardDrive,
  Link2,
  Lock,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Share2,
  Star,
  Trash2,
  Users,
} from 'lucide-react'
import { can } from '@cadsandbox/shared'
import { Badge, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, IconButton, Tooltip, cx } from '../../ui'
import { formatBytes, formatRelative, useT } from '../../i18n'
import type { ProjectItem } from '../../data/projects'
import { startProjectDrag } from './dnd'
import s from './dashboard.module.css'

export type ProjectAction = 'open' | 'openTab' | 'rename' | 'duplicate' | 'move' | 'star' | 'share' | 'upload' | 'download' | 'trash' | 'restore' | 'delete'

export interface ProjectCapabilities {
  signedIn: boolean
  serverAvailable: boolean
}

export function allowedActions(p: ProjectItem, cap: ProjectCapabilities): Set<ProjectAction> {
  const out = new Set<ProjectAction>()
  const owner = p.mode === 'local' || p.role === 'owner'
  if (p.deletedAt) {
    if (owner) {
      out.add('restore')
      out.add('delete')
    }
    return out
  }
  out.add('open').add('openTab').add('download')
  if (owner) out.add('rename').add('move').add('trash')
  if (p.mode === 'local' || cap.serverAvailable) out.add('duplicate').add('star')
  if (p.mode === 'cloud' && can(p.role, 'share') && cap.serverAvailable) out.add('share')
  if (p.mode === 'local' && cap.signedIn && cap.serverAvailable) out.add('upload')
  return out
}

function Thumb({ p }: { p: ProjectItem }) {
  const [failed, setFailed] = useState(false)
  return (
    <div className={s.thumb}>
      {p.thumbnailUrl && !failed ? <img src={p.thumbnailUrl} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} /> : <Box size={28} strokeWidth={1.4} aria-hidden="true" />}
    </div>
  )
}

function Visibility({ p }: { p: ProjectItem }) {
  const t = useT()
  if (p.mode === 'local')
    return (
      <Badge tone="outline" icon={<HardDrive size={11} />}>
        {t('dashboard.onDevice', 'On this device')}
      </Badge>
    )
  if (p.visibility === 'public') return <Badge tone="info" icon={<Globe size={11} />}>{t('share.visibility.public', 'Public')}</Badge>
  if (p.visibility === 'link') return <Badge tone="accent" icon={<Link2 size={11} />}>{t('share.visibility.link', 'Link')}</Badge>
  if (p.role !== 'owner') return <Badge tone="neutral" icon={<Users size={11} />}>{t('dashboard.sharedBadge', 'Shared')}</Badge>
  return null
}

/** Actions that open a dialog: the closing menu must not pull focus back to its trigger. */
const DIALOG_ACTIONS: ReadonlySet<ProjectAction> = new Set(['rename', 'move', 'share', 'delete', 'upload'])

export function ProjectMenu({ p, allowed, onAction: act }: { p: ProjectItem; allowed: Set<ProjectAction>; onAction(a: ProjectAction): void }) {
  const t = useT()
  // Radix returns focus to the menu trigger when the menu closes — after the dialog opened by the
  // item already focused its first field (e.g. the rename input), so typing went nowhere.
  const openedDialog = useRef(false)
  const onAction = (a: ProjectAction) => {
    openedDialog.current = DIALOG_ACTIONS.has(a)
    act(a)
  }
  if (!allowed.size) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton size="sm" variant="ghost" label={t('dashboard.projectActions', 'Project actions')} icon={<MoreHorizontal size={16} />} tooltip={false} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        style={{ minWidth: 220 }}
        onCloseAutoFocus={(e) => {
          if (openedDialog.current) e.preventDefault()
          openedDialog.current = false
        }}
      >
        {allowed.has('restore') && (
          <DropdownMenuItem icon={<RotateCcw size={15} />} onSelect={() => onAction('restore')}>
            {t('dashboard.restore', 'Restore')}
          </DropdownMenuItem>
        )}
        {allowed.has('delete') && (
          <DropdownMenuItem danger icon={<Trash2 size={15} />} onSelect={() => onAction('delete')}>
            {t('dashboard.deleteForever', 'Delete forever')}
          </DropdownMenuItem>
        )}
        {allowed.has('open') && (
          <DropdownMenuItem icon={<Box size={15} />} onSelect={() => onAction('open')}>
            {t('dashboard.open', 'Open')}
          </DropdownMenuItem>
        )}
        {allowed.has('openTab') && (
          <DropdownMenuItem icon={<ExternalLink size={15} />} onSelect={() => onAction('openTab')}>
            {t('dashboard.openTab', 'Open in new tab')}
          </DropdownMenuItem>
        )}
        {(allowed.has('rename') || allowed.has('duplicate') || allowed.has('move') || allowed.has('star')) && <DropdownMenuSeparator />}
        {allowed.has('rename') && (
          <DropdownMenuItem icon={<Pencil size={15} />} onSelect={() => onAction('rename')}>
            {t('common.rename', 'Rename')}
          </DropdownMenuItem>
        )}
        {allowed.has('duplicate') && (
          <DropdownMenuItem icon={<Copy size={15} />} onSelect={() => onAction('duplicate')}>
            {t('common.duplicate', 'Duplicate')}
          </DropdownMenuItem>
        )}
        {allowed.has('move') && (
          <DropdownMenuItem icon={<FolderInput size={15} />} onSelect={() => onAction('move')}>
            {t('dashboard.moveTo', 'Move to…')}
          </DropdownMenuItem>
        )}
        {allowed.has('star') && (
          <DropdownMenuItem icon={<Star size={15} />} onSelect={() => onAction('star')}>
            {p.starred ? t('dashboard.unstar', 'Remove star') : t('dashboard.star', 'Star')}
          </DropdownMenuItem>
        )}
        {(allowed.has('share') || allowed.has('upload') || allowed.has('download')) && <DropdownMenuSeparator />}
        {allowed.has('share') && (
          <DropdownMenuItem icon={<Share2 size={15} />} onSelect={() => onAction('share')}>
            {t('share.share', 'Share')}
          </DropdownMenuItem>
        )}
        {allowed.has('upload') && (
          <DropdownMenuItem icon={<CloudUpload size={15} />} onSelect={() => onAction('upload')}>
            {t('dashboard.upload', 'Upload to cloud')}
          </DropdownMenuItem>
        )}
        {allowed.has('download') && (
          <DropdownMenuItem icon={<Download size={15} />} onSelect={() => onAction('download')}>
            {t('dashboard.download', 'Download .csbx')}
          </DropdownMenuItem>
        )}
        {allowed.has('trash') && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem danger icon={<Trash2 size={15} />} onSelect={() => onAction('trash')}>
              {t('dashboard.moveToTrash', 'Move to trash')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function StarButton({ p, allowed, onAction }: { p: ProjectItem; allowed: Set<ProjectAction>; onAction(a: ProjectAction): void }) {
  const t = useT()
  if (!allowed.has('star')) return null
  return (
    <IconButton
      size="sm"
      variant="ghost"
      className={cx(p.starred && s.starOn)}
      label={p.starred ? t('dashboard.unstar', 'Remove star') : t('dashboard.star', 'Star')}
      icon={<Star size={15} />}
      onClick={() => onAction('star')}
      aria-pressed={p.starred}
    />
  )
}

interface ItemProps {
  p: ProjectItem
  allowed: Set<ProjectAction>
  onAction(a: ProjectAction): void
}

function metaLine(p: ProjectItem, t: ReturnType<typeof useT>): string {
  if (p.deletedAt) return t('dashboard.deletedAgo', 'Deleted {when}', { when: formatRelative(p.deletedAt) })
  return t('dashboard.editedAgo', 'Edited {when}', { when: formatRelative(p.updatedAt) })
}

export function ProjectCard({ p, allowed, onAction }: ItemProps) {
  const t = useT()
  const draggable = allowed.has('move')
  return (
    <article className={s.card} draggable={draggable} onDragStart={draggable ? (e) => startProjectDrag(e, { id: p.id, mode: p.mode, name: p.name }) : undefined}>
      {!p.deletedAt && <Link className={s.cardLink} to={`/p/${p.id}`} aria-label={t('dashboard.openNamed', 'Open {name}', { name: p.name })} draggable={false} />}
      <div style={{ position: 'relative' }}>
        <Thumb p={p} />
        <div className={s.thumbBadges}>
          <Visibility p={p} />
        </div>
      </div>
      <div className={s.cardBody}>
        <div className={s.cardText}>
          <span className={s.cardName} title={p.name}>
            {p.name}
          </span>
          <span className={s.cardMeta}>
            {metaLine(p, t)}
            {p.ownerName && p.role !== 'owner' && <> · {p.ownerName}</>}
          </span>
        </div>
        <div className={s.cardActions}>
          <StarButton p={p} allowed={allowed} onAction={onAction} />
          <ProjectMenu p={p} allowed={allowed} onAction={onAction} />
        </div>
      </div>
    </article>
  )
}

export function ProjectRow({ p, allowed, onAction }: ItemProps) {
  const t = useT()
  const draggable = allowed.has('move')
  const roleLabel =
    p.mode === 'local' ? t('dashboard.onDevice', 'On this device') : p.role === 'owner' ? t('dashboard.ownedByYou', 'Owned by you') : (p.ownerName ?? t('dashboard.sharedBadge', 'Shared'))
  return (
    <div className={s.listRow} draggable={draggable} onDragStart={draggable ? (e) => startProjectDrag(e, { id: p.id, mode: p.mode, name: p.name }) : undefined}>
      {!p.deletedAt && <Link className={s.cardLink} to={`/p/${p.id}`} aria-label={t('dashboard.openNamed', 'Open {name}', { name: p.name })} draggable={false} />}
      <div className={s.listThumb}>
        <Thumb p={p} />
      </div>
      <span className={s.cardName} title={p.name}>
        {p.name}
      </span>
      <span className={cx(s.listMuted, s.hideSm)}>{roleLabel}</span>
      <span className={cx(s.listMuted, s.hideSm)}>{metaLine(p, t)}</span>
      <span className={cx(s.listMuted, s.hideSm)}>{p.sizeBytes ? formatBytes(p.sizeBytes) : '—'}</span>
      <div className={s.cardActions}>
        {p.mode === 'cloud' && p.visibility !== 'private' && p.visibility !== 'device' && (
          <Tooltip content={p.visibility === 'public' ? t('share.visibility.public', 'Public') : t('share.visibility.link', 'Link')}>
            <span style={{ color: 'var(--cs-text-3)', display: 'inline-flex' }}>{p.visibility === 'public' ? <Globe size={14} /> : <Link2 size={14} />}</span>
          </Tooltip>
        )}
        {p.mode === 'cloud' && p.visibility === 'private' && p.role === 'owner' && <Lock size={13} color="var(--cs-text-3)" aria-hidden="true" />}
        <StarButton p={p} allowed={allowed} onAction={onAction} />
        <ProjectMenu p={p} allowed={allowed} onAction={onAction} />
      </div>
    </div>
  )
}
