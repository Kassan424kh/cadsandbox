// /admin — key numbers.
import { useQuery } from '@tanstack/react-query'
import { Activity, Building2, FolderKanban, HardDrive, Inbox, Radio, UserPlus, Users } from 'lucide-react'
import { PageHeader, Skeleton } from '../../ui'
import { formatBytes, formatNumber, useT } from '../../i18n'
import { api } from '../../data/api/endpoints'
import { useDocumentTitle } from '../hooks'
import { errorMessage } from '../components/Dialogs'
import p from '../pages/pages.module.css'

export default function AdminOverview() {
  const t = useT()
  useDocumentTitle(t('admin.overview', 'Overview'))
  const stats = useQuery({ queryKey: ['admin', 'stats'], queryFn: api.admin.stats, refetchInterval: 30_000 })
  const d = stats.data
  const cards = d
    ? [
        { icon: <Users size={14} />, label: t('admin.stat.users', 'Users'), value: formatNumber(d.users) },
        { icon: <UserPlus size={14} />, label: t('admin.stat.newUsers', 'New users (7 days)'), value: formatNumber(d.newUsers7d) },
        { icon: <Activity size={14} />, label: t('admin.stat.active', 'Active users (7 days)'), value: formatNumber(d.activeUsers7d) },
        { icon: <FolderKanban size={14} />, label: t('admin.stat.projects', 'Projects'), value: formatNumber(d.projects) },
        { icon: <Building2 size={14} />, label: t('admin.stat.orgs', 'Organizations'), value: formatNumber(d.orgs) },
        { icon: <HardDrive size={14} />, label: t('admin.stat.storage', 'Storage used'), value: formatBytes(d.storageBytes) },
        { icon: <Inbox size={14} />, label: t('admin.stat.tickets', 'Open tickets'), value: formatNumber(d.openTickets) },
        { icon: <Radio size={14} />, label: t('admin.stat.collab', 'Live connections / documents'), value: `${formatNumber(d.collabConnections)} / ${formatNumber(d.collabDocuments)}` },
      ]
    : []
  return (
    <div className={p.page}>
      <PageHeader title={t('admin.overview', 'Overview')} description={t('admin.overviewDesc', 'Service health at a glance. Numbers refresh every 30 seconds.')} />
      {stats.isError && <div className={p.notice}>{errorMessage(stats.error)}</div>}
      <div className={p.cards}>
        {stats.isLoading
          ? Array.from({ length: 8 }, (_, i) => <Skeleton key={i} height={92} radius={20} />)
          : cards.map((c) => (
              <div key={c.label} className={p.stat}>
                <span>
                  {c.icon}
                  {c.label}
                </span>
                <strong>{c.value}</strong>
              </div>
            ))}
      </div>
    </div>
  )
}
