// /support — my tickets: conversation, replies, and revoking a project access grant.
import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LifeBuoy, Plus, ShieldCheck, ShieldOff } from 'lucide-react'
import type { TicketDTO } from '@cadsandbox/shared'
import { Badge, Button, EmptyState, PageHeader, Skeleton, Textarea, cx, toast } from '../../ui'
import { formatDateTime, formatRelative, useT } from '../../i18n'
import { api } from '../../data/api/endpoints'
import { qk } from '../../data/queries'
import { useDocumentTitle } from '../hooks'
import { RequireAuth } from '../components/Guards'
import { ConfirmDialog, errorMessage } from '../components/Dialogs'
import { useDashboardUI } from '../dashboard/store'
import s from './pages.module.css'

export function TicketStatusBadge({ status }: { status: TicketDTO['status'] }) {
  const t = useT()
  const tone = status === 'open' ? 'accent' : status === 'pending' ? 'warning' : 'neutral'
  return <Badge tone={tone}>{t(`support.status.${status}`, status === 'open' ? 'Open' : status === 'pending' ? 'Waiting for reply' : 'Closed')}</Badge>
}

export function TicketThread({ ticket, staffView }: { ticket: TicketDTO; staffView?: boolean }) {
  const t = useT()
  return (
    <div className={s.thread}>
      {ticket.messages.map((m) => (
        <article key={m.id} className={cx(s.message, m.staff && s.staffMessage)}>
          <header>
            <strong>{m.staff ? (staffView ? m.authorName : t('support.team', 'CadSandbox support')) : m.authorName}</strong>
            <time dateTime={m.createdAt} title={formatDateTime(m.createdAt)}>
              {formatRelative(m.createdAt)}
            </time>
          </header>
          <p>{m.body}</p>
        </article>
      ))}
    </div>
  )
}

function AccessNotice({ ticket }: { ticket: TicketDTO }) {
  const t = useT()
  const qc = useQueryClient()
  const [confirm, setConfirm] = useState(false)
  const active = ticket.supportAccessUntil && Date.parse(ticket.supportAccessUntil) > Date.now()
  if (!ticket.projectId) return null
  return (
    <div className={s.notice}>
      {active ? <ShieldCheck size={16} /> : <ShieldOff size={16} />}
      <p>
        {active
          ? t('support.accessActive', 'Support may view the linked project read-only until {date}.', { date: formatDateTime(ticket.supportAccessUntil!) })
          : t('support.accessNone', 'Support cannot open the linked project.')}
      </p>
      {active && (
        <Button size="sm" variant="secondary" onClick={() => setConfirm(true)}>
          {t('support.revoke', 'Withdraw access')}
        </Button>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('support.revokeTitle', 'Withdraw project access?')}
        description={t('support.revokeDesc', 'Support staff will no longer be able to open the project. This takes effect immediately.')}
        confirmLabel={t('support.revoke', 'Withdraw access')}
        onConfirm={async () => {
          await api.support.revokeAccess(ticket.id)
          await qc.invalidateQueries({ queryKey: qk.tickets })
          await qc.invalidateQueries({ queryKey: qk.ticket(ticket.id) })
          toast.success(t('support.revoked', 'Access withdrawn'))
        }}
      />
    </div>
  )
}

function TicketDetail({ id }: { id: string }) {
  const t = useT()
  const qc = useQueryClient()
  const ticket = useQuery({ queryKey: qk.ticket(id), queryFn: () => api.support.get(id), refetchInterval: 30_000 })
  const [body, setBody] = useState('')
  const reply = useMutation({
    mutationFn: (text: string) => api.support.message(id, text),
    onSuccess: (data) => {
      setBody('')
      qc.setQueryData(qk.ticket(id), data)
      void qc.invalidateQueries({ queryKey: qk.tickets })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  if (ticket.isLoading) return <Skeleton height={240} />
  if (!ticket.data) return <p className={s.muted}>{errorMessage(ticket.error)}</p>
  const tk = ticket.data
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (body.trim()) reply.mutate(body.trim())
  }
  return (
    <div className={s.detail}>
      <header className={s.detailHead}>
        <h2>{tk.subject}</h2>
        <TicketStatusBadge status={tk.status} />
      </header>
      <AccessNotice ticket={tk} />
      <TicketThread ticket={tk} />
      {tk.status !== 'closed' && (
        <form className={s.replyForm} onSubmit={submit}>
          <Textarea value={body} rows={4} maxLength={10_000} placeholder={t('support.replyPlaceholder', 'Write a reply…')} aria-label={t('support.reply', 'Reply')} onChange={(e) => setBody(e.target.value)} />
          <div>
            <Button type="submit" variant="primary" loading={reply.isPending} disabled={!body.trim()}>
              {t('support.sendReply', 'Send reply')}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}

function Tickets() {
  const t = useT()
  const [search, setSearch] = useSearchParams()
  const setSupportOpen = useDashboardUI((st) => st.setSupportOpen)
  const tickets = useQuery({ queryKey: qk.tickets, queryFn: api.support.list })
  const selected = search.get('ticket') ?? tickets.data?.[0]?.id ?? null
  return (
    <div className={s.page}>
      <PageHeader
        title={t('nav.support', 'Support')}
        description={t('support.pageDesc', 'Your conversations with the CadSandbox team.')}
        actions={
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => setSupportOpen(true)}>
            {t('support.newTicket', 'New request')}
          </Button>
        }
      />
      {tickets.isLoading ? (
        <Skeleton height={200} />
      ) : !tickets.data?.length ? (
        <EmptyState
          icon={<LifeBuoy size={22} />}
          title={t('support.emptyTitle', 'No support requests')}
          description={t('support.emptyDesc', 'Stuck or found a bug? Send us a request — we are happy to help.')}
          actions={
            <Button variant="primary" onClick={() => setSupportOpen(true)}>
              {t('support.newTicket', 'New request')}
            </Button>
          }
        />
      ) : (
        <div className={s.split}>
          <nav className={s.ticketList} aria-label={t('support.tickets', 'Requests')}>
            {tickets.data.map((tk) => (
              <button key={tk.id} type="button" className={s.ticketItem} aria-current={tk.id === selected ? 'true' : undefined} onClick={() => setSearch({ ticket: tk.id })}>
                <strong>{tk.subject}</strong>
                <span>
                  <TicketStatusBadge status={tk.status} /> {formatRelative(tk.updatedAt)}
                </span>
              </button>
            ))}
          </nav>
          {selected && <TicketDetail id={selected} />}
        </div>
      )}
    </div>
  )
}

export default function SupportPage() {
  const t = useT()
  useDocumentTitle(t('nav.support', 'Support'))
  return (
    <RequireAuth description={t('support.gate', 'Sign in to see your support requests.')}>
      <Tickets />
    </RequireAuth>
  )
}
