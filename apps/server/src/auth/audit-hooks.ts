// Audit logging for better-auth endpoints (login, 2FA, passwords, passkeys, impersonation, …).
import { getSessionFromCtx, isAPIError } from 'better-auth/api'
import { eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import { user as userTable } from '../db/schema'
import type { Logger } from '../log'
import { audit } from '../services/audit'
import type { AccessEvents } from '../services/events'

/**
 * Sensitive account changes an impersonating admin must not perform: credentials (password, 2FA,
 * passkeys), sessions, e-mail, and sharing through organisation membership. (Account deletion, data
 * export, project sharing and content are guarded in our own routes — see `requireRealUser`.)
 */
export const IMPERSONATION_BLOCKED = new Set([
  '/change-password',
  '/change-email',
  '/set-password',
  '/two-factor/enable',
  '/two-factor/disable',
  '/two-factor/generate-backup-codes',
  '/two-factor/get-totp-uri',
  '/two-factor/view-backup-codes',
  '/passkey/generate-register-options',
  '/passkey/verify-registration',
  '/passkey/delete-passkey',
  '/passkey/update-passkey',
  '/revoke-session',
  '/revoke-sessions',
  '/revoke-other-sessions',
  '/organization/delete',
  '/organization/invite-member',
  '/organization/cancel-invitation',
  '/organization/accept-invitation',
  '/organization/reject-invitation',
  '/organization/remove-member',
  '/organization/update-member-role',
  '/organization/leave',
  '/admin/impersonate-user',
])

const ACTIONS: Record<string, string> = {
  '/sign-in/email': 'auth.login',
  '/sign-in/passkey': 'auth.login',
  '/passkey/verify-authentication': 'auth.login',
  '/two-factor/verify-totp': 'auth.login',
  '/two-factor/verify-backup-code': 'auth.login',
  '/two-factor/verify-otp': 'auth.login',
  '/sign-out': 'auth.logout',
  '/two-factor/enable': 'auth.2fa.enable',
  '/two-factor/disable': 'auth.2fa.disable',
  '/two-factor/generate-backup-codes': 'auth.2fa.backup_codes',
  '/change-password': 'auth.password.change',
  '/request-password-reset': 'auth.password.reset_requested',
  '/change-email': 'auth.email.change_requested',
  '/passkey/verify-registration': 'auth.passkey.add',
  '/passkey/delete-passkey': 'auth.passkey.remove',
  '/revoke-sessions': 'auth.sessions.revoke_all',
  '/revoke-other-sessions': 'auth.sessions.revoke_others',
  '/revoke-session': 'auth.session.revoke',
  '/admin/impersonate-user': 'admin.impersonate.start',
  '/admin/stop-impersonating': 'admin.impersonate.stop',
  '/organization/leave': 'org.member.leave',
}

interface HookCtx {
  path: string
  body?: unknown
  request?: Request
  headers?: Headers
  context: {
    returned?: unknown
    newSession?: { session: { id: string; userId: string; impersonatedBy?: string | null }; user: { id: string; email: string } } | null
    session?: { session: { id: string; userId: string; impersonatedBy?: string | null }; user: { id: string; email: string } } | null
  }
}

function failed(returned: unknown): boolean {
  if (isAPIError(returned)) return true
  return returned instanceof Response && returned.status >= 400
}

export async function auditAuthRequest(raw: unknown, d: { db: Db; log: Logger; events: AccessEvents }): Promise<void> {
  const ctx = raw as HookCtx
  const action = ACTIONS[ctx.path]
  // Only audit real HTTP calls; server-side auth.api calls are audited by the calling route.
  if (!action || !ctx.request) return
  const ip = ctx.headers?.get('x-csb-client-ip') ?? null
  const isFailure = failed(ctx.context.returned)
  const body = (ctx.body ?? {}) as { email?: unknown; userId?: unknown; organizationId?: unknown }

  try {
    if (isFailure) {
      if (action !== 'auth.login') return
      // Failed logins: record against the account if it exists (no entries for unknown e-mails).
      const email = typeof body.email === 'string' ? body.email.toLowerCase() : null
      if (!email) return
      const [u] = await d.db.select({ id: userTable.id }).from(userTable).where(eq(userTable.email, email)).limit(1)
      if (u) await audit(d.db, { actorId: u.id, actorEmail: email, action: 'auth.login.failed', targetType: 'user', targetId: u.id, ip, meta: { method: ctx.path } }, d.log)
      return
    }

    if (action === 'auth.password.reset_requested') {
      const email = typeof body.email === 'string' ? body.email.toLowerCase() : null
      const [u] = email ? await d.db.select({ id: userTable.id }).from(userTable).where(eq(userTable.email, email)).limit(1) : []
      if (u) await audit(d.db, { actorId: null, action, targetType: 'user', targetId: u.id, ip }, d.log)
      return
    }

    const fresh = ctx.context.newSession
    if (action === 'admin.impersonate.start') {
      const adminId = fresh?.session.impersonatedBy ?? null
      await audit(d.db, { actorId: adminId, action, targetType: 'user', targetId: fresh?.user.id ?? (typeof body.userId === 'string' ? body.userId : null), ip, meta: { sessionMaxSeconds: 3600 } }, d.log)
      return
    }
    if (action === 'admin.impersonate.stop') {
      const ended = ctx.context.session
      await audit(d.db, { actorId: fresh?.user.id ?? null, actorEmail: fresh?.user.email ?? null, action, targetType: 'user', targetId: ended?.user.id ?? null, ip }, d.log)
      // The impersonation session is gone: close its live collab connections now, not at the next sweep.
      if (ended?.session.impersonatedBy) d.events.sessionRevoked(ended.session.id)
      return
    }

    const s = fresh ?? ctx.context.session ?? (await getSessionFromCtx(raw as Parameters<typeof getSessionFromCtx>[0]).catch(() => null))
    if (!s) return
    if (action === 'org.member.leave') {
      // better-auth deletes the membership without calling organizationHooks (unlike remove-member):
      // audit it here and re-check the member's live collab connections to org-shared projects.
      const orgId = typeof body.organizationId === 'string' ? body.organizationId : null
      await audit(d.db, { actorId: s.user.id, actorEmail: s.user.email, action, targetType: 'org', targetId: orgId, ip, meta: { userId: s.user.id } }, d.log)
      d.events.userChanged(s.user.id)
      return
    }
    const impersonatedBy = s.session.impersonatedBy ?? null
    await audit(
      d.db,
      {
        actorId: impersonatedBy ?? s.user.id,
        actorEmail: impersonatedBy ? null : s.user.email,
        action,
        targetType: 'user',
        targetId: s.user.id,
        ip,
        meta: { method: ctx.path, ...(impersonatedBy ? { impersonated: true } : {}) },
      },
      d.log,
    )
    // Live collab connections of revoked sessions must close now, not at the next 2-minute sweep.
    if (action === 'auth.sessions.revoke_all' || action === 'auth.sessions.revoke_others' || action === 'auth.session.revoke' || action === 'auth.password.change') d.events.userChanged(s.user.id)
  } catch (err) {
    d.log.error({ err: (err as Error).message, path: ctx.path }, 'auth audit failed')
  }
}
