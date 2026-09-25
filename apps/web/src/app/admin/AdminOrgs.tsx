// /admin/orgs and /admin/projects — metadata tables (project content requires a user support grant).
import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Lock, Search } from 'lucide-react'
import type { OrgDTO, ProjectDTO } from '@cadsandbox/shared'
import { Badge, Input, PageHeader, Table, type TableColumn } from '../../ui'
import { formatBytes, formatDate, formatRelative, useT } from '../../i18n'
import { api } from '../../data/api/endpoints'
import { useDocumentTitle } from '../hooks'
import { errorMessage } from '../components/Dialogs'
import { Pager } from './Pager'
import p from '../pages/pages.module.css'

const PAGE_SIZE = 50

function useSearchPage() {
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  return { q, page, setPage, setQ: (v: string) => (setQ(v), setPage(1)) }
}

function SearchBox({ value, onChange, label }: { value: string; onChange(v: string): void; label: string }) {
  return (
    <div className={p.filters}>
      <Input type="search" value={value} prefix={<Search size={15} />} placeholder={label} aria-label={label} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

export function AdminOrgsView() {
  const t = useT()
  const sp = useSearchPage()
  useDocumentTitle(t('admin.orgs', 'Organizations'))
  const orgs = useQuery({ queryKey: ['admin', 'orgs', sp.q, sp.page], queryFn: () => api.admin.orgs({ q: sp.q.trim() || undefined, page: sp.page, pageSize: PAGE_SIZE }), placeholderData: keepPreviousData })
  const columns: TableColumn<OrgDTO>[] = [
    { key: 'name', label: t('org.name', 'Name'), sortable: true },
    { key: 'slug', label: t('org.slug', 'URL name'), render: (o) => <span className={p.mono}>{o.slug}</span> },
    { key: 'memberCount', label: t('admin.col.members', 'Members'), align: 'right', sortable: true },
    { key: 'createdAt', label: t('admin.col.created', 'Created'), sortable: true, render: (o) => formatDate(o.createdAt) },
  ]
  return (
    <div className={p.page}>
      <PageHeader title={t('admin.orgs', 'Organizations')} />
      <SearchBox value={sp.q} onChange={sp.setQ} label={t('admin.searchOrgs', 'Search organizations')} />
      {orgs.isError && <div className={p.notice}>{errorMessage(orgs.error)}</div>}
      <Table aria-label={t('admin.orgs', 'Organizations')} columns={columns} rows={orgs.data?.items ?? []} rowKey={(o) => o.id} emptyLabel={orgs.isLoading ? t('common.loading', 'Loading…') : t('admin.none', 'None')} />
      {orgs.data && <Pager page={sp.page} pageSize={PAGE_SIZE} total={orgs.data.total} onPage={sp.setPage} />}
    </div>
  )
}

export function AdminProjectsView() {
  const t = useT()
  const sp = useSearchPage()
  useDocumentTitle(t('admin.projects', 'Projects'))
  const projects = useQuery({
    queryKey: ['admin', 'projects', sp.q, sp.page],
    queryFn: () => api.admin.projects({ q: sp.q.trim() || undefined, page: sp.page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  })
  const columns: TableColumn<ProjectDTO>[] = [
    { key: 'name', label: t('org.name', 'Name'), sortable: true },
    { key: 'ownerName', label: t('admin.col.owner', 'Owner'), sortable: true },
    { key: 'visibility', label: t('share.generalAccess', 'General access'), render: (x) => <Badge tone={x.visibility === 'public' ? 'info' : 'neutral'}>{t(`share.visibility.${x.visibility}`, x.visibility)}</Badge> },
    { key: 'sizeBytes', label: t('admin.col.storage', 'Storage'), align: 'right', sortable: true, render: (x) => formatBytes(x.sizeBytes) },
    { key: 'updatedAt', label: t('admin.col.updated', 'Updated'), sortable: true, render: (x) => formatRelative(x.updatedAt) },
    { key: 'deletedAt', label: '', render: (x) => (x.deletedAt ? <Badge tone="warning">{t('nav.trash', 'Trash')}</Badge> : null) },
  ]
  return (
    <div className={p.page}>
      <PageHeader title={t('admin.projects', 'Projects')} description={t('admin.projectsDesc', 'Names, owners and sizes only.')} />
      <div className={p.notice}>
        <Lock size={15} />
        <p>
          {t(
            'admin.contentAccess',
            'Project content is private. Staff can open a project only while its owner has granted time-limited read access in a support request — use the Support inbox for that.',
          )}
        </p>
      </div>
      <SearchBox value={sp.q} onChange={sp.setQ} label={t('admin.searchProjects', 'Search projects')} />
      {projects.isError && <div className={p.notice}>{errorMessage(projects.error)}</div>}
      <Table aria-label={t('admin.projects', 'Projects')} columns={columns} rows={projects.data?.items ?? []} rowKey={(x) => x.id} emptyLabel={projects.isLoading ? t('common.loading', 'Loading…') : t('admin.none', 'None')} />
      {projects.data && <Pager page={sp.page} pageSize={PAGE_SIZE} total={projects.data.total} onPage={sp.setPage} />}
    </div>
  )
}

export default AdminOrgsView
