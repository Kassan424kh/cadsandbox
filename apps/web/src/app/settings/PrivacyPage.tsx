// /settings/privacy — privacy center: data export (Art. 15/20), account deletion with a 7-day grace
// period (Art. 17), what we store and why, and an overview of consents and access grants.
import { useState } from 'react'
import { Link } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Cookie, Download, EyeOff, HardDrive, ShieldCheck, Trash2, UserX } from 'lucide-react'
import { LIMITS } from '@cadsandbox/shared'
import { Badge, Button, toast } from '../../ui'
import { formatDate, formatDateTime, useT } from '../../i18n'
import { useAuth } from '../../data/auth/AuthProvider'
import { api } from '../../data/api/endpoints'
import { qk } from '../../data/queries'
import { clearCloudCache } from '../../data/cloud-cache'
import { useDocumentTitle } from '../hooks'
import { RequireAuth } from '../components/Guards'
import { ConfirmDialog, errorMessage } from '../components/Dialogs'
import s from './settings.module.css'
import { LinkButton } from '../components/LinkButton'

function ExportSection() {
  const t = useT()
  return (
    <section className={s.section}>
      <div className={s.sectionHead}>
        <div>
          <h2>
            <Download size={16} /> {t('privacy.exportTitle', 'Download your data')}
          </h2>
          <p>
            {t(
              'privacy.exportDesc',
              'A ZIP archive with your profile, all projects you own (documents and files), collections, support requests and your security log — in open formats (JSON and your original files).',
            )}
          </p>
        </div>
        <LinkButton href={api.me.exportUrl()} download variant="primary" icon={<Download size={15} />}>{t('privacy.exportButton', 'Download archive')}</LinkButton>
      </div>
    </section>
  )
}

function DeleteSection() {
  const t = useT()
  const auth = useAuth()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const scheduled = auth.me?.deletionScheduledAt ?? null
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
    <section className={`${s.section} ${s.danger}`}>
      <div className={s.sectionHead}>
        <div>
          <h2>
            <UserX size={16} /> {t('privacy.deleteTitle', 'Delete account')}
          </h2>
          <p>
            {scheduled
              ? t('privacy.deleteScheduled', 'Your account is scheduled for deletion on {date}. Until then you can cancel and everything stays as it is.', {
                  date: formatDateTime(scheduled),
                })
              : t(
                  'privacy.deleteDesc',
                  'Deletes your account, all projects you own, files, collections and personal data. You have {days} days to change your mind; after that, deletion is permanent. Projects stored only on this device are not affected.',
                  { days: LIMITS.accountDeletionGraceDays },
                )}
          </p>
        </div>
        {scheduled ? (
          <Button variant="primary" loading={busy} onClick={cancel}>
            {t('privacy.cancelDeletion', 'Cancel deletion')}
          </Button>
        ) : (
          <Button variant="danger" icon={<Trash2 size={15} />} onClick={() => setOpen(true)}>
            {t('privacy.deleteButton', 'Delete my account')}
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        danger
        title={t('privacy.deleteConfirmTitle', 'Delete your account?')}
        description={t('privacy.deleteConfirmDesc', 'We’ll email you a confirmation. You can cancel within {days} days by signing in. Shared projects you own will disappear for collaborators too.', {
          days: LIMITS.accountDeletionGraceDays,
        })}
        requireText={auth.user?.email ?? ''}
        confirmLabel={t('privacy.deleteButton', 'Delete my account')}
        onConfirm={async () => {
          const res = await api.me.delete(auth.user?.email ?? '')
          await auth.refresh()
          toast.warning(t('privacy.deletionScheduled', 'Account scheduled for deletion on {date}', { date: formatDate(res.deletionScheduledAt) }))
        }}
      />
    </section>
  )
}

function StoreTable() {
  const t = useT()
  const rows: [string, string, string, string][] = [
    [
      t('privacy.data.account', 'Account'),
      t('privacy.data.accountWhat', 'Name, email, password hash, optional photo, language, 2FA secret, passkeys'),
      t('privacy.data.accountWhy', 'Signing in and securing your account (contract, Art. 6(1)(b) GDPR)'),
      t('privacy.data.accountKeep', 'Until you delete your account (+{days}-day grace period)', { days: LIMITS.accountDeletionGraceDays }),
    ],
    [
      t('privacy.data.projects', 'Projects & files'),
      t('privacy.data.projectsWhat', 'Design documents, uploaded files, thumbnails, versions, comments'),
      t('privacy.data.projectsWhy', 'Sync, sharing and collaboration you ask for (Art. 6(1)(b))'),
      t('privacy.data.projectsKeep', 'Until you delete them; trash is emptied after {days} days', { days: LIMITS.trashRetentionDays }),
    ],
    [
      t('privacy.data.session', 'Session cookie'),
      t('privacy.data.sessionWhat', 'One strictly necessary, HttpOnly cookie with a random session token'),
      t('privacy.data.sessionWhy', 'Keeping you signed in (§ 25(2) TDDDG — no consent needed)'),
      t('privacy.data.sessionKeep', 'Until you sign out or the session expires'),
    ],
    [
      t('privacy.data.security', 'Security log'),
      t('privacy.data.securityWhat', 'Sign-ins and privileged actions with shortened IP addresses'),
      t('privacy.data.securityWhy', 'Protecting accounts and detecting abuse (Art. 6(1)(f))'),
      t('privacy.data.securityKeep', '{days} days', { days: LIMITS.auditRetentionDays }),
    ],
    [
      t('privacy.data.support', 'Support requests'),
      t('privacy.data.supportWhat', 'Your messages and, only if you allow it, time-limited read access to one project'),
      t('privacy.data.supportWhy', 'Answering your request (Art. 6(1)(b))'),
      t('privacy.data.supportKeep', 'Until your account is deleted'),
    ],
    [
      t('privacy.data.device', 'This device'),
      t('privacy.data.deviceWhat', 'Local projects, offline copies, preferences (theme, language, units)'),
      t('privacy.data.deviceWhy', 'Offline use — stored only in your browser, never sent unless you sync'),
      t('privacy.data.deviceKeep', 'Until you delete it in the browser; cloud copies are removed on sign-out'),
    ],
  ]
  return (
    <section className={s.section}>
      <div className={s.sectionHead}>
        <div>
          <h2>
            <ShieldCheck size={16} /> {t('privacy.storeTitle', 'What we store and why')}
          </h2>
          <p>
            {t('privacy.storeDesc', 'Hosted in the EU. No analytics, no advertising, no third-party requests — fonts and all assets are served by us.')}{' '}
            <Link to="/legal/privacy">{t('legal.privacy', 'Privacy policy')}</Link>
          </p>
        </div>
      </div>
      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>{t('privacy.col.category', 'Category')}</th>
              <th>{t('privacy.col.what', 'What')}</th>
              <th>{t('privacy.col.why', 'Why')}</th>
              <th>{t('privacy.col.keep', 'How long')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r[0]}>
                {r.map((cell, i) => (
                  <td key={i}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function ConsentSection() {
  const t = useT()
  const qc = useQueryClient()
  const tickets = useQuery({ queryKey: qk.tickets, queryFn: api.support.list })
  const [clearing, setClearing] = useState(false)
  const grants = (tickets.data ?? []).filter((tk) => tk.projectId && tk.supportAccessUntil && Date.parse(tk.supportAccessUntil) > Date.now())
  return (
    <section className={s.section}>
      <div className={s.sectionHead}>
        <div>
          <h2>{t('privacy.consentTitle', 'Consents & access')}</h2>
          <p>{t('privacy.consentDesc', 'An overview of everything you have allowed. We do not ask for tracking consent because we do not track.')}</p>
        </div>
      </div>
      <div className={s.list}>
        <div className={s.listItem}>
          <Cookie size={18} />
          <div className={s.itemText}>
            <strong>{t('privacy.consent.cookie', 'Session cookie')}</strong>
            <span>{t('privacy.consent.cookieDesc', 'Strictly necessary — set only when you sign in.')}</span>
          </div>
          <Badge tone="neutral">{t('privacy.required', 'Required')}</Badge>
        </div>
        <div className={s.listItem}>
          <EyeOff size={18} />
          <div className={s.itemText}>
            <strong>{t('privacy.consent.tracking', 'Analytics & tracking')}</strong>
            <span>{t('privacy.consent.trackingDesc', 'None. There is nothing to opt out of.')}</span>
          </div>
          <Badge tone="success">{t('privacy.none', 'None')}</Badge>
        </div>
        <div className={s.listItem}>
          <ShieldCheck size={18} />
          <div className={s.itemText}>
            <strong>{t('privacy.consent.support', 'Support access to projects')}</strong>
            <span>
              {grants.length
                ? grants.map((g) => t('privacy.consent.grant', '“{subject}” until {date}', { subject: g.subject, date: formatDateTime(g.supportAccessUntil!) })).join(' · ')
                : t('privacy.consent.noGrants', 'No active grants.')}
            </span>
          </div>
          {grants.length > 0 ? (
            <LinkButton to="/support" size="sm" variant="secondary">{t('privacy.manage', 'Manage')}</LinkButton>
          ) : (
            <span />
          )}
        </div>
        <div className={s.listItem}>
          <HardDrive size={18} />
          <div className={s.itemText}>
            <strong>{t('privacy.consent.cache', 'Cloud data cached on this device')}</strong>
            <span>{t('privacy.consent.cacheDesc', 'Offline copies of your cloud projects. Removed automatically when you sign out.')}</span>
          </div>
          <Button size="sm" variant="secondary" onClick={() => setClearing(true)}>
            {t('privacy.clearCache', 'Remove now')}
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={clearing}
        onOpenChange={setClearing}
        title={t('privacy.clearCacheTitle', 'Remove cached cloud data?')}
        description={t('privacy.clearCacheDesc', 'Offline copies of cloud projects are deleted from this browser. Your cloud projects and local projects are not affected. Unsynced changes in cloud projects would be lost.')}
        confirmLabel={t('privacy.clearCache', 'Remove now')}
        onConfirm={async () => {
          await clearCloudCache()
          await qc.invalidateQueries()
          toast.success(t('privacy.cacheCleared', 'Cached cloud data removed from this device'))
        }}
      />
    </section>
  )
}

export default function PrivacyPage() {
  const t = useT()
  useDocumentTitle(t('nav.privacy', 'Privacy center'))
  return (
    <div className={s.page}>
      <StoreTable />
      <RequireAuth description={t('privacy.gate', 'Sign in to export your data, manage consents or delete your account. Data on this device is under your control — clear it in your browser settings.')}>
        <ExportSection />
        <ConsentSection />
        <DeleteSection />
      </RequireAuth>
      <p className={s.hint}>
        <AlertTriangle size={12} /> {t('privacy.rights', 'You have the right to access, rectify, erase, restrict and port your data and to object (Art. 15–21 GDPR), and to lodge a complaint with a supervisory authority.')}{' '}
        <Link to="/legal/privacy">{t('privacy.learnMore', 'Learn more')}</Link>
      </p>
    </div>
  )
}
