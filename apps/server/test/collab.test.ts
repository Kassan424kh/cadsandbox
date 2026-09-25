import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import * as Y from 'yjs'
import { docNames } from '@cadsandbox/shared'
import type { CommentDef } from '@cadsandbox/doc'
import { decideCollabAccess, stillAllowed } from '../src/collab/auth'
import { projectMembers, tickets, supportGrants } from '../src/db/schema'
import { testServer, type TestServer, type TestUser } from './helpers'

let s: TestServer
let owner: TestUser
let editor: TestUser
let commenter: TestUser
let viewer: TestUser
let outsider: TestUser
let staff: TestUser
let pid: string

const decide = (documentName: string, cookie?: string, token: string | null = null) =>
  decideCollabAccess({ db: s.deps.db, auth: s.deps.auth, publicSharing: true, grants: s.deps.grants }, { documentName, headers: new Headers(cookie ? { cookie } : {}), token })

beforeAll(async () => {
  s = await testServer()
  owner = await s.signup('owner@example.com', 'Owner')
  editor = await s.signup('editor@example.com', 'Editor')
  commenter = await s.signup('commenter@example.com', 'Commenter')
  viewer = await s.signup('viewer@example.com', 'Viewer')
  outsider = await s.signup('outsider@example.com')
  staff = await s.signup('staff@example.com')
  await s.setRole(staff.id, 'support')
  for (const u of [editor, commenter, viewer]) await s.setVerified(u.id)
  pid = (await s.json('POST', '/api/projects', { cookie: owner.cookie, json: { name: 'Collab' } })).body.id
  for (const [u, role] of [
    [editor, 'editor'],
    [commenter, 'commenter'],
    [viewer, 'viewer'],
  ] as const) {
    const r = await s.json('POST', `/api/projects/${pid}/members`, { cookie: owner.cookie, json: { email: u.email, role } })
    expect(r.body.status).toBe('added')
  }
})
afterAll(() => s.close())

describe('collab onAuthenticate decisions', () => {
  it('rejects malformed document names', async () => {
    expect(await decide('project:../../etc', owner.cookie)).toEqual({ ok: false, reason: 'bad-document' })
    expect(await decide('whatever', owner.cookie)).toEqual({ ok: false, reason: 'bad-document' })
  })

  it('maps roles to read-only / read-write connections', async () => {
    const doc = docNames.file(pid, 'main')
    const o = await decide(doc, owner.cookie)
    expect(o).toMatchObject({ ok: true, readOnly: false, context: { role: 'owner', userId: owner.id, projectId: pid } })
    expect(await decide(doc, editor.cookie)).toMatchObject({ ok: true, readOnly: false })
    expect(await decide(doc, commenter.cookie)).toMatchObject({ ok: true, readOnly: true })
    expect(await decide(docNames.manifest(pid), viewer.cookie)).toMatchObject({ ok: true, readOnly: true })
    expect(await decide(doc, outsider.cookie)).toEqual({ ok: false, reason: 'forbidden' })
    expect(await decide(doc)).toEqual({ ok: false, reason: 'forbidden' })
    expect(await decide(docNames.file('nonexistent', 'x'), owner.cookie)).toEqual({ ok: false, reason: 'forbidden' })
  })

  it('anonymous viewers via public visibility, viewer-link token or signed grant are read-only', async () => {
    const link = await s.json('POST', `/api/projects/${pid}/links`, { cookie: owner.cookie, json: { role: 'viewer' } })
    const viaToken = await decide(docNames.manifest(pid), undefined, link.body.token)
    expect(viaToken).toMatchObject({ ok: true, readOnly: true, context: { via: 'link', userId: null } })
    const editorLink = await s.json('POST', `/api/projects/${pid}/links`, { cookie: owner.cookie, json: { role: 'editor' } })
    expect(await decide(docNames.manifest(pid), undefined, editorLink.body.token)).toEqual({ ok: false, reason: 'forbidden' })
    const pw = await s.json('POST', `/api/projects/${pid}/links`, { cookie: owner.cookie, json: { role: 'viewer', password: 'collab-pw' } })
    expect(await decide(docNames.manifest(pid), undefined, pw.body.token)).toEqual({ ok: false, reason: 'forbidden' })
    const acc = await s.json('POST', `/api/share/${pw.body.token}/accept`, { json: { password: 'collab-pw' } })
    const viaGrant = await decide(docNames.manifest(pid), undefined, acc.body.grant)
    expect(viaGrant).toMatchObject({ ok: true, readOnly: true, context: { via: 'link', userId: null } })
    // Live grant connections are dropped once the link is deleted.
    if (!viaGrant.ok) throw new Error('expected access')
    await s.req('DELETE', `/api/projects/${pid}/links/${pw.body.id}`, { cookie: owner.cookie })
    expect(await stillAllowed({ db: s.deps.db, publicSharing: true, grants: s.deps.grants }, viaGrant.context, true)).toBe(false)
    await s.json('PATCH', `/api/projects/${pid}`, { cookie: owner.cookie, json: { visibility: 'public' } })
    expect(await decide(docNames.manifest(pid))).toMatchObject({ ok: true, readOnly: true, context: { via: 'public' } })
    await s.json('PATCH', `/api/projects/${pid}`, { cookie: owner.cookie, json: { visibility: 'private' } })
    expect(await decide(docNames.manifest(pid), undefined, link.body.token)).toEqual({ ok: false, reason: 'forbidden' })
  })

  it('support staff only with a valid grant, always read-only', async () => {
    expect(await decide(docNames.manifest(pid), staff.cookie)).toEqual({ ok: false, reason: 'forbidden' })
    await s.deps.db.insert(tickets).values({ id: 'tk', userId: owner.id, subject: 'help' })
    await s.deps.db.insert(supportGrants).values({ id: 'sg', ticketId: 'tk', projectId: pid, grantedBy: owner.id, expiresAt: new Date(Date.now() + 3600_000) })
    expect(await decide(docNames.manifest(pid), staff.cookie)).toMatchObject({ ok: true, readOnly: true, context: { via: 'support' } })
  })

  it('live connections are re-checked after access changes', async () => {
    const d = await decide(docNames.manifest(pid), editor.cookie)
    if (!d.ok) throw new Error('expected access')
    const deps = { db: s.deps.db, publicSharing: true }
    expect(await stillAllowed(deps, d.context, d.readOnly)).toBe(true)
    await s.json('PATCH', `/api/projects/${pid}/members/${editor.id}`, { cookie: owner.cookie, json: { role: 'viewer' } })
    expect(await stillAllowed(deps, d.context, false)).toBe(false) // must reconnect read-only
    expect(await stillAllowed(deps, d.context, true)).toBe(false) // role changed: client reopens with its new role
    const v = await decide(docNames.manifest(pid), editor.cookie)
    if (!v.ok) throw new Error('expected access')
    expect(v).toMatchObject({ readOnly: true, context: { role: 'viewer' } })
    expect(await stillAllowed(deps, v.context, true)).toBe(true)
    // Same read-only mode, different role (viewer → commenter): still closed so the client can comment.
    await s.json('PATCH', `/api/projects/${pid}/members/${editor.id}`, { cookie: owner.cookie, json: { role: 'commenter' } })
    expect(await stillAllowed(deps, v.context, true)).toBe(false)
    const cm = await decide(docNames.manifest(pid), editor.cookie)
    if (!cm.ok) throw new Error('expected access')
    expect(await stillAllowed(deps, cm.context, true)).toBe(true)
    await s.deps.db.delete(projectMembers).where(eq(projectMembers.userId, editor.id))
    expect(await stillAllowed(deps, cm.context, true)).toBe(false)
    // Logging out invalidates the session → connection must go.
    const o = await decide(docNames.manifest(pid), owner.cookie)
    if (!o.ok) throw new Error('expected access')
    await s.req('POST', '/api/auth/sign-out', { cookie: owner.cookie, json: {} })
    expect(await stillAllowed(deps, o.context, false)).toBe(false)
    owner = { ...owner, cookie: (await s.req('POST', '/api/auth/sign-in/email', { json: { email: owner.email, password: 'correct-horse-battery-staple' } })).headers.getSetCookie().map((c) => c.split(';')[0]).join('; ') }
  })
})

describe('versions & comments through direct connections', () => {
  const file = () => docNames.file(pid, 'f1')

  it('restores a version by syncing Y.Map roots (comments preserved)', async () => {
    await s.deps.collab.transact(file(), (doc) => {
      doc.getMap('nodes').set('a', { id: 'a', w: 1 })
      doc.getMap('nodes').set('b', { id: 'b', w: 2 })
      doc.getMap('meta').set('units', 'mm')
    })
    const v = await s.json('POST', `/api/projects/${pid}/versions`, { cookie: owner.cookie, json: { docName: file(), name: 'Baseline' } })
    expect(v.status).toBe(201)
    await s.deps.collab.transact(file(), (doc) => {
      doc.getMap('nodes').delete('a')
      doc.getMap('nodes').set('b', { id: 'b', w: 99 })
      doc.getMap('nodes').set('c', { id: 'c' })
      doc.getMap('comments').set('k1', { id: 'k1', text: 'keep me' })
    })
    const raw = await s.req('GET', `/api/projects/${pid}/versions/${v.body.id}`, { cookie: owner.cookie })
    expect(raw.headers.get('content-type')).toBe('application/octet-stream')
    const r = await s.json('POST', `/api/projects/${pid}/versions/${v.body.id}/restore`, { cookie: owner.cookie })
    expect(r.status).toBe(200)
    expect(r.body.backupVersionId).toBeTruthy()
    const doc = new Y.Doc()
    Y.applyUpdate(doc, (await s.deps.collab.getState(file()))!)
    expect(doc.getMap('nodes').toJSON()).toEqual({ a: { id: 'a', w: 1 }, b: { id: 'b', w: 2 } })
    expect(doc.getMap('meta').get('units')).toBe('mm')
    expect(doc.getMap('comments').get('k1')).toEqual({ id: 'k1', text: 'keep me' })
    const list = await s.json('GET', `/api/projects/${pid}/versions?docName=${encodeURIComponent(file())}`, { cookie: owner.cookie })
    expect(list.body.map((x: { name: string }) => x.name)).toEqual(['Before restoring "Baseline"', 'Baseline'])
  })

  it('commenters comment via REST; the change lands in the live doc', async () => {
    const c2 = await s.signup('c2@example.com', 'Cee')
    await s.setVerified(c2.id)
    await s.json('POST', `/api/projects/${pid}/members`, { cookie: owner.cookie, json: { email: c2.email, role: 'commenter' } })
    const add = await s.json('POST', `/api/projects/${pid}/comments`, { cookie: c2.cookie, json: { docName: file(), text: 'Door too narrow', anchor: { nodeId: 'a', point: [1, 2, 3] } } })
    expect(add.status).toBe(201)
    const reply = await s.json('POST', `/api/projects/${pid}/comments/${add.body.id}/replies`, { cookie: owner.cookie, json: { docName: file(), text: 'Fixed' } })
    expect(reply.status).toBe(201)
    const res = await s.json('PATCH', `/api/projects/${pid}/comments/${add.body.id}`, { cookie: c2.cookie, json: { docName: file(), resolved: true } })
    expect(res.body.resolved).toBe(true)
    const doc = new Y.Doc()
    Y.applyUpdate(doc, (await s.deps.collab.getState(file()))!)
    const c = doc.getMap<CommentDef>('comments').get(add.body.id)!
    expect(c).toMatchObject({ text: 'Door too narrow', resolved: true, author: { id: c2.id, name: 'Cee' }, anchor: { nodeId: 'a', point: [1, 2, 3] } })
    expect(c.author.color).toMatch(/^#[0-9a-f]{6}$/)
    expect(c.replies.map((x) => x.text)).toEqual(['Fixed'])
    expect((await s.req('POST', `/api/projects/${pid}/comments`, { cookie: viewer.cookie, json: { docName: file(), text: 'x', anchor: {} } })).status).toBe(403)
    expect((await s.req('POST', `/api/projects/${pid}/comments`, { json: { docName: file(), text: 'x', anchor: {} } })).status).toBe(401)
    expect((await s.req('POST', `/api/projects/${pid}/comments`, { cookie: c2.cookie, json: { docName: docNames.manifest(pid), text: 'x', anchor: {} } })).status).toBe(400)
  })
})
