// User helpers: DTO mapping, pending-invite acceptance, admin bootstrap, GDPR hard delete.
import { and, asc, eq, gt, inArray, ne, or, sql } from 'drizzle-orm'
import type { SystemRole, UserDTO } from '@cadsandbox/shared'
import type { Db } from '../db/client'
import { auditLog, invitation, member, organization, projectInvites, projectMembers, projects, user, verification } from '../db/schema'
import { newId } from '../lib/crypto'
import type { Logger } from '../log'
import type { AccessEvents } from './events'

export type UserRow = typeof user.$inferSelect

export interface UserLike {
  id: string
  email: string
  name: string
  image?: string | null
  role?: string | null
  emailVerified: boolean
  twoFactorEnabled?: boolean | null
  locale?: string | null
  createdAt: Date
}

/** better-auth stores roles as a comma-separated list; we use the highest. */
export function systemRole(role: string | null | undefined): SystemRole {
  const roles = (role ?? '').split(',').map((r) => r.trim())
  if (roles.includes('admin')) return 'admin'
  if (roles.includes('support')) return 'support'
  return 'user'
}

export function toUserDTO(u: UserLike): UserDTO {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    image: u.image ?? null,
    role: systemRole(u.role),
    emailVerified: !!u.emailVerified,
    twoFactorEnabled: !!u.twoFactorEnabled,
    locale: u.locale ?? 'en',
    createdAt: u.createdAt.toISOString(),
  }
}

/** Turn pending project invitations for a (verified) e-mail address into memberships. */
export async function acceptPendingInvites(db: Db, events: AccessEvents, userId: string, email: string): Promise<number> {
  const invites = await db
    .select()
    .from(projectInvites)
    .where(and(eq(projectInvites.email, email.toLowerCase()), gt(projectInvites.expiresAt, new Date())))
  if (!invites.length) return 0
  for (const inv of invites) {
    await db
      .insert(projectMembers)
      .values({ id: newId(), projectId: inv.projectId, userId, role: inv.role, linkId: null, addedBy: inv.invitedBy })
      .onConflictDoNothing()
  }
  await db.delete(projectInvites).where(
    inArray(
      projectInvites.id,
      invites.map((i) => i.id),
    ),
  )
  for (const inv of invites) events.projectChanged(inv.projectId)
  return invites.length
}

/** ADMIN_EMAILS bootstrap: grant 'admin' to listed, verified accounts. */
export async function ensureBootstrapAdmin(db: Db, adminEmails: string[], u: { id: string; email: string; role?: string | null; emailVerified: boolean }, requireVerified: boolean): Promise<boolean> {
  if (!adminEmails.includes(u.email.toLowerCase())) return false
  if (requireVerified && !u.emailVerified) return false
  if (systemRole(u.role) === 'admin') return false
  await db.update(user).set({ role: 'admin', updatedAt: new Date() }).where(eq(user.id, u.id))
  return true
}

/**
 * GDPR Art. 17 hard delete. Removes the account and everything it owns (FK cascades cover sessions,
 * accounts, 2FA, passkeys, memberships, folders, projects → collab docs, versions, links, members,
 * blob refs; collections, assets, tickets). Unreferenced blobs are removed by the GC job. Audit entries
 * about the user are kept for security but anonymised.
 */
export async function hardDeleteUser(db: Db, events: AccessEvents, userId: string, log: Logger): Promise<{ projects: string[] } | null> {
  const [u] = await db.select().from(user).where(eq(user.id, userId)).limit(1)
  if (!u) return null
  const email = u.email.toLowerCase()
  const affected = new Set<string>()
  const owned = await db.transaction(async (tx) => {
    // Organisations: hand ownership over (admin → member, oldest first) or delete empty orgs.
    const ownerships = await tx.select().from(member).where(and(eq(member.userId, userId), eq(member.role, 'owner')))
    for (const m of ownerships) {
      const others = await tx
        .select()
        .from(member)
        .where(and(eq(member.organizationId, m.organizationId), ne(member.userId, userId)))
        .orderBy(asc(member.createdAt))
      if (!others.length) {
        await tx.delete(organization).where(eq(organization.id, m.organizationId))
        continue
      }
      if (others.some((o) => o.role === 'owner')) continue
      const heir = others.find((o) => o.role === 'admin') ?? others[0]!
      await tx.update(member).set({ role: 'owner' }).where(eq(member.id, heir.id))
    }
    const ownedProjects = await tx.select({ id: projects.id }).from(projects).where(eq(projects.ownerId, userId))
    const memberOf = await tx.select({ projectId: projectMembers.projectId }).from(projectMembers).where(eq(projectMembers.userId, userId))
    for (const p of memberOf) affected.add(p.projectId)
    await tx.delete(projectInvites).where(eq(projectInvites.email, email))
    await tx.delete(invitation).where(eq(invitation.email, email))
    await tx.delete(verification).where(or(eq(verification.value, userId), eq(verification.identifier, email)))
    await tx
      .update(auditLog)
      .set({ actorId: null, actorEmail: null, ip: null })
      .where(eq(auditLog.actorId, userId))
    await tx
      .update(auditLog)
      .set({ targetId: null, meta: sql`${auditLog.meta} - 'email'` })
      .where(and(eq(auditLog.targetType, 'user'), eq(auditLog.targetId, userId)))
    await tx.delete(projects).where(eq(projects.ownerId, userId))
    await tx.delete(user).where(eq(user.id, userId))
    return ownedProjects.map((p) => p.id)
  })
  events.userChanged(userId)
  for (const id of [...owned, ...affected]) events.projectChanged(id)
  log.info({ projects: owned.length }, 'account hard-deleted')
  return { projects: owned }
}
