// /admin/users — searchable, paginated user table.
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import type { AdminUserDTO } from '@cadsandbox/shared'
import { Avatar, Badge, Input, PageHeader, Table, type TableColumn } from '../../ui'
import { formatBytes, formatDate, formatRelative, useT } from '../../i18n'
import { api } from '../../data/api/endpoints'
import { userColor } from '../../data/session/user'
import { useDocumentTitle } from '../hooks'
import { errorMessage } from '../components/Dialogs'
import { Pager } from './Pager'
import p from '../pages/pages.module.css'

const PAGE_SIZE = 50

export function RoleBadge({ role }: { role: AdminUserDTO['role'] }) {
  const t = useT()
  if (role === 'user') return null
  return <Badge tone={role === 'admin' ? 'danger' : 'info'}>{t(`admin.role.${role}`, role === 'admin' ? 'Admin' : 'Support')}</Badge>
}

export default function AdminUsers() {
  const t = useT()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  useDocumentTitle(t('admin.users', 'Users'))
  const users = useQuery({
    queryKey: ['admin', 'users', q, page],
    queryFn: () => api.admin.users({ q: q.trim() || undefined, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  })
  const columns: TableColumn<AdminUserDTO>[] = [
    {
      key: 'name',
      label: t('admin.col.user', 'User'),
      sortable: true,
      sortValue: (u) => u.name.toLowerCase(),
      render: (u) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <Avatar name={u.name || u.email} src={u.image} color={userColor(u.id)} size={26} />
          <span style={{ display: 'grid', minWidth: 0 }}>
            <strong style={{ fontSize: 13 }}>{u.name || '—'}</strong>
            <span style={{ fontSize: 12, color: 'var(--cs-text-3)' }}>{u.email}</span>
          </span>
        </span>
      ),
    },
    {
      key: 'status',
      label: t('admin.col.status', 'Status'),
      render: (u) => (
        <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <RoleBadge role={u.role} />
          {u.banned && <Badge tone="danger">{t('admin.banned', 'Banned')}</Badge>}
          {!u.emailVerified && <Badge tone="warning">{t('admin.unverified', 'Unverified')}</Badge>}
          {u.twoFactorEnabled && <Badge tone="success">2FA</Badge>}
        </span>
      ),
    },
    { key: 'projectCount', label: t('admin.col.projects', 'Projects'), align: 'right', sortable: true },
    { key: 'storageBytes', label: t('admin.col.storage', 'Storage'), align: 'right', sortable: true, render: (u) => formatBytes(u.storageBytes) },
    {
      key: 'lastActiveAt',
      label: t('admin.col.lastActive', 'Last active'),
      sortable: true,
      sortValue: (u) => u.lastActiveAt ?? '',
      render: (u) => (u.lastActiveAt ? formatRelative(u.lastActiveAt) : '—'),
    },
    { key: 'createdAt', label: t('admin.col.joined', 'Joined'), sortable: true, render: (u) => formatDate(u.createdAt) },
  ]
  return (
    <div className={p.page}>
      <PageHeader title={t('admin.users', 'Users')} description={t('admin.usersDesc', 'Search by name or email. Open a user for actions.')} />
      <div className={p.filters}>
        <Input
          type="search"
          value={q}
          prefix={<Search size={15} />}
          placeholder={t('admin.searchUsers', 'Search users')}
          aria-label={t('admin.searchUsers', 'Search users')}
          onChange={(e) => {
            setQ(e.target.value)
            setPage(1)
          }}
        />
      </div>
      {users.isError && <div className={p.notice}>{errorMessage(users.error)}</div>}
      <Table
        aria-label={t('admin.users', 'Users')}
        columns={columns}
        rows={users.data?.items ?? []}
        rowKey={(u) => u.id}
        onRowClick={(u) => navigate(`/admin/users/${u.id}`)}
        emptyLabel={users.isLoading ? t('common.loading', 'Loading…') : t('admin.noUsers', 'No users found')}
      />
      {users.data && <Pager page={page} pageSize={PAGE_SIZE} total={users.data.total} onPage={setPage} />}
    </div>
  )
}
