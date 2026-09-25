// Shared page for All projects (+ folders), Shared with me, Starred and Trash.
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { CloudOff, FolderPlus, HardDrive, Import, Plus, Star, Trash2, Users } from 'lucide-react'
import { LIMITS } from '@cadsandbox/shared'
import { Button, EmptyState, PageHeader, toast } from '../../ui'
import { useT } from '../../i18n'
import { useFolderActions, invalidateProjects } from '../../data/queries'
import { folderPath, matchesQuery, sortProjects, type ProjectItem, type SortKey } from '../../data/projects'
import { importProjectFile } from '../../data/archive'
import { useDocumentTitle } from '../hooks'
import { PromptDialog, errorMessage } from '../components/Dialogs'
import { ProjectGrid } from './ProjectGrid'
import { FolderCrumbs, FolderTiles } from './Folders'
import { ListToolbar } from './Toolbar'
import { useDashboardUI } from './store'
import { useProjectsView, type ListView } from './useProjectsView'
import s from './dashboard.module.css'

function useFiltered(list: ProjectItem[], q: string, sort: SortKey): ProjectItem[] {
  return useMemo(() => sortProjects(list.filter((p) => matchesQuery(p, q)), sort), [list, q, sort])
}

export function ProjectListPage({ view }: { view: Exclude<ListView, 'recent'> }) {
  const t = useT()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { folderId = null } = useParams()
  const data = useProjectsView(view, folderId)
  const folderActions = useFolderActions()
  const openNewProject = useDashboardUI((st) => st.openNewProject)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<SortKey>('updated')
  const [newFolder, setNewFolder] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const primary = useFiltered(data.primary, q, sort)
  const device = useFiltered(data.device, q, sort)
  const path = folderPath(data.folders, folderId)
  const current = path[path.length - 1] ?? null

  const titles: Record<typeof view, [string, string]> = {
    all: ['nav.allProjects', 'All projects'],
    shared: ['nav.shared', 'Shared with me'],
    starred: ['nav.starred', 'Starred'],
    trash: ['nav.trash', 'Trash'],
  }
  const title = current?.name ?? t(titles[view][0], titles[view][1])
  useDocumentTitle(title)

  const importArchive = async (file: File) => {
    const run = importProjectFile(file).then(async (id) => {
      await invalidateProjects(qc)
      navigate(`/p/${id}`)
    })
    toast.promise(run, {
      loading: t('dashboard.importing', 'Importing project…'),
      success: t('dashboard.imported', 'Project imported to this device'),
      error: (err: unknown) => errorMessage(err),
    })
  }

  const descriptions: Record<typeof view, string> = {
    all: data.signedIn
      ? t('dashboard.allDesc', 'Your cloud projects — synced, shareable and available offline on this device.')
      : t('dashboard.allDescLocal', 'Projects stored in this browser. Sign in to sync them across devices.'),
    shared: t('dashboard.sharedDesc', 'Projects other people shared with you or your organizations.'),
    starred: t('dashboard.starredDesc', 'Your favourite projects in one place.'),
    trash: t('dashboard.trashDesc', 'Trashed projects are deleted permanently after {days} days.', { days: LIMITS.trashRetentionDays }),
  }

  const empty: Record<typeof view, ReactNode> = {
    all: (
      <EmptyState
        icon={<Plus size={22} />}
        title={q ? t('dashboard.noMatches', 'No matching projects') : current ? t('dashboard.emptyFolder', 'This folder is empty') : t('dashboard.emptyAll', 'No projects yet')}
        description={q ? undefined : t('dashboard.emptyAllDesc', 'Create a project from a template or drag projects into this folder.')}
        actions={
          !q && (
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => openNewProject({ folderId })}>
              {t('dashboard.newProject', 'New project')}
            </Button>
          )
        }
      />
    ),
    shared: (
      <EmptyState
        icon={data.signedIn ? <Users size={22} /> : <CloudOff size={22} />}
        title={data.signedIn ? t('dashboard.emptyShared', 'Nothing shared with you yet') : t('dashboard.sharedSignedOut', 'Sharing needs an account')}
        description={
          data.signedIn
            ? t('dashboard.emptySharedDesc', 'When someone invites you to a project, it shows up here.')
            : t('dashboard.sharedSignedOutDesc', 'Sign in to see projects others share with you.')
        }
      />
    ),
    starred: <EmptyState icon={<Star size={22} />} title={t('dashboard.emptyStarred', 'No starred projects')} description={t('dashboard.emptyStarredDesc', 'Star projects to find them quickly.')} />,
    trash: <EmptyState icon={<Trash2 size={22} />} title={t('dashboard.emptyTrash', 'Trash is empty')} description={t('dashboard.emptyTrashDesc', 'Projects you delete stay here for a while so you can restore them.')} />,
  }

  const hasDevice = device.length > 0
  return (
    <div className={s.page}>
      <PageHeader
        title={title}
        description={current ? undefined : descriptions[view]}
        breadcrumbs={view === 'all' && path.length > 0 ? <FolderCrumbs path={path} mode={data.folderMode} /> : undefined}
        actions={
          view === 'all' && (
            <>
              <Button variant="secondary" icon={<Import size={16} />} onClick={() => fileInput.current?.click()}>
                {t('dashboard.import', 'Import .csbx')}
              </Button>
              <Button variant="secondary" icon={<FolderPlus size={16} />} onClick={() => setNewFolder(true)}>
                {t('dashboard.newFolder', 'New folder')}
              </Button>
              <Button variant="primary" icon={<Plus size={16} />} onClick={() => openNewProject({ folderId })}>
                {t('dashboard.newProject', 'New project')}
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept=".csbx,application/zip"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (f) void importArchive(f)
                }}
              />
            </>
          )
        }
      />
      <ListToolbar q={q} onQ={setQ} sort={sort} onSort={setSort} />
      {data.fromCache && (
        <div className={s.notice} role="status">
          <CloudOff size={15} />
          {t('dashboard.fromCache', 'Offline — showing cloud projects cached on this device.')}
        </div>
      )}
      {!!data.error && !data.fromCache && (
        <div className={s.notice} role="alert">
          {errorMessage(data.error)}
        </div>
      )}
      {view === 'all' && <FolderTiles folders={data.subfolders} allFolders={data.folders} />}
      <section>
        {hasDevice && data.signedIn && (
          <div className={s.sectionHead}>
            <h2 className={s.sectionTitle}>{t('dashboard.inCloud', 'In your cloud')}</h2>
          </div>
        )}
        <ProjectGrid items={primary} folders={data.folders} loading={data.loading} empty={hasDevice ? null : empty[view]} />
      </section>
      {hasDevice && (
        <section>
          <div className={s.sectionHead}>
            <h2 className={s.sectionTitle}>
              <HardDrive size={16} /> {t('dashboard.onDevice', 'On this device')}
            </h2>
            <span className={s.sectionHint}>{t('dashboard.onDeviceHint', 'Stored only in this browser — upload to sync and share.')}</span>
          </div>
          <ProjectGrid items={device} folders={[]} />
        </section>
      )}
      <PromptDialog
        open={newFolder}
        onOpenChange={setNewFolder}
        title={t('dashboard.newFolder', 'New folder')}
        label={t('dashboard.folderName', 'Folder name')}
        initialValue={t('dashboard.untitledFolder', 'New folder')}
        confirmLabel={t('common.create', 'Create')}
        onSubmit={(name) => folderActions.create.mutateAsync({ mode: data.folderMode, name, parentId: folderId })}
      />
    </div>
  )
}
