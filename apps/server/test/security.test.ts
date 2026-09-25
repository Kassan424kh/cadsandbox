import { randomBytes } from 'node:crypto'
import { Readable } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createKeyRing, decryptStream, encryptStream, hashSecret, openRecord, sealRecord, verifySecret } from '../src/lib/crypto'
import { ProxyTrust, truncateIp } from '../src/lib/ip'
import { redactUrl } from '../src/log'
import { sniffMime } from '../src/storage'
import { testServer, type TestServer, type TestUser } from './helpers'

let s: TestServer
let u: TestUser

beforeAll(async () => {
  s = await testServer()
  u = await s.signup('csrf@example.com')
})
afterAll(() => s.close())

describe('CSRF origin check', () => {
  const create = (o: Parameters<TestServer['req']>[2]) => s.req('POST', '/api/projects', { cookie: u.cookie, json: { name: 'P' }, ...o })

  it('accepts same-origin requests', async () => {
    expect((await create({})).status).toBe(201)
    expect((await create({ origin: null, headers: { 'sec-fetch-site': 'same-origin' } })).status).toBe(201)
  })

  it('rejects foreign or missing origins on cookie-authenticated writes', async () => {
    expect((await create({ origin: 'https://evil.example' })).status).toBe(403)
    expect((await create({ origin: 'null' })).status).toBe(403)
    expect((await create({ origin: null, headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403)
    expect((await create({ origin: null })).status).toBe(403)
    const r = await s.json('DELETE', '/api/me', { cookie: u.cookie, origin: 'https://evil.example', json: { confirmEmail: 'csrf@example.com' } })
    expect(r.status).toBe(403)
    expect(r.body.error.code).toBe('forbidden')
  })

  it('also protects the auth endpoints', async () => {
    const r = await s.req('POST', '/api/auth/sign-in/email', { origin: 'https://evil.example', json: { email: 'csrf@example.com', password: 'correct-horse-battery-staple' } })
    expect(r.status).toBe(403)
  })

  it('reads are not affected', async () => {
    expect((await s.req('GET', '/api/me', { cookie: u.cookie, origin: 'https://evil.example' })).status).toBe(200)
  })
})

describe('HTTP hardening', () => {
  it('sets security headers on every response incl. errors', async () => {
    const r = await s.req('GET', '/api/does-not-exist')
    expect(r.status).toBe(404)
    expect(r.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(r.headers.get('content-security-policy')).toContain("script-src 'self' 'wasm-unsafe-eval'")
    expect(r.headers.get('cross-origin-opener-policy')).toBe('same-origin')
    expect(r.headers.get('cross-origin-embedder-policy')).toBe('require-corp')
    expect(r.headers.get('referrer-policy')).toBe('no-referrer')
    expect(r.headers.get('x-request-id')).toBeTruthy()
    expect(await r.json()).toEqual({ error: { code: 'not_found', message: 'Not found' } })
  })

  it('validates bodies with zod and returns structured 400s without echoing input', async () => {
    const r = await s.json('POST', '/api/projects', { cookie: u.cookie, json: { name: '' } })
    expect(r.status).toBe(400)
    expect(r.body.error.code).toBe('bad_request')
    expect(r.body.error.details[0].path).toBe('name')
    const malformed = await s.req('POST', '/api/projects', { cookie: u.cookie, body: '{bad', headers: { 'content-type': 'application/json' } })
    expect(malformed.status).toBe(400)
  })

  it('limits JSON body sizes', async () => {
    const r = await s.req('POST', '/api/projects', { cookie: u.cookie, json: { name: 'x', description: 'y'.repeat(40_000) } })
    expect(r.status).toBe(413)
  })

  it('password policy: minimum 10 characters', async () => {
    const r = await s.req('POST', '/api/auth/sign-up/email', { json: { email: 'short@example.com', password: 'short-pw', name: 'S' } })
    expect(r.status).toBe(400)
  })
})

describe('crypto & privacy helpers', () => {
  const ring = createKeyRing(randomBytes(32).toString('base64'))

  it('record encryption binds ciphertext to its identity', () => {
    const sealed = sealRecord(ring, Buffer.from('hello'), 'collab:a')
    expect(openRecord(ring, sealed, 'collab:a').toString()).toBe('hello')
    expect(() => openRecord(ring, sealed, 'collab:b')).toThrow()
    const rotated = createKeyRing(randomBytes(32).toString('base64'), [ring.current!.key.toString('base64')])
    expect(openRecord(rotated, sealed, 'collab:a').toString()).toBe('hello')
  })

  it('streaming encryption round-trips and detects tampering/truncation', async () => {
    const collect = async (r: NodeJS.ReadableStream) => {
      const chunks: Buffer[] = []
      for await (const c of r) chunks.push(c as Buffer)
      return Buffer.concat(chunks)
    }
    for (const size of [0, 1, 65_536, 65_537, 300_000]) {
      const data = randomBytes(size)
      const enc = await collect(Readable.from([data]).pipe(encryptStream(ring, 'blob:x')))
      expect((await collect(Readable.from([enc]).pipe(decryptStream(ring, 'blob:x')))).equals(data)).toBe(true)
      if (size > 70_000) {
        await expect(collect(Readable.from([enc.subarray(0, enc.length - 100)]).pipe(decryptStream(ring, 'blob:x')))).rejects.toThrow()
        const flipped = Buffer.from(enc)
        flipped[100] = flipped[100]! ^ 1
        await expect(collect(Readable.from([flipped]).pipe(decryptStream(ring, 'blob:x')))).rejects.toThrow()
      }
    }
  })

  it('scrypt secrets verify only with the right password', async () => {
    const h = await hashSecret('link-password')
    expect(await verifySecret('link-password', h)).toBe(true)
    expect(await verifySecret('Link-password', h)).toBe(false)
  })

  it('IPs are truncated for storage and forwarded headers need a trusted proxy', () => {
    expect(truncateIp('203.0.113.77')).toBe('203.0.113.0')
    expect(truncateIp('::ffff:198.51.100.9')).toBe('198.51.100.0')
    expect(truncateIp('2001:db8:abcd:12::1')).toBe('2001:db8:abcd::')
    expect(new ProxyTrust(false, []).resolve('10.0.0.2', '1.2.3.4')).toBe('10.0.0.2')
    expect(new ProxyTrust(true, ['10.0.0.0/8']).resolve('10.0.0.2', '6.6.6.6, 1.2.3.4, 10.0.0.9')).toBe('1.2.3.4')
    expect(new ProxyTrust(true, ['10.0.0.0/8']).resolve('8.8.8.8', '1.2.3.4')).toBe('8.8.8.8')
  })

  it('redacts tokens from logged URLs and sniffs content types', () => {
    expect(redactUrl('/api/projects/x?token=abc&y=1')).toBe('/api/projects/x?token=[redacted]&y=1')
    expect(redactUrl('/api/share/abcdef/accept')).toBe('/api/share/[redacted]/accept')
    expect(sniffMime(Buffer.from('ISO-10303-21;\nHEADER;'))).toBe('application/p21')
    expect(sniffMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('image/svg+xml')
    expect(sniffMime(Buffer.from('glTF\x02\x00\x00\x00', 'latin1'))).toBe('model/gltf-binary')
  })
})
