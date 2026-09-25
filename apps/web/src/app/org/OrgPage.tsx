// /org/:orgId — projects owned by or shared with an organization.
import { useMemo, useState } from 'react'
import { useParams } from 'react-router'
import { Building2, Plus, Settings } from 'lucide-react'
import { canOrg } from '@cadsandbox/shared'
import { AvatarStack, Badge, Button, EmptyState, PageHeader } from '../../ui'
import { useT } from '../../i18n'
import { useAuth } from '../../data/auth/AuthProvider'
import { useOrgProjects } from '../../data/queries'
import { matchesQuery, sortProjects, type SortKey } from '../../data/projects'
import { userColor } from '../../data/session/user'
import { useDocumentTitle } from '../hooks'
import { RequireAuth } from '../components/Guards'
import { NotFoundPage } from '../components/PageStates'
import { errorMessage } from '../components/Dialogs'
import { ProjectGrid } from '../dashboard/ProjectGrid'
import { ListToolbar } from '../dashboard/Toolbar'
import { useDashboardUI } from '../dashboard/store'
import { useFullOrg } from './orgData'
import d from '../dashboard/dashboard.module.css'
import { LinkButton } from '../components/LinkButton'

function Org({ orgId }: { orgId: string }) {
  const t = useT()
  const auth = useAuth()
  const org = auth.me?.orgs.find((o) => o.id === orgId)
  const full = useFullOrg(orgId, !!org)
  const projects = useOrgProjects(orgId, !!org)
  const openNewProject = useDashboardUI((st) => st.openNewProject)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<SortKey>('updated')
  useDocumentTitle(org?.name)
  const items = useMemo(() => sortProjects((projects.data ?? []).filter((p) => !p.deletedAt && matchesQuery(p, q)), sort), [projects.data, q, sort])
  if (!org) return <NotFoundPage />
  const members = full.data?.members ?? []
  return (
    <div className={d.page}>
      <PageHeader
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            {org.name} <Badge tone="outline">{t(`org.role.${org.role}`, org.role)}</Badge>
          </span>
        }
        description={t('org.pageDesc', '{count} members · projects owned by or shared with this organization', { count: org.memberCount })}
        actions={
          <>
            {members.length > 0 && <AvatarStack users={members.map((m) => ({ id: m.userId, name: m.user.name || m.user.email, color: userColor(m.userId), src: m.user.image ?? null }))} max={5} />}
            {canOrg(org.role, 'manageOrg') && (
              <LinkButton to={`/org/${orgId}/settings`} variant="secondary" icon={<Settings size={16} />}>{t('nav.settings', 'Settings')}</LinkButton>
            )}
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => openNewProject({ orgId })}>
              {t('dashboard.newProject', 'New project')}
            </Button>
          </>
        }
      />
      <ListToolbar q={q} onQ={setQ} sort={sort} onSort={setSort} />
      {projects.isError && <div className={d.notice}>{errorMessage(projects.error)}</div>}
      <ProjectGrid
        items={items}
        loading={projects.isLoading}
        empty={
          <EmptyState
            icon={<Building2 size={22} />}
            title={t('org.emptyTitle', 'No projects in this organization yet')}
            description={t('org.emptyDesc', 'Create a project here, or share an existing project with the organization from its share dialog.')}
            actions={
              <Button variant="primary" onClick={() => openNewProject({ orgId })}>
                {t('dashboard.newProject', 'New project')}
              </Button>
            }
          />
        }
      />
    </div>
  )
}

export default function OrgPage() {
  const { orgId = '' } = useParams()
  return (
    <RequireAuth>
      <Org orgId={orgId} />
    </RequireAuth>
  )
}
