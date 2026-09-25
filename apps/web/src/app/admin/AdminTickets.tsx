// /admin/tickets[/:ticketId] — support inbox: reply, set status, open the granted project read-only.
import { useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, Inbox, Lock } from 'lucide-react'
import type { TicketDTO, TicketStatus } from '@cadsandbox/shared'
import { Button, EmptyState, PageHeader, SegmentedControl, Select, Skeleton, Textarea, toast } from '../../ui'
import { formatDateTime, formatRelative, useT } from '../../i18n'
import { api } from '../../data/api/endpoints'
import { useDocumentTitle } from '../hooks'
import { errorMessage } from '../components/Dialogs'
import { TicketStatusBadge, TicketThread } from '../pages/SupportPage'
import p from '../pages/pages.module.css'

type Filter = TicketStatus | 'all'

function grantActive(tk: TicketDTO): boolean {
  return !!tk.projectId && !!tk.supportAccessUntil && Date.parse(tk.supportAccessUntil) > Date.now()
}

function Detail({ ticket }: { ticket: TicketDTO }) {
  const t = useT()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [body, setBody] = useState('')
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'tickets'] })
  const reply = useMutation({
    mutationFn: (text: string) => api.admin.ticketMessage(ticket.id, text),
    onSuccess: () => {
      setBody('')
      void refresh()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const status = useMutation({
    mutationFn: (s: TicketStatus) => api.admin.updateTicket(ticket.id, s),
    onSuccess: () => void refresh(),
    onError: (err) => toast.error(errorMessage(err)),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (body.trim()) reply.mutate(body.trim())
  }
  const active = grantActive(ticket)
  return (
    <div className={p.detail}>
      <header className={p.detailHead}>
        <div style={{ display: 'grid', gap: 4 }}>
          <h2>{ticket.subject}</h2>
          <span className={p.muted}>
            {ticket.userEmail} · {formatDateTime(ticket.createdAt)}
          </span>
        </div>
        <Select<TicketStatus>
          value={ticket.status}
          onChange={(s) => status.mutate(s)}
          aria-label={t('admin.ticketStatus', 'Status')}
          options={[
            { value: 'open', label: t('support.status.open', 'Open') },
            { value: 'pending', label: t('support.status.pending', 'Waiting for reply') },
            { value: 'closed', label: t('support.status.closed', 'Closed') },
          ]}
        />
      </header>
      {ticket.projectId && (
        <div className={p.notice}>
          {active ? <Eye size={16} /> : <Lock size={16} />}
          <p>
            {active
              ? t('admin.grantActive', 'The user granted read-only access to the linked project until {date}. Access is logged.', { date: formatDateTime(ticket.supportAccessUntil!) })
              : t('admin.grantNone', 'No valid access grant — the project cannot be opened.')}
          </p>
          {active && (
            <Button size="sm" variant="secondary" icon={<Eye size={14} />} onClick={() => navigate(`/p/${ticket.projectId}`)}>
              {t('admin.openReadOnly', 'Open read-only')}
            </Button>
          )}
        </div>
      )}
      <TicketThread ticket={ticket} staffView />
      <form className={p.replyForm} onSubmit={submit}>
        <Textarea value={body} rows={4} maxLength={10_000} placeholder={t('admin.replyPlaceholder', 'Reply to the user (sent by email and shown in their Support page)…')} aria-label={t('support.reply', 'Reply')} onChange={(e) => setBody(e.target.value)} />
        <div>
          <Button type="submit" variant="primary" loading={reply.isPending} disabled={!body.trim()}>
            {t('support.sendReply', 'Send reply')}
          </Button>
        </div>
      </form>
    </div>
  )
}

export default function AdminTickets() {
  const t = useT()
  const navigate = useNavigate()
  const { ticketId } = useParams()
  const [filter, setFilter] = useState<Filter>('open')
  useDocumentTitle(t('admin.tickets', 'Support inbox'))
  const tickets = useQuery({ queryKey: ['admin', 'tickets', filter], queryFn: () => api.admin.tickets(filter), refetchInterval: 30_000 })
  const list = tickets.data ?? []
  const selected = list.find((x) => x.id === ticketId) ?? (ticketId ? undefined : list[0])
  return (
    <div className={p.page}>
      <PageHeader
        title={t('admin.tickets', 'Support inbox')}
        actions={
          <SegmentedControl<Filter>
            value={filter}
            onChange={setFilter}
            aria-label={t('admin.ticketStatus', 'Status')}
            options={[
              { value: 'open', label: t('support.status.open', 'Open') },
              { value: 'pending', label: t('admin.pending', 'Pending') },
              { value: 'closed', label: t('support.status.closed', 'Closed') },
              { value: 'all', label: t('admin.all', 'All') },
            ]}
          />
        }
      />
      {tickets.isError && <div className={p.notice}>{errorMessage(tickets.error)}</div>}
      {tickets.isLoading ? (
        <Skeleton height={240} />
      ) : !list.length ? (
        <EmptyState icon={<Inbox size={22} />} title={t('admin.inboxEmpty', 'Inbox zero')} description={t('admin.inboxEmptyDesc', 'No tickets with this status.')} />
      ) : (
        <div className={p.split}>
          <nav className={p.ticketList} aria-label={t('admin.tickets', 'Support inbox')}>
            {list.map((tk) => (
              <button key={tk.id} type="button" className={p.ticketItem} aria-current={tk.id === selected?.id ? 'true' : undefined} onClick={() => navigate(`/admin/tickets/${tk.id}`)}>
                <strong>{tk.subject}</strong>
                <span>
                  <TicketStatusBadge status={tk.status} /> {tk.userEmail} · {formatRelative(tk.updatedAt)}
                </span>
              </button>
            ))}
          </nav>
          {selected ? <Detail ticket={selected} /> : <p className={p.muted}>{t('admin.ticketNotInFilter', 'This ticket is not in the current filter.')}</p>}
        </div>
      )}
    </div>
  )
}
