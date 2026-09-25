// Support tickets → DTOs (with messages and the current support-access window).
import { and, asc, desc, eq, gt, inArray, isNull } from 'drizzle-orm'
import type { TicketDTO } from '@cadsandbox/shared'
import type { DbOrTx } from '../db/client'
import { supportGrants, ticketMessages, tickets, user } from '../db/schema'

export type TicketRow = typeof tickets.$inferSelect

export async function ticketDTOs(db: DbOrTx, rows: TicketRow[]): Promise<TicketDTO[]> {
  if (!rows.length) return []
  const ids = rows.map((t) => t.id)
  const [msgs, grants, owners] = await Promise.all([
    db
      .select({ id: ticketMessages.id, ticketId: ticketMessages.ticketId, authorId: ticketMessages.authorId, staff: ticketMessages.staff, body: ticketMessages.body, createdAt: ticketMessages.createdAt, authorName: user.name })
      .from(ticketMessages)
      .leftJoin(user, eq(user.id, ticketMessages.authorId))
      .where(inArray(ticketMessages.ticketId, ids))
      .orderBy(asc(ticketMessages.createdAt)),
    db
      .select({ ticketId: supportGrants.ticketId, expiresAt: supportGrants.expiresAt })
      .from(supportGrants)
      .where(and(inArray(supportGrants.ticketId, ids), isNull(supportGrants.revokedAt), gt(supportGrants.expiresAt, new Date())))
      .orderBy(desc(supportGrants.expiresAt)),
    db
      .select({ id: user.id, email: user.email })
      .from(user)
      .where(
        inArray(
          user.id,
          rows.map((t) => t.userId),
        ),
      ),
  ])
  const emailOf = new Map(owners.map((o) => [o.id, o.email]))
  return rows.map((t) => {
    const g = grants.find((x) => x.ticketId === t.id)
    return {
      id: t.id,
      userId: t.userId,
      userEmail: emailOf.get(t.userId) ?? '',
      subject: t.subject,
      status: t.status,
      projectId: t.projectId,
      supportAccessUntil: g ? g.expiresAt.toISOString() : null,
      messages: msgs
        .filter((m) => m.ticketId === t.id)
        .map((m) => ({ id: m.id, authorId: m.authorId ?? '', authorName: m.authorName ?? (m.staff ? 'Support' : 'Deleted user'), staff: m.staff, body: m.body, createdAt: m.createdAt.toISOString() })),
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    }
  })
}

export async function ticketDTO(db: DbOrTx, row: TicketRow): Promise<TicketDTO> {
  return (await ticketDTOs(db, [row]))[0]!
}
