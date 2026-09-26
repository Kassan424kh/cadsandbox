import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sha256, testServer, type TestServer, type TestUser } from './helpers'

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(200)])
const HTML = Buffer.from('<!doctype html><html><script>alert(1)</script></html>')

function filesUnder(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) out.push(...filesUnder(p))
    else out.push(p)
  }
  return out
}

describe('blobs (plaintext storage)', () => {
  let s: TestServer
  let owner: TestUser
  let viewer: TestUser
  let pid: string
  beforeAll(async () => {
    s = await testServer({ STORAGE_QUOTA_BYTES: '4096' })
    owner = await s.signup('blob-owner@example.com')
    viewer = await s.signup('blob-viewer@example.com')
    await s.setVerified(viewer.id)
    pid = (await s.json('POST', '/api/projects', { cookie: owner.cookie, json: { name: 'Blobs' } })).body.id
    await s.json('POST', `/api/projects/${pid}/members`, { cookie: owner.cookie, json: { email: viewer.email, role: 'viewer' } })
  })
  afterAll(() => s.close())

  it('rejects a body whose sha256 differs from the URL', async () => {
    const wrong = await sha256('something else')
    const r = await s.json('PUT', `/api/projects/${pid}/blobs/${wrong}`, { cookie: owner.cookie, body: PNG })
    expect(r.status).toBe(400)
    expect(r.body.error.code).toBe('bad_request')
  })

  it('stores, sniffs and serves with safe headers', async () => {
    const hash = await sha256(PNG)
    const put = await s.json('PUT', `/api/projects/${pid}/blobs/${hash}`, { cookie: owner.cookie, body: PNG, headers: { 'content-type': 'text/html' } })
    expect(put.status).toBe(201)
    expect(put.body).toMatchObject({ hash, size: PNG.length, mime: 'image/png' })
    const again = await s.req('PUT', `/api/projects/${pid}/blobs/${hash}`, { cookie: owner.cookie, body: PNG })
    expect(again.status).toBe(200)

    const get = await s.req('GET', `/api/projects/${pid}/blobs/${hash}`, { cookie: viewer.cookie })
    expect(get.status).toBe(200)
    expect(Buffer.from(await get.arrayBuffer()).equals(PNG)).toBe(true)
    expect(get.headers.get('content-type')).toBe('image/png')
    expect(get.headers.get('x-content-type-options')).toBe('nosniff')
    expect(get.headers.get('cache-control')).toContain('immutable')
    expect(get.headers.get('etag')).toBe(`"${hash}"`)
    const head = await s.req('HEAD', `/api/projects/${pid}/blobs/${hash}`, { cookie: viewer.cookie })
    expect(head.status).toBe(200)
    expect(head.headers.get('content-length')).toBe(String(PNG.length))
    const cached = await s.req('GET', `/api/projects/${pid}/blobs/${hash}`, { cookie: viewer.cookie, headers: { 'if-none-match': `"${hash}"` } })
    expect(cached.status).toBe(304)
  })

  it('never serves active content inline', async () => {
    const hash = await sha256(HTML)
    expect((await s.req('PUT', `/api/projects/${pid}/blobs/${hash}`, { cookie: owner.cookie, body: HTML })).status).toBe(201)
    const get = await s.req('GET', `/api/projects/${pid}/blobs/${hash}`, { cookie: owner.cookie })
    expect(get.headers.get('content-type')).toBe('application/octet-stream')
    expect(get.headers.get('content-disposition')).toMatch(/^attachment/)
    expect(get.headers.get('content-security-policy')).toContain('sandbox')
  })

  it('enforces roles: viewers cannot upload, outsiders get 404', async () => {
    const data = randomBytes(32)
    const hash = await sha256(data)
    expect((await s.req('PUT', `/api/projects/${pid}/blobs/${hash}`, { cookie: viewer.cookie, body: data })).status).toBe(403)
    const outsider = await s.signup('outsider@example.com')
    expect((await s.req('GET', `/api/projects/${pid}/blobs/${await sha256(PNG)}`, { cookie: outsider.cookie })).status).toBe(404)
    // A hash that exists globally but is not referenced by this project is not served.
    const other = (await s.json('POST', '/api/projects', { cookie: outsider.cookie, json: { name: 'Other' } })).body.id
    expect((await s.req('GET', `/api/projects/${other}/blobs/${await sha256(PNG)}`, { cookie: outsider.cookie })).status).toBe(404)
  })

  it('charges the owner quota and rejects uploads beyond it', async () => {
    const big = randomBytes(5000)
    const r = await s.json('PUT', `/api/projects/${pid}/blobs/${await sha256(big)}`, { cookie: owner.cookie, body: big })
    expect(r.status).toBe(403)
    expect(r.body.error.code).toBe('quota_exceeded')
    const me = await s.json('GET', '/api/me', { cookie: owner.cookie })
    expect(me.body.storage.usedBytes).toBe(PNG.length + HTML.length)
    expect(me.body.storage.quotaBytes).toBe(4096)
  })

  it('rejects declared bodies over the size limit before reading', async () => {
    const r = await s.json('PUT', `/api/projects/${pid}/blobs/${'a'.repeat(64)}`, { cookie: owner.cookie, body: 'x', headers: { 'content-length': String(300 * 1024 * 1024) } })
    expect([413, 400]).toContain(r.status)
  })

  it('refuses uploads that do not declare their size', async () => {
    const data = randomBytes(64)
    const body = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(new Uint8Array(data))
        ctrl.close()
      },
    })
    const r = await s.req('PUT', `/api/projects/${pid}/blobs/${await sha256(data)}`, { cookie: owner.cookie, body, headers: {} })
    expect(r.status).toBe(400)
    expect(((await r.json()) as { error: { message: string } }).error.message).toMatch(/Content-Length/)
  })
})

describe('blobs (encrypted at rest)', () => {
  let s: TestServer
  let owner: TestUser
  beforeAll(async () => {
    s = await testServer({ STORAGE_ENCRYPTION_KEY: randomBytes(32).toString('base64') })
    owner = await s.signup('enc@example.com')
  })
  afterAll(() => s.close())

  it('stores ciphertext on disk and returns the original bytes', async () => {
    const pid = (await s.json('POST', '/api/projects', { cookie: owner.cookie, json: { name: 'Enc' } })).body.id
    const data = Buffer.concat([Buffer.from('%PDF-1.7 secret-marker '), randomBytes(150_000)])
    const hash = await sha256(data)
    expect((await s.req('PUT', `/api/projects/${pid}/blobs/${hash}`, { cookie: owner.cookie, body: data })).status).toBe(201)
    const files = filesUnder(join(s.deps.config.dataDir, 'blobs'))
    expect(files).toHaveLength(1)
    expect(files[0]!.endsWith(`${hash}.enc`)).toBe(true)
    const raw = readFileSync(files[0]!)
    expect(raw.includes(Buffer.from('secret-marker'))).toBe(false)
    const get = await s.req('GET', `/api/projects/${pid}/blobs/${hash}`, { cookie: owner.cookie })
    expect(Buffer.from(await get.arrayBuffer()).equals(data)).toBe(true)
    expect(get.headers.get('content-type')).toBe('application/pdf')
  })
})
