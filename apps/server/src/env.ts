// Environment configuration — parsed and validated once at startup (fail fast on misconfiguration).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { BRAND, LIMITS } from '@cadsandbox/shared'

const TRUE = new Set(['true', '1', 'yes', 'on'])
const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? def : TRUE.has(v.trim().toLowerCase())))
const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
const optStr = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined))

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  HOST: z.string().default('0.0.0.0'),
  PUBLIC_URL: optStr,
  BETTER_AUTH_SECRET: optStr,
  TRUSTED_ORIGINS: csv,
  TRUST_PROXY: bool(false),
  TRUSTED_PROXIES: csv,
  DATABASE_URL: optStr,
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(200).default(10),
  DATABASE_SSL: bool(false),
  DATA_DIR: optStr,
  PGLITE_DIR: optStr,
  WEB_DIST_DIR: optStr,
  MIGRATIONS_DIR: optStr,
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_ENCRYPTION_KEY: optStr,
  STORAGE_ENCRYPTION_OLD_KEYS: csv,
  S3_ENDPOINT: optStr,
  S3_REGION: z.string().default('eu-central-1'),
  S3_BUCKET: optStr,
  S3_ACCESS_KEY_ID: optStr,
  S3_SECRET_ACCESS_KEY: optStr,
  S3_FORCE_PATH_STYLE: bool(true),
  S3_PREFIX: z.string().default('blobs/'),
  SMTP_HOST: optStr,
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: bool(false),
  SMTP_USER: optStr,
  SMTP_PASS: optStr,
  MAIL_FROM: z.string().default(`${BRAND.name} <no-reply@localhost>`),
  EMAIL_VERIFICATION: bool(true),
  SIGNUP_ENABLED: bool(true),
  /** Proof-of-work challenge at sign-up (self-hosted, no third party); difficulty = max number tried. */
  SIGNUP_CAPTCHA: bool(true),
  SIGNUP_CAPTCHA_DIFFICULTY: z.coerce.number().int().min(1000).max(10_000_000).default(100_000),
  PUBLIC_SHARING: bool(true),
  COLLAB_ENABLED: bool(true),
  PASSKEY_RP_ID: optStr,
  PASSKEY_RP_NAME: z.string().default(BRAND.name),
  ADMIN_EMAILS: csv,
  STORAGE_QUOTA_BYTES: z.coerce.number().int().positive().default(LIMITS.defaultStorageQuotaBytes),
  MAX_PROJECTS_FREE: z.coerce.number().int().positive().default(5),
  LEGAL_IMPRINT_URL: z.string().default('/legal/imprint'),
  LEGAL_PRIVACY_URL: z.string().default('/legal/privacy'),
  LEGAL_TERMS_URL: z.string().default('/legal/terms'),
  LEGAL_DPA_URL: z.string().default('/legal/dpa'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Sentry-compatible DSN of a self-hosted GlitchTip project; unset = no error reports. */
  SENTRY_DSN: optStr,
  SENTRY_ENVIRONMENT: optStr,
  RATE_LIMIT: bool(true),
  JOBS_ENABLED: bool(true),
  COLLAB_MAX_MESSAGE_BYTES: z.coerce.number().int().min(64 * 1024).default(16 * 1024 * 1024),
  /** Bytes per project and hour served to visitors (public projects, share-link guests). */
  VISITOR_EGRESS_BYTES_PER_HOUR: z.coerce.number().int().min(1024 * 1024).default(2 * 1024 * 1024 * 1024),
  /** Extra e-mail domains refused at sign-up (comma-separated), on top of the built-in disposable list. */
  BLOCKED_EMAIL_DOMAINS: csv,
  /** A design (Yjs document) larger than this turns read-only — protects server memory and the database. */
  COLLAB_MAX_DOC_BYTES: z.coerce.number().int().min(1024 * 1024).default(64 * 1024 * 1024),
})

export interface Config {
  env: 'development' | 'production' | 'test'
  isProd: boolean
  isTest: boolean
  version: string
  port: number
  host: string
  publicUrl: string
  authSecret: string
  trustedOrigins: string[]
  trustProxy: boolean
  trustedProxies: string[]
  databaseUrl: string | undefined
  databasePoolMax: number
  databaseSsl: boolean
  dataDir: string
  pgliteDir: string
  webDistDir: string | null
  migrationsDir: string
  storage: {
    driver: 'local' | 's3'
    encryptionKey: string | undefined
    oldEncryptionKeys: string[]
    s3: { endpoint?: string; region: string; bucket?: string; accessKeyId?: string; secretAccessKey?: string; forcePathStyle: boolean; prefix: string }
  }
  smtp: { host?: string; port: number; secure: boolean; user?: string; pass?: string; from: string }
  features: { signup: boolean; signupCaptcha: boolean; collab: boolean; emailVerification: boolean; passkeys: boolean; publicSharing: boolean; errorReporting: boolean }
  errorReports: { dsn: string | undefined; environment: string }
  signupCaptchaDifficulty: number
  passkey: { rpId: string; rpName: string }
  adminEmails: string[]
  storageQuotaBytes: number
  maxProjectsFree: number
  legal: { imprintUrl: string; privacyUrl: string; termsUrl: string; dpaUrl: string }
  logLevel: string
  rateLimit: boolean
  jobsEnabled: boolean
  collabPath: string
  collabMaxMessageBytes: number
  collabMaxDocBytes: number
  visitorEgressBytesPerHour: number
  blockedEmailDomains: string[]
}

const HERE = dirname(fileURLToPath(import.meta.url))

/** apps/server — works from src/ (tsx), src/<dir>/ and dist/ (bundled). */
function serverRoot(): string {
  for (const c of [resolve(HERE, '..'), resolve(HERE, '../..'), process.cwd()]) {
    if (existsSync(join(c, 'package.json')) && existsSync(join(c, 'drizzle'))) return c
  }
  return resolve(HERE, '..')
}

function readVersion(root: string): string {
  try {
    return (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: string }).version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/** Dev-only: persist a random auth secret so sessions survive restarts. Never used in production. */
function devSecret(dataDir: string): string {
  const file = join(dataDir, '.dev-auth-secret')
  if (existsSync(file)) return readFileSync(file, 'utf8').trim()
  mkdirSync(dataDir, { recursive: true })
  const secret = randomBytes(32).toString('base64url')
  writeFileSync(file, secret, { mode: 0o600 })
  return secret
}

function validKey(b64: string | undefined): boolean {
  if (!b64) return true
  try {
    return Buffer.from(b64, 'base64').length === 32
  } catch {
    return false
  }
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(source)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`Invalid environment: ${issues}`)
  }
  const e = parsed.data
  const isProd = e.NODE_ENV === 'production'
  const isTest = e.NODE_ENV === 'test'
  const root = serverRoot()
  const abs = (p: string) => (isAbsolute(p) ? p : resolve(process.cwd(), p))
  const dataDir = abs(e.DATA_DIR ?? join(root, 'data'))

  const publicUrl = (e.PUBLIC_URL ?? (isProd ? '' : 'http://localhost:5173')).replace(/\/+$/, '')
  const problems: string[] = []
  if (!publicUrl) problems.push('PUBLIC_URL is required in production')
  else if (isProd && !publicUrl.startsWith('https://')) problems.push('PUBLIC_URL must be https:// in production')
  if (isProd && (!e.BETTER_AUTH_SECRET || e.BETTER_AUTH_SECRET.length < 32)) problems.push('BETTER_AUTH_SECRET (≥ 32 chars) is required in production')
  if (e.BETTER_AUTH_SECRET && e.BETTER_AUTH_SECRET.length < 32) problems.push('BETTER_AUTH_SECRET must be at least 32 characters')
  if (!validKey(e.STORAGE_ENCRYPTION_KEY)) problems.push('STORAGE_ENCRYPTION_KEY must be 32 bytes, base64-encoded')
  for (const k of e.STORAGE_ENCRYPTION_OLD_KEYS) if (!validKey(k)) problems.push('STORAGE_ENCRYPTION_OLD_KEYS entries must be 32 bytes, base64-encoded')
  if (e.STORAGE_DRIVER === 's3' && (!e.S3_BUCKET || !e.S3_ENDPOINT || !e.S3_ACCESS_KEY_ID || !e.S3_SECRET_ACCESS_KEY))
    problems.push('STORAGE_DRIVER=s3 requires S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY')
  if (isProd && e.EMAIL_VERIFICATION && !e.SMTP_HOST) problems.push('SMTP_HOST is required in production while EMAIL_VERIFICATION=true')
  if (problems.length) throw new Error(`Invalid configuration:\n  - ${problems.join('\n  - ')}`)

  const origin = new URL(publicUrl).origin
  const selfOrigins = isProd ? [] : [`http://localhost:${e.PORT}`, `http://127.0.0.1:${e.PORT}`, 'http://localhost:5173', 'http://localhost:4173']
  const trustedOrigins = [...new Set([origin, ...e.TRUSTED_ORIGINS.map((o) => new URL(o).origin), ...selfOrigins])]

  const webDist = e.WEB_DIST_DIR ? abs(e.WEB_DIST_DIR) : resolve(root, '../web/dist')
  const migrationsDir = e.MIGRATIONS_DIR ? abs(e.MIGRATIONS_DIR) : join(root, 'drizzle')

  return {
    env: e.NODE_ENV,
    isProd,
    isTest,
    version: readVersion(root),
    port: e.PORT,
    host: e.HOST,
    publicUrl,
    authSecret: e.BETTER_AUTH_SECRET ?? (isTest ? 'test-secret-test-secret-test-secret-0000' : devSecret(dataDir)),
    trustedOrigins,
    trustProxy: e.TRUST_PROXY,
    trustedProxies: e.TRUSTED_PROXIES,
    databaseUrl: e.DATABASE_URL,
    databasePoolMax: e.DATABASE_POOL_MAX,
    databaseSsl: e.DATABASE_SSL,
    dataDir,
    pgliteDir: e.PGLITE_DIR?.startsWith('memory://') ? e.PGLITE_DIR : abs(e.PGLITE_DIR ?? join(dataDir, 'pglite')),
    webDistDir: existsSync(join(webDist, 'index.html')) ? webDist : null,
    migrationsDir,
    storage: {
      driver: e.STORAGE_DRIVER,
      encryptionKey: e.STORAGE_ENCRYPTION_KEY,
      oldEncryptionKeys: e.STORAGE_ENCRYPTION_OLD_KEYS,
      s3: {
        endpoint: e.S3_ENDPOINT,
        region: e.S3_REGION,
        bucket: e.S3_BUCKET,
        accessKeyId: e.S3_ACCESS_KEY_ID,
        secretAccessKey: e.S3_SECRET_ACCESS_KEY,
        forcePathStyle: e.S3_FORCE_PATH_STYLE,
        prefix: e.S3_PREFIX,
      },
    },
    smtp: { host: e.SMTP_HOST, port: e.SMTP_PORT, secure: e.SMTP_SECURE, user: e.SMTP_USER, pass: e.SMTP_PASS, from: e.MAIL_FROM },
    features: {
      signup: e.SIGNUP_ENABLED,
      signupCaptcha: e.SIGNUP_CAPTCHA,
      collab: e.COLLAB_ENABLED,
      emailVerification: e.EMAIL_VERIFICATION,
      passkeys: true,
      publicSharing: e.PUBLIC_SHARING,
      errorReporting: !!e.SENTRY_DSN,
    },
    errorReports: { dsn: e.SENTRY_DSN, environment: e.SENTRY_ENVIRONMENT ?? e.NODE_ENV },
    signupCaptchaDifficulty: e.SIGNUP_CAPTCHA_DIFFICULTY,
    passkey: { rpId: e.PASSKEY_RP_ID ?? new URL(publicUrl).hostname, rpName: e.PASSKEY_RP_NAME },
    adminEmails: e.ADMIN_EMAILS.map((m) => m.toLowerCase()),
    storageQuotaBytes: e.STORAGE_QUOTA_BYTES,
    maxProjectsFree: e.MAX_PROJECTS_FREE,
    legal: { imprintUrl: e.LEGAL_IMPRINT_URL, privacyUrl: e.LEGAL_PRIVACY_URL, termsUrl: e.LEGAL_TERMS_URL, dpaUrl: e.LEGAL_DPA_URL },
    logLevel: e.LOG_LEVEL,
    rateLimit: e.RATE_LIMIT,
    jobsEnabled: e.JOBS_ENABLED,
    collabPath: '/collab',
    collabMaxMessageBytes: e.COLLAB_MAX_MESSAGE_BYTES,
    collabMaxDocBytes: e.COLLAB_MAX_DOC_BYTES,
    visitorEgressBytesPerHour: e.VISITOR_EGRESS_BYTES_PER_HOUR,
    blockedEmailDomains: e.BLOCKED_EMAIL_DOMAINS.map((x) => x.toLowerCase()),
  }
}
