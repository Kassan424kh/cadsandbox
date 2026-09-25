import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { auditLog, deletionRequests, projects, session, user } from '../src/db/schema'
import { testServer, type TestServer, type TestUser } from './helpers'

let s: TestServer
let admin: TestUser
let support: TestUser
let joe: TestUser

beforeAll(async () => {
  s = await testServer()
  admin = await s.signup('root@example.com', 'Root')
  support = await s.signup('help@example.com', 'Help')
  joe = await s.signup('joe@example.com', 'Joe')
  await s.setRole(admin.id, 'admin')
  await s.setRole(support.id, 'support')
})
afterAll(() => s.close())

describe('admin guard', () => {
  it('regular users are refused on every admin endpoint', async () => {
    for (const [m, p] of [
      ['GET', '/api/admin/stats'],
      ['GET', '/api/admin/users'],
      ['GET', `/api/admin/users/${admin.id}`],
      ['POST', `/api/admin/users/${admin.id}/ban`],
      ['GET', '/api/admin/audit'],
      ['GET', '/api/admin/projects'],
      ['POST', '/api/admin/announcements'],
    ] as const) {
      const r = await s.req(m, p, { cookie: joe.cookie, json: m === 'POST' ? {} : undefined })
      expect(r.status, `${m} ${p}`).toBe(403)
      expect((await s.req(m, p)).status, `${m} ${p} anonymous`).toBe(401)
    }
  })

  it('support staff can read users/stats but not administer', async () => {
    expect((await s.req('GET', '/api/admin/stats', { cookie: support.cookie })).status).toBe(200)
    const users = await s.json('GET', '/api/admin/users?q=joe', { cookie: support.cookie })
    expect(users.body.total).toBe(1)
    expect(users.body.items[0]).toMatchObject({ email: 'joe@example.com', banned: false, projectCount: 0 })
    expect((await s.req('POST', `/api/admin/users/${joe.id}/ban`, { cookie: support.cookie, json: {} })).status).toBe(403)
    expect((await s.req('GET', '/api/admin/audit', { cookie: support.cookie })).status).toBe(403)
  })

  it('stats include live collab counters', async () => {
    const r = await s.json('GET', '/api/admin/stats', { cookie: admin.cookie })
    expect(r.body).toMatchObject({ users: 3, collabConnections: 0, collabDocuments: 0 })
  })

  it('ban revokes sessions and is audited; unban restores login', async () => {
    const r = await s.json('POST', `/api/admin/users/${joe.id}/ban`, { cookie: admin.cookie, json: { reason: 'spam', expiresInDays: 7 } })
    expect(r.status).toBe(200)
    expect(r.body.banned).toBe(true)
    expect((await s.req('GET', '/api/me', { cookie: joe.cookie })).status).toBe(401)
    const login = await s.req('POST', '/api/auth/sign-in/email', { json: { email: 'joe@example.com', password: 'correct-horse-battery-staple' } })
    expect(login.status).toBe(403)
    const entries = await s.deps.db.select().from(auditLog).where(eq(auditLog.action, 'admin.user.ban'))
    expect(entries[0]).toMatchObject({ actorId: admin.id, targetId: joe.id })
    await s.req('POST', `/api/admin/users/${joe.id}/unban`, { cookie: admin.cookie })
    // User detail sessions match the web app's AdminSessionDTO (superset allowed).
    const detail = await s.json('GET', `/api/admin/users/${admin.id}`, { cookie: admin.cookie })
    const sess = detail.body.sessions[0]
    expect(Object.keys(sess)).toEqual(expect.arrayContaining(['id', 'ipAddress', 'userAgent', 'createdAt', 'expiresAt', 'impersonatedBy']))
    expect(typeof sess.id).toBe('string')
    expect(new Date(sess.createdAt).toISOString()).toBe(sess.createdAt)
    expect(new Date(sess.expiresAt).toISOString()).toBe(sess.expiresAt)
    expect(sess.impersonatedBy).toBeNull()
    const again = await s.req('POST', '/api/auth/sign-in/email', { json: { email: 'joe@example.com', password: 'correct-horse-battery-staple' } })
    expect(again.status).toBe(200)
  })

  it('role changes are validated; admins cannot demote themselves', async () => {
    expect((await s.req('POST', `/api/admin/users/${admin.id}/role`, { cookie: admin.cookie, json: { role: 'user' } })).status).toBe(400)
    expect((await s.req('POST', `/api/admin/users/${joe.id}/role`, { cookie: admin.cookie, json: { role: 'root' } })).status).toBe(400)
    const r = await s.json('POST', `/api/admin/users/${joe.id}/role`, { cookie: admin.cookie, json: { role: 'support' } })
    expect(r.body.role).toBe('support')
  })

  it('impersonation: admin only, audited, 1h max, blocked from sensitive actions', async () => {
    const target = await s.signup('imp@example.com')
    expect((await s.req('POST', '/api/auth/admin/impersonate-user', { cookie: support.cookie, json: { userId: target.id } })).status).toBe(403)
    const r = await s.req('POST', '/api/auth/admin/impersonate-user', { cookie: admin.cookie, json: { userId: target.id } })
    expect(r.status).toBe(200)
    const jar = new Map(admin.cookie.split('; ').map((c) => c.split('=') as [string, string]))
    for (const c of r.headers.getSetCookie()) {
      const [k, v] = c.split(';')[0]!.split('=') as [string, string]
      jar.set(k, v)
    }
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
    expect((await s.json('GET', '/api/me', { cookie })).body.user.id).toBe(target.id)
    expect((await s.req('GET', '/api/me/export', { cookie })).status).toBe(403)
    expect((await s.req('DELETE', '/api/me', { cookie, json: { confirmEmail: 'imp@example.com' } })).status).toBe(403)
    const sess = (await s.deps.db.select().from(session).where(eq(session.userId, target.id))).find((x) => x.impersonatedBy)
    expect(sess!.impersonatedBy).toBe(admin.id)
    expect(sess!.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(3600_000)
    const start = await s.deps.db.select().from(auditLog).where(eq(auditLog.action, 'admin.impersonate.start'))
    expect(start[0]).toMatchObject({ actorId: admin.id, targetId: target.id })
    expect((await s.req('POST', '/api/auth/admin/stop-impersonating', { cookie, json: {} })).status).toBe(200)
    const stop = await s.deps.db.select().from(auditLog).where(eq(auditLog.action, 'admin.impersonate.stop'))
    expect(stop[0]?.actorId).toBe(admin.id)
  })

  it('announcements CRUD and public listing', async () => {
    const a = await s.json('POST', '/api/admin/announcements', { cookie: admin.cookie, json: { message: 'Maintenance tonight', level: 'warning' } })
    expect(a.status).toBe(201)
    const pub = await s.json('GET', '/api/announcements')
    expect(pub.body.map((x: { id: string }) => x.id)).toContain(a.body.id)
    await s.req('DELETE', `/api/admin/announcements/${a.body.id}`, { cookie: admin.cookie })
    expect((await s.json('GET', '/api/announcements')).body).toHaveLength(0)
  })

  it('admin delete performs a GDPR hard delete and anonymises audit entries', async () => {
    const victim = await s.signup('gone@example.com')
    const p = await s.json('POST', '/api/projects', { cookie: victim.cookie, json: { name: 'Mine' } })
    const r = await s.json('DELETE', `/api/admin/users/${victim.id}`, { cookie: admin.cookie })
    expect(r.body).toMatchObject({ ok: true, deletedProjects: 1 })
    expect(await s.deps.db.select().from(user).where(eq(user.id, victim.id))).toHaveLength(0)
    expect(await s.deps.db.select().from(projects).where(eq(projects.id, p.body.id))).toHaveLength(0)
    expect(await s.deps.db.select().from(auditLog).where(eq(auditLog.actorId, victim.id))).toHaveLength(0)
    const audit = await s.json('GET', '/api/admin/audit?action=admin.user.delete', { cookie: admin.cookie })
    expect(audit.body.total).toBe(1)
  })

  it('self-service deletion is scheduled with a grace period, cancellable, then executed by the job', async () => {
    const u = await s.signup('leaver@example.com')
    expect((await s.req('DELETE', '/api/me', { cookie: u.cookie, json: { confirmEmail: 'wrong@example.com' } })).status).toBe(400)
    const del = await s.json('DELETE', '/api/me', { cookie: u.cookie, json: { confirmEmail: 'Leaver@example.com' } })
    const days = (new Date(del.body.deletionScheduledAt).getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(6.9)
    expect(s.mailer.sent.some((m) => m.to === 'leaver@example.com' && /deletion/i.test(m.subject))).toBe(true)
    await s.req('POST', '/api/me/cancel-deletion', { cookie: u.cookie })
    expect((await s.json('GET', '/api/me', { cookie: u.cookie })).body.deletionScheduledAt).toBeNull()
    await s.req('DELETE', '/api/me', { cookie: u.cookie, json: { confirmEmail: 'leaver@example.com' } })
    await s.deps.db.update(deletionRequests).set({ executeAfter: new Date(Date.now() - 1000) }).where(eq(deletionRequests.userId, u.id))
    await s.scheduler.run('account-deletions')
    expect(await s.deps.db.select().from(user).where(eq(user.id, u.id))).toHaveLength(0)
  })
})
