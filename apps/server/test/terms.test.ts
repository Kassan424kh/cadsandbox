import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { LEGAL } from '@cadsandbox/shared'
import { auditLog, user } from '../src/db/schema'
import { testServer, type TestServer } from './helpers'

let s: TestServer
beforeAll(async () => {
  s = await testServer()
})
afterAll(() => s.close())

const signUp = (email: string, extra: Record<string, unknown>) =>
  s.json('POST', '/api/auth/sign-up/email', { json: { email, password: 'correct-horse-battery-staple', name: 'T', ...extra } })

describe('terms of service acceptance', () => {
  it('refuses sign-up without the current terms version', async () => {
    expect((await signUp('terms-none@example.com', {})).status).toBe(400)
    expect((await signUp('terms-old@example.com', { termsVersion: '1999-01-01' })).status).toBe(400)
    expect(await s.deps.db.select().from(user).where(eq(user.email, 'terms-none@example.com'))).toHaveLength(0)
  })

  it('records version and time at sign-up and reports them in /api/me', async () => {
    const before = Date.now()
    const u = await s.signup('terms-ok@example.com')
    const [row] = await s.deps.db.select().from(user).where(eq(user.id, u.id))
    expect(row!.termsVersion).toBe(LEGAL.termsVersion)
    expect(row!.termsAcceptedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000)
    const [entry] = await s.deps.db.select().from(auditLog).where(and(eq(auditLog.action, 'auth.signup'), eq(auditLog.targetId, u.id)))
    expect(entry!.meta).toMatchObject({ termsVersion: LEGAL.termsVersion })
    const me = await s.json('GET', '/api/me', { cookie: u.cookie })
    expect(me.body.termsAcceptedVersion).toBe(LEGAL.termsVersion)
    // The record cannot be rewritten through the profile endpoint.
    expect((await s.json('POST', '/api/auth/update-user', { cookie: u.cookie, json: { termsVersion: 'x' } })).status).toBe(400)
  })

  it('lets existing users accept changed terms, with an audit entry', async () => {
    const u = await s.signup('terms-later@example.com')
    await s.deps.db.update(user).set({ termsVersion: null, termsAcceptedAt: null }).where(eq(user.id, u.id))
    expect((await s.json('GET', '/api/me', { cookie: u.cookie })).body.termsAcceptedVersion).toBeNull()
    expect((await s.json('POST', '/api/me/terms', { cookie: u.cookie, json: { version: 'old' } })).status).toBe(400)
    const ok = await s.json('POST', '/api/me/terms', { cookie: u.cookie, json: { version: LEGAL.termsVersion } })
    expect(ok.status).toBe(200)
    expect(ok.body.termsAcceptedVersion).toBe(LEGAL.termsVersion)
    const entries = await s.deps.db.select().from(auditLog).where(and(eq(auditLog.action, 'account.terms.accept'), eq(auditLog.actorId, u.id)))
    expect(entries).toHaveLength(1)
  })
})
