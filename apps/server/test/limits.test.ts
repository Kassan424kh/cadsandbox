import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { docNames, LEGAL } from '@cadsandbox/shared'
import { decideCollabAccess, stillAllowed } from '../src/collab/auth'
import { collabDocs, versions } from '../src/db/schema'
import { newId } from '../src/lib/crypto'
import { sha256, testServer, type TestServer, type TestUser } from './helpers'

const MiB = 1024 * 1024

describe('project limit', () => {
  let s: TestServer
  let u: TestUser
  beforeAll(async () => {
    s = await testServer({ MAX_PROJECTS_FREE: '2' })
    u = await s.signup('limit-projects@example.com')
  })
  afterAll(() => s.close())

  it('does not count trashed projects, but restoring one does', async () => {
    const a = await s.json('POST', '/api/projects', { cookie: u.cookie, json: { name: 'A' } })
    await s.json('POST', '/api/projects', { cookie: u.cookie, json: { name: 'B' } })
    const third = await s.json('POST', '/api/projects', { cookie: u.cookie, json: { name: 'C' } })
    expect(third.status).toBe(403)
    expect(third.body.error.code).toBe('quota_exceeded')
    expect((await s.json('DELETE', `/api/projects/${a.body.id}`, { cookie: u.cookie })).status).toBe(200)
    expect((await s.json('POST', '/api/projects', { cookie: u.cookie, json: { name: 'C' } })).status).toBe(201)
    expect((await s.json('POST', `/api/projects/${a.body.id}/restore`, { cookie: u.cookie })).status).toBe(403)
  })
})

describe('storage and size limits', () => {
  let s: TestServer
  let owner: TestUser
  let editor: TestUser
  beforeAll(async () => {
    s = await testServer({ STORAGE_QUOTA_BYTES: String(2 * MiB), COLLAB_MAX_DOC_BYTES: String(MiB), VISITOR_EGRESS_BYTES_PER_HOUR: String(MiB) })
    owner = await s.signup('limit-owner@example.com')
    editor = await s.signup('limit-editor@example.com')
    await s.setVerified(editor.id)
  })
  afterAll(() => s.close())

  const newProject = async (name: string) => (await s.json('POST', '/api/projects', { cookie: owner.cookie, json: { name } })).body.id as string
  const fakeDoc = (projectId: string, size: number) =>
    s.deps.db.insert(collabDocs).values({ name: docNames.file(projectId, newId()), projectId, state: new Uint8Array([0, 0]), size })
  const collab = (documentName: string, cookie: string) =>
    decideCollabAccess(
      { db: s.deps.db, auth: s.deps.auth, publicSharing: true, grants: s.deps.grants, limits: { storageQuotaBytes: 2 * MiB, maxDocBytes: MiB } },
      { documentName, headers: new Headers({ cookie }), token: null },
    )

  it('turns a project with an oversized design read-only for everyone', async () => {
    const pid = await newProject('Big design')
    await s.json('POST', `/api/projects/${pid}/members`, { cookie: owner.cookie, json: { email: editor.email, role: 'editor' } })
    expect((await s.json('GET', `/api/projects/${pid}`, { cookie: owner.cookie })).body.writeBlock).toBeNull()
    const before = await collab(docNames.manifest(pid), editor.cookie)
    expect(before.ok && before.readOnly).toBe(false)
    await fakeDoc(pid, MiB + 1)
    expect((await s.json('GET', `/api/projects/${pid}`, { cookie: editor.cookie })).body.writeBlock).toBe('design_too_large')
    const after = await collab(docNames.manifest(pid), editor.cookie)
    expect(after.ok && after.readOnly).toBe(true)
    // A live writable connection no longer matches → it is closed and reopened read-only.
    if (!before.ok) throw new Error('unreachable')
    expect(await stillAllowed({ db: s.deps.db, publicSharing: true, grants: s.deps.grants, limits: { storageQuotaBytes: 2 * MiB, maxDocBytes: MiB } }, before.context, false)).toBe(false)
    await s.deps.db.delete(collabDocs).where(eq(collabDocs.projectId, pid))
  })

  it('reports storage_full once the owner is out of storage', async () => {
    const pid = await newProject('Full')
    await fakeDoc(pid, MiB - 10)
    await fakeDoc(pid, MiB - 10)
    expect((await s.json('GET', `/api/projects/${pid}`, { cookie: owner.cookie })).body.writeBlock).toBeNull()
    await fakeDoc(pid, 100)
    expect((await s.json('GET', `/api/projects/${pid}`, { cookie: owner.cookie })).body.writeBlock).toBe('storage_full')
    await s.deps.db.delete(collabDocs).where(eq(collabDocs.projectId, pid))
  })

  it('charges library items to the owner quota', async () => {
    const col = await s.json('POST', '/api/collections', { cookie: owner.cookie, json: { name: 'Lib' } })
    const small = await s.json('POST', `/api/collections/${col.body.id}/items`, { cookie: owner.cookie, json: { name: 'x', kind: 'object', tags: [], payload: { a: 'x'.repeat(1000) }, assets: [] } })
    expect(small.status).toBe(201)
    const me = await s.json('GET', '/api/me', { cookie: owner.cookie })
    expect(me.body.storage.usedBytes).toBeGreaterThan(1000)
    const big = await s.json('POST', `/api/collections/${col.body.id}/items`, { cookie: owner.cookie, json: { name: 'y', kind: 'object', tags: [], payload: { a: 'x'.repeat(2 * MiB) }, assets: [] } })
    expect(big.status).toBe(403)
    expect(big.body.error.code).toBe('quota_exceeded')
  })

  it('caps named versions per file', async () => {
    const pid = await newProject('Versions')
    const docName = docNames.file(pid, 'f1')
    await s.deps.db.insert(versions).values(Array.from({ length: 100 }, (_, i) => ({ id: newId(), projectId: pid, docName, name: `v${i}`, auto: false, state: new Uint8Array([0, 0]) })))
    const r = await s.json('POST', `/api/projects/${pid}/versions`, { cookie: owner.cookie, json: { docName, name: 'one more' } })
    expect(r.status).toBe(409)
  })

  it('limits bytes served to visitors of public projects', async () => {
    const pid = await newProject('Public')
    await s.json('PATCH', `/api/projects/${pid}`, { cookie: owner.cookie, json: { visibility: 'public' } })
    const data = randomBytes(600 * 1024)
    const hash = await sha256(data)
    expect((await s.req('PUT', `/api/projects/${pid}/blobs/${hash}`, { cookie: owner.cookie, body: data })).status).toBe(201)
    expect((await s.req('GET', `/api/projects/${pid}/blobs/${hash}`)).status).toBe(200)
    const second = await s.req('GET', `/api/projects/${pid}/blobs/${hash}`)
    expect(second.status).toBe(429)
    expect(Number(second.headers.get('retry-after'))).toBeGreaterThan(0)
    // Members are not visitors.
    expect((await s.req('GET', `/api/projects/${pid}/blobs/${hash}`, { cookie: owner.cookie })).status).toBe(200)
  })
})

describe('disposable e-mail addresses', () => {
  let s: TestServer
  beforeAll(async () => {
    s = await testServer({ BLOCKED_EMAIL_DOMAINS: 'spam.example' })
  })
  afterAll(() => s.close())

  const signUp = (email: string) => s.json('POST', '/api/auth/sign-up/email', { json: { email, password: 'correct-horse-battery-staple', name: 'D', termsVersion: LEGAL.termsVersion } })

  it('refuses throwaway domains (and their subdomains) plus configured ones', async () => {
    expect((await signUp('a@mailinator.com')).status).toBe(400)
    expect((await signUp('b@x.yopmail.com')).status).toBe(400)
    expect((await signUp('c@spam.example')).status).toBe(400)
    expect((await signUp('d@example.com')).status).toBe(200)
  })
})
