import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { auditLog, twoFactor, user } from '../src/db/schema'
import { testServer, type TestServer, type TestUser } from './helpers'

let s: TestServer
let alice: TestUser
let staff: TestUser
let admin: TestUser
let pid: string

beforeAll(async () => {
  s = await testServer()
  alice = await s.signup('alice@example.com', 'Alice')
  staff = await s.signup('staff@example.com', 'Staff')
  admin = await s.signup('admin@example.com', 'Admin')
  await s.setRole(staff.id, 'support')
  await s.setRole(admin.id, 'admin')
  pid = (await s.json('POST', '/api/projects', { cookie: alice.cookie, json: { name: 'Secret plans' } })).body.id
})
afterAll(() => s.close())

describe('support access', () => {
  it('staff see project content only with a user grant; access is audited and revocable', async () => {
    expect((await s.req('GET', `/api/projects/${pid}`, { cookie: staff.cookie })).status).toBe(404)
    const t = await s.json('POST', '/api/support/tickets', { cookie: alice.cookie, json: { subject: 'Broken wall', message: 'Please look', projectId: pid, grantAccessDays: 3 } })
    expect(t.status).toBe(201)
    expect(t.body.supportAccessUntil).not.toBeNull()
    const seen = await s.json('GET', `/api/projects/${pid}`, { cookie: staff.cookie })
    expect(seen.status).toBe(200)
    expect(seen.body.role).toBe('viewer')
    expect((await s.req('PATCH', `/api/projects/${pid}`, { cookie: staff.cookie, json: { starred: true } })).status).toBe(403)
    const entries = await s.deps.db.select().from(auditLog).where(eq(auditLog.action, 'support.project.access'))
    expect(entries[0]).toMatchObject({ actorId: staff.id, targetId: pid })
    const reply = await s.json('POST', `/api/admin/tickets/${t.body.id}/messages`, { cookie: staff.cookie, json: { body: 'On it' } })
    expect(reply.body.status).toBe('pending')
    expect(reply.body.messages.map((m: { staff: boolean }) => m.staff)).toEqual([false, true])
    const revoked = await s.json('POST', `/api/support/tickets/${t.body.id}/revoke-access`, { cookie: alice.cookie })
    expect(revoked.body.supportAccessUntil).toBeNull()
    expect((await s.req('GET', `/api/projects/${pid}`, { cookie: staff.cookie })).status).toBe(404)
  })

  it('granting access requires share permission on the project; tickets are private', async () => {
    const bob = await s.signup('bob@example.com')
    const r = await s.req('POST', '/api/support/tickets', { cookie: bob.cookie, json: { subject: 'Hi there', message: 'x', projectId: pid, grantAccessDays: 5 } })
    expect(r.status).toBe(404)
    const t = await s.json('POST', '/api/support/tickets', { cookie: alice.cookie, json: { subject: 'Another', message: 'y' } })
    expect((await s.req('GET', `/api/support/tickets/${t.body.id}`, { cookie: bob.cookie })).status).toBe(404)
    expect((await s.req('GET', `/api/support/tickets/${t.body.id}`, { cookie: staff.cookie })).status).toBe(200)
  })
})

describe('organisations (better-auth plugin + org grants)', () => {
  it('org members get projects created in the org space', async () => {
    const org = await s.json('POST', '/api/auth/organization/create', { cookie: alice.cookie, json: { name: 'Studio', slug: 'studio' } })
    expect(org.status).toBe(200)
    const orgId = org.body.id as string
    const bob = await s.signup('bob2@example.com')
    await s.setVerified(bob.id)
    const add = await s.deps.auth.api.addMember({ body: { userId: bob.id, organizationId: orgId, role: 'member' } })
    expect(add?.userId).toBe(bob.id)
    const p = await s.json('POST', '/api/projects', { cookie: alice.cookie, json: { name: 'Org project', orgId } })
    expect(p.body.orgId).toBe(orgId)
    const list = await s.json('GET', `/api/orgs/${orgId}/projects`, { cookie: bob.cookie })
    expect(list.body.map((x: { id: string; role: string }) => [x.id, x.role])).toEqual([[p.body.id, 'editor']])
    const me = await s.json('GET', '/api/me', { cookie: bob.cookie })
    expect(me.body.orgs).toMatchObject([{ id: orgId, role: 'member', memberCount: 2 }])
    const outsider = await s.signup('out@example.com')
    expect((await s.req('GET', `/api/orgs/${orgId}/projects`, { cookie: outsider.cookie })).status).toBe(404)
    const folder = await s.json('POST', '/api/folders', { cookie: bob.cookie, json: { name: 'F', orgId } })
    expect(folder.status).toBe(403)

    // Leaving (unlike remove-member, better-auth runs no org hooks here) must still be audited and
    // re-check the member's live collab connections right away.
    const changed: string[] = []
    const off = s.deps.events.on('user', (id) => changed.push(id))
    const leave = await s.req('POST', '/api/auth/organization/leave', { cookie: bob.cookie, json: { organizationId: orgId } })
    off()
    expect(leave.status).toBe(200)
    expect(changed).toContain(bob.id)
    const rows = await s.deps.db.select().from(auditLog).where(eq(auditLog.action, 'org.member.leave'))
    expect(rows.map((r) => [r.actorId, r.targetId])).toEqual([[bob.id, orgId]])
    expect((await s.req('GET', `/api/orgs/${orgId}/projects`, { cookie: bob.cookie })).status).toBe(404)
  })
})

describe('2FA and passkeys are wired', () => {
  it('enables TOTP with backup codes (audited) and admins can reset it', async () => {
    const r = await s.json('POST', '/api/auth/two-factor/enable', { cookie: alice.cookie, json: { password: 'correct-horse-battery-staple' } })
    expect(r.status).toBe(200)
    expect(r.body.totpURI).toMatch(/^otpauth:\/\/totp\//)
    expect(r.body.backupCodes).toHaveLength(10)
    expect(await s.deps.db.select().from(twoFactor).where(eq(twoFactor.userId, alice.id))).toHaveLength(1)
    expect((await s.deps.db.select().from(auditLog).where(eq(auditLog.action, 'auth.2fa.enable'))).length).toBe(1)
    await s.req('POST', `/api/admin/users/${alice.id}/reset-2fa`, { cookie: admin.cookie })
    expect(await s.deps.db.select().from(twoFactor).where(eq(twoFactor.userId, alice.id))).toHaveLength(0)
    const [u] = await s.deps.db.select().from(user).where(eq(user.id, alice.id))
    expect(u!.twoFactorEnabled).toBe(false)
  })

  it('issues passkey registration options for our relying party', async () => {
    const r = await s.json('GET', '/api/auth/passkey/generate-register-options', { cookie: alice.cookie })
    expect(r.status).toBe(200)
    expect(r.body.rp).toMatchObject({ id: 'localhost', name: 'CadSandbox' })
  })
})
