// Wire all services together (used by the server entry point, the CLI and tests).
import { and, eq } from 'drizzle-orm'
import { createAuth } from './auth/auth'
import { createCollab } from './collab/server'
import { openDatabase } from './db/client'
import { user } from './db/schema'
import type { Deps } from './deps'
import type { Config } from './env'
import { RateLimiter } from './http/rate-limit'
import { createKeyRing } from './lib/crypto'
import { IpHasher, ProxyTrust } from './lib/ip'
import { createLogger, type Logger } from './log'
import { createMailer, type Mailer } from './mail/mailer'
import { audit, AuditThrottle } from './services/audit'
import { AccessEvents } from './services/events'
import { ShareGrants } from './services/share-grants'
import { ProofOfWork } from './auth/captcha'
import { ErrorReporter, reportFromLog } from './lib/error-reports'
import { ensureBootstrapAdmin } from './services/users'
import { createBlobStore } from './storage'

export interface Runtime {
  deps: Deps
  close(): Promise<void>
}

export async function createRuntime(config: Config, overrides: { mailer?: Mailer; log?: Logger } = {}): Promise<Runtime> {
  const errorReporter = config.errorReports.dsn ? new ErrorReporter(config.errorReports.dsn, { release: config.version, environment: config.errorReports.environment }) : null
  const onError = errorReporter
    ? (args: unknown[]) => {
        const report = reportFromLog(args)
        if (report) errorReporter.report(report)
      }
    : undefined
  const log = overrides.log ?? createLogger(config.logLevel, config.isProd, onError)
  const database = await openDatabase({
    databaseUrl: config.databaseUrl,
    poolMax: config.databasePoolMax,
    ssl: config.databaseSsl,
    pgliteDir: config.pgliteDir,
    migrationsDir: config.migrationsDir,
  })
  const db = database.db
  const ring = createKeyRing(config.storage.encryptionKey, config.storage.oldEncryptionKeys)
  const blobs = createBlobStore(config, ring)
  const mailer = overrides.mailer ?? createMailer(config, log)
  const events = new AccessEvents()
  const pow = config.features.signupCaptcha ? new ProofOfWork(config.authSecret, config.signupCaptchaDifficulty) : null
  const auth = createAuth({ config, db, log, mailer, events, pow })
  const limiter = new RateLimiter(config.rateLimit)
  const ipHasher = new IpHasher()
  const proxy = new ProxyTrust(config.trustProxy, config.trustedProxies)
  const auditThrottle = new AuditThrottle()
  const grants = new ShareGrants(config.authSecret)
  const collab = createCollab({ config, log, db, auth, ring, events, limiter, ipHasher, proxy, auditThrottle, grants })
  const deps: Deps = { config, log, db, dbDriver: database.driver, auth, blobs, ring, mailer, events, collab, ipHasher, proxy, limiter, auditThrottle, grants, pow, errorReporter }

  // ADMIN_EMAILS: promote listed accounts that are already verified (others on verification).
  for (const email of config.adminEmails) {
    const [u] = await db
      .select()
      .from(user)
      .where(and(eq(user.email, email), eq(user.emailVerified, true)))
      .limit(1)
    if (u && (await ensureBootstrapAdmin(db, config.adminEmails, u, true))) {
      await audit(db, { action: 'admin.bootstrap', targetType: 'user', targetId: u.id }, log)
      log.warn({ userId: u.id }, 'granted admin role from ADMIN_EMAILS')
    }
  }

  return {
    deps,
    async close() {
      await collab.close()
      limiter.close()
      await database.close()
    },
  }
}
