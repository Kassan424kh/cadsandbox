import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { projectMembers, shareLinks } from '../src/db/schema'
import { hashToken } from '../src/lib/crypto'
import { ShareGrants } from '../src/services/share-grants'
import { sha256, testServer, type TestServer, type TestUser } from './helpers'

let s: TestServer
let owner: TestUser
let guest: TestUser
let pid: string

beforeAll(async () => {
  s = await testServer()
  owner = await s.signup('owner@example.com')
  guest = await s.signup('guest@example.com')
  const r = await s.json('POST', '/api/projects', { cookie: owner.cookie, json: { name: 'Shared' } })
  pid = r.body.id
})
afterAll(() => s.close())

describe('share links', () => {
  it('stores only a sha256 of the token and returns it once', async () => {
    const r = await s.json('POST', `/api/projects/${pid}/links`, { cookie: owner.cookie, json: { role: 'editor' } })
    expect(r.status).toBe(201)
    const token: string = r.body.token
    expect(token).toMatch(/^[\w-]{43}$/)
    const [row] = await s.deps.db.select().from(shareLinks).where(eq(shareLinks.id, r.body.id))
    expect(row!.tokenHash).toBe(hashToken(token))
    expect(JSON.stringify(row)).not.toContain(token)
    const list = await s.json('GET', `/api/projects/${pid}/links`, { cookie: owner.cookie })
    expect(list.body[0].token).toBe('')
    // Owner creating a link on a private project enables link sharing.
    const p = await s.json('GET', `/api/projects/${pid}`, { cookie: owner.cookie })
    expect(p.body.visibility).toBe('link')
  })

  it('guests accept viewer links without a session and read with the token (no member row)', async () => {
    const link = await s.json('POST', `/api/projects/${pid}/links`, { cookie: owner.cookie, json: { role: 'viewer' } })
    const acc = await s.json('POST', `/api/share/${link.body.token}/accept`)
    expect(acc.status).toBe(200)
    expect(acc.body).toEqual({ projectId: pid, role: 'viewer' })
    const rows = await s.deps.db.select().from(projectMembers).where(eq(projectMembers.linkId, link.body.id))
    expect(rows).toHaveLength(0)
    const hdr = await s.json('GET', `/api/projects/${pid}`, { headers: { 'x-share-token': link.body.token } })
    expect(hdr.status).toBe(200)
    expect(hdr.body.role).toBe('viewer')
    const q = await s.json('GET', `/api/projects/${pid}?token=${link.body.token}`)
    expect(q.body.role).toBe('viewer')
    const data = Buffer.from('guest-visible-bytes')
    const hash = await sha256(data)
    await s.req('PUT', `/api/projects/${pid}/blobs/${hash}`, { cookie: owner.cookie, body: data })
    const blob = await s.req('GET', `/api/projects/${pid}/blobs/${hash}`, { headers: { 'x-share-token': link.body.token } })
    expect(Buffer.from(await blob.arrayBuffer()).equals(data)).toBe(true)
    expect((await s.req('GET', `/api/projects/${pid}/blobs/${hash}`)).status).toBe(404)
    // Tokens never authorise writes.
    const write = await s.req('PATCH', `/api/projects/${pid}`, { headers: { 'x-share-token': link.body.token }, json: { name: 'hacked' } })
    expect(write.status).toBe(401)
    const [row] = await s.deps.db.select().from(shareLinks).where(eq(shareLinks.id, link.body.id))
    expect(row!.uses).toBe(1)
  })

  it('editor/commenter links require sign-in — their raw tokens give guests nothing', async () => {
    for (const role of ['editor', 'commenter'] as const) {
      const link = await s.json('POST', `/api/projects/${pid}/links`, { cookie: owner.cookie, json: { role } })
      const acc = await s.json('POST', `/api/share/${link.body.token}/accept`)
      expect(acc.status).toBe(401)
      expect((await s.req('GET', `/api/projects/${pid}`, { headers: { 'x-share-token': link.body.token } })).status).toBe(404)
    }
  })

  it('password-protected viewer links: guests get a short-lived signed grant', async () => {
    const link = await s.json('POST', `/api/projects/${pid}/links`, { cookie: owner.cookie, json: { role: 'viewer', password: 'guest-pass' } })
    expect((await s.req('POST', `/api/share/${link.body.token}/accept`)).status).toBe(403)
    expect((await s.req('POST', `/api/share/${link.body.token}/accept`, { json: { password: 'wrong' } })).status).toBe(403)
    const acc = await s.json('POST', `/api/share/${link.body.token}/accept`, { json: { password: 'guest-pass' } })
    expect(acc.status).toBe(200)
    expect(acc.body).toMatchObject({ projectId: pid, role: 'viewer' })
    const grant: string = acc.body.grant
    expect(grant).toMatch(/^g1\.[\w-]+\.[\w-]+$/)
    const hours = (new Date(acc.body.grantExpiresAt).getTime() - Date.now()) / 3_600_000
    expect(hours).toBeGreaterThan(11.9)
    expect(hours).toBeLessThanOrEqual(12)
    // The grant works, the raw token alone does not (password would be bypassed).
    expect((await s.json('GET', `/api/projects/${pid}`, { headers: { 'x-share-token': grant } })).body.role).toBe('viewer')
    expect((await s.req('GET', `/api/projects/${pid}`, { headers: { 'x-share-token': link.body.token } })).status).toBe(404)
    // Tampering, expiry and link deletion all invalidate it.
    const [prefix, payload, sig] = grant.split('.') as [string, string, string]
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), exp: 4_102_444_800 })).toString('base64url')
    expect((await s.req('GET', `/api/projects/${pid}`, { headers: { 'x-share-token': `${prefix}.${forged}.${sig}` } })).status).toBe(404)
    const expired = new ShareGrants(s.deps.config.authSecret, -10).issue(link.body.id, pid, null).grant
    expect((await s.req('GET', `/api/projects/${pid}`, { headers: { 'x-share-token': expired } })).status).toBe(404)
    const otherKey = new ShareGrants('another-secret-another-secret-00000').issue(link.body.id, pid, null).grant
    expect((await s.req('GET', `/api/projects/${pid}`, { headers: { 'x-share-token': otherKey } })).status).toBe(404)
    await s.req('DELETE', `/api/projects/${pid}/links/${link.body.id}`, { cookie: owner.cookie })
    expect((await s.req('GET', `/api/projects/${pid}`, { headers: { 'x-share-token': grant } })).status).toBe(404)
  })

  it('grants never outlive their link', async () => {
    const expiresAt = new Date(Date.now() + 3600_000)
    const link = await s.json('POST', `/api/projects/${pid}/links`, { cookie: owner.cookie, json: { role: 'viewer', password: 'pw-1234', expiresAt: expiresAt.toISOString() } })
    const acc = await s.json('POST', `/api/share/${link.body.token}/accept`, { json: { password: 'pw-1234' } })
    expect(new Date(acc.body.grantExpiresAt).getTime()).toBeLessThanOrEqual(expiresAt.getTime())
  })

  it('accepting creates a membership with the link role; deleting the link revokes it', async () => {
    const link = await s.json('POST', `/api/projects/${pid}/links`, { cookie: owner.cookie, json: { role: 'commenter' } })
    const acc = await s.json('POST', `/api/share/${link.body.token}/accept`, { cookie: guest.cookie })
    expect(acc.status).toBe(200)
    expect(acc.body).toEqual({ projectId: pid, role: 'commenter' })
    const rows = await s.deps.db.select().from(projectMembers).where(eq(projectMembers.userId, guest.id))
    expect(rows.some((m) => m.linkId === link.body.id)).toBe(true)
    const before = await s.json('GET', `/api/projects/${pid}`, { cookie: guest.cookie })
    expect(before.body.role).toBe('commenter')
    const del = await s.req('DELETE', `/api/projects/${pid}/links/${link.body.id}`, { cookie: owner.cookie })
    expect(del.status).toBe(200)
    const after = await s.req('GET', `/api/projects/${pid}`, { cookie: guest.cookie })
    expect(after.status).toBe(404)
  })

  it('password-protected links require the right password', async () => {
    const link = await s.json('POST', `/api/projects/${pid}/links`, { cookie: owner.cookie, json: { role: 'viewer', password: 's3cret-pw' } })
    expect(link.body.hasPassword).toBe(true)
    const anon = await s.req('GET', `/api/projects/${pid}?token=${link.body.token}`)
    expect(anon.status).toBe(404)
    const wrong = await s.json('POST', `/api/share/${link.body.token}/accept`, { cookie: guest.cookie, json: { password: 'nope' } })
    expect(wrong.status).toBe(403)
    const right = await s.json('POST', `/api/share/${link.body.token}/accept`, { cookie: guest.cookie, json: { password: 's3cret-pw' } })
    expect(right.status).toBe(200)
    expect(right.body.role).toBe('viewer')
  })

  it('expired links and unknown tokens are rejected', async () => {
    const past = await s.json('POST', `/api/projects/${pid}/links`, { cookie: owner.cookie, json: { role: 'viewer', expiresAt: new Date(Date.now() - 60_000).toISOString() } })
    expect(past.status).toBe(400)
    const link = await s.json('POST', `/api/projects/${pid}/links`, { cookie: owner.cookie, json: { role: 'viewer', expiresAt: new Date(Date.now() + 60_000).toISOString() } })
    await s.deps.db.update(shareLinks).set({ expiresAt: new Date(Date.now() - 1) }).where(eq(shareLinks.id, link.body.id))
    const acc = await s.req('POST', `/api/share/${link.body.token}/accept`, { cookie: guest.cookie })
    expect(acc.status).toBe(404)
    expect((await s.req('POST', `/api/share/not-a-real-token-at-all-0000000000/accept`, { cookie: guest.cookie })).status).toBe(404)
    expect((await s.req('POST', `/api/share/${link.body.token}/accept`)).status).toBe(404)
  })

  it('share management requires share permission and is audited', async () => {
    const v = await s.json('POST', `/api/projects/${pid}/links`, { cookie: guest.cookie, json: { role: 'viewer' } })
    expect(v.status).toBe(403)
    const audit = await s.deps.db.query.auditLog.findMany()
    expect(audit.some((a) => a.action === 'project.share.link.create')).toBe(true)
    expect(audit.some((a) => a.action === 'project.share.link.accept')).toBe(true)
  })
})

describe('share accept rate limits', () => {
  let r: TestServer
  afterAll(() => r?.close())

  it('locks a password link after repeated wrong passwords (per link) without blocking popular links', async () => {
    r = await testServer({ RATE_LIMIT: 'true' })
    const o = await r.signup('rl-owner@example.com')
    const p = (await r.json('POST', '/api/projects', { cookie: o.cookie, json: { name: 'RL' } })).body.id
    const open = await r.json('POST', `/api/projects/${p}/links`, { cookie: o.cookie, json: { role: 'viewer' } })
    for (let i = 0; i < 12; i++) expect((await r.req('POST', `/api/share/${open.body.token}/accept`)).status).toBe(200)
    const pw = await r.json('POST', `/api/projects/${p}/links`, { cookie: o.cookie, json: { role: 'viewer', password: 'right-pw' } })
    for (let i = 0; i < 10; i++) expect((await r.req('POST', `/api/share/${pw.body.token}/accept`, { json: { password: `nope-${i}` } })).status).toBe(403)
    const locked = await r.req('POST', `/api/share/${pw.body.token}/accept`, { json: { password: 'right-pw' } })
    expect(locked.status).toBe(429)
    expect(locked.headers.get('retry-after')).toBeTruthy()
  })
})
