// /settings/security — password, two-factor, passkeys, active sessions.
import { useId, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { LogOut, Monitor, Smartphone } from 'lucide-react'
import { Badge, Button, Checkbox, IconButton, Input, Skeleton, toast } from '../../ui'
import { formatRelative, useT } from '../../i18n'
import { authClient, unwrap } from '../../data/auth/client'
import { useDocumentTitle } from '../hooks'
import { RequireAuth } from '../components/Guards'
import { ConfirmDialog, errorMessage } from '../components/Dialogs'
import { MIN_PASSWORD } from '../auth/AuthLayout'
import { PasswordStrength } from '../auth/SignupPage'
import { TwoFactorSection } from './TwoFactorSection'
import { PasskeysSection } from './PasskeysSection'
import s from './settings.module.css'

function PasswordSection() {
  const t = useT()
  const curId = useId()
  const newId = useId()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [revoke, setRevoke] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (next.length < MIN_PASSWORD) return
    setBusy(true)
    setError(null)
    try {
      await unwrap(authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: revoke }))
      setCurrent('')
      setNext('')
      toast.success(t('security.passwordChanged', 'Password changed'))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className={s.section}>
      <div className={s.sectionHead}>
        <div>
          <h2>{t('security.password', 'Password')}</h2>
          <p>{t('security.passwordDesc', 'Use a long, unique password. We store only a salted hash.')}</p>
        </div>
      </div>
      <form className={s.form} onSubmit={submit}>
        <label className={s.field} htmlFor={curId}>
          {t('security.currentPassword', 'Current password')}
          <Input id={curId} type="password" required autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </label>
        <label className={s.field} htmlFor={newId}>
          {t('auth.newPassword', 'New password')}
          <Input id={newId} type="password" required minLength={MIN_PASSWORD} maxLength={128} autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          <PasswordStrength password={next} />
        </label>
        <Checkbox checked={revoke} onChange={setRevoke} label={t('security.signOutOthers', 'Sign out of all other devices')} />
        {error && <p className={s.error}>{error}</p>}
        <div>
          <Button type="submit" variant="primary" loading={busy} disabled={!current || next.length < MIN_PASSWORD}>
            {t('security.changePassword', 'Change password')}
          </Button>
        </div>
      </form>
    </section>
  )
}

interface SessionRow {
  id: string
  token: string
  ipAddress?: string | null
  userAgent?: string | null
  createdAt: string | Date
  updatedAt?: string | Date
}

export function describeAgent(ua: string | null | undefined): { label: string; mobile: boolean } {
  if (!ua) return { label: 'Unknown device', mobile: false }
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : ''
  return { label: os ? `${browser} · ${os}` : browser, mobile: /Mobile|iPhone|Android/.test(ua) }
}

function SessionsSection() {
  const t = useT()
  const qc = useQueryClient()
  const key = ['auth', 'sessions']
  const current = authClient.useSession()
  const sessions = useQuery({ queryKey: key, queryFn: async () => ((await unwrap(authClient.listSessions())) ?? []) as SessionRow[] })
  const [confirmAll, setConfirmAll] = useState(false)
  const currentToken = (current.data as { session?: { token?: string } } | null)?.session?.token
  const revoke = async (token: string) => {
    try {
      await unwrap(authClient.revokeSession({ token }))
      await qc.invalidateQueries({ queryKey: key })
      toast.success(t('security.sessionRevoked', 'Signed out of that device'))
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  return (
    <section className={s.section}>
      <div className={s.sectionHead}>
        <div>
          <h2>{t('security.sessions', 'Active sessions')}</h2>
          <p>{t('security.sessionsDesc', 'Devices where you are signed in. IP addresses are shortened for your privacy.')}</p>
        </div>
        <Button variant="secondary" icon={<LogOut size={15} />} onClick={() => setConfirmAll(true)} disabled={(sessions.data?.length ?? 0) < 2}>
          {t('security.signOutOthersShort', 'Sign out other devices')}
        </Button>
      </div>
      {sessions.isLoading ? (
        <Skeleton height={96} />
      ) : sessions.isError ? (
        <p className={s.error}>{errorMessage(sessions.error)}</p>
      ) : (
        <div className={s.list}>
          {sessions.data?.map((row) => {
            const agent = describeAgent(row.userAgent)
            const isCurrent = row.token === currentToken
            return (
              <div key={row.id} className={s.listItem}>
                {agent.mobile ? <Smartphone size={18} /> : <Monitor size={18} />}
                <div className={s.itemText}>
                  <strong>
                    {agent.label} {isCurrent && <Badge tone="accent">{t('security.thisDevice', 'This device')}</Badge>}
                  </strong>
                  <span>
                    {row.ipAddress ? `${row.ipAddress} · ` : ''}
                    {t('security.lastActive', 'Active {when}', { when: formatRelative(row.updatedAt ?? row.createdAt) })}
                  </span>
                </div>
                {!isCurrent ? <IconButton size="sm" variant="ghost" label={t('security.revoke', 'Sign out this device')} icon={<LogOut size={14} />} onClick={() => void revoke(row.token)} /> : <span />}
              </div>
            )
          })}
        </div>
      )}
      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title={t('security.signOutOthersTitle', 'Sign out of all other devices?')}
        description={t('security.signOutOthersDesc', 'Every session except this one ends immediately. Unsynced changes on those devices stay stored there and sync after signing in again.')}
        confirmLabel={t('security.signOutOthersShort', 'Sign out other devices')}
        onConfirm={async () => {
          await unwrap(authClient.revokeOtherSessions())
          await qc.invalidateQueries({ queryKey: key })
        }}
      />
    </section>
  )
}

export default function SecurityPage() {
  const t = useT()
  useDocumentTitle(t('settings.security', 'Security'))
  return (
    <RequireAuth>
      <div className={s.page}>
        <PasswordSection />
        <TwoFactorSection />
        <PasskeysSection />
        <SessionsSection />
      </div>
    </RequireAuth>
  )
}
