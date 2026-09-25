// Folder tiles (drop targets), breadcrumbs and folder actions (create/rename/move/delete).
import { Fragment, useState } from 'react'
import { Link } from 'react-router'
import { ChevronRight, Folder, FolderInput, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, IconButton, cx, toast } from '../../ui'
import { useT } from '../../i18n'
import { useFolderActions, useProjectActions } from '../../data/queries'
import type { FolderItem } from '../../data/projects'
import { ConfirmDialog, PromptDialog, errorMessage } from '../components/Dialogs'
import { MoveDialog } from './MoveDialog'
import { useProjectDrop } from './dnd'
import s from './dashboard.module.css'

function useMoveProjectInto(folder: FolderItem | null, mode: FolderItem['mode']) {
  const t = useT()
  const actions = useProjectActions()
  return useProjectDrop((p) => {
    if (p.mode !== mode) {
      toast.error(t('dashboard.moveModeMismatch', 'Projects on this device and cloud projects live in separate folders.'))
      return
    }
    actions.move.mutate(
      { id: p.id, mode: p.mode, folderId: folder?.id ?? null },
      {
        onSuccess: () => toast.success(t('dashboard.movedInto', 'Moved “{name}” to {folder}', { name: p.name, folder: folder?.name ?? t('nav.allProjects', 'All projects') })),
        onError: (e) => toast.error(errorMessage(e)),
      },
    )
  })
}

function FolderTile({ folder, onRename, onMove, onDelete, canManage }: { folder: FolderItem; onRename(): void; onMove(): void; onDelete(): void; canManage: boolean }) {
  const t = useT()
  const { over, dropProps } = useMoveProjectInto(folder, folder.mode)
  return (
    <div className={cx(s.folder, over && s.folderOver)} {...dropProps}>
      <Folder size={18} />
      <Link to={`/projects/f/${folder.id}`} style={{ flex: 1, minWidth: 0, color: 'inherit', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13.5, fontWeight: 500 }}>
        {folder.name}
      </Link>
      {canManage && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton size="sm" variant="ghost" label={t('dashboard.folderActions', 'Folder actions')} icon={<MoreHorizontal size={15} />} tooltip={false} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem icon={<Pencil size={15} />} onSelect={onRename}>
              {t('common.rename', 'Rename')}
            </DropdownMenuItem>
            <DropdownMenuItem icon={<FolderInput size={15} />} onSelect={onMove}>
              {t('dashboard.moveTo', 'Move to…')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem danger icon={<Trash2 size={15} />} onSelect={onDelete}>
              {t('dashboard.deleteFolder', 'Delete folder')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

export function FolderTiles({ folders, allFolders, canManage = true }: { folders: FolderItem[]; allFolders: FolderItem[]; canManage?: boolean }) {
  const t = useT()
  const actions = useFolderActions()
  const [rename, setRename] = useState<FolderItem | null>(null)
  const [move, setMove] = useState<FolderItem | null>(null)
  const [remove, setRemove] = useState<FolderItem | null>(null)
  if (!folders.length) return null
  return (
    <>
      <div className={s.folders}>
        {folders.map((f) => (
          <FolderTile key={f.id} folder={f} canManage={canManage} onRename={() => setRename(f)} onMove={() => setMove(f)} onDelete={() => setRemove(f)} />
        ))}
      </div>
      <PromptDialog
        open={!!rename}
        onOpenChange={(o) => !o && setRename(null)}
        title={t('dashboard.renameFolder', 'Rename folder')}
        label={t('dashboard.folderName', 'Folder name')}
        initialValue={rename?.name ?? ''}
        confirmLabel={t('common.rename', 'Rename')}
        onSubmit={(name) => rename && actions.rename.mutateAsync({ folder: rename, name })}
      />
      <MoveDialog
        open={!!move}
        onOpenChange={(o) => !o && setMove(null)}
        title={t('dashboard.moveFolder', 'Move folder “{name}”', { name: move?.name ?? '' })}
        folders={allFolders.filter((f) => f.mode === move?.mode && f.orgId === move?.orgId)}
        current={move?.parentId ?? null}
        movingFolderId={move?.id}
        onMove={(parentId) => move && actions.move.mutateAsync({ folder: move, parentId })}
      />
      <ConfirmDialog
        open={!!remove}
        onOpenChange={(o) => !o && setRemove(null)}
        danger
        title={t('dashboard.deleteFolderTitle', 'Delete folder “{name}”?', { name: remove?.name ?? '' })}
        description={t('dashboard.deleteFolderDesc', 'Projects and sub-folders inside move up one level. No project is deleted.')}
        confirmLabel={t('dashboard.deleteFolder', 'Delete folder')}
        onConfirm={() => remove && actions.remove.mutateAsync({ folder: remove })}
      />
    </>
  )
}

/** Breadcrumbs "All projects › A › B"; every crumb accepts dropped projects. */
export function FolderCrumbs({ path, mode }: { path: FolderItem[]; mode: FolderItem['mode'] }) {
  const t = useT()
  return (
    <nav className={s.crumbs} aria-label={t('dashboard.breadcrumbs', 'Breadcrumbs')}>
      <Crumb folder={null} mode={mode} label={t('nav.allProjects', 'All projects')} />
      {path.map((f, i) => (
        <Fragment key={f.id}>
          <ChevronRight size={13} aria-hidden="true" />
          {i === path.length - 1 ? <span aria-current="page">{f.name}</span> : <Crumb folder={f} mode={mode} label={f.name} />}
        </Fragment>
      ))}
    </nav>
  )
}

function Crumb({ folder, mode, label }: { folder: FolderItem | null; mode: FolderItem['mode']; label: string }) {
  const { over, dropProps } = useMoveProjectInto(folder, mode)
  return (
    <Link to={folder ? `/projects/f/${folder.id}` : '/projects'} className={cx(s.crumb, over && s.crumbOver)} {...dropProps}>
      {label}
    </Link>
  )
}
