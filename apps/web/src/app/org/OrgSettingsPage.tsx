// /org/:orgId/settings — general info, members & roles, invitations, leave/delete.
import { useEffect, useId, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, LogOut, Mail, Trash2, UserPlus, X } from 'lucide-react'
import { canOrg, type OrgRole } from '@cadsandbox/shared'
import { Avatar, Badge, Button, IconButton, Input, PageHeader, Select, Skeleton, toast } from '../../ui'
import { formatDate, useT } from '../../i18n'
import { useAuth } from '../../data/auth/AuthProvider'
import { authClient, unwrap } from '../../data/auth/client'
import { userColor } from '../../data/session/user'
import { useDocumentTitle } from '../hooks'
import { RequireAuth } from '../components/Guards'
import { NotFoundPage } from '../components/PageStates'
import { ConfirmDialog, errorMessage } from '../components/Dialogs'
import { slugify } from './CreateOrgDialog'
import { orgKey, useFullOrg, type FullOrg } from './orgData'
import s from '../settings/settings.module.css'

function useRoleOptions(canMakeOwner: boolean) {
  const t = useT()
  return [
    ...(canMakeOwner ? [{ value: 'owner' as OrgRole, label: t('org.role.owner', 'Owner') }] : []),
    { value: 'admin' as OrgRole, label: t('org.role.admin', 'Admin') },
    { value: 'member' as OrgRole, label: t('org.role.member', 'Member') },
  ]
}

function General({ org, canManage }: { org: FullOrg; canManage: boolean }) {
  const t = useT()
  const auth = useAuth()
  const qc = useQueryClient()
  const nameId = useId()
  const slugId = useId()
  const [name, setName] = useState(org.name)
  const [slug, setSlug] = useState(org.slug)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setName(org.name)
    setSlug(org.slug)
  }, [org.name, org.slug])
  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await unwrap(authClient.organization.update({ organizationId: org.id, data: { name: name.trim(), slug } }))
      await qc.invalidateQueries({ queryKey: orgKey(org.id) })
      await auth.refresh()
      toast.success(t('settings.saved', 'Changes saved'))
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className={s.section}>
      <div className={s.sectionHead}>
        <div>
          <h2>{t('org.general', 'General')}</h2>
        </div>
      </div>
      <form className={s.form} onSubmit={save}>
        <label className={s.field} htmlFor={nameId}>
          {t('org.name', 'Name')}
          <Input id={nameId} value={name} maxLength={80} required disabled={!canManage} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className={s.field} htmlFor={slugId}>
          {t('org.slug', 'URL name')}
          <Input id={slugId} value={slug} maxLength={48} required disabled={!canManage} onChange={(e) => setSlug(slugify(e.target.value))} />
        </label>
        {canManage && (
          <div>
            <Button type="submit" variant="primary" loading={busy} disabled={!name.trim() || !slug || (name === org.name && slug === org.slug)}>
              {t('common.save', 'Save')}
            </Button>
          </div>
        )}
      </form>
    </section>
  )
}

function Members({ org, myRole }: { org: FullOrg; myRole: OrgRole }) {
  const t = useT()
  const auth = useAuth()
  const qc = useQueryClient()
  const emailId = useId()
  const canManage = canOrg(myRole, 'manageMembers')
  const roles = useRoleOptions(myRole === 'owner')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<OrgRole>('member')
  const [busy, setBusy] = useState(false)
  // Removing a member revokes their access to every project shared with the organisation: confirm.
  const [removing, setRemoving] = useState<FullOrg['members'][number] | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: orgKey(org.id) })
  const run = async (p: Promise<unknown>, ok?: string) => {
    try {
      await p
      await refresh()
      if (ok) toast.success(ok)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  const invite = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    await run(
      unwrap(authClient.organization.inviteMember({ organizationId: org.id, email: email.trim(), role: role as 'member' | 'admin' | 'owner' })),
      t('org.invited', 'Invitation sent to {email}', { email: email.trim() }),
    )
    setEmail('')
    setBusy(false)
  }
  const pending = org.invitations.filter((i) => i.status === 'pending')
  return (
    <section className={s.section}>
      <div className={s.sectionHead}>
        <div>
          <h2>{t('org.members', 'Members')}</h2>
          <p>{t('org.membersDesc', 'Owners and admins manage members and projects. Members can open everything shared with the organization.')}</p>
        </div>
      </div>
      {canManage && (
        <form className={s.row} onSubmit={invite}>
          <label htmlFor={emailId} className="cs-sr-only">
            {t('share.email', 'Email address')}
          </label>
          <Input id={emailId} type="email" required value={email} placeholder={t('share.emailPlaceholder', 'name@example.com')} wrapperClassName={s.grow} onChange={(e) => setEmail(e.target.value)} />
          <Select<OrgRole> className={s.choiceControl} value={role} onChange={setRole} options={roles.filter((r) => r.value !== 'owner')} aria-label={t('share.role', 'Role')} />
          <Button type="submit" variant="primary" icon={<UserPlus size={15} />} loading={busy}>
            {t('share.invite', 'Invite')}
          </Button>
        </form>
      )}
      <div className={s.list}>
        {org.members.map((m) => {
          const isMe = m.userId === auth.user?.id
          const editable = canManage && !isMe && (m.role !== 'owner' || myRole === 'owner')
          return (
            <div key={m.id} className={s.listItem}>
              <Avatar name={m.user.name || m.user.email} src={m.user.image} color={userColor(m.userId)} size={30} />
              <div className={s.itemText}>
                <strong>
                  {m.user.name || m.user.email} {isMe && <Badge tone="neutral">{t('share.you', 'you')}</Badge>}
                </strong>
                <span>{m.user.email}</span>
              </div>
              <div className={s.row}>
                {editable ? (
                  <>
                    <Select<OrgRole>
                      className={s.choiceControl}
                      size="sm"
                      value={m.role}
                      options={roles}
                      aria-label={t('share.roleFor', 'Role for {name}', { name: m.user.name || m.user.email })}
                      onChange={(r) => void run(unwrap(authClient.organization.updateMemberRole({ organizationId: org.id, memberId: m.id, role: r })))}
                    />
                    <IconButton
                      size="sm"
                      variant="ghost"
                      label={t('org.removeMember', 'Remove from organization')}
                      icon={<Trash2 size={14} />}
                      onClick={() => setRemoving(m)}
                    />
                  </>
                ) : (
                  <Badge tone="outline">{t(`org.role.${m.role}`, m.role)}</Badge>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {pending.length > 0 && (
        <>
          <h3 style={{ fontSize: 13 }}>{t('org.pendingInvites', 'Pending invitations')}</h3>
          <div className={s.list}>
            {pending.map((i) => (
              <div key={i.id} className={s.listItem}>
                <Mail size={18} />
                <div className={s.itemText}>
                  <strong>{i.email}</strong>
                  <span>
                    {t(`org.role.${i.role}`, i.role)}
                    {i.expiresAt ? ` · ${t('org.expires', 'expires {date}', { date: formatDate(i.expiresAt) })}` : ''}
                  </span>
                </div>
                {canManage ? (
                  <IconButton
                    size="sm"
                    variant="ghost"
                    label={t('org.cancelInvite', 'Cancel invitation')}
                    icon={<X size={14} />}
                    onClick={() => void run(unwrap(authClient.organization.cancelInvitation({ invitationId: i.id })))}
                  />
                ) : (
                  <span />
                )}
              </div>
            ))}
          </div>
        </>
      )}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        danger
        title={t('org.removeTitle', 'Remove {name} from “{org}”?', { name: removing?.user.name || removing?.user.email || '', org: org.name })}
        description={t('org.removeDesc', 'They immediately lose access to the projects shared with the organization. You can invite them again later.')}
        confirmLabel={t('org.removeMember', 'Remove from organization')}
        onConfirm={async () => {
          if (!removing) return
          await run(unwrap(authClient.organization.removeMember({ organizationId: org.id, memberIdOrEmail: removing.id })), t('org.removed', 'Member removed'))
        }}
      />
    </section>
  )
}

function Danger({ org, myRole }: { org: FullOrg; myRole: OrgRole }) {
  const t = useT()
  const auth = useAuth()
  const navigate = useNavigate()
  const [leave, setLeave] = useState(false)
  const [remove, setRemove] = useState(false)
  const done = async () => {
    await auth.refresh()
    navigate('/')
  }
  return (
    <section className={`${s.section} ${s.danger}`}>
      <div className={s.sectionHead}>
        <div>
          <h2>{t('org.danger', 'Danger zone')}</h2>
          <p>{t('org.dangerDesc', 'Leaving removes your access to the organization’s projects. Deleting removes the organization for everyone; projects owned by members stay with them.')}</p>
        </div>
        <div className={s.row}>
          {myRole !== 'owner' && (
            <Button variant="danger" icon={<LogOut size={15} />} onClick={() => setLeave(true)}>
              {t('org.leave', 'Leave organization')}
            </Button>
          )}
          {canOrg(myRole, 'deleteOrg') && (
            <Button variant="danger-solid" icon={<Trash2 size={15} />} onClick={() => setRemove(true)}>
              {t('org.delete', 'Delete organization')}
            </Button>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={leave}
        onOpenChange={setLeave}
        danger
        title={t('org.leaveTitle', 'Leave “{name}”?', { name: org.name })}
        confirmLabel={t('org.leave', 'Leave organization')}
        onConfirm={async () => {
          await unwrap(authClient.organization.leave({ organizationId: org.id }))
          await done()
        }}
      />
      <ConfirmDialog
        open={remove}
        onOpenChange={setRemove}
        danger
        title={t('org.deleteTitle', 'Delete “{name}”?', { name: org.name })}
        description={t('org.deleteDesc', 'Members lose access to everything shared through the organization. This cannot be undone.')}
        requireText={org.name}
        confirmLabel={t('org.delete', 'Delete organization')}
        onConfirm={async () => {
          await unwrap(authClient.organization.delete({ organizationId: org.id }))
          await done()
        }}
      />
    </section>
  )
}

function OrgSettings({ orgId }: { orgId: string }) {
  const t = useT()
  const auth = useAuth()
  const mine = auth.me?.orgs.find((o) => o.id === orgId)
  const full = useFullOrg(orgId, !!mine)
  useDocumentTitle(mine ? `${mine.name} · ${t('nav.settings', 'Settings')}` : null)
  if (!mine) return <NotFoundPage />
  return (
    <div className={s.page}>
      <PageHeader
        title={t('org.settingsTitle', '{name} settings', { name: mine.name })}
        breadcrumbs={
          <Link to={`/org/${orgId}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
            <ArrowLeft size={14} /> {mine.name}
          </Link>
        }
      />
      {full.isLoading || !full.data ? (
        full.isError ? <p className={s.error}>{errorMessage(full.error)}</p> : <Skeleton height={240} />
      ) : (
        <>
          <General org={full.data} canManage={canOrg(mine.role, 'manageOrg')} />
          <Members org={full.data} myRole={mine.role} />
          <Danger org={full.data} myRole={mine.role} />
        </>
      )}
    </div>
  )
}

export default function OrgSettingsPage() {
  const { orgId = '' } = useParams()
  return (
    <RequireAuth>
      <OrgSettings orgId={orgId} />
    </RequireAuth>
  )
}
