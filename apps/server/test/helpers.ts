// Test harness: full app on in-memory PGlite, temp blob dir, in-memory mailer, app.request() client.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { eq } from 'drizzle-orm'
import { createRuntime } from '../src/bootstrap'
import { user } from '../src/db/schema'
import type { Deps } from '../src/deps'
import { loadConfig } from '../src/env'
import { createApp } from '../src/http/app'
import { startScheduler, type Scheduler } from '../src/jobs/scheduler'
import { MemoryMailer } from '../src/mail/mailer'

export const ORIGIN = 'http://localhost:8787'

export interface ReqOpts {
  cookie?: string
  json?: unknown
  body?: RequestInit["body"]
  headers?: Record<string, string>
  /** Origin header; null = omit. Defaults to the trusted test origin. */
  origin?: string | null
}

export interface TestUser {
  id: string
  email: string
  cookie: string
}

export interface TestServer {
  deps: Deps
  mailer: MemoryMailer
  scheduler: Scheduler
  req(method: string, path: string, opts?: ReqOpts): Promise<Response>
  json<T = any>(method: string, path: string, opts?: ReqOpts): Promise<{ status: number; body: T; res: Response }>
  signup(email: string, name?: string): Promise<TestUser>
  setVerified(userId: string): Promise<void>
  setRole(userId: string, role: 'user' | 'support' | 'admin'): Promise<void>
  close(): Promise<void>
}

export async function testServer(env: Record<string, string> = {}): Promise<TestServer> {
  const dataDir = mkdtempSync(join(tmpdir(), 'csb-test-'))
  const config = loadConfig({
    NODE_ENV: 'test',
    DATA_DIR: dataDir,
    PGLITE_DIR: 'memory://',
    PUBLIC_URL: ORIGIN,
    EMAIL_VERIFICATION: 'false',
    RATE_LIMIT: 'false',
    JOBS_ENABLED: 'false',
    LOG_LEVEL: 'silent',
    ...env,
  })
  const log = pino({ level: 'silent' })
  const mailer = new MemoryMailer(log)
  const runtime = await createRuntime(config, { log, mailer })
  const app = createApp(runtime.deps)
  const scheduler = startScheduler(runtime.deps, { autoStart: false })

  const req = (method: string, path: string, o: ReqOpts = {}) => {
    const headers: Record<string, string> = { ...(o.headers ?? {}) }
    if (o.origin !== null) headers.origin = o.origin ?? ORIGIN
    if (o.cookie) headers.cookie = o.cookie
    let body = o.body
    if (o.json !== undefined) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(o.json)
    }
    return Promise.resolve(app.request(`http://localhost:8787${path}`, { method, headers, body }))
  }

  const server: TestServer = {
    deps: runtime.deps,
    mailer,
    scheduler,
    req,
    async json(method, path, opts) {
      const res = await req(method, path, opts)
      const text = await res.text()
      return { status: res.status, body: text ? JSON.parse(text) : null, res }
    },
    async signup(email, name = email.split('@')[0]!) {
      const res = await req('POST', '/api/auth/sign-up/email', { json: { email, password: 'correct-horse-battery-staple', name } })
      if (res.status !== 200) throw new Error(`signup failed ${res.status}: ${await res.text()}`)
      const body = (await res.json()) as { user: { id: string } }
      const cookie = res.headers
        .getSetCookie()
        .map((c) => c.split(';')[0]!)
        .join('; ')
      return { id: body.user.id, email, cookie }
    },
    async setVerified(userId) {
      await runtime.deps.db.update(user).set({ emailVerified: true }).where(eq(user.id, userId))
    },
    async setRole(userId, role) {
      await runtime.deps.db.update(user).set({ role }).where(eq(user.id, userId))
    },
    async close() {
      await scheduler.stop()
      await runtime.close()
      rmSync(dataDir, { recursive: true, force: true })
    },
  }
  return server
}

export async function sha256(data: Uint8Array | string): Promise<string> {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(data).digest('hex')
}
