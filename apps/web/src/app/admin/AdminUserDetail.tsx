// /admin/users/:userId — user detail and privileged actions (all audit-logged by the server).
import { useId, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Ban, BadgeCheck, KeyRound, LogOut, ShieldAlert, Trash2, UserCog, VenetianMask } from 'lucide-react'
import type { SystemRole } from '@cadsandbox/shared'
import { Avatar, Badge, Button, Input, PageHeader, Select, Skeleton, Table, toast } from '../../ui'
import { formatBytes, formatDate, formatDateTime, formatRelative, useT } from '../../i18n'
import { api, type AdminSessionDTO } from '../../data/api/endpoints'
import { authClient, unwrap } from '../../data/auth/client'
import { useAuth } from '../../data/auth/AuthProvider'
import { userColor } from '../../data/session/user'
import { describeAgent } from '../settings/SecurityPage'
import { useDocumentTitle } from '../hooks'
import { ConfirmDialog, errorMessage } from '../components/Dialogs'
import { RoleBadge } from './AdminUsers'
import p from '../pages/pages.module.css'
import c from '../components/components.module.css'

type Action = 'ban' | 'unban' | 'role' | 'sessions' | '2fa' | 'verify' | 'delete' | 'impersonate' | null

export default function AdminUserDetail() {
  const t = useT()
  const { userId = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const auth = useAuth()
  const reasonId = useId()
  const daysId = useId()
  const key = ['admin', 'user', userId]
  const detail = useQuery({ queryKey: key, queryFn: () => api.admin.user(userId) })
  const [action, setAction] = useState<Action>(null)
  const [role, setRole] = useState<SystemRole>('user')
  const [reason, setReason] = useState('')
  const [days, setDays] = useState('')
  useDocumentTitle(detail.data?.user.email ?? t('admin.users', 'Users'))

  if (detail.isLoading) return <Skeleton height={320} />
  if (!detail.data) return <div className={p.notice}>{errorMessage(detail.error)}</div>
  const { user, orgs, projects, sessions } = detail.data
  const isSelf = user.id === auth.user?.id
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: key })
    await qc.invalidateQueries({ queryKey: ['admin', 'users'] })
  }
  const close = () => setAction(null)
  const done = (msg: string) => async () => {
    await refresh()
    toast.success(msg)
  }

  const btn = (a: Exclude<Action, null>, icon: ReactNode, label: string, variant: 'secondary' | 'danger' = 'secondary', show = true) =>
    show && (
      <Button variant={variant} size="sm" icon={icon} onClick={() => setAction(a)} disabled={isSelf && a !== 'verify'}>
        {label}
      </Button>
    )

  const sessionCols = [
    { key: 'agent', label: t('admin.col.device', 'Device'), render: (s: AdminSessionDTO) => describeAgent(s.userAgent).label },
    { key: 'ipAddress', label: t('admin.col.ip', 'IP (shortened)'), render: (s: AdminSessionDTO) => <span className={p.mono}>{s.ipAddress ?? '—'}</span> },
    { key: 'createdAt', label: t('admin.col.created', 'Created'), render: (s: AdminSessionDTO) => formatRelative(s.createdAt) },
    { key: 'expiresAt', label: t('admin.col.expires', 'Expires'), render: (s: AdminSessionDTO) => formatDateTime(s.expiresAt) },
    { key: 'imp', label: '', render: (s: AdminSessionDTO) => (s.impersonatedBy ? <Badge tone="danger">{t('admin.impersonation', 'Impersonation')}</Badge> : null) },
  ]

  return (
    <div className={p.page}>
      <PageHeader
        breadcrumbs={
          <Link to="/admin/users" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
            <ArrowLeft size={14} /> {t('admin.users', 'Users')}
          </Link>
        }
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
            <Avatar name={user.name || user.email} src={user.image} color={userColor(user.id)} size={40} />
            {user.name || user.email} <RoleBadge role={user.role} />
            {user.banned && <Badge tone="danger">{t('admin.banned', 'Banned')}</Badge>}
          </span>
        }
        description={user.email}
      />

      <section className={p.panel}>
        <div className={p.panelHead}>
          <h2>{t('admin.actions', 'Actions')}</h2>
        </div>
        <div className={p.actionsRow}>
          {btn('verify', <BadgeCheck size={14} />, t('admin.verifyEmail', 'Mark email verified'), 'secondary', !user.emailVerified)}
          {btn('sessions', <LogOut size={14} />, t('admin.revokeSessions', 'Sign out everywhere'))}
          {btn('2fa', <KeyRound size={14} />, t('admin.reset2fa', 'Reset 2FA'), 'secondary', user.twoFactorEnabled)}
          {btn('role', <UserCog size={14} />, t('admin.setRole', 'Change role'), 'secondary', auth.isAdmin)}
          {user.banned ? btn('unban', <ShieldAlert size={14} />, t('admin.unban', 'Lift ban')) : btn('ban', <Ban size={14} />, t('admin.ban', 'Ban'), 'danger')}
          {btn('impersonate', <VenetianMask size={14} />, t('admin.impersonate', 'Impersonate'), 'secondary', auth.isAdmin && !user.banned)}
          {btn('delete', <Trash2 size={14} />, t('admin.deleteUser', 'Delete user'), 'danger', auth.isAdmin)}
        </div>
        {isSelf && <p className={c.hint}>{t('admin.selfHint', 'You cannot run privileged actions on your own account.')}</p>}
      </section>

      <section className={p.panel}>
        <div className={p.panelHead}>
          <h2>{t('admin.account', 'Account')}</h2>
        </div>
        <dl className={p.kv}>
          <dt>ID</dt>
          <dd className={p.mono}>{user.id}</dd>
          <dt>{t('admin.col.joined', 'Joined')}</dt>
          <dd>{formatDateTime(user.createdAt)}</dd>
          <dt>{t('admin.col.lastActive', 'Last active')}</dt>
          <dd>{user.lastActiveAt ? formatDateTime(user.lastActiveAt) : '—'}</dd>
          <dt>{t('admin.col.storage', 'Storage')}</dt>
          <dd>{formatBytes(user.storageBytes)}</dd>
          <dt>{t('admin.emailStatus', 'Email')}</dt>
          <dd>{user.emailVerified ? t('settings.verified', 'Verified') : t('settings.unverified', 'Not verified')}</dd>
          <dt>2FA</dt>
          <dd>{user.twoFactorEnabled ? t('security.on', 'On') : t('security.off', 'Off')}</dd>
          <dt>{t('menu.language', 'Language')}</dt>
          <dd>{user.locale}</dd>
          {user.banned && (
            <>
              <dt>{t('admin.banReason', 'Ban reason')}</dt>
              <dd>
                {user.banReason || '—'}
                {user.banExpires ? ` · ${t('admin.until', 'until {date}', { date: formatDate(user.banExpires) })}` : ''}
              </dd>
            </>
          )}
        </dl>
      </section>

      <section className={p.panel}>
        <div className={p.panelHead}>
          <h2>{t('admin.orgs', 'Organizations')}</h2>
        </div>
        <Table aria-label={t('admin.orgs', 'Organizations')} dense columns={[{ key: 'name', label: t('org.name', 'Name') }, { key: 'role', label: t('share.role', 'Role') }, { key: 'memberCount', label: t('admin.col.members', 'Members'), align: 'right' }]} rows={orgs} rowKey={(o) => o.id} emptyLabel={t('admin.none', 'None')} />
      </section>

      <section className={p.panel}>
        <div className={p.panelHead}>
          <h2>{t('admin.projects', 'Projects')}</h2>
          <span className={c.hint}>{t('admin.metadataOnly', 'Metadata only — opening content requires the user’s support grant.')}</span>
        </div>
        <Table
          aria-label={t('admin.projects', 'Projects')}
          dense
          columns={[
            { key: 'name', label: t('org.name', 'Name') },
            { key: 'visibility', label: t('share.generalAccess', 'General access') },
            { key: 'sizeBytes', label: t('admin.col.storage', 'Storage'), align: 'right', render: (x) => formatBytes(x.sizeBytes) },
            { key: 'updatedAt', label: t('admin.col.updated', 'Updated'), render: (x) => formatRelative(x.updatedAt) },
          ]}
          rows={projects}
          rowKey={(x) => x.id}
          emptyLabel={t('admin.none', 'None')}
        />
      </section>

      <section className={p.panel}>
        <div className={p.panelHead}>
          <h2>{t('security.sessions', 'Active sessions')}</h2>
        </div>
        <Table aria-label={t('security.sessions', 'Active sessions')} dense columns={sessionCols} rows={sessions} rowKey={(s) => s.id} emptyLabel={t('admin.none', 'None')} />
      </section>

      <ConfirmDialog open={action === 'verify'} onOpenChange={close} title={t('admin.verifyEmail', 'Mark email verified')} confirmLabel={t('common.confirm', 'Confirm')} onConfirm={() => api.admin.verifyEmail(user.id).then(done(t('admin.done', 'Done')))} />
      <ConfirmDialog
        open={action === 'sessions'}
        onOpenChange={close}
        title={t('admin.revokeSessionsTitle', 'Sign {email} out everywhere?', { email: user.email })}
        confirmLabel={t('admin.revokeSessions', 'Sign out everywhere')}
        onConfirm={() => api.admin.revokeSessions(user.id).then(done(t('admin.done', 'Done')))}
      />
      <ConfirmDialog
        open={action === '2fa'}
        onOpenChange={close}
        danger
        title={t('admin.reset2faTitle', 'Reset two-factor authentication?')}
        description={t('admin.reset2faDesc', 'Only do this after verifying the user’s identity. They can sign in with their password alone until they set up 2FA again.')}
        confirmLabel={t('admin.reset2fa', 'Reset 2FA')}
        onConfirm={() => api.admin.reset2fa(user.id).then(done(t('admin.done', 'Done')))}
      />
      <ConfirmDialog
        open={action === 'role'}
        onOpenChange={close}
        title={t('admin.setRoleTitle', 'Change system role')}
        description={t('admin.setRoleDesc', 'Support can read the support inbox and user metadata. Admins can do everything, including impersonation.')}
        confirmLabel={t('admin.setRole', 'Change role')}
        onConfirm={() => api.admin.setRole(user.id, role).then(done(t('admin.done', 'Done')))}
      >
        <Select<SystemRole>
          value={role}
          onChange={setRole}
          aria-label={t('share.role', 'Role')}
          options={[
            { value: 'user', label: t('admin.role.user', 'User') },
            { value: 'support', label: t('admin.role.support', 'Support') },
            { value: 'admin', label: t('admin.role.admin', 'Admin') },
          ]}
        />
      </ConfirmDialog>
      <ConfirmDialog
        open={action === 'ban'}
        onOpenChange={close}
        danger
        title={t('admin.banTitle', 'Ban {email}?', { email: user.email })}
        description={t('admin.banDesc', 'The user is signed out and cannot sign in. Their projects remain but are inaccessible to them.')}
        confirmLabel={t('admin.ban', 'Ban')}
        onConfirm={() => api.admin.ban(user.id, { reason: reason.trim() || undefined, expiresInDays: days ? Number(days) : undefined }).then(done(t('admin.bannedToast', 'User banned')))}
      >
        <label className={c.label} htmlFor={reasonId}>
          {t('admin.banReason', 'Ban reason')}
          <Input id={reasonId} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
        </label>
        <label className={c.label} htmlFor={daysId}>
          {t('admin.banDays', 'Duration in days (empty = permanent)')}
          <Input id={daysId} type="number" min={1} max={3650} value={days} onChange={(e) => setDays(e.target.value)} />
        </label>
      </ConfirmDialog>
      <ConfirmDialog open={action === 'unban'} onOpenChange={close} title={t('admin.unbanTitle', 'Lift the ban?')} confirmLabel={t('admin.unban', 'Lift ban')} onConfirm={() => api.admin.unban(user.id).then(done(t('admin.done', 'Done')))} />
      <ConfirmDialog
        open={action === 'delete'}
        onOpenChange={close}
        danger
        title={t('admin.deleteTitle', 'Delete {email} permanently?', { email: user.email })}
        description={t('admin.deleteDesc', 'All projects, files and personal data of this user are deleted. This cannot be undone.')}
        requireText={user.email}
        confirmLabel={t('admin.deleteUser', 'Delete user')}
        onConfirm={async () => {
          await api.admin.deleteUser(user.id)
          await qc.invalidateQueries({ queryKey: ['admin', 'users'] })
          toast.success(t('admin.deleted', 'User deleted'))
          navigate('/admin/users')
        }}
      />
      <ConfirmDialog
        open={action === 'impersonate'}
        onOpenChange={close}
        danger
        title={t('admin.impersonateTitle', 'Act as {email}?', { email: user.email })}
        description={t(
          'admin.impersonateDesc',
          'You will be signed in as this user and see exactly what they see. Use this only to resolve a support request. The session is recorded in the audit log, a banner stays visible and you can stop at any time.',
        )}
        requireText={user.email}
        confirmLabel={t('admin.impersonate', 'Impersonate')}
        onConfirm={async () => {
          await unwrap(authClient.admin.impersonateUser({ userId: user.id }))
          qc.clear()
          window.location.assign('/')
        }}
      />
    </div>
  )
}
