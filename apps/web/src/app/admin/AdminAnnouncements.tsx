// /admin/announcements — site-wide banners (maintenance, incidents, news).
import { useId, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Megaphone, Trash2 } from 'lucide-react'
import type { AnnouncementDTO } from '@cadsandbox/shared'
import { Badge, Button, IconButton, Input, PageHeader, Select, Table, Textarea, toast, type TableColumn } from '../../ui'
import { formatDateTime, useT } from '../../i18n'
import { api } from '../../data/api/endpoints'
import { useAuth } from '../../data/auth/AuthProvider'
import { useDocumentTitle } from '../hooks'
import { NotFoundPage } from '../components/PageStates'
import { errorMessage } from '../components/Dialogs'
import p from '../pages/pages.module.css'
import c from '../components/components.module.css'

type Level = AnnouncementDTO['level']
const toIso = (local: string) => (local ? new Date(local).toISOString() : undefined)

export default function AdminAnnouncements() {
  const t = useT()
  const auth = useAuth()
  const qc = useQueryClient()
  const msgId = useId()
  const startId = useId()
  const endId = useId()
  const [message, setMessage] = useState('')
  const [level, setLevel] = useState<Level>('info')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  useDocumentTitle(t('admin.announcements', 'Announcements'))
  const key = ['admin', 'announcements']
  const list = useQuery({ queryKey: key, queryFn: api.admin.announcements, enabled: auth.isAdmin })
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: key }), qc.invalidateQueries({ queryKey: ['announcements'] })])
  const create = useMutation({
    mutationFn: () => api.admin.createAnnouncement({ message: message.trim(), level, startsAt: toIso(startsAt), endsAt: toIso(endsAt) ?? null }),
    onSuccess: () => {
      setMessage('')
      setStartsAt('')
      setEndsAt('')
      toast.success(t('admin.announcementCreated', 'Announcement published'))
    },
    onError: (err) => toast.error(errorMessage(err)),
    onSettled: refresh,
  })
  const remove = useMutation({ mutationFn: (id: string) => api.admin.deleteAnnouncement(id), onSettled: refresh, onError: (err) => toast.error(errorMessage(err)) })
  if (!auth.isAdmin) return <NotFoundPage />

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (message.trim()) create.mutate()
  }
  const columns: TableColumn<AnnouncementDTO>[] = [
    { key: 'level', label: t('admin.col.level', 'Level'), render: (a) => <Badge tone={a.level === 'critical' ? 'danger' : a.level === 'warning' ? 'warning' : 'info'}>{t(`admin.level.${a.level}`, a.level)}</Badge> },
    { key: 'message', label: t('admin.col.message', 'Message') },
    { key: 'startsAt', label: t('admin.col.starts', 'Starts'), render: (a) => formatDateTime(a.startsAt) },
    { key: 'endsAt', label: t('admin.col.ends', 'Ends'), render: (a) => (a.endsAt ? formatDateTime(a.endsAt) : '—') },
    { key: 'actions', label: '', align: 'right', render: (a) => <IconButton size="sm" variant="ghost" label={t('common.delete', 'Delete')} icon={<Trash2 size={14} />} onClick={() => remove.mutate(a.id)} /> },
  ]
  return (
    <div className={p.page}>
      <PageHeader title={t('admin.announcements', 'Announcements')} description={t('admin.announcementsDesc', 'Shown as a banner to every user. Critical ones cannot be dismissed.')} />
      <form className={p.panel} onSubmit={submit}>
        <label className={c.label} htmlFor={msgId}>
          {t('admin.col.message', 'Message')}
          <Textarea id={msgId} rows={3} maxLength={500} required value={message} onChange={(e) => setMessage(e.target.value)} />
        </label>
        <div className={p.filters}>
          <div className={c.label}>
            {t('admin.col.level', 'Level')}
            <Select<Level>
              value={level}
              onChange={setLevel}
              aria-label={t('admin.col.level', 'Level')}
              options={[
                { value: 'info', label: t('admin.level.info', 'Info') },
                { value: 'warning', label: t('admin.level.warning', 'Warning') },
                { value: 'critical', label: t('admin.level.critical', 'Critical') },
              ]}
            />
          </div>
          <label className={c.label} htmlFor={startId}>
            {t('admin.col.starts', 'Starts')}
            <Input id={startId} type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </label>
          <label className={c.label} htmlFor={endId}>
            {t('admin.col.ends', 'Ends')}
            <Input id={endId} type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </label>
        </div>
        <div>
          <Button type="submit" variant="primary" icon={<Megaphone size={15} />} loading={create.isPending} disabled={!message.trim()}>
            {t('admin.publish', 'Publish')}
          </Button>
        </div>
      </form>
      <Table aria-label={t('admin.announcements', 'Announcements')} columns={columns} rows={list.data ?? []} rowKey={(a) => a.id} emptyLabel={list.isLoading ? t('common.loading', 'Loading…') : t('admin.none', 'None')} />
    </div>
  )
}
