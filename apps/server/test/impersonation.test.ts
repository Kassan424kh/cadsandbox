// Admin impersonation vs. project content (privacy by design): metadata stays visible, content only
// through the impersonated user's own support grant and then read-only; every access is audited;
// sharing, export, deletion and credential changes are refused.
import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import * as Y from 'yjs'
import { docNames } from '@cadsandbox/shared'
import { decideCollabAccess, stillAllowed } from '../src/collab/auth'
import { auditLog } from '../src/db/schema'
import { sha256, testServer, type TestServer, type TestUser } from './helpers'

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(200)])

let s: TestServer
let alice: TestUser
let admin: TestUser
let pid: string
let hash: string
let versionId: string
/** Cookie of admin's impersonation session acting as alice. */
let imp: string

function mergeCookies(base: string, res: Response): string {
  const jar = new Map(base.split('; ').map((c) => c.split('=') as [string, string]))
  for (const c of res.headers.getSetCookie()) {
    const [k, v] = c.split(';')[0]!.split('=') as [string, string]
    jar.set(k, v)
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
}

const auditRows = (action: string) => s.deps.db.select().from(auditLog).where(and(eq(auditLog.action, action), eq(auditLog.actorId, admin.id)))
const decide = (docName: string, cookie: string) =>
  decideCollabAccess({ db: s.deps.db, auth: s.deps.auth, publicSharing: true, grants: s.deps.grants }, { documentName: docName, headers: new Headers({ cookie }), token: null })

beforeAll(async () => {
  s = await testServer()
  alice = await s.signup('alice-imp@example.com', 'Alice')
  admin = await s.signup('admin-imp@example.com', 'Admin')
  await s.setRole(admin.id, 'admin')
  pid = (await s.json('POST', '/api/projects', { cookie: alice.cookie, json: { name: 'Private plans' } })).body.id
  // Content: a document, a blob, a thumbnail and a named version.
  await s.deps.collab.transact(docNames.file(pid, 'f1'), (doc: Y.Doc) => doc.getMap('nodes').set('a', { id: 'a', name: 'Wall' }))
  hash = await sha256(PNG)
  expect((await s.req('PUT', `/api/projects/${pid}/blobs/${hash}`, { cookie: alice.cookie, body: PNG })).status).toBe(201)
  expect((await s.req('PUT', `/api/projects/${pid}/thumbnail`, { cookie: alice.cookie, body: PNG })).status).toBe(200)
  const v = await s.json('POST', `/api/projects/${pid}/versions`, { cookie: alice.cookie, json: { docName: docNames.file(pid, 'f1'), name: 'v1' } })
  expect(v.status).toBe(201)
  versionId = v.body.id
  const r = await s.req('POST', '/api/auth/admin/impersonate-user', { cookie: admin.cookie, json: { userId: alice.id } })
  expect(r.status).toBe(200)
  imp = mergeCookies(admin.cookie, r)
  expect((await s.json('GET', '/api/me', { cookie: imp })).body.user.id).toBe(alice.id)
})
afterAll(() => s.close())

describe('impersonation without a support grant', () => {
  it('shows project metadata but no content previews', async () => {
    const list = await s.json('GET', '/api/projects', { cookie: imp })
    expect(list.status).toBe(200)
    expect(list.body.items).toMatchObject([{ id: pid, name: 'Private plans', thumbnailUrl: null }])
    const one = await s.json('GET', `/api/projects/${pid}`, { cookie: imp })
    expect(one.status).toBe(200)
    expect(one.body).toMatchObject({ id: pid, role: 'viewer', thumbnailUrl: null })
    expect((await s.req('GET', `/api/projects/${pid}/members`, { cookie: imp })).status).toBe(200)
    expect((await s.req('GET', `/api/projects/${pid}/links`, { cookie: imp })).status).toBe(200)
  })

  it('refuses every kind of content with a clear reason and audits the attempts', async () => {
    const blocked = [
      ['GET', `/api/projects/${pid}/thumbnail`],
      ['GET', `/api/projects/${pid}/blobs/${hash}`],
      ['GET', `/api/projects/${pid}/versions?docName=${encodeURIComponent(docNames.file(pid, 'f1'))}`],
      ['GET', `/api/projects/${pid}/versions/${versionId}`],
    ] as const
    for (const [method, path] of blocked) {
      const r = await s.json(method, path, { cookie: imp })
      expect(r.status, path).toBe(403)
      expect(r.body.error.details).toEqual({ reason: 'impersonation' })
      expect(r.body.error.message).toMatch(/impersonat/i)
    }
    const comment = await s.json('POST', `/api/projects/${pid}/comments`, { cookie: imp, json: { docName: docNames.file(pid, 'f1'), text: 'hi', anchor: {} } })
    expect(comment.status).toBe(403)
    expect(await decide(docNames.file(pid, 'f1'), imp)).toMatchObject({ ok: false, reason: 'impersonation', projectId: pid, userId: alice.id, impersonatedBy: admin.id })
    expect(await decide(docNames.manifest(pid), imp)).toMatchObject({ ok: false, reason: 'impersonation' })
    const denied = await auditRows('admin.impersonate.content_denied')
    expect(denied.length).toBeGreaterThanOrEqual(blocked.length)
    expect(denied.every((r) => r.targetId === pid)).toBe(true)
    expect(await auditRows('admin.impersonate.content')).toHaveLength(0)
  })

  it('blocks sharing changes, export, deletion and credential changes', async () => {
    const bob = await s.signup('bob-imp@example.com')
    const attempts: [string, string, unknown][] = [
      ['POST', `/api/projects/${pid}/members`, { email: bob.email, role: 'editor' }],
      ['POST', `/api/projects/${pid}/links`, { role: 'viewer' }],
      ['PATCH', `/api/projects/${pid}`, { visibility: 'public' }],
      ['POST', `/api/projects/${pid}/duplicate`, {}],
      ['DELETE', `/api/projects/${pid}/permanent`, undefined],
      ['GET', '/api/me/export', undefined],
      ['DELETE', '/api/me', { confirmEmail: alice.email }],
      ['GET', '/api/collections/x/items', undefined],
    ]
    for (const [method, path, json] of attempts) {
      const r = await s.json(method, path, { cookie: imp, json })
      expect(r.status, `${method} ${path}`).toBe(403)
      expect(r.body.error.details, `${method} ${path}`).toEqual({ reason: 'impersonation' })
    }
    for (const path of ['/api/auth/change-password', '/api/auth/two-factor/enable', '/api/auth/organization/invite-member', '/api/auth/revoke-session']) {
      expect((await s.req('POST', path, { cookie: imp, json: { password: 'x', currentPassword: 'x', newPassword: 'y'.repeat(12), email: bob.email, role: 'member', token: 'x' } })).status, path).toBe(403)
    }
    // Metadata edits stay possible (support can tidy up a dashboard) — and nothing above happened.
    expect((await s.req('PATCH', `/api/projects/${pid}`, { cookie: imp, json: { name: 'Private plans' } })).status).toBe(200)
    const own = await s.json('GET', `/api/projects/${pid}`, { cookie: alice.cookie })
    expect(own.body.visibility).toBe('private')
    expect((await s.json('GET', `/api/projects/${pid}/members`, { cookie: alice.cookie })).body).toHaveLength(1)
  })
})

describe('impersonation with the user’s support grant', () => {
  let ticketId: string

  it('allows read-only content access, auditing every access', async () => {
    // The user (not the impersonating admin) grants support access in a ticket.
    expect((await s.req('POST', '/api/support/tickets', { cookie: imp, json: { subject: 'Help', message: 'x', projectId: pid, grantAccessDays: 1 } })).status).toBe(403)
    const t = await s.json('POST', '/api/support/tickets', { cookie: alice.cookie, json: { subject: 'Walls look odd', message: 'please check', projectId: pid, grantAccessDays: 1 } })
    expect(t.status).toBe(201)
    ticketId = t.body.id

    const before = (await auditRows('admin.impersonate.content')).length
    expect((await s.req('GET', `/api/projects/${pid}/thumbnail`, { cookie: imp })).status).toBe(200)
    expect((await s.req('GET', `/api/projects/${pid}/blobs/${hash}`, { cookie: imp })).status).toBe(200)
    expect((await s.req('GET', `/api/projects/${pid}/blobs/${hash}`, { cookie: imp })).status).toBe(200)
    expect((await s.req('GET', `/api/projects/${pid}/versions/${versionId}`, { cookie: imp })).status).toBe(200)
    // Still read-only.
    const write = await s.json('POST', `/api/projects/${pid}/versions`, { cookie: imp, json: { docName: docNames.file(pid, 'f1'), name: 'x' } })
    expect(write.status).toBe(403)
    expect(write.body.error.details).toEqual({ reason: 'impersonation' })
    expect((await s.req('PUT', `/api/projects/${pid}/blobs/${await sha256('new')}`, { cookie: imp, body: 'new' })).status).toBe(403)
    // Every allowed access is audited (no de-duplication), with admin as actor and the user in meta.
    const rows = await auditRows('admin.impersonate.content')
    expect(rows.length - before).toBe(4)
    expect(rows.every((r) => r.targetId === pid && (r.meta as { impersonatedUserId?: string }).impersonatedUserId === alice.id)).toBe(true)

    const d = await decide(docNames.file(pid, 'f1'), imp)
    expect(d).toMatchObject({ ok: true, readOnly: true, context: { via: 'impersonation', role: 'viewer', impersonatedBy: admin.id } })
    if (!d.ok) throw new Error('expected access')
    const deps = { db: s.deps.db, publicSharing: true, grants: s.deps.grants }
    expect(await stillAllowed(deps, d.context, true)).toBe(true)
    expect(await stillAllowed(deps, d.context, false)).toBe(false)

    // The user revokes → content is gone again, live connections must close.
    expect((await s.req('POST', `/api/support/tickets/${ticketId}/revoke-access`, { cookie: alice.cookie, json: {} })).status).toBe(200)
    expect(await stillAllowed(deps, d.context, true)).toBe(false)
    expect((await s.req('GET', `/api/projects/${pid}/blobs/${hash}`, { cookie: imp })).status).toBe(403)
    // A support grant never extends the user's own normal access.
    expect((await s.json('GET', `/api/projects/${pid}`, { cookie: alice.cookie })).body.role).toBe('owner')
  })

  it('closes the impersonation session’s live connections when impersonation stops', async () => {
    const revoked: string[] = []
    const off = s.deps.events.on('session', (id) => revoked.push(id))
    const res = await s.req('POST', '/api/auth/admin/stop-impersonating', { cookie: imp, json: {} })
    off()
    expect(res.status).toBe(200)
    expect(revoked).toHaveLength(1)
    const stop = await auditRows('admin.impersonate.stop')
    expect(stop.at(-1)?.targetId).toBe(alice.id)
  })
})
