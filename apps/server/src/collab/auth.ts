// Collab connection authorisation — pure-ish decision logic, unit-tested separately from the socket.
import { and, eq, gt } from 'drizzle-orm'
import { can, docNames } from '@cadsandbox/shared'
import type { Auth } from '../auth/auth'
import type { Db } from '../db/client'
import { session as sessionTable, user as userTable } from '../db/schema'
import type { CollabContext } from '../deps'
import { hasSupportGrantFrom, resolveProjectAccess } from '../services/access'
import { writeBlock, type WriteLimits } from '../services/projects'
import type { ShareGrants } from '../services/share-grants'
import { systemRole } from '../services/users'

export interface CollabAuthInput {
  documentName: string
  headers: Headers
  /** Provider auth token or `?token=` — a share-link token for anonymous/link viewers. */
  token: string | null
}

export type CollabDecision =
  | { ok: true; readOnly: boolean; context: CollabContext }
  | { ok: false; reason: 'bad-document' | 'forbidden' }
  /** An admin impersonating the user, without that user's support grant for the project. */
  | { ok: false; reason: 'impersonation'; projectId: string; userId: string; impersonatedBy: string }

export interface CollabAccessDeps {
  db: Db
  publicSharing: boolean
  grants?: ShareGrants
  /** Storage quota and design size limit; without it writability depends on the role only. */
  limits?: WriteLimits
}

export async function decideCollabAccess(deps: CollabAccessDeps & { auth: Auth }, input: CollabAuthInput): Promise<CollabDecision> {
  const parsed = docNames.parse(input.documentName)
  if (!parsed) return { ok: false, reason: 'bad-document' }
  let s: Awaited<ReturnType<Auth['api']['getSession']>> = null
  if (input.headers.get('cookie')) {
    s = await deps.auth.api.getSession({ headers: input.headers }).catch(() => null)
    if (s?.user.banned && (!s.user.banExpires || new Date(s.user.banExpires) > new Date())) s = null
  }
  // Raw link token (base64url) or signed grant ("g1.<payload>.<sig>").
  const token = input.token && /^[\w.-]{16,512}$/.test(input.token) ? input.token : null
  const role = s ? systemRole(s.user.role) : null
  const access = await resolveProjectAccess(deps.db, parsed.projectId, { userId: s?.user.id ?? null, systemRole: role, shareToken: token }, { publicSharing: deps.publicSharing, grants: deps.grants })
  if (!access) return { ok: false, reason: 'forbidden' }
  // Impersonation: documents are content — only through the user's own support grant, read-only.
  const impersonatedBy = (s?.session as { impersonatedBy?: string | null } | undefined)?.impersonatedBy ?? null
  if (s && impersonatedBy && !(await hasSupportGrantFrom(deps.db, parsed.projectId, s.user.id))) {
    return { ok: false, reason: 'impersonation', projectId: parsed.projectId, userId: s.user.id, impersonatedBy }
  }
  let readOnly = !!impersonatedBy || !can(access.role, 'edit') || access.via === 'support'
  // Out of storage / design too large: everyone's connection is read-only until that is resolved.
  if (!readOnly && deps.limits && (await writeBlock(deps.db, access.project, deps.limits))) readOnly = true
  return {
    ok: true,
    readOnly,
    context: {
      userId: s?.user.id ?? null,
      userName: s?.user.name ?? null,
      sessionId: s?.session.id ?? null,
      systemRole: role,
      projectId: parsed.projectId,
      ownerId: access.project.ownerId,
      role: impersonatedBy ? 'viewer' : access.role,
      linkId: impersonatedBy ? null : access.linkId,
      shareToken: !impersonatedBy && access.via === 'link' ? token : null,
      via: impersonatedBy ? 'impersonation' : access.via,
      sessionExpiresAt: s ? new Date(s.session.expiresAt).getTime() : null,
      impersonatedBy,
    },
  }
}

/**
 * Re-check a live connection: session still valid, access still granted, same read-only mode and
 * same project role. A role change that keeps the mode (viewer ↔ commenter) still closes the
 * connection: the client learns about access changes only through that close and then reopens the
 * project with its new role (e.g. to enable commenting).
 */
export async function stillAllowed(deps: CollabAccessDeps, ctx: CollabContext, readOnly: boolean): Promise<boolean> {
  let sysRole = ctx.systemRole as ReturnType<typeof systemRole> | null
  if (ctx.sessionId) {
    const [row] = await deps.db
      .select({ role: userTable.role, banned: userTable.banned, banExpires: userTable.banExpires })
      .from(sessionTable)
      .innerJoin(userTable, eq(userTable.id, sessionTable.userId))
      .where(and(eq(sessionTable.id, ctx.sessionId), gt(sessionTable.expiresAt, new Date())))
      .limit(1)
    if (!row) return false
    if (row.banned && (!row.banExpires || row.banExpires > new Date())) return false
    sysRole = systemRole(row.role)
  }
  const access = await resolveProjectAccess(deps.db, ctx.projectId, { userId: ctx.userId, systemRole: sysRole, shareToken: ctx.shareToken }, { publicSharing: deps.publicSharing, grants: deps.grants })
  if (!access) return false
  // Impersonation connections live only as long as the user's support grant (revoked/expired → close).
  if (ctx.impersonatedBy) return readOnly && !!ctx.userId && (await hasSupportGrantFrom(deps.db, ctx.projectId, ctx.userId))
  let shouldBeReadOnly = !can(access.role, 'edit') || access.via === 'support'
  if (!shouldBeReadOnly && deps.limits && (await writeBlock(deps.db, access.project, deps.limits))) shouldBeReadOnly = true
  return shouldBeReadOnly === readOnly && access.role === ctx.role
}
