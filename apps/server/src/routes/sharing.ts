// Sharing: members (invite by e-mail), share links (hashed tokens, optional password + expiry),
// organisation grants. Every change is audited and re-checks live collab connections.
import type { Hono } from 'hono'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { can, PROJECT_ROLE_RANK, schemas, type GrantRole, type OrgGrantDTO, type ProjectMemberDTO, type ProjectRole, type ShareLinkDTO } from '@cadsandbox/shared'
import { organization, orgProjectGrants, projectInvites, projectMembers, projects, shareLinks, user } from '../db/schema'
import { hashSecret, hashToken, newId, randomToken, verifySecret } from '../lib/crypto'
import { badRequest, forbidden, notFound, unauthorized } from '../lib/errors'
import { maskEmail } from '../log'
import { assertNotLimited, impersonationBlocked, isImpersonating, jsonBody, limit, optionalJsonBody, param, projectAccess, requireAuth, requireRealUser, type AppEnv, type Ctx } from '../http/context'
import { jsonLimit, KB, register } from '../http/router'
import { pickLocale } from '../mail/templates'
import { findActiveLink, type ProjectAccess } from '../services/access'
import { audit } from '../services/audit'
import { membershipRole } from '../services/orgs'

const linkDTO = (l: typeof shareLinks.$inferSelect, token = ''): ShareLinkDTO => ({
  id: l.id,
  token,
  role: l.role,
  hasPassword: !!l.passwordHash,
  expiresAt: l.expiresAt ? l.expiresAt.toISOString() : null,
  createdAt: l.createdAt.toISOString(),
  uses: l.uses,
})

const SHARING_BLOCKED = 'Sharing changes are not allowed while impersonating a user'

const projectUrl = (c: Ctx, id: string) => `${c.get('deps').config.publicUrl}/projects/${encodeURIComponent(id)}`

async function shareAudit(c: Ctx, a: ProjectAccess, action: string, meta: Record<string, unknown>) {
  const d = c.get('deps')
  const s = c.get('session')
  await audit(d.db, { actorId: s?.user.id, actorEmail: s?.user.email, action, targetType: 'project', targetId: a.project.id, ip: c.get('ip'), meta }, d.log)
  d.events.projectChanged(a.project.id)
}

export async function listMembersOf(c: Ctx, a: ProjectAccess): Promise<ProjectMemberDTO[]> {
  const d = c.get('deps')
  const showEmails = can(a.role, 'share')
  const [owner] = await d.db.select().from(user).where(eq(user.id, a.project.ownerId)).limit(1)
  const rows = await d.db
    .select({ userId: projectMembers.userId, role: projectMembers.role, createdAt: projectMembers.createdAt, email: user.email, name: user.name, image: user.image, linkId: projectMembers.linkId, expiresAt: shareLinks.expiresAt })
    .from(projectMembers)
    .innerJoin(user, eq(user.id, projectMembers.userId))
    .leftJoin(shareLinks, eq(shareLinks.id, projectMembers.linkId))
    .where(eq(projectMembers.projectId, a.project.id))
    .orderBy(asc(projectMembers.createdAt))
  const byUser = new Map<string, ProjectMemberDTO>()
  const now = new Date()
  for (const r of rows) {
    // Link memberships only count while the link is active.
    if (r.linkId && (a.project.visibility === 'private' || (r.expiresAt && r.expiresAt <= now))) continue
    const cur = byUser.get(r.userId)
    if (cur && PROJECT_ROLE_RANK[cur.role] >= PROJECT_ROLE_RANK[r.role]) continue
    byUser.set(r.userId, { userId: r.userId, email: showEmails ? r.email : (maskEmail(r.email) ?? ''), name: r.name, image: r.image ?? null, role: r.role, addedAt: (cur?.addedAt ?? r.createdAt.toISOString()) })
  }
  const list = [...byUser.values()]
  if (owner) list.unshift({ userId: owner.id, email: showEmails ? owner.email : (maskEmail(owner.email) ?? ''), name: owner.name, image: owner.image ?? null, role: 'owner', addedAt: a.project.createdAt.toISOString() })
  return list
}

export function sharingRoutes(app: Hono<AppEnv>): void {
  // ---------------------------------------------------------------- members
  register(app, 'listMembers', async (c) => {
    requireAuth(c)
    const a = await projectAccess(c, param(c, 'id'), 'view', { metadata: true })
    // Collaborator lists are not public: visitors of public projects don't see who works on them.
    if (a.via === 'public') throw forbidden()
    return c.json(await listMembersOf(c, a))
  })

  register(app, 'addMember', jsonLimit(8 * KB), async (c) => {
    const s = requireRealUser(c, SHARING_BLOCKED)
    const d = c.get('deps')
    const a = await projectAccess(c, param(c, 'id'), 'share', { metadata: true })
    limit(c, 'invitePerUser', s.user.id)
    const input = await jsonBody(c, schemas.addMember)
    const email = input.email.trim().toLowerCase()
    const [target] = await d.db.select().from(user).where(eq(user.email, email)).limit(1)
    if (target?.id === a.project.ownerId) throw badRequest('This user owns the project')
    const locale = pickLocale((s.user as { locale?: string }).locale)
    const url = projectUrl(c, a.project.id)
    if (target && target.emailVerified) {
      await d.db
        .insert(projectMembers)
        .values({ id: newId(), projectId: a.project.id, userId: target.id, role: input.role, linkId: null, addedBy: s.user.id })
        .onConflictDoUpdate({ target: [projectMembers.projectId, projectMembers.userId, projectMembers.linkId], set: { role: input.role } })
      d.mailer.queue(target.email, { kind: 'projectInvite', inviter: s.user.name, project: a.project.name, role: input.role, url, hasAccount: true }, pickLocale(target.locale))
      await shareAudit(c, a, 'project.share.member.add', { userId: target.id, role: input.role })
      const members = await listMembersOf(c, a)
      return c.json({ status: 'added', member: members.find((m) => m.userId === target.id) ?? null }, 201)
    }
    // Unknown (or unverified) address → pending invitation, turned into a membership after verification.
    await d.db
      .insert(projectInvites)
      .values({ id: newId(), projectId: a.project.id, email, role: input.role, invitedBy: s.user.id, expiresAt: new Date(Date.now() + 30 * 86_400_000) })
      .onConflictDoUpdate({ target: [projectInvites.projectId, projectInvites.email], set: { role: input.role, expiresAt: new Date(Date.now() + 30 * 86_400_000) } })
    d.mailer.queue(email, { kind: 'projectInvite', inviter: s.user.name, project: a.project.name, role: input.role, url, hasAccount: !!target }, target ? pickLocale(target.locale) : locale)
    await shareAudit(c, a, 'project.share.invite', { email: maskEmail(email), role: input.role })
    return c.json({ status: 'invited', email, role: input.role }, 202)
  })

  register(app, 'updateMember', jsonLimit(8 * KB), async (c) => {
    const s = requireRealUser(c, SHARING_BLOCKED)
    const d = c.get('deps')
    const a = await projectAccess(c, param(c, 'id'), 'share', { metadata: true })
    const userId = param(c, 'userId')
    const { role } = await jsonBody(c, schemas.updateMember)
    if (userId === a.project.ownerId) throw badRequest("The owner's role cannot be changed")
    const existing = await d.db.select({ id: projectMembers.id }).from(projectMembers).where(and(eq(projectMembers.projectId, a.project.id), eq(projectMembers.userId, userId))).limit(1)
    if (!existing.length) throw notFound('Member not found')
    await d.db
      .insert(projectMembers)
      .values({ id: newId(), projectId: a.project.id, userId, role, linkId: null, addedBy: s.user.id })
      .onConflictDoUpdate({ target: [projectMembers.projectId, projectMembers.userId, projectMembers.linkId], set: { role } })
    // A direct grant replaces link-derived memberships for this user.
    await d.db.execute(sql`DELETE FROM project_members WHERE project_id = ${a.project.id} AND user_id = ${userId} AND link_id IS NOT NULL`)
    await shareAudit(c, a, 'project.share.member.role', { userId, role })
    const members = await listMembersOf(c, a)
    return c.json(members.find((m) => m.userId === userId) ?? null)
  })

  register(app, 'removeMember', async (c) => {
    const s = requireRealUser(c, SHARING_BLOCKED)
    const d = c.get('deps')
    const id = param(c, 'id')
    const userId = param(c, 'userId')
    // Members may always leave; removing others requires share permission.
    const a = await projectAccess(c, id, userId === s.user.id ? 'view' : 'share', { metadata: true })
    if (userId === a.project.ownerId) throw badRequest('The owner cannot be removed')
    const removed = await d.db.delete(projectMembers).where(and(eq(projectMembers.projectId, a.project.id), eq(projectMembers.userId, userId))).returning({ id: projectMembers.id })
    if (!removed.length) throw notFound('Member not found')
    await shareAudit(c, a, 'project.share.member.remove', { userId })
    return c.json({ ok: true })
  })

  // ---------------------------------------------------------------- share links
  register(app, 'listLinks', async (c) => {
    requireAuth(c)
    const d = c.get('deps')
    const a = await projectAccess(c, param(c, 'id'), 'share', { metadata: true })
    const rows = await d.db.select().from(shareLinks).where(eq(shareLinks.projectId, a.project.id)).orderBy(asc(shareLinks.createdAt))
    return c.json(rows.map((l) => linkDTO(l)))
  })

  register(app, 'createLink', jsonLimit(8 * KB), async (c) => {
    const s = requireRealUser(c, SHARING_BLOCKED)
    const d = c.get('deps')
    const a = await projectAccess(c, param(c, 'id'), 'share', { metadata: true })
    const input = await jsonBody(c, schemas.createLink)
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null
    if (expiresAt && expiresAt.getTime() <= Date.now()) throw badRequest('expiresAt must be in the future')
    if (PROJECT_ROLE_RANK[input.role as GrantRole] > PROJECT_ROLE_RANK[a.role]) throw forbidden('Cannot grant more than your own role')
    const token = randomToken(32)
    const [row] = await d.db
      .insert(shareLinks)
      .values({ id: newId(), projectId: a.project.id, tokenHash: hashToken(token), role: input.role, passwordHash: input.password ? await hashSecret(input.password) : null, expiresAt, createdBy: s.user.id })
      .returning()
    // The owner creating a link on a private project means "anyone with the link": enable links.
    if (a.project.visibility === 'private' && a.role === 'owner') await d.db.update(projects).set({ visibility: 'link' }).where(eq(projects.id, a.project.id))
    await shareAudit(c, a, 'project.share.link.create', { linkId: row!.id, role: input.role, password: !!input.password, expiresAt: expiresAt?.toISOString() ?? null })
    // The raw token is returned exactly once — only its hash is stored.
    return c.json(linkDTO(row!, token), 201)
  })

  register(app, 'deleteLink', async (c) => {
    requireRealUser(c, SHARING_BLOCKED)
    const d = c.get('deps')
    const a = await projectAccess(c, param(c, 'id'), 'share', { metadata: true })
    const linkId = param(c, 'linkId')
    const removed = await d.db.delete(shareLinks).where(and(eq(shareLinks.id, linkId), eq(shareLinks.projectId, a.project.id))).returning({ id: shareLinks.id })
    if (!removed.length) throw notFound('Link not found')
    await shareAudit(c, a, 'project.share.link.delete', { linkId })
    return c.json({ ok: true })
  })

  // Signed-in users become members with the link's role. Guests (no session) may accept *viewer*
  // links only: nothing is stored; they then send the raw token — or, for password-protected links,
  // the returned short-lived signed `grant` — as `x-share-token` / Hocuspocus token (read-only).
  register(app, 'acceptLink', jsonLimit(4 * KB), async (c) => {
    const s = c.get('session')
    if (s && isImpersonating(s)) throw impersonationBlocked(SHARING_BLOCKED)
    const d = c.get('deps')
    const token = c.req.param('token') ?? ''
    limit(c, 'shareAcceptPerIp', c.get('ipHash'))
    const input = await optionalJsonBody(c, schemas.acceptLink)
    const link = await findActiveLink(d.db, token)
    const [project] = link ? await d.db.select().from(projects).where(and(eq(projects.id, link.projectId), isNull(projects.deletedAt))).limit(1) : []
    if (!link || !project || project.visibility === 'private') throw notFound('Link not found or expired')
    // Editor/commenter links need an identity (checked before the password, so guests can't probe it).
    if (!s && link.role !== 'viewer') throw unauthorized('Sign in to open this link')
    if (link.passwordHash) assertNotLimited(c, 'sharePasswordFailPerLink', link.id)
    if (link.passwordHash && !(input.password && (await verifySecret(input.password, link.passwordHash)))) {
      limit(c, 'sharePasswordFailPerLink', link.id)
      await audit(d.db, { actorId: s?.user.id ?? null, actorEmail: s?.user.email ?? null, action: 'project.share.link.password_failed', targetType: 'project', targetId: project.id, ip: c.get('ip'), meta: { linkId: link.id, guest: !s } }, d.log)
      throw forbidden('Invalid password')
    }
    if (!s) {
      await d.db.update(shareLinks).set({ uses: sql`${shareLinks.uses} + 1` }).where(eq(shareLinks.id, link.id))
      const body: { projectId: string; role: ProjectRole; grant?: string; grantExpiresAt?: string } = { projectId: project.id, role: 'viewer' }
      if (link.passwordHash) {
        const g = d.grants.issue(link.id, project.id, link.expiresAt)
        body.grant = g.grant
        body.grantExpiresAt = g.expiresAt.toISOString()
      }
      c.header('Cache-Control', 'no-store')
      return c.json(body)
    }
    if (project.ownerId === s.user.id) return c.json({ projectId: project.id, role: 'owner' as ProjectRole })
    await d.db
      .insert(projectMembers)
      .values({ id: newId(), projectId: project.id, userId: s.user.id, role: link.role, linkId: link.id, addedBy: link.createdBy })
      .onConflictDoUpdate({ target: [projectMembers.projectId, projectMembers.userId, projectMembers.linkId], set: { role: link.role } })
    await d.db.update(shareLinks).set({ uses: sql`${shareLinks.uses} + 1` }).where(eq(shareLinks.id, link.id))
    const a = await projectAccess(c, project.id, 'view', { metadata: true })
    await shareAudit(c, a, 'project.share.link.accept', { linkId: link.id, role: link.role })
    return c.json({ projectId: project.id, role: a.role })
  })

  // ---------------------------------------------------------------- organisation grants
  register(app, 'listOrgGrants', async (c) => {
    requireAuth(c)
    const d = c.get('deps')
    const a = await projectAccess(c, param(c, 'id'), 'share', { metadata: true })
    const rows = await d.db
      .select({ orgId: orgProjectGrants.orgId, orgName: organization.name, role: orgProjectGrants.role, addedAt: orgProjectGrants.createdAt })
      .from(orgProjectGrants)
      .innerJoin(organization, eq(organization.id, orgProjectGrants.orgId))
      .where(eq(orgProjectGrants.projectId, a.project.id))
    return c.json(rows.map((r): OrgGrantDTO => ({ orgId: r.orgId, orgName: r.orgName, role: r.role, addedAt: r.addedAt.toISOString() })))
  })

  register(app, 'setOrgGrant', jsonLimit(4 * KB), async (c) => {
    const s = requireRealUser(c, SHARING_BLOCKED)
    const d = c.get('deps')
    const a = await projectAccess(c, param(c, 'id'), 'share', { metadata: true })
    const orgId = param(c, 'orgId')
    const { role } = await jsonBody(c, schemas.setOrgGrant)
    // You can only share into organisations you belong to.
    if (!(await membershipRole(d.db, orgId, s.user.id))) throw notFound('Organisation not found')
    if (PROJECT_ROLE_RANK[role] > PROJECT_ROLE_RANK[a.role]) throw forbidden('Cannot grant more than your own role')
    await d.db
      .insert(orgProjectGrants)
      .values({ projectId: a.project.id, orgId, role, addedBy: s.user.id })
      .onConflictDoUpdate({ target: [orgProjectGrants.projectId, orgProjectGrants.orgId], set: { role } })
    await shareAudit(c, a, 'project.share.org.set', { orgId, role })
    const [org] = await d.db.select({ name: organization.name }).from(organization).where(eq(organization.id, orgId)).limit(1)
    const body: OrgGrantDTO = { orgId, orgName: org?.name ?? '', role, addedAt: new Date().toISOString() }
    return c.json(body)
  })

  register(app, 'removeOrgGrant', async (c) => {
    requireRealUser(c, SHARING_BLOCKED)
    const d = c.get('deps')
    const a = await projectAccess(c, param(c, 'id'), 'share', { metadata: true })
    const orgId = param(c, 'orgId')
    const removed = await d.db.delete(orgProjectGrants).where(and(eq(orgProjectGrants.projectId, a.project.id), eq(orgProjectGrants.orgId, orgId))).returning({ orgId: orgProjectGrants.orgId })
    if (!removed.length) throw notFound('Grant not found')
    await shareAudit(c, a, 'project.share.org.remove', { orgId })
    return c.json({ ok: true })
  })
}
