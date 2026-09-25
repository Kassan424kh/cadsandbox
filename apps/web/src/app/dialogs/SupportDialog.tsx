// Contact support: create a ticket, optionally granting time-boxed, read-only access to a project.
import { useEffect, useId, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Button, Checkbox, Dialog, DialogContent, Input, Select, Textarea, toast } from '../../ui'
import { formatDate, useT } from '../../i18n'
import { useAuth } from '../../data/auth/AuthProvider'
import { api } from '../../data/api/endpoints'
import { qk } from '../../data/queries'
import { getLocalProject } from '../../data/local/projects'
import { errorMessage } from '../components/Dialogs'
import s from './dialogs.module.css'
import c from '../components/components.module.css'
import { LinkButton } from '../components/LinkButton'

export interface SupportDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  /** Pre-fill: the project the user is working on (they may grant time-boxed read access). */
  projectId?: string | null
}

const DAYS = ['1', '3', '7', '14', '30'] as const

export function SupportDialog({ open, onOpenChange, projectId = null }: SupportDialogProps) {
  const t = useT()
  const auth = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const subjectId = useId()
  const messageId = useId()
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [grant, setGrant] = useState(false)
  const [days, setDays] = useState<(typeof DAYS)[number]>('7')
  const [isLocal, setIsLocal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setGrant(false)
    if (projectId) void getLocalProject(projectId).then((p) => setIsLocal(!!p))
  }, [open, projectId])

  const until = new Date(Date.now() + Number(days) * 86_400_000)
  const canGrant = !!projectId && !isLocal

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const ticket = await api.support.create({
        subject: subject.trim(),
        message: message.trim(),
        projectId: canGrant ? projectId : null,
        grantAccessDays: canGrant && grant ? Number(days) : 0,
      })
      await qc.invalidateQueries({ queryKey: qk.tickets })
      toast.success(t('support.sent', 'Thanks — we received your request and will reply by email and in Support.'), {
        action: { label: t('support.view', 'View'), onClick: () => navigate(`/support?ticket=${ticket.id}`) },
      })
      setSubject('')
      setMessage('')
      onOpenChange(false)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const signedIn = auth.status === 'signed-in'
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent
        size="md"
        title={t('support.title', 'Contact support')}
        description={t('support.desc', 'Describe what happened and what you expected. We usually answer within one business day.')}
        closeLabel={t('common.close', 'Close')}
      >
        {!signedIn ? (
          <div className={s.callout}>
            <strong>{t('support.signInTitle', 'Sign in to open a ticket')}</strong>
            <span>{t('support.signInBody', 'Tickets are linked to your account so we can reply securely. You can also reach us through the contact details in the imprint.')}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <LinkButton to="/login?next=/support" onClick={() => onOpenChange(false)} variant="primary">{t('auth.signIn', 'Sign in')}</LinkButton>
              <LinkButton to="/legal/imprint" onClick={() => onOpenChange(false)} variant="secondary">{t('legal.imprint', 'Imprint')}</LinkButton>
            </div>
          </div>
        ) : (
          <form className={c.form} onSubmit={submit}>
            <label className={c.label} htmlFor={subjectId}>
              {t('support.subject', 'Subject')}
              <Input id={subjectId} value={subject} required minLength={3} maxLength={200} onChange={(e) => setSubject(e.target.value)} autoFocus />
            </label>
            <label className={c.label} htmlFor={messageId}>
              {t('support.message', 'Message')}
              <Textarea id={messageId} value={message} required maxLength={10_000} rows={6} onChange={(e) => setMessage(e.target.value)} />
            </label>
            {canGrant && (
              <div className={s.consent}>
                <Checkbox checked={grant} onChange={setGrant} label={<strong>{t('support.grantLabel', 'Let support look at this project (read-only)')}</strong>} />
                <p>{t('support.grantIntro', 'Only if you tick this box, support staff may open the project you are working on — and only:')}</p>
                <ul>
                  <li>{t('support.grantRead', 'to view it, never to change, copy or share it,')}</li>
                  <li>{t('support.grantScope', 'this one project — none of your other projects or files,')}</li>
                  <li>{t('support.grantUntil', 'until {date}, after which access ends automatically,', { date: formatDate(until, { dateStyle: 'long' }) })}</li>
                  <li>{t('support.grantLog', 'with every access recorded in an audit log.')}</li>
                </ul>
                <p>{t('support.grantRevoke', 'You can withdraw this permission at any time on the Support page. Without it, support only sees your message and project name.')}</p>
                {grant && (
                  <div className={c.label}>
                    {t('support.grantDuration', 'Access duration')}
                    <Select
                      value={days}
                      onChange={(v) => setDays(v as (typeof DAYS)[number])}
                      options={DAYS.map((d) => ({ value: d, label: t('support.days', '{count} days', { count: d }) }))}
                      aria-label={t('support.grantDuration', 'Access duration')}
                    />
                  </div>
                )}
              </div>
            )}
            {projectId && isLocal && <p className={c.hint}>{t('support.localProject', 'This project is stored only on your device, so support cannot open it. Describe the issue in detail — or upload the project to the cloud first if support should look at it.')}</p>}
            {error && (
              <p className={c.error} role="alert">
                {error}
              </p>
            )}
            <div className={c.footer}>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button type="submit" variant="primary" loading={busy} disabled={subject.trim().length < 3 || !message.trim()}>
                {t('support.send', 'Send')}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
