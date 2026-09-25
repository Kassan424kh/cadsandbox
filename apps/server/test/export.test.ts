import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import * as Y from 'yjs'
import { docNames } from '@cadsandbox/shared'
import { sha256, testServer, type TestServer, type TestUser } from './helpers'

let s: TestServer
let u: TestUser

beforeAll(async () => {
  s = await testServer({ STORAGE_ENCRYPTION_KEY: randomBytes(32).toString('base64') })
  u = await s.signup('export@example.com', 'Exporter')
})
afterAll(() => s.close())

describe('GDPR data export', () => {
  it('streams a ZIP with profile, projects, collab docs, blobs, collections, tickets and audit', async () => {
    const p = (await s.json('POST', '/api/projects', { cookie: u.cookie, json: { name: 'Exported' } })).body
    await s.deps.collab.transact(docNames.file(p.id, 'f1'), (doc) => doc.getMap('nodes').set('n', { id: 'n', type: 'wall' }))
    const blob = randomBytes(1000)
    const hash = await sha256(blob)
    await s.req('PUT', `/api/projects/${p.id}/blobs/${hash}`, { cookie: u.cookie, body: blob })
    const asset = randomBytes(300)
    const assetHash = await sha256(asset)
    await s.req('PUT', `/api/assets/${assetHash}`, { cookie: u.cookie, body: asset })
    const col = (await s.json('POST', '/api/collections', { cookie: u.cookie, json: { name: 'Lib' } })).body
    await s.json('POST', `/api/collections/${col.id}/items`, { cookie: u.cookie, json: { name: 'Chair', kind: 'object', payload: { format: 'x' }, assets: [assetHash] } })
    await s.json('POST', '/api/support/tickets', { cookie: u.cookie, json: { subject: 'Question', message: 'Hello support' } })

    const res = await s.req('GET', '/api/me/export', { cookie: u.cookie })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/zip')
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="cadsandbox-export-/)
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()))
    const names = Object.keys(files)
    expect(names).toContain('README.txt')
    const profile = JSON.parse(strFromU8(files['profile.json']!))
    expect(profile.user.email).toBe('export@example.com')
    expect(JSON.stringify(profile)).not.toMatch(/password|secret/i)
    const project = JSON.parse(strFromU8(files[`projects/${p.id}/project.json`]!))
    expect(project.project.name).toBe('Exported')
    const yjs = files[`projects/${p.id}/docs/file_${p.id}_f1.yjs`]!
    const doc = new Y.Doc()
    Y.applyUpdate(doc, yjs)
    expect(doc.getMap('nodes').get('n')).toEqual({ id: 'n', type: 'wall' })
    const dump = JSON.parse(strFromU8(files[`projects/${p.id}/docs/file_${p.id}_f1.json`]!))
    expect(dump.nodes.n.type).toBe('wall')
    expect(Buffer.from(files[`projects/${p.id}/blobs/${hash}`]!).equals(blob)).toBe(true)
    expect(Buffer.from(files[`assets/${assetHash}`]!).equals(asset)).toBe(true)
    expect(JSON.parse(strFromU8(files['collections.json']!)).items[0].name).toBe('Chair')
    expect(JSON.parse(strFromU8(files['tickets.json']!)).messages[0].body).toBe('Hello support')
    const activity = JSON.parse(strFromU8(files['activity.json']!))
    expect(activity.audit.some((a: { action: string }) => a.action === 'account.export')).toBe(true)
    expect(s.mailer.sent.some((m) => m.to === 'export@example.com' && /export/i.test(m.subject))).toBe(true)
  })

  it('is blocked for impersonation sessions and requires login', async () => {
    expect((await s.req('GET', '/api/me/export')).status).toBe(401)
  })
})
