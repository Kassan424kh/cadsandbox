// Global banners: impersonation (persistent), announcements, offline, pending account deletion.
import { useState } from 'react'
import { Link } from 'react-router'
import { AlertTriangle, CloudOff, Info, ShieldAlert, X } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Button, cx, toast } from '../../ui'
import { formatDate, useT } from '../../i18n'
import { useAuth } from '../../data/auth/AuthProvider'
import { authClient, unwrap } from '../../data/auth/client'
import { useAnnouncements } from '../../data/queries'
import { useOnline, useServer } from '../../data/online'
import { api } from '../../data/api/endpoints'
import { errorMessage } from './Dialogs'
import s from './components.module.css'

/** Shown on every page (incl. the editor) while a staff member acts as another user. */
export function ImpersonationBanner() {
  const t = useT()
  const auth = useAuth()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  if (!auth.impersonatedBy || !auth.user) return null
  const stop = async () => {
    setBusy(true)
    try {
      await unwrap(authClient.admin.stopImpersonating())
      qc.clear()
      await auth.refresh()
      window.location.assign('/admin/users')
    } catch (err) {
      toast.error(errorMessage(err))
      setBusy(false)
    }
  }
  return (
    <div className={cx(s.banner, s.impersonating)} role="alert">
      <ShieldAlert size={16} aria-hidden="true" />
      <p>
        {t('banner.impersonating', 'Impersonating {name} ({email}). Every action is recorded in the audit log.', {
          name: auth.user.name,
          email: auth.user.email,
        })}
      </p>
      <Button size="sm" variant="danger-solid" loading={busy} onClick={stop}>
        {t('banner.stopImpersonating', 'Stop impersonating')}
      </Button>
    </div>
  )
}

const DISMISSED_KEY = 'cadsandbox.dismissedAnnouncements'

function readDismissed(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(-50) : []
  } catch {
    return []
  }
}

export function AnnouncementBanner() {
  const t = useT()
  const { available } = useServer()
  const { data } = useAnnouncements(available === true)
  const [dismissed, setDismissed] = useState(readDismissed)
  const now = Date.now()
  const active = (data ?? []).filter(
    (a) => Date.parse(a.startsAt) <= now &&(!a.endsAt || Date.parse(a.endsAt) > now) && (a.level === 'critical' || !dismissed.includes(a.id)),
  )
  const a = active[0]
  if (!a) return null
  const dismiss = () => {
    const next = [...dismissed, a.id]
    setDismissed(next)
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(next))
    } catch {
      /* ignore */
    }
  }
  const Icon = a.level === 'info' ? Info : AlertTriangle
  return (
    <div className={cx(s.banner, s[a.level])} role={a.level === 'critical' ? 'alert' : 'status'}>
      <Icon size={16} aria-hidden="true" />
      <p>{a.message}</p>
      {a.level !== 'critical' && (
        <button type="button" className={s.bannerDismiss} onClick={dismiss} aria-label={t('common.dismiss', 'Dismiss')}>
          <X size={14} />
        </button>
      )}
    </div>
  )
}

export function OfflineBanner() {
  const t = useT()
  const online = useOnline()
  const auth = useAuth()
  if (online && !auth.offline) return null
  return (
    <div className={cx(s.banner, s.info)} role="status">
      <CloudOff size={16} aria-hidden="true" />
      <p>
        {online
          ? t('banner.serverOffline', 'The CadSandbox server is unreachable. You can keep working — changes are saved on this device and sync later.')
          : t('banner.offline', 'You are offline. Keep working — changes are saved on this device and sync when you are back online.')}
      </p>
    </div>
  )
}

export function DeletionBanner() {
  const t = useT()
  const auth = useAuth()
  const [busy, setBusy] = useState(false)
  const when = auth.me?.deletionScheduledAt
  if (!when) return null
  const cancel = async () => {
    setBusy(true)
    try {
      await api.me.cancelDeletion()
      await auth.refresh()
      toast.success(t('privacy.deletionCancelled', 'Account deletion cancelled'))
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={cx(s.banner, s.warning)} role="alert">
      <AlertTriangle size={16} aria-hidden="true" />
      <p>
        {t('banner.deletion', 'Your account and all its data will be permanently deleted on {date}.', { date: formatDate(when, { dateStyle: 'long' }) })}{' '}
        <Link to="/settings/privacy">{t('banner.deletionDetails', 'Details')}</Link>
      </p>
      <Button size="sm" variant="secondary" loading={busy} onClick={cancel}>
        {t('privacy.cancelDeletion', 'Cancel deletion')}
      </Button>
    </div>
  )
}
