import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { docNames } from '@cadsandbox/shared'
import { sha256, testServer, type TestServer, type TestUser } from './helpers'

let s: TestServer
let alice: TestUser
let bob: TestUser

beforeAll(async () => {
  s = await testServer()
  alice = await s.signup('alice@example.com', 'Alice')
  bob = await s.signup('bob@example.com', 'Bob')
  await s.setVerified(bob.id)
})
afterAll(() => s.close())

function manifestState(name: string, fileId: string): Uint8Array {
  const doc = new Y.Doc()
  doc.transact(() => {
    const info = doc.getMap('project')
    info.set('name', name)
    info.set('mainFile', fileId)
    doc.getMap('files').set(fileId, { id: fileId, name: 'Main', kind: 'design', parent: null, order: 'a0', createdAt: 1, updatedAt: 1 })
  })
  return Y.encodeStateAsUpdate(doc)
}

describe('projects', () => {
  it('creates with a client id, lists and gets', async () => {
    const r = await s.json('POST', '/api/projects', { cookie: alice.cookie, json: { name: 'Villa', description: 'Draft', id: 'local-first-123' } })
    expect(r.status).toBe(201)
    expect(r.body).toMatchObject({ id: 'local-first-123', name: 'Villa', role: 'owner', ownerName: 'Alice', visibility: 'private', deletedAt: null })
    const dup = await s.json('POST', '/api/projects', { cookie: alice.cookie, json: { name: 'X', id: 'local-first-123' } })
    expect(dup.status).toBe(409)
    const list = await s.json('GET', '/api/projects?scope=mine&q=vil', { cookie: alice.cookie })
    expect(list.body.total).toBe(1)
    expect(list.body.items[0].id).toBe('local-first-123')
    const bad = await s.json('GET', '/api/projects?scope=nope', { cookie: alice.cookie })
    expect(bad.status).toBe(400)
    expect((await s.req('GET', '/api/projects')).status).toBe(401)
  })

  it('updates metadata (owner only) and stars (any role)', async () => {
    await s.json('POST', '/api/projects/local-first-123/members', { cookie: alice.cookie, json: { email: bob.email, role: 'editor' } })
    const rename = await s.json('PATCH', '/api/projects/local-first-123', { cookie: bob.cookie, json: { name: 'Hijack' } })
    expect(rename.status).toBe(403)
    const star = await s.json('PATCH', '/api/projects/local-first-123', { cookie: bob.cookie, json: { starred: true } })
    expect(star.status).toBe(200)
    expect(star.body.starred).toBe(true)
    const starred = await s.json('GET', '/api/projects?scope=starred', { cookie: bob.cookie })
    expect(starred.body.items.map((p: { id: string }) => p.id)).toEqual(['local-first-123'])
    const shared = await s.json('GET', '/api/projects?scope=shared', { cookie: bob.cookie })
    expect(shared.body.items[0].role).toBe('editor')
    const ok = await s.json('PATCH', '/api/projects/local-first-123', { cookie: alice.cookie, json: { name: 'Villa 2', visibility: 'public' } })
    expect(ok.body).toMatchObject({ name: 'Villa 2', visibility: 'public' })
  })

  it('trash → hidden from members → restore → permanent delete', async () => {
    const p = (await s.json('POST', '/api/projects', { cookie: alice.cookie, json: { name: 'Temp' } })).body
    await s.json('POST', `/api/projects/${p.id}/members`, { cookie: alice.cookie, json: { email: bob.email, role: 'viewer' } })
    expect((await s.req('DELETE', `/api/projects/${p.id}`, { cookie: bob.cookie })).status).toBe(403)
    const trashed = await s.json('DELETE', `/api/projects/${p.id}`, { cookie: alice.cookie })
    expect(trashed.body.deletedAt).not.toBeNull()
    expect((await s.req('GET', `/api/projects/${p.id}`, { cookie: bob.cookie })).status).toBe(404)
    const trash = await s.json('GET', '/api/projects?scope=trash', { cookie: alice.cookie })
    expect(trash.body.items.map((x: { id: string }) => x.id)).toContain(p.id)
    const restored = await s.json('POST', `/api/projects/${p.id}/restore`, { cookie: alice.cookie })
    expect(restored.body.deletedAt).toBeNull()
    expect((await s.req('GET', `/api/projects/${p.id}`, { cookie: bob.cookie })).status).toBe(200)
    expect((await s.req('DELETE', `/api/projects/${p.id}/permanent`, { cookie: bob.cookie })).status).toBe(403)
    expect((await s.req('DELETE', `/api/projects/${p.id}/permanent`, { cookie: alice.cookie })).status).toBe(200)
    expect((await s.req('GET', `/api/projects/${p.id}`, { cookie: alice.cookie })).status).toBe(404)
  })

  it('duplicates collab docs (renaming the manifest) and blob references', async () => {
    const src = (await s.json('POST', '/api/projects', { cookie: alice.cookie, json: { name: 'Source' } })).body
    await s.deps.collab.writeState(docNames.manifest(src.id), src.id, manifestState('Source', 'f1'))
    const design = new Y.Doc()
    design.getMap('nodes').set('n1', { id: 'n1', type: 'box' })
    await s.deps.collab.writeState(docNames.file(src.id, 'f1'), src.id, Y.encodeStateAsUpdate(design))
    const data = randomBytes(64)
    const hash = await sha256(data)
    expect((await s.req('PUT', `/api/projects/${src.id}/blobs/${hash}`, { cookie: alice.cookie, body: data })).status).toBe(201)

    // Bob (viewer via share) duplicates into his own account.
    await s.json('POST', `/api/projects/${src.id}/members`, { cookie: alice.cookie, json: { email: bob.email, role: 'viewer' } })
    const copy = await s.json('POST', `/api/projects/${src.id}/duplicate`, { cookie: bob.cookie, json: { name: 'My copy' } })
    expect(copy.status).toBe(201)
    expect(copy.body).toMatchObject({ name: 'My copy', ownerId: bob.id, role: 'owner', visibility: 'private' })
    const id = copy.body.id as string

    const manifest = await s.deps.collab.getState(docNames.manifest(id))
    const mdoc = new Y.Doc()
    Y.applyUpdate(mdoc, manifest!)
    expect(mdoc.getMap('project').get('name')).toBe('My copy')
    expect(mdoc.getMap('files').has('f1')).toBe(true)
    const file = await s.deps.collab.getState(docNames.file(id, 'f1'))
    const fdoc = new Y.Doc()
    Y.applyUpdate(fdoc, file!)
    expect(fdoc.getMap('nodes').get('n1')).toEqual({ id: 'n1', type: 'box' })
    const blob = await s.req('GET', `/api/projects/${id}/blobs/${hash}`, { cookie: bob.cookie })
    expect(Buffer.from(await blob.arrayBuffer()).equals(data)).toBe(true)
    // The copy is independent: Alice has no access to Bob's copy.
    expect((await s.req('GET', `/api/projects/${id}`, { cookie: alice.cookie })).status).toBe(404)
  })

  it('thumbnails accept only png/webp within the size limit', async () => {
    const p = (await s.json('POST', '/api/projects', { cookie: alice.cookie, json: { name: 'Thumb' } })).body
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(100)])
    const put = await s.json('PUT', `/api/projects/${p.id}/thumbnail`, { cookie: alice.cookie, body: png })
    expect(put.status).toBe(200)
    const get = await s.req('GET', put.body.thumbnailUrl, { cookie: alice.cookie })
    expect(get.headers.get('content-type')).toBe('image/png')
    expect(get.headers.get('cache-control')).toContain('immutable')
    expect((await s.req('PUT', `/api/projects/${p.id}/thumbnail`, { cookie: alice.cookie, body: Buffer.from('<svg/>') })).status).toBe(400)
    expect((await s.req('PUT', `/api/projects/${p.id}/thumbnail`, { cookie: alice.cookie, body: randomBytes(600 * 1024) })).status).toBe(413)
  })

  it('folders: nesting, no cycles, deleting moves contents up', async () => {
    const a = (await s.json('POST', '/api/folders', { cookie: alice.cookie, json: { name: 'A' } })).body
    const b = (await s.json('POST', '/api/folders', { cookie: alice.cookie, json: { name: 'B', parentId: a.id } })).body
    expect((await s.json('PATCH', `/api/folders/${a.id}`, { cookie: alice.cookie, json: { parentId: b.id } })).status).toBe(400)
    const p = (await s.json('POST', '/api/projects', { cookie: alice.cookie, json: { name: 'InB', folderId: b.id } })).body
    expect(p.folderId).toBe(b.id)
    expect((await s.json('GET', `/api/projects?scope=mine&folderId=${b.id}`, { cookie: alice.cookie })).body.total).toBe(1)
    await s.req('DELETE', `/api/folders/${b.id}`, { cookie: alice.cookie })
    const moved = await s.json('GET', `/api/projects/${p.id}`, { cookie: alice.cookie })
    expect(moved.body.folderId).toBe(a.id)
    expect((await s.req('GET', `/api/folders`, { cookie: bob.cookie })).status).toBe(200)
    expect((await s.req('PATCH', `/api/folders/${a.id}`, { cookie: bob.cookie, json: { name: 'x' } })).status).toBe(404)
  })
})
