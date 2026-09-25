// /admin/audit — filterable audit log of privileged and security-relevant actions.
import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { AuditEntryDTO } from '@cadsandbox/shared'
import { Input, PageHeader, Table, Tooltip, type TableColumn } from '../../ui'
import { formatDateTime, useT } from '../../i18n'
import { api } from '../../data/api/endpoints'
import { useDebouncedCallback } from '../../ui'
import { useDocumentTitle } from '../hooks'
import { errorMessage } from '../components/Dialogs'
import { Pager } from './Pager'
import p from '../pages/pages.module.css'

const PAGE_SIZE = 50

export default function AdminAudit() {
  const t = useT()
  const [draft, setDraft] = useState({ actorId: '', action: '', targetType: '', targetId: '' })
  const [filters, setFilters] = useState(draft)
  const [page, setPage] = useState(1)
  useDocumentTitle(t('admin.audit', 'Audit log'))
  const apply = useDebouncedCallback((next: typeof draft) => {
    setFilters(next)
    setPage(1)
  }, 350)
  const update = (patch: Partial<typeof draft>) => {
    const next = { ...draft, ...patch }
    setDraft(next)
    apply(next)
  }
  const log = useQuery({
    queryKey: ['admin', 'audit', filters, page],
    queryFn: () =>
      api.admin.audit({
        actorId: filters.actorId.trim() || undefined,
        action: filters.action.trim() || undefined,
        targetType: filters.targetType.trim() || undefined,
        targetId: filters.targetId.trim() || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
  })
  const columns: TableColumn<AuditEntryDTO>[] = [
    { key: 'createdAt', label: t('admin.col.time', 'Time'), width: 170, render: (e) => formatDateTime(e.createdAt) },
    { key: 'actor', label: t('admin.col.actor', 'Actor'), render: (e) => e.actorEmail ?? (e.actorId ? <span className={p.mono}>{e.actorId}</span> : t('admin.system', 'System')) },
    { key: 'action', label: t('admin.col.action', 'Action'), render: (e) => <span className={p.mono}>{e.action}</span> },
    { key: 'target', label: t('admin.col.target', 'Target'), render: (e) => (e.targetType ? <span className={p.mono}>{`${e.targetType}:${e.targetId ?? ''}`}</span> : '—') },
    {
      key: 'meta',
      label: t('admin.col.details', 'Details'),
      render: (e) => {
        const json = Object.keys(e.meta ?? {}).length ? JSON.stringify(e.meta) : ''
        return json ? (
          <Tooltip content={<pre style={{ margin: 0, maxWidth: 420, whiteSpace: 'pre-wrap', fontSize: 11 }}>{JSON.stringify(e.meta, null, 2)}</pre>}>
            <span className={p.mono} style={{ display: 'inline-block', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'bottom' }}>
              {json}
            </span>
          </Tooltip>
        ) : (
          '—'
        )
      },
    },
  ]
  return (
    <div className={p.page}>
      <PageHeader title={t('admin.audit', 'Audit log')} description={t('admin.auditDesc', 'Security events and every privileged action. Entries are kept for 365 days.')} />
      <div className={p.filters}>
        <Input value={draft.action} placeholder={t('admin.filter.action', 'Action (e.g. admin.user)')} aria-label={t('admin.col.action', 'Action')} onChange={(e) => update({ action: e.target.value })} />
        <Input value={draft.actorId} placeholder={t('admin.filter.actor', 'Actor ID')} aria-label={t('admin.col.actor', 'Actor')} onChange={(e) => update({ actorId: e.target.value })} />
        <Input value={draft.targetType} placeholder={t('admin.filter.targetType', 'Target type')} aria-label={t('admin.filter.targetType', 'Target type')} onChange={(e) => update({ targetType: e.target.value })} />
        <Input value={draft.targetId} placeholder={t('admin.filter.targetId', 'Target ID')} aria-label={t('admin.filter.targetId', 'Target ID')} onChange={(e) => update({ targetId: e.target.value })} />
      </div>
      {log.isError && <div className={p.notice}>{errorMessage(log.error)}</div>}
      <Table aria-label={t('admin.audit', 'Audit log')} dense columns={columns} rows={log.data?.items ?? []} rowKey={(e) => e.id} emptyLabel={log.isLoading ? t('common.loading', 'Loading…') : t('admin.none', 'None')} />
      {log.data && <Pager page={page} pageSize={PAGE_SIZE} total={log.data.total} onPage={setPage} />}
    </div>
  )
}
