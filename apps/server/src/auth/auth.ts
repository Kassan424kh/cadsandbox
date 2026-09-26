// better-auth: e-mail+password (scrypt), e-mail verification, password reset, 30-day rolling session
// cookies, TOTP 2FA + backup codes, passkeys, organisations, admin (ban/impersonate). Telemetry is off.
import { passkey } from '@better-auth/passkey'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import { admin, organization, twoFactor } from 'better-auth/plugins'
import type { AccessControl } from 'better-auth/plugins/access'
import { adminAc, defaultAc, userAc } from 'better-auth/plugins/admin/access'
import { eq } from 'drizzle-orm'
import { BRAND, LEGAL } from '@cadsandbox/shared'
import type { Db } from '../db/client'
import { authSchema, user as userTable } from '../db/schema'
import type { Config } from '../env'
import { newId } from '../lib/crypto'
import { truncateIp } from '../lib/ip'
import type { Logger } from '../log'
import type { Mailer } from '../mail/mailer'
import { pickLocale } from '../mail/templates'
import { audit } from '../services/audit'
import type { AccessEvents } from '../services/events'
import { acceptPendingInvites, ensureBootstrapAdmin } from '../services/users'
import { auditAuthRequest, IMPERSONATION_BLOCKED } from './audit-hooks'
import type { ProofOfWork } from './captcha'
import { isBlockedEmail } from './disposable'

/** Set by our HTTP layer from the socket / trusted proxy chain (client-supplied values are stripped). */
export const CLIENT_IP_HEADER = 'x-csb-client-ip'

export interface AuthDeps {
  config: Config
  db: Db
  log: Logger
  mailer: Mailer
  events: AccessEvents
  /** Sign-up proof-of-work; null = not required. */
  pow?: ProofOfWork | null
}

/** HTTP paths disabled on /api/auth — our /api/admin + /api/me endpoints wrap these with auditing/GDPR flows. */
const DISABLED_PATHS = [
  '/delete-user',
  '/delete-user/callback',
  '/admin/set-user-password',
  '/admin/update-user',
  '/admin/remove-user',
  '/admin/create-user',
  '/admin/ban-user',
  '/admin/unban-user',
  '/admin/set-role',
  '/admin/list-users',
  '/admin/list-user-sessions',
  '/admin/revoke-user-session',
  '/admin/revoke-user-sessions',
]

const DAY = 86_400

export function createAuth(d: AuthDeps) {
  process.env.BETTER_AUTH_TELEMETRY = '0'
  const { config, db, log, mailer, events, pow } = d
  const verificationOn = config.features.emailVerification

  const onVerified = async (u: { id: string; email: string; role?: string | null; emailVerified: boolean }) => {
    await acceptPendingInvites(db, events, u.id, u.email)
    if (await ensureBootstrapAdmin(db, config.adminEmails, u, true)) {
      await audit(db, { actorId: null, action: 'admin.bootstrap', targetType: 'user', targetId: u.id }, log)
    }
  }

  const localeOf = async (email: string) => {
    const [u] = await db.select({ locale: userTable.locale }).from(userTable).where(eq(userTable.email, email.toLowerCase())).limit(1)
    return pickLocale(u?.locale)
  }

  const supportAc = defaultAc.newRole({ user: ['list', 'get'], session: ['list'] })

  return betterAuth({
    appName: BRAND.name,
    baseURL: config.publicUrl,
    basePath: '/api/auth',
    secret: config.authSecret,
    trustedOrigins: config.trustedOrigins,
    telemetry: { enabled: false },
    database: drizzleAdapter(db, { provider: 'pg', schema: authSchema }),
    disabledPaths: DISABLED_PATHS,
    user: {
      additionalFields: {
        locale: { type: 'string', required: false, defaultValue: 'en', input: true },
        // Sent with the sign-up form; checked and time-stamped in databaseHooks.user.create.before.
        termsVersion: { type: 'string', required: false, input: true },
        termsAcceptedAt: { type: 'date', required: false, input: false },
      },
      deleteUser: { enabled: false },
      // Rectification (Art. 16): the old address confirms, the new one is verified before it counts.
      changeEmail: {
        enabled: true,
        updateEmailWithoutVerification: false,
        sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
          mailer.queue(user.email, { kind: 'changeEmail', url, newEmail }, pickLocale((user as { locale?: string }).locale))
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: !config.features.signup,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      requireEmailVerification: verificationOn,
      autoSignIn: !verificationOn,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 3600,
      sendResetPassword: async ({ user, url }) => {
        mailer.queue(user.email, { kind: 'reset', url }, pickLocale((user as { locale?: string }).locale))
      },
      onPasswordReset: async ({ user }) => {
        await audit(db, { actorId: user.id, actorEmail: user.email, action: 'auth.password.reset', targetType: 'user', targetId: user.id }, log)
        events.userChanged(user.id)
      },
    },
    emailVerification: {
      sendOnSignUp: verificationOn,
      sendOnSignIn: verificationOn,
      autoSignInAfterVerification: true,
      expiresIn: DAY,
      sendVerificationEmail: async ({ user, url }) => {
        mailer.queue(user.email, { kind: 'verify', url }, pickLocale((user as { locale?: string }).locale))
      },
      afterEmailVerification: async (user) => {
        await audit(db, { actorId: user.id, actorEmail: user.email, action: 'auth.email.verified', targetType: 'user', targetId: user.id }, log)
        await onVerified({ ...user, emailVerified: true })
      },
    },
    session: {
      expiresIn: 30 * DAY,
      updateAge: DAY,
      freshAge: 15 * 60,
    },
    account: { accountLinking: { enabled: false } },
    rateLimit: {
      enabled: config.rateLimit,
      storage: 'memory',
      window: 60,
      max: 120,
      customRules: {
        '/sign-in/*': { window: 60, max: 10 },
        '/sign-up/*': { window: 600, max: 5 },
        '/request-password-reset': { window: 900, max: 3 },
        '/reset-password': { window: 900, max: 5 },
        '/send-verification-email': { window: 900, max: 3 },
        '/change-password': { window: 600, max: 5 },
        '/change-email': { window: 600, max: 5 },
        '/two-factor/*': { window: 60, max: 10 },
        '/passkey/*': { window: 60, max: 20 },
        '/organization/invite-member': { window: 600, max: 30 },
        '/admin/impersonate-user': { window: 600, max: 10 },
        '/get-session': false,
      },
    },
    advanced: {
      cookiePrefix: 'csb',
      useSecureCookies: config.isProd,
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure: config.isProd, path: '/' },
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
      database: { generateId: () => newId() },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user, ctx) => {
            const email = user.email.toLowerCase()
            // Without verification the bootstrap role is granted at sign-up (dev/closed deployments only).
            const bootstrap = !verificationOn && config.adminEmails.includes(email)
            // Self sign-up must accept the current terms; the server records version and time.
            const selfSignup = ctx?.path === '/sign-up/email'
            if (selfSignup && user.termsVersion !== LEGAL.termsVersion) {
              throw new APIError('BAD_REQUEST', { message: 'Please accept the current terms of service and privacy policy' })
            }
            const terms = selfSignup ? { termsVersion: LEGAL.termsVersion, termsAcceptedAt: new Date() } : { termsVersion: null, termsAcceptedAt: null }
            return { data: { ...user, email, ...terms, ...(bootstrap ? { role: 'admin' } : {}) } }
          },
          after: async (user) => {
            const termsVersion = (user as { termsVersion?: string | null }).termsVersion ?? null
            await audit(db, { actorId: user.id, actorEmail: user.email, action: 'auth.signup', targetType: 'user', targetId: user.id, meta: { termsVersion } }, log)
            // Invitations are only bound to *verified* addresses — never to a merely claimed e-mail.
            if (user.emailVerified) await acceptPendingInvites(db, events, user.id, user.email)
          },
        },
      },
      session: {
        create: {
          before: async (session) => ({ data: { ...session, ipAddress: truncateIp(session.ipAddress) } }),
          after: async (session) => {
            const [u] = await db.select().from(userTable).where(eq(userTable.id, session.userId)).limit(1)
            if (u?.emailVerified) await onVerified(u)
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (pow && ctx.path === '/sign-up/email' && !pow.verify(ctx.headers?.get('x-captcha'))) {
          throw new APIError('BAD_REQUEST', { message: 'The sign-up check failed — reload the page and try again' })
        }
        if (ctx.path === '/sign-up/email' || ctx.path === '/change-email') {
          const body = (ctx.body ?? {}) as { email?: unknown; newEmail?: unknown }
          const email = ctx.path === '/sign-up/email' ? body.email : body.newEmail
          if (typeof email === 'string' && isBlockedEmail(email, config.blockedEmailDomains)) {
            throw new APIError('BAD_REQUEST', { message: 'Please use a permanent e-mail address — disposable addresses are not accepted' })
          }
        }
        // The accepted terms version is only written at sign-up and via POST /api/me/terms.
        if (ctx.path === '/update-user' && ctx.body && typeof ctx.body === 'object' && 'termsVersion' in ctx.body) {
          throw new APIError('BAD_REQUEST', { message: 'termsVersion cannot be changed here' })
        }
        if (!IMPERSONATION_BLOCKED.has(ctx.path)) return
        const s = await getSessionFromCtx(ctx).catch(() => null)
        if (s?.session && (s.session as { impersonatedBy?: string | null }).impersonatedBy) {
          throw new APIError('FORBIDDEN', { message: 'Not allowed while impersonating a user' })
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        await auditAuthRequest(ctx, { db, log, events })
      }),
    },
    plugins: [
      admin({
        ac: defaultAc as unknown as AccessControl,
        roles: { admin: adminAc, support: supportAc, user: userAc },
        adminRoles: ['admin'],
        defaultRole: 'user',
        impersonationSessionDuration: 3600,
        allowImpersonatingAdmins: false,
        bannedUserMessage: 'This account has been suspended. Contact support if you believe this is a mistake.',
      }),
      organization({
        allowUserToCreateOrganization: true,
        creatorRole: 'owner',
        membershipLimit: 1000,
        invitationExpiresIn: 7 * DAY,
        cancelPendingInvitationsOnReInvite: true,
        requireEmailVerificationOnInvitation: verificationOn,
        sendInvitationEmail: async (data) => {
          const url = `${config.publicUrl}/invite/${encodeURIComponent(data.id)}`
          const locale = await localeOf(data.email)
          mailer.queue(data.email, { kind: 'orgInvite', inviter: data.inviter.user.name, org: data.organization.name, role: data.role, url }, locale)
        },
        organizationHooks: {
          afterCreateOrganization: async ({ organization: org, user }) => {
            await audit(db, { actorId: user.id, actorEmail: user.email, action: 'org.create', targetType: 'org', targetId: org.id }, log)
          },
          afterDeleteOrganization: async ({ organization: org, user }) => {
            await audit(db, { actorId: user.id, actorEmail: user.email, action: 'org.delete', targetType: 'org', targetId: org.id, meta: { name: org.name } }, log)
            events.orgChanged(org.id)
          },
          afterAddMember: async ({ member, organization: org }) => {
            await audit(db, { action: 'org.member.add', targetType: 'org', targetId: org.id, meta: { userId: member.userId, role: member.role } }, log)
            events.userChanged(member.userId)
          },
          afterRemoveMember: async ({ member, organization: org }) => {
            await audit(db, { action: 'org.member.remove', targetType: 'org', targetId: org.id, meta: { userId: member.userId } }, log)
            events.userChanged(member.userId)
          },
          afterUpdateMemberRole: async ({ member, previousRole, organization: org }) => {
            await audit(db, { action: 'org.member.role', targetType: 'org', targetId: org.id, meta: { userId: member.userId, from: previousRole, to: member.role } }, log)
          },
          afterCreateInvitation: async ({ invitation, inviter, organization: org }) => {
            await audit(db, { actorId: inviter.id, actorEmail: inviter.email, action: 'org.invite.create', targetType: 'org', targetId: org.id, meta: { role: invitation.role } }, log)
          },
          afterAcceptInvitation: async ({ member, user, organization: org }) => {
            await audit(db, { actorId: user.id, actorEmail: user.email, action: 'org.invite.accept', targetType: 'org', targetId: org.id, meta: { role: member.role } }, log)
            events.userChanged(user.id)
          },
        },
      }),
      twoFactor({
        issuer: BRAND.name,
        backupCodeOptions: { amount: 10, length: 10 },
        accountLockout: { enabled: true, maxFailedAttempts: 5, durationSeconds: 900 },
      }),
      passkey({
        rpID: config.passkey.rpId,
        rpName: config.passkey.rpName,
        origin: new URL(config.publicUrl).origin,
      }),
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>
export type AuthSession = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>
export type AuthUser = AuthSession['user']
