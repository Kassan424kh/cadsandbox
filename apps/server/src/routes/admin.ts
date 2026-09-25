// Admin & support console. Support staff: stats, users (read), tickets. Admins: everything.
// Project *content* is never exposed here — only metadata; content needs a user support grant.
import type { Hono } from 'hono'
import { and, count, desc, eq, gte, ilike, inArray, max, or, sql, type SQL } from 'drizzle-orm'
import { schemas, type AdminStatsDTO, type AdminUserDTO, type AuditEntryDTO, type Page } from '@cadsandbox/shared'
import { announcements, auditLog, member, organization, projects, session, supportGrants, ticketMessages, tickets, twoFactor, user } from '../db/schema'
import { newId } from '../lib/crypto'
import { badRequest, forbidden, notFound } from '../lib/errors'
import { jsonBody, param, queryParams, requireAdmin, requireStaff, type AppEnv, type Ctx } from '../http/context'
import { jsonLimit, KB, register } from '../http/router'
import { pickLocale } from '../mail/templates'
import { audit } from '../services/audit'
import { orgRole, orgsOfUser, orgsWithCounts } from '../services/orgs'
import { escapeLike, projectDTO, storageUsage } from '../services/projects'
import { ticketDTO, ticketDTOs } from '../services/tickets'
import { acceptPendingInvites, hardDeleteUser, systemRole, toUserDTO, type UserRow } from '../services/users'
import { announcementDTO } from './public'

const DAY = 86_400_000

async function adminUserDTO(c: Ctx, u: UserRow): Promise<AdminUserDTO> {
  const { db } = c.get('deps')
  const [[pc], [la], used] = await Promise.all([
    db.select({ n: count() }).from(projects).where(eq(projects.ownerId, u.id)),
    db.select({ t: max(session.updatedAt) }).from(session).where(eq(session.userId, u.id)),
    storageUsage(db, u.id),
  ])
  return {
    ...toUserDTO(u),
    banned: !!u.banned,
    banReason: u.banReason ?? null,
    banExpires: u.banExpires ? u.banExpires.toISOString() : null,
    projectCount: Number(pc?.n ?? 0),
    storageBytes: used,
    lastActiveAt: la?.t ? new Date(la.t).toISOString() : null,
  }
}

async function targetUser(c: Ctx): Promise<UserRow> {
  const [u] = await c.get('deps').db.select().from(user).where(eq(user.id, param(c, 'id'))).limit(1)
  if (!u) throw notFound('User not found')
  return u
}

async function adminAudit(c: Ctx, action: string, targetType: string, targetId: string, meta: Record<string, unknown> = {}) {
  const d = c.get('deps')
  const s = c.get('session')!
  await audit(d.db, { actorId: s.user.id, actorEmail: s.user.email, action, targetType, targetId, ip: c.get('ip'), meta }, d.log)
}

const page = <T>(items: T[], total: number, p: { page: number; pageSize: number }): Page<T> => ({ items, total, page: p.page, pageSize: p.pageSize })

export function adminRoutes(app: Hono<AppEnv>): void {
  register(app, 'adminStats', async (c) => {
    requireStaff(c)
    const d = c.get('deps')
    const since = new Date(Date.now() - 7 * DAY)
    const [[users], [newUsers], [active], [projs], [orgs], [open], storage] = await Promise.all([
      d.db.select({ n: count() }).from(user),
      d.db.select({ n: count() }).from(user).where(gte(user.createdAt, since)),
      d.db.select({ n: sql<number>`count(DISTINCT ${session.userId})` }).from(session).where(gte(session.updatedAt, since)),
      d.db.select({ n: count() }).from(projects),
      d.db.select({ n: count() }).from(organization),
      d.db.select({ n: count() }).from(tickets).where(eq(tickets.status, 'open')),
      d.db.execute(sql`SELECT COALESCE(SUM(size), 0) + (SELECT COALESCE(SUM(size), 0) FROM collab_docs) AS n FROM blobs`),
    ])
    const live = d.collab.stats()
    const body: AdminStatsDTO = {
      users: Number(users?.n ?? 0),
      newUsers7d: Number(newUsers?.n ?? 0),
      activeUsers7d: Number(active?.n ?? 0),
      projects: Number(projs?.n ?? 0),
      orgs: Number(orgs?.n ?? 0),
      storageBytes: Number(((storage as { rows?: { n: string }[] }).rows ?? [])[0]?.n ?? 0),
      openTickets: Number(open?.n ?? 0),
      collabConnections: live.connections,
      collabDocuments: live.documents,
    }
    return c.json(body)
  })

  register(app, 'adminUsers', async (c) => {
    requireStaff(c)
    const d = c.get('deps')
    const q = queryParams(c, schemas.pageQuery)
    const where = q.q ? or(ilike(user.email, `%${escapeLike(q.q)}%`), ilike(user.name, `%${escapeLike(q.q)}%`)) : undefined
    const [rows, [total]] = await Promise.all([
      d.db.select().from(user).where(where).orderBy(desc(user.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
      d.db.select({ n: count() }).from(user).where(where),
    ])
    const items = await Promise.all(rows.map((u) => adminUserDTO(c, u)))
    return c.json(page(items, Number(total?.n ?? 0), q))
  })

  register(app, 'adminUser', async (c) => {
    requireStaff(c)
    const d = c.get('deps')
    const u = await targetUser(c)
    const [orgs, owned, sessions] = await Promise.all([
      orgsOfUser(d.db, u.id),
      d.db.select().from(projects).where(eq(projects.ownerId, u.id)).orderBy(desc(projects.updatedAt)).limit(500),
      d.db.select().from(session).where(eq(session.userId, u.id)).orderBy(desc(session.updatedAt)),
    ])
    return c.json({
      user: await adminUserDTO(c, u),
      orgs,
      projects: owned.map((p) => projectDTO(p, u.name, 'viewer', false)),
      sessions: sessions.map((x) => ({
        id: x.id,
        createdAt: x.createdAt.toISOString(),
        updatedAt: x.updatedAt.toISOString(),
        expiresAt: x.expiresAt.toISOString(),
        ipAddress: x.ipAddress,
        userAgent: x.userAgent,
        impersonatedBy: x.impersonatedBy,
      })),
    })
  })

  register(app, 'adminBan', jsonLimit(4 * KB), async (c) => {
    const s = requireAdmin(c)
    const d = c.get('deps')
    const u = await targetUser(c)
    if (u.id === s.user.id) throw badRequest('You cannot ban yourself')
    if (systemRole(u.role) === 'admin') throw forbidden('Demote the admin before banning')
    const input = await jsonBody(c, schemas.adminBan)
    await d.auth.api.banUser({ body: { userId: u.id, banReason: input.reason, banExpiresIn: input.expiresInDays ? input.expiresInDays * 86_400 : undefined }, headers: c.req.raw.headers })
    d.events.userChanged(u.id)
    await adminAudit(c, 'admin.user.ban', 'user', u.id, { reason: input.reason ?? null, days: input.expiresInDays ?? null })
    return c.json(await adminUserDTO(c, (await targetUser(c))!))
  })

  register(app, 'adminUnban', async (c) => {
    requireAdmin(c)
    const d = c.get('deps')
    const u = await targetUser(c)
    await d.auth.api.unbanUser({ body: { userId: u.id }, headers: c.req.raw.headers })
    await adminAudit(c, 'admin.user.unban', 'user', u.id)
    return c.json(await adminUserDTO(c, await targetUser(c)))
  })

  register(app, 'adminSetRole', jsonLimit(4 * KB), async (c) => {
    const s = requireAdmin(c)
    const d = c.get('deps')
    const u = await targetUser(c)
    const { role } = await jsonBody(c, schemas.adminSetRole)
    if (u.id === s.user.id && role !== 'admin') throw badRequest('You cannot demote yourself')
    await d.auth.api.setRole({ body: { userId: u.id, role }, headers: c.req.raw.headers })
    d.events.userChanged(u.id)
    await adminAudit(c, 'admin.user.role', 'user', u.id, { from: systemRole(u.role), to: role })
    return c.json(await adminUserDTO(c, await targetUser(c)))
  })

  register(app, 'adminRevokeSessions', async (c) => {
    requireAdmin(c)
    const d = c.get('deps')
    const u = await targetUser(c)
    await d.auth.api.revokeUserSessions({ body: { userId: u.id }, headers: c.req.raw.headers })
    d.events.userChanged(u.id)
    await adminAudit(c, 'admin.user.revoke_sessions', 'user', u.id)
    return c.json({ ok: true })
  })

  register(app, 'adminReset2fa', async (c) => {
    requireAdmin(c)
    const d = c.get('deps')
    const u = await targetUser(c)
    await d.db.transaction(async (tx) => {
      await tx.delete(twoFactor).where(eq(twoFactor.userId, u.id))
      await tx.update(user).set({ twoFactorEnabled: false, updatedAt: new Date() }).where(eq(user.id, u.id))
    })
    await adminAudit(c, 'admin.user.reset_2fa', 'user', u.id)
    return c.json(await adminUserDTO(c, await targetUser(c)))
  })

  register(app, 'adminVerifyEmail', async (c) => {
    requireAdmin(c)
    const d = c.get('deps')
    const u = await targetUser(c)
    await d.db.update(user).set({ emailVerified: true, updatedAt: new Date() }).where(eq(user.id, u.id))
    await acceptPendingInvites(d.db, d.events, u.id, u.email)
    await adminAudit(c, 'admin.user.verify_email', 'user', u.id)
    return c.json(await adminUserDTO(c, await targetUser(c)))
  })

  register(app, 'adminDeleteUser', async (c) => {
    const s = requireAdmin(c)
    const d = c.get('deps')
    const u = await targetUser(c)
    if (u.id === s.user.id) throw badRequest('Use account deletion in your settings to delete yourself')
    if (systemRole(u.role) === 'admin') throw forbidden('Demote the admin before deleting')
    await adminAudit(c, 'admin.user.delete', 'user', u.id)
    const result = await hardDeleteUser(d.db, d.events, u.id, d.log)
    d.mailer.queue(u.email, { kind: 'accountDeleted' }, pickLocale(u.locale))
    return c.json({ ok: true, deletedProjects: result?.projects.length ?? 0 })
  })

  register(app, 'adminOrgs', async (c) => {
    requireStaff(c)
    const d = c.get('deps')
    const q = queryParams(c, schemas.pageQuery)
    const where = q.q ? or(ilike(organization.name, `%${escapeLike(q.q)}%`), ilike(organization.slug, `%${escapeLike(q.q)}%`)) : undefined
    const [rows, [total]] = await Promise.all([
      d.db.select().from(organization).where(where).orderBy(desc(organization.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
      d.db.select({ n: count() }).from(organization).where(where),
    ])
    const me = c.get('session')!.user.id
    const mine = rows.length
      ? await d.db
          .select({ orgId: member.organizationId, role: member.role })
          .from(member)
          .where(
            and(
              eq(member.userId, me),
              inArray(
                member.organizationId,
                rows.map((r) => r.id),
              ),
            ),
          )
      : []
    const roleOf = new Map(mine.map((m) => [m.orgId, orgRole(m.role)]))
    // `role` is the admin's own membership role (or 'member' when not a member) — see report.
    return c.json(page(await orgsWithCounts(d.db, rows, (id) => roleOf.get(id) ?? 'member'), Number(total?.n ?? 0), q))
  })

  register(app, 'adminProjects', async (c) => {
    requireAdmin(c)
    const d = c.get('deps')
    const q = queryParams(c, schemas.pageQuery)
    const where = q.q ? ilike(projects.name, `%${escapeLike(q.q)}%`) : undefined
    const [rows, [total]] = await Promise.all([
      d.db.select({ p: projects, ownerName: user.name }).from(projects).innerJoin(user, eq(user.id, projects.ownerId)).where(where).orderBy(desc(projects.updatedAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
      d.db.select({ n: count() }).from(projects).where(where),
    ])
    // Metadata only; 'viewer' is a placeholder role — admins get no content access from this list.
    return c.json(page(rows.map((r) => projectDTO(r.p, r.ownerName, 'viewer', false)), Number(total?.n ?? 0), q))
  })

  register(app, 'adminTickets', async (c) => {
    requireStaff(c)
    const d = c.get('deps')
    const status = c.req.query('status')
    if (status && !['open', 'pending', 'closed'].includes(status)) throw badRequest('Invalid status')
    const rows = await d.db
      .select()
      .from(tickets)
      .where(status ? eq(tickets.status, status as 'open' | 'pending' | 'closed') : undefined)
      .orderBy(desc(tickets.updatedAt))
      .limit(500)
    return c.json(await ticketDTOs(d.db, rows))
  })

  register(app, 'adminTicketMessage', jsonLimit(32 * KB), async (c) => {
    const s = requireStaff(c)
    const d = c.get('deps')
    const [t] = await d.db.select().from(tickets).where(eq(tickets.id, param(c, 'id'))).limit(1)
    if (!t) throw notFound('Ticket not found')
    const { body } = await jsonBody(c, schemas.ticketMessage)
    await d.db.insert(ticketMessages).values({ id: newId(), ticketId: t.id, authorId: s.user.id, staff: true, body })
    const [row] = await d.db.update(tickets).set({ status: 'pending', updatedAt: new Date() }).where(eq(tickets.id, t.id)).returning()
    await adminAudit(c, 'support.ticket.reply', 'ticket', t.id)
    return c.json(await ticketDTO(d.db, row!), 201)
  })

  register(app, 'adminUpdateTicket', jsonLimit(4 * KB), async (c) => {
    requireStaff(c)
    const d = c.get('deps')
    const { status } = await jsonBody(c, schemas.adminUpdateTicket)
    const [row] = await d.db.update(tickets).set({ status, updatedAt: new Date() }).where(eq(tickets.id, param(c, 'id'))).returning()
    if (!row) throw notFound('Ticket not found')
    if (status === 'closed') {
      // Closing a ticket ends any support access that was granted for it.
      const revoked = await d.db.update(supportGrants).set({ revokedAt: new Date() }).where(and(eq(supportGrants.ticketId, row.id), sql`${supportGrants.revokedAt} IS NULL`)).returning({ projectId: supportGrants.projectId })
      for (const g of revoked) d.events.projectChanged(g.projectId)
    }
    await adminAudit(c, 'support.ticket.status', 'ticket', row.id, { status })
    return c.json(await ticketDTO(d.db, row))
  })

  register(app, 'adminAudit', async (c) => {
    requireAdmin(c)
    const d = c.get('deps')
    const q = queryParams(c, schemas.pageQuery)
    const conds: SQL[] = []
    const actorId = c.req.query('actorId')
    const action = c.req.query('action')
    const targetId = c.req.query('targetId')
    const targetType = c.req.query('targetType')
    if (actorId) conds.push(eq(auditLog.actorId, actorId))
    if (action) conds.push(ilike(auditLog.action, `${escapeLike(action)}%`))
    if (targetId) conds.push(eq(auditLog.targetId, targetId))
    if (targetType) conds.push(eq(auditLog.targetType, targetType))
    if (q.q) conds.push(or(ilike(auditLog.action, `%${escapeLike(q.q)}%`), ilike(auditLog.actorEmail, `%${escapeLike(q.q)}%`))!)
    const where = conds.length ? and(...conds) : undefined
    const [rows, [total]] = await Promise.all([
      d.db.select().from(auditLog).where(where).orderBy(desc(auditLog.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
      d.db.select({ n: count() }).from(auditLog).where(where),
    ])
    const items: AuditEntryDTO[] = rows.map((r) => ({
      id: r.id,
      actorId: r.actorId,
      actorEmail: r.actorEmail,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      meta: { ...r.meta, ...(r.ip ? { ip: r.ip } : {}) },
      createdAt: r.createdAt.toISOString(),
    }))
    return c.json(page(items, Number(total?.n ?? 0), q))
  })

  register(app, 'adminAnnouncements', async (c) => {
    requireAdmin(c)
    const rows = await c.get('deps').db.select().from(announcements).orderBy(desc(announcements.startsAt)).limit(200)
    return c.json(rows.map(announcementDTO))
  })

  register(app, 'adminCreateAnnouncement', jsonLimit(8 * KB), async (c) => {
    const s = requireAdmin(c)
    const d = c.get('deps')
    const input = await jsonBody(c, schemas.adminAnnouncement)
    const startsAt = input.startsAt ? new Date(input.startsAt) : new Date()
    const endsAt = input.endsAt ? new Date(input.endsAt) : null
    if (endsAt && endsAt <= startsAt) throw badRequest('endsAt must be after startsAt')
    const [row] = await d.db.insert(announcements).values({ id: newId(), message: input.message, level: input.level, startsAt, endsAt, createdBy: s.user.id }).returning()
    await adminAudit(c, 'admin.announcement.create', 'announcement', row!.id, { level: input.level })
    return c.json(announcementDTO(row!), 201)
  })

  register(app, 'adminDeleteAnnouncement', async (c) => {
    requireAdmin(c)
    const d = c.get('deps')
    const id = param(c, 'id')
    const removed = await d.db.delete(announcements).where(eq(announcements.id, id)).returning({ id: announcements.id })
    if (!removed.length) throw notFound('Announcement not found')
    await adminAudit(c, 'admin.announcement.delete', 'announcement', id)
    return c.json({ ok: true })
  })
}
