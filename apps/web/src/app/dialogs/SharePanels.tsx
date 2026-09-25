// Share dialog panels: people (members), general access (visibility), links, organizations.
import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { Copy, Globe, KeyRound, Link2, Lock, Trash2, UserPlus } from 'lucide-react'
import { ROLE_LABEL, can, type GrantRole, type ProjectDTO, type ProjectRole, type ProjectVisibility, type ShareLinkDTO } from '@cadsandbox/shared'
import { Avatar, Badge, Button, IconButton, Input, Select, Skeleton, toast, type SelectOption } from '../../ui'
import { formatDate, formatRelative, t as translate, tn, useT } from '../../i18n'
import { useAuth } from '../../data/auth/AuthProvider'
import { useQueryClient } from '@tanstack/react-query'
import { qk, useLinks, useMembers, useOrgGrants, useProjectActions, useShareActions } from '../../data/queries'
import { userColor } from '../../data/session/user'
import { errorMessage } from '../components/Dialogs'
import s from './dialogs.module.css'
import c from '../components/components.module.css'

export function useRoleOptions(): SelectOption<GrantRole>[] {
  const t = useT()
  return [
    { value: 'editor', label: t('share.role.editor', ROLE_LABEL.editor) },
    { value: 'commenter', label: t('share.role.commenter', ROLE_LABEL.commenter) },
    { value: 'viewer', label: t('share.role.viewer', ROLE_LABEL.viewer) },
  ]
}

const fail = (err: unknown) => toast.error(errorMessage(err))

export function PeoplePanel({ projectId, role, ownerName }: { projectId: string; role: ProjectRole; ownerName: string }) {
  const t = useT()
  const auth = useAuth()
  const roles = useRoleOptions()
  const emailId = useId()
  const members = useMembers(projectId)
  const actions = useShareActions(projectId)
  const [email, setEmail] = useState('')
  const [grant, setGrant] = useState<GrantRole>('editor')
  const canShare = can(role, 'share')
  const invite = (e: FormEvent) => {
    e.preventDefault()
    const v = email.trim()
    if (!v) return
    actions.addMember.mutate(
      { email: v, role: grant },
      {
        onSuccess: (res) => {
          setEmail('')
          toast.success(
            res.status === 'added'
              ? t('share.added', '{email} now has access', { email: v })
              : t('share.invited', 'Invitation sent to {email}', { email: v }),
          )
        },
        onError: fail,
      },
    )
  }
  return (
    <div className={s.stack}>
      {canShare && (
        <form className={s.inviteRow} onSubmit={invite}>
          <label htmlFor={emailId} className="cs-sr-only">
            {t('share.email', 'Email address')}
          </label>
          <Input id={emailId} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('share.emailPlaceholder', 'name@example.com')} autoComplete="off" />
          <Select<GrantRole> value={grant} onChange={setGrant} options={roles} aria-label={t('share.role', 'Role')} />
          <Button type="submit" variant="primary" icon={<UserPlus size={15} />} loading={actions.addMember.isPending}>
            {t('share.invite', 'Invite')}
          </Button>
        </form>
      )}
      <div className={s.section}>
        <div className={s.sectionTitle}>{t('share.peopleWithAccess', 'People with access')}</div>
        <div className={s.people}>
          {members.data && !members.data.some((m) => m.role === 'owner') && (
            <div className={s.person}>
              <Avatar name={ownerName} size={30} />
              <div className={s.personText}>
                <strong>{ownerName}</strong>
              </div>
              <Badge tone="accent">{t('share.role.owner', ROLE_LABEL.owner)}</Badge>
              <span />
            </div>
          )}
          {members.isLoading && <Skeleton height={36} />}
          {members.data?.map((m) => (
            <div key={m.userId} className={s.person}>
              <Avatar name={m.name || m.email} src={m.image} color={userColor(m.userId)} size={30} />
              <div className={s.personText}>
                <strong>
                  {m.name || m.email}
                  {m.userId === auth.user?.id && ` (${t('share.you', 'you')})`}
                </strong>
                <span>{m.email}</span>
              </div>
              {m.role === 'owner' ? (
                <Badge tone="accent">{t('share.role.owner', ROLE_LABEL.owner)}</Badge>
              ) : canShare ? (
                <Select<GrantRole>
                  size="sm"
                  value={m.role}
                  options={roles}
                  aria-label={t('share.roleFor', 'Role for {name}', { name: m.name || m.email })}
                  onChange={(r) => actions.updateMember.mutate({ userId: m.userId, role: r }, { onError: fail })}
                />
              ) : (
                <Badge tone="neutral">{t(`share.role.${m.role}`, ROLE_LABEL[m.role])}</Badge>
              )}
              {canShare && m.role !== 'owner' ? (
                <IconButton
                  size="sm"
                  variant="ghost"
                  label={t('share.removeAccess', 'Remove access')}
                  icon={<Trash2 size={14} />}
                  onClick={() => actions.removeMember.mutate(m.userId, { onError: fail })}
                />
              ) : (
                <span />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function VisibilityPanel({ project }: { project: ProjectDTO }) {
  const t = useT()
  const actions = useProjectActions()
  const [value, setValue] = useState<ProjectVisibility>(project.visibility)
  const canManage = can(project.role, 'manage')
  const set = (v: ProjectVisibility) => {
    const prev = value
    setValue(v)
    actions.setVisibility.mutate(
      { id: project.id, visibility: v },
      {
        onError: (err) => {
          setValue(prev)
          fail(err)
        },
      },
    )
  }
  const options: { v: ProjectVisibility; icon: ReactNode; title: string; desc: string }[] = [
    { v: 'private', icon: <Lock size={18} />, title: t('share.visibility.private', 'Private'), desc: t('share.visibility.privateDesc', 'Only people and organizations you invite can open it.') },
    { v: 'link', icon: <Link2 size={18} />, title: t('share.visibility.link', 'Link'), desc: t('share.visibility.linkDesc', 'Anyone with a share link can open it with the link’s role.') },
    { v: 'public', icon: <Globe size={18} />, title: t('share.visibility.public', 'Public'), desc: t('share.visibility.publicDesc', 'Anyone on the internet can view it — no account needed. Edits still need an invitation.') },
  ]
  return (
    <div className={s.visibility} role="radiogroup" aria-label={t('share.generalAccess', 'General access')}>
      {options.map((o) => (
        <button key={o.v} type="button" role="radio" aria-checked={value === o.v} className={s.visOption} disabled={!canManage} onClick={() => value !== o.v && set(o.v)}>
          {o.icon}
          <span>
            <strong>{o.title}</strong>
            <p>{o.desc}</p>
          </span>
        </button>
      ))}
      {!canManage && <p className={c.hint}>{t('share.visibility.ownerOnly', 'Only the owner can change general access.')}</p>}
    </div>
  )
}

const shareUrl = (token: string) => new URL(`/s/${encodeURIComponent(token)}`, window.location.origin).toString()

async function copy(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(done)
  } catch {
    // Clipboard blocked (permissions/insecure context): show the link so it can be copied by hand.
    toast(translate('share.copyManually', 'Copy the link manually'), { description: text, duration: 15_000 })
  }
}

export function LinksPanel({ projectId, role }: { projectId: string; role: ProjectRole }) {
  const t = useT()
  const qc = useQueryClient()
  const roles = useRoleOptions()
  const links = useLinks(projectId)
  const actions = useShareActions(projectId)
  const pwId = useId()
  const [linkRole, setLinkRole] = useState<GrantRole>('viewer')
  const [expiry, setExpiry] = useState('never')
  const [password, setPassword] = useState('')
  const canShare = can(role, 'share')
  const expiryOptions: SelectOption[] = [
    { value: 'never', label: t('share.expiry.never', 'Never expires') },
    { value: '1', label: t('share.expiry.day', '1 day') },
    { value: '7', label: t('share.expiry.week', '7 days') },
    { value: '30', label: t('share.expiry.month', '30 days') },
  ]
  // The server stores only a hash of each token: the full link exists once, in the create response.
  const [created, setCreated] = useState<ShareLinkDTO | null>(null)
  const create = (e: FormEvent) => {
    e.preventDefault()
    const expiresAt = expiry === 'never' ? null : new Date(Date.now() + Number(expiry) * 86_400_000).toISOString()
    actions.createLink.mutate(
      { role: linkRole, expiresAt, ...(password ? { password } : {}) },
      {
        onSuccess: (link: ShareLinkDTO) => {
          setPassword('')
          setCreated(link)
          void qc.invalidateQueries({ queryKey: qk.project(projectId) }) // a private project switches to "link"
          void copy(shareUrl(link.token), t('share.linkCreatedCopied', 'Link created and copied'))
        },
        onError: fail,
      },
    )
  }
  return (
    <div className={s.stack}>
      {created?.token && (
        <div className={s.callout} role="status">
          <strong>{t('share.newLinkTitle', 'Your new link')}</strong>
          <div className={s.linkRow} style={{ width: '100%' }}>
            <span className={s.linkUrl}>{shareUrl(created.token)}</span>
            <Button size="sm" variant="primary" icon={<Copy size={14} />} onClick={() => void copy(shareUrl(created.token), t('share.copied', 'Link copied'))}>
              {t('share.copyLink', 'Copy link')}
            </Button>
          </div>
          <span>{t('share.newLinkOnce', 'Copy it now — for your security the full link is shown only once. You can create a new link at any time.')}</span>
        </div>
      )}
      {canShare && (
        <form className={s.section} onSubmit={create}>
          <div className={s.linkForm}>
            <div className={c.label}>
              {t('share.role', 'Role')}
              <Select<GrantRole> value={linkRole} onChange={setLinkRole} options={roles} aria-label={t('share.role', 'Role')} />
            </div>
            <div className={c.label}>
              {t('share.expires', 'Expires')}
              <Select value={expiry} onChange={setExpiry} options={expiryOptions} aria-label={t('share.expires', 'Expires')} />
            </div>
            <label className={c.label} htmlFor={pwId}>
              {t('share.passwordOptional', 'Password (optional)')}
              <Input id={pwId} type="password" value={password} minLength={4} maxLength={128} autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} />
            </label>
          </div>
          <div>
            <Button type="submit" variant="primary" icon={<Link2 size={15} />} loading={actions.createLink.isPending}>
              {t('share.createLink', 'Create link')}
            </Button>
          </div>
        </form>
      )}
      <div className={s.section}>
        <div className={s.sectionTitle}>{t('share.activeLinks', 'Active links')}</div>
        {links.isLoading && <Skeleton height={52} />}
        {links.data?.length === 0 && <p className={c.hint}>{t('share.noLinks', 'No share links yet.')}</p>}
        {links.data?.map((l) => (
          <div key={l.id} className={s.linkRow}>
            <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
              <span className={s.linkUrl}>{l.token ? shareUrl(l.token) : t('share.linkHidden', 'Share link · created {when}', { when: formatRelative(l.createdAt) })}</span>
              <span className={s.linkMeta}>
                <Badge tone="neutral">{t(`share.role.${l.role}`, ROLE_LABEL[l.role])}</Badge>
                {l.hasPassword && (
                  <Badge tone="outline" icon={<KeyRound size={11} />}>
                    {t('share.passwordProtected', 'Password')}
                  </Badge>
                )}
                {l.expiresAt ? t('share.expiresOn', 'Expires {date}', { date: formatDate(l.expiresAt) }) : t('share.expiry.never', 'Never expires')}
                {' · '}
                {tn('share.uses', l.uses, '{count} use', '{count} uses')}
              </span>
            </div>
            <div className={s.actions}>
              {l.token && (
                <IconButton size="sm" variant="ghost" label={t('share.copyLink', 'Copy link')} icon={<Copy size={14} />} onClick={() => void copy(shareUrl(l.token), t('share.copied', 'Link copied'))} />
              )}
              {canShare && (
                <IconButton size="sm" variant="ghost" label={t('share.deleteLink', 'Delete link')} icon={<Trash2 size={14} />} onClick={() => actions.removeLink.mutate(l.id, { onError: fail })} />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function OrgsPanel({ projectId, role }: { projectId: string; role: ProjectRole }) {
  const t = useT()
  const auth = useAuth()
  const roles = useRoleOptions()
  const grants = useOrgGrants(projectId)
  const actions = useShareActions(projectId)
  const orgs = auth.me?.orgs ?? []
  const granted = new Set(grants.data?.map((g) => g.orgId))
  const available = orgs.filter((o) => !granted.has(o.id))
  const [orgId, setOrgId] = useState<string>('')
  const [grant, setGrant] = useState<GrantRole>('viewer')
  const canShare = can(role, 'share')
  const add = (e: FormEvent) => {
    e.preventDefault()
    const target = orgId || available[0]?.id
    if (!target) return
    actions.setOrgGrant.mutate({ orgId: target, role: grant }, { onSuccess: () => setOrgId(''), onError: fail })
  }
  return (
    <div className={s.stack}>
      {canShare && available.length > 0 && (
        <form className={s.inviteRow} onSubmit={add}>
          <Select value={orgId || available[0]!.id} onChange={setOrgId} options={available.map((o) => ({ value: o.id, label: o.name }))} aria-label={t('share.organization', 'Organization')} />
          <Select<GrantRole> value={grant} onChange={setGrant} options={roles} aria-label={t('share.role', 'Role')} />
          <Button type="submit" variant="primary" loading={actions.setOrgGrant.isPending}>
            {t('share.shareWithOrg', 'Share')}
          </Button>
        </form>
      )}
      {canShare && orgs.length === 0 && <p className={c.hint}>{t('share.noOrgs', 'You are not a member of any organization yet.')}</p>}
      <div className={s.people}>
        {grants.isLoading && <Skeleton height={36} />}
        {grants.data?.length === 0 && <p className={c.hint}>{t('share.noOrgGrants', 'Not shared with any organization.')}</p>}
        {grants.data?.map((g) => (
          <div key={g.orgId} className={s.person}>
            <Avatar name={g.orgName} color={userColor(g.orgId)} size={30} />
            <div className={s.personText}>
              <strong>{g.orgName}</strong>
              <span>{t('share.allMembers', 'All members')}</span>
            </div>
            {canShare ? (
              <Select<GrantRole> size="sm" value={g.role} options={roles} aria-label={t('share.role', 'Role')} onChange={(r) => actions.setOrgGrant.mutate({ orgId: g.orgId, role: r }, { onError: fail })} />
            ) : (
              <Badge tone="neutral">{t(`share.role.${g.role}`, ROLE_LABEL[g.role])}</Badge>
            )}
            {canShare ? (
              <IconButton size="sm" variant="ghost" label={t('share.removeAccess', 'Remove access')} icon={<Trash2 size={14} />} onClick={() => actions.removeOrgGrant.mutate(g.orgId, { onError: fail })} />
            ) : (
              <span />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
