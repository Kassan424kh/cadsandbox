// User-facing support: tickets, messages and user-granted, time-boxed, revocable support access.
import type { Hono } from 'hono'
import { and, desc, eq, gt, isNull } from 'drizzle-orm'
import { schemas } from '@cadsandbox/shared'
import { supportGrants, ticketMessages, tickets } from '../db/schema'
import { newId } from '../lib/crypto'
import { notFound } from '../lib/errors'
import { jsonBody, limit, param, projectAccess, requireAuth, requireRealUser, roleOf, type AppEnv, type Ctx } from '../http/context'
import { jsonLimit, KB, register } from '../http/router'
import { isStaff } from '../services/access'
import { audit } from '../services/audit'
import { ticketDTO, ticketDTOs } from '../services/tickets'

async function ownTicket(c: Ctx, id: string) {
  const s = requireAuth(c)
  const [t] = await c.get('deps').db.select().from(tickets).where(eq(tickets.id, id)).limit(1)
  if (!t || (t.userId !== s.user.id && !isStaff(roleOf(s)))) throw notFound('Ticket not found')
  return t
}

export function supportRoutes(app: Hono<AppEnv>): void {
  register(app, 'createTicket', jsonLimit(32 * KB), async (c) => {
    const s = requireAuth(c)
    const d = c.get('deps')
    limit(c, 'ticketPerUser', s.user.id)
    const input = await jsonBody(c, schemas.createTicket)
    let projectId: string | null = null
    if (input.projectId) {
      // Granting staff access is a sharing decision → needs share permission on the project.
      const a = await projectAccess(c, input.projectId, input.grantAccessDays > 0 ? 'share' : 'view', { metadata: true })
      projectId = a.project.id
    }
    if (input.grantAccessDays > 0) requireRealUser(c)
    const id = newId()
    const now = new Date()
    await d.db.transaction(async (tx) => {
      await tx.insert(tickets).values({ id, userId: s.user.id, subject: input.subject, projectId, status: 'open' })
      await tx.insert(ticketMessages).values({ id: newId(), ticketId: id, authorId: s.user.id, staff: false, body: input.message })
      if (projectId && input.grantAccessDays > 0) {
        await tx.insert(supportGrants).values({ id: newId(), ticketId: id, projectId, grantedBy: s.user.id, expiresAt: new Date(now.getTime() + input.grantAccessDays * 86_400_000) })
      }
    })
    await audit(d.db, { actorId: s.user.id, actorEmail: s.user.email, action: 'support.ticket.create', targetType: 'ticket', targetId: id, ip: c.get('ip') }, d.log)
    if (projectId && input.grantAccessDays > 0) {
      await audit(d.db, { actorId: s.user.id, actorEmail: s.user.email, action: 'support.access.grant', targetType: 'project', targetId: projectId, ip: c.get('ip'), meta: { ticketId: id, days: input.grantAccessDays } }, d.log)
    }
    const [row] = await d.db.select().from(tickets).where(eq(tickets.id, id)).limit(1)
    return c.json(await ticketDTO(d.db, row!), 201)
  })

  register(app, 'listTickets', async (c) => {
    const s = requireAuth(c)
    const d = c.get('deps')
    const rows = await d.db.select().from(tickets).where(eq(tickets.userId, s.user.id)).orderBy(desc(tickets.updatedAt)).limit(200)
    return c.json(await ticketDTOs(d.db, rows))
  })

  register(app, 'getTicket', async (c) => {
    const t = await ownTicket(c, param(c, 'id'))
    return c.json(await ticketDTO(c.get('deps').db, t))
  })

  register(app, 'ticketMessage', jsonLimit(32 * KB), async (c) => {
    const s = requireAuth(c)
    const d = c.get('deps')
    const t = await ownTicket(c, param(c, 'id'))
    if (t.userId !== s.user.id) throw notFound('Ticket not found')
    limit(c, 'ticketMessagePerUser', s.user.id)
    const { body } = await jsonBody(c, schemas.ticketMessage)
    await d.db.insert(ticketMessages).values({ id: newId(), ticketId: t.id, authorId: s.user.id, staff: false, body })
    const [row] = await d.db.update(tickets).set({ status: 'open', updatedAt: new Date() }).where(eq(tickets.id, t.id)).returning()
    return c.json(await ticketDTO(d.db, row!), 201)
  })

  register(app, 'revokeSupportAccess', async (c) => {
    const s = requireAuth(c)
    const d = c.get('deps')
    const t = await ownTicket(c, param(c, 'id'))
    if (t.userId !== s.user.id) throw notFound('Ticket not found')
    const revoked = await d.db
      .update(supportGrants)
      .set({ revokedAt: new Date() })
      .where(and(eq(supportGrants.ticketId, t.id), isNull(supportGrants.revokedAt), gt(supportGrants.expiresAt, new Date())))
      .returning({ projectId: supportGrants.projectId })
    for (const g of revoked) {
      await audit(d.db, { actorId: s.user.id, actorEmail: s.user.email, action: 'support.access.revoke', targetType: 'project', targetId: g.projectId, ip: c.get('ip'), meta: { ticketId: t.id } }, d.log)
      d.events.projectChanged(g.projectId)
    }
    return c.json(await ticketDTO(d.db, t))
  })
}
