// Project collection view (grid/list) with every project action and its dialogs.
import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { Skeleton, downloadBlob, toast } from '../../ui'
import { useT } from '../../i18n'
import { useAuth } from '../../data/auth/AuthProvider'
import { useServer } from '../../data/online'
import { useProjectActions } from '../../data/queries'
import { exportProjectFile } from '../../data/archive'
import { editorUser } from '../../data/session/user'
import type { FolderItem, ProjectItem } from '../../data/projects'
import { ConfirmDialog, PromptDialog, errorMessage } from '../components/Dialogs'
import { MoveDialog } from './MoveDialog'
import { ProjectCard, ProjectRow, allowedActions, type ProjectAction } from './ProjectCard'
import { useDashboardUI } from './store'
import s from './dashboard.module.css'

interface Props {
  items: ProjectItem[]
  /** Folders available as move targets, per mode. */
  folders?: FolderItem[]
  loading?: boolean
  empty?: ReactNode
}

export function ProjectGrid({ items, folders = [], loading, empty }: Props) {
  const t = useT()
  const navigate = useNavigate()
  const auth = useAuth()
  const { available } = useServer()
  const actions = useProjectActions()
  const view = useDashboardUI((st) => st.view)
  const setShare = useDashboardUI((st) => st.setShare)
  const setUpload = useDashboardUI((st) => st.setUpload)
  const [rename, setRename] = useState<ProjectItem | null>(null)
  const [move, setMove] = useState<ProjectItem | null>(null)
  const [remove, setRemove] = useState<ProjectItem | null>(null)
  const cap = { signedIn: auth.status === 'signed-in', serverAvailable: available === true }

  const fail = (err: unknown) => toast.error(errorMessage(err, t('errors.generic', 'Something went wrong')))

  const onAction = (p: ProjectItem, a: ProjectAction) => {
    const target = { id: p.id, mode: p.mode }
    switch (a) {
      case 'open':
        navigate(`/p/${p.id}`)
        break
      case 'openTab':
        window.open(`/p/${p.id}`, '_blank', 'noopener')
        break
      case 'rename':
        setRename(p)
        break
      case 'move':
        setMove(p)
        break
      case 'delete':
        setRemove(p)
        break
      case 'share':
        setShare(p)
        break
      case 'upload':
        setUpload(p)
        break
      case 'star':
        actions.star.mutate({ ...target, starred: !p.starred }, { onError: fail })
        break
      case 'duplicate':
        actions.duplicate.mutate(
          { ...target, name: t('dashboard.copyOf', '{name} (copy)', { name: p.name }) },
          { onSuccess: () => toast.success(t('dashboard.duplicated', 'Project duplicated')), onError: fail },
        )
        break
      case 'restore':
        actions.restore.mutate(target, { onSuccess: () => toast.success(t('dashboard.restored', 'Project restored')), onError: fail })
        break
      case 'trash':
        actions.trash.mutate(target, {
          onSuccess: () =>
            toast(t('dashboard.trashed', '“{name}” moved to trash', { name: p.name }), {
              action: { label: t('common.undo', 'Undo'), onClick: () => actions.restore.mutate(target, { onError: fail }) },
            }),
          onError: fail,
        })
        break
      case 'download': {
        const run = exportProjectFile(p.id, editorUser(auth.user)).then(({ blob, fileName }) => downloadBlob(blob, fileName))
        toast.promise(run, {
          loading: t('dashboard.preparingDownload', 'Preparing download…'),
          success: t('dashboard.downloadReady', 'Download started'),
          error: (err: unknown) => errorMessage(err),
        })
        break
      }
    }
  }

  if (loading)
    return (
      <div className={s.grid} aria-busy="true">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={s.skeletonCard}>
            <Skeleton height={148} radius={0} />
            <Skeleton width="70%" height={14} />
            <Skeleton width="40%" height={11} />
          </div>
        ))}
      </div>
    )
  if (!items.length) return <>{empty ?? null}</>

  const moveFolders = move ? folders.filter((f) => f.mode === move.mode && (move.mode === 'local' || f.orgId === move.orgId)) : []

  return (
    <>
      {view === 'grid' ? (
        <div className={s.grid}>
          {items.map((p) => (
            <ProjectCard key={`${p.mode}:${p.id}`} p={p} allowed={allowedActions(p, cap)} onAction={(a) => onAction(p, a)} />
          ))}
        </div>
      ) : (
        <div className={s.list} role="list">
          {items.map((p) => (
            <ProjectRow key={`${p.mode}:${p.id}`} p={p} allowed={allowedActions(p, cap)} onAction={(a) => onAction(p, a)} />
          ))}
        </div>
      )}

      <PromptDialog
        open={!!rename}
        onOpenChange={(o) => !o && setRename(null)}
        title={t('dashboard.renameProject', 'Rename project')}
        label={t('dashboard.projectName', 'Project name')}
        initialValue={rename?.name ?? ''}
        confirmLabel={t('common.rename', 'Rename')}
        onSubmit={(name) => rename && actions.rename.mutateAsync({ id: rename.id, mode: rename.mode, name })}
      />
      <MoveDialog
        open={!!move}
        onOpenChange={(o) => !o && setMove(null)}
        title={t('dashboard.moveProject', 'Move “{name}”', { name: move?.name ?? '' })}
        folders={moveFolders}
        current={move?.folderId ?? null}
        onMove={(folderId) =>
          move &&
          actions.move.mutateAsync({ id: move.id, mode: move.mode, folderId }).then(
            () => toast.success(t('dashboard.moved', 'Project moved')),
            (err: unknown) => fail(err),
          )
        }
      />
      <ConfirmDialog
        open={!!remove}
        onOpenChange={(o) => !o && setRemove(null)}
        danger
        title={t('dashboard.deleteForeverTitle', 'Delete “{name}” forever?', { name: remove?.name ?? '' })}
        description={
          remove?.mode === 'local'
            ? t('dashboard.deleteForeverLocal', 'The project and its files are removed from this device. This cannot be undone.')
            : t('dashboard.deleteForeverCloud', 'The project, its files and version history are deleted for everyone. This cannot be undone.')
        }
        confirmLabel={t('dashboard.deleteForever', 'Delete forever')}
        onConfirm={() => remove && actions.remove.mutateAsync({ id: remove.id, mode: remove.mode })}
      />
    </>
  )
}
