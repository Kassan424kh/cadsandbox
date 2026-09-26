// Static web-app serving (src/http/static.ts): build outputs carry .br/.gz siblings; the server picks
// one by Accept-Encoding, keeps the original Content-Type, sets Vary, applies the cache policy of the
// original file, serves the SPA fallback the same way and never compresses /api.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { brotliCompressSync, brotliDecompressSync, gunzipSync, gzipSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testServer, type TestServer } from './helpers'

const INDEX_HTML = `<!doctype html><html><head><title>CadSandbox</title></head><body><div id="root"></div>${'<!-- pad -->'.repeat(120)}</body></html>`
const APP_JS = `export const answer = 42;\n${'// padding so the fixture is realistically larger than 1 KB\n'.repeat(40)}`
const STYLE_CSS = `:root{--x:1}\n${'.pad{color:red}\n'.repeat(100)}`
const SW_JS = `self.addEventListener('install', () => {});\n${'// sw\n'.repeat(200)}`
const MANIFEST = JSON.stringify({ name: 'CadSandbox', icons: Array.from({ length: 20 }, (_, i) => ({ src: `/icon-${i}.svg` })) })

let s: TestServer
let dist: string

function fixture(rel: string, body: string, siblings: ('br' | 'gz')[]): void {
  const file = join(dist, rel)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, body)
  if (siblings.includes('br')) writeFileSync(`${file}.br`, brotliCompressSync(body))
  if (siblings.includes('gz')) writeFileSync(`${file}.gz`, gzipSync(body))
}

const get = (path: string, headers: Record<string, string> = {}) => s.req('GET', path, { headers })
const bytes = async (res: Response) => Buffer.from(await res.arrayBuffer())

beforeAll(async () => {
  dist = mkdtempSync(join(tmpdir(), 'csb-web-dist-'))
  fixture('index.html', INDEX_HTML, ['br', 'gz'])
  fixture('sw.js', SW_JS, ['br', 'gz'])
  fixture('manifest.webmanifest', MANIFEST, ['br', 'gz'])
  fixture('assets/app-abc123.js', APP_JS, ['br', 'gz'])
  fixture('assets/style-abc123.css', STYLE_CSS, ['gz'])
  fixture('assets/plain-abc123.js', APP_JS, [])
  s = await testServer({ WEB_DIST_DIR: dist })
})
afterAll(async () => {
  await s.close()
  rmSync(dist, { recursive: true, force: true })
})

describe('static web app: precompressed assets', () => {
  it('serves the brotli sibling when accepted, with the original Content-Type and immutable caching', async () => {
    const res = await get('/assets/app-abc123.js', { 'accept-encoding': 'gzip, deflate, br, zstd' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-encoding')).toBe('br')
    expect(res.headers.get('content-type')).toMatch(/^text\/javascript/)
    expect(res.headers.get('vary')).toBe('Accept-Encoding')
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    const body = await bytes(res)
    expect(Number(res.headers.get('content-length'))).toBe(body.length)
    expect(brotliDecompressSync(body).toString()).toBe(APP_JS)
  })

  it('falls back to gzip when br is not accepted or has no sibling', async () => {
    const gzOnly = await get('/assets/app-abc123.js', { 'accept-encoding': 'gzip, deflate' })
    expect(gzOnly.headers.get('content-encoding')).toBe('gzip')
    expect(gunzipSync(await bytes(gzOnly)).toString()).toBe(APP_JS)

    const css = await get('/assets/style-abc123.css', { 'accept-encoding': 'br, gzip' })
    expect(css.headers.get('content-encoding')).toBe('gzip')
    expect(css.headers.get('content-type')).toMatch(/^text\/css/)
    expect(css.headers.get('vary')).toBe('Accept-Encoding')
    expect(gunzipSync(await bytes(css)).toString()).toBe(STYLE_CSS)
  })

  it('serves identity when neither encoding is accepted, still with Vary', async () => {
    const variants: Record<string, string>[] = [{}, { 'accept-encoding': 'identity' }]
    for (const headers of variants) {
      const res = await get('/assets/app-abc123.js', headers)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-encoding')).toBeNull()
      expect(res.headers.get('vary')).toBe('Accept-Encoding')
      expect(res.headers.get('content-type')).toMatch(/^text\/javascript/)
      expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
      expect(await res.text()).toBe(APP_JS)
    }
  })

  it('serves identity when the file has no sibling', async () => {
    const res = await get('/assets/plain-abc123.js', { 'accept-encoding': 'br, gzip' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-encoding')).toBeNull()
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(await res.text()).toBe(APP_JS)
  })

  it('keeps the no-cache policy of compressed index.html, sw.js and the manifest', async () => {
    const br = { 'accept-encoding': 'br' }
    const index = await get('/index.html', br)
    expect(index.headers.get('content-encoding')).toBe('br')
    expect(index.headers.get('content-type')).toMatch(/^text\/html/)
    expect(index.headers.get('cache-control')).toBe('no-cache')
    expect(brotliDecompressSync(await bytes(index)).toString()).toBe(INDEX_HTML)

    const sw = await get('/sw.js', br)
    expect(sw.headers.get('content-encoding')).toBe('br')
    expect(sw.headers.get('content-type')).toMatch(/^text\/javascript/)
    expect(sw.headers.get('cache-control')).toBe('no-cache')

    const manifest = await get('/manifest.webmanifest', br)
    expect(manifest.headers.get('content-encoding')).toBe('br')
    expect(manifest.headers.get('content-type')).toMatch(/^application\/manifest\+json/)
    expect(manifest.headers.get('cache-control')).toBe('no-cache')
  })

  it('serves the SPA fallback for client routes, compressed when accepted', async () => {
    const res = await get('/projects/f/some-folder', { accept: 'text/html,*/*;q=0.8', 'accept-encoding': 'gzip, br' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/^text\/html/)
    expect(res.headers.get('content-encoding')).toBe('br')
    expect(res.headers.get('cache-control')).toBe('no-cache')
    expect(res.headers.get('vary')).toBe('Accept-Encoding')
    expect(brotliDecompressSync(await bytes(res)).toString()).toBe(INDEX_HTML)

    const identity = await get('/p/some-project', { accept: 'text/html' })
    expect(identity.status).toBe(200)
    expect(identity.headers.get('content-encoding')).toBeNull()
    expect(identity.headers.get('cache-control')).toBe('no-cache')
    expect(await identity.text()).toBe(INDEX_HTML)
  })

  it('does not fall back to index.html for non-html requests and never compresses /api', async () => {
    const missing = await get('/assets/missing-000000.js', { accept: '*/*', 'accept-encoding': 'br' })
    expect(missing.status).toBe(404)
    expect(missing.headers.get('content-encoding')).toBeNull()

    const api = await get('/api/config', { accept: 'application/json', 'accept-encoding': 'gzip, br' })
    expect(api.status).toBe(200)
    expect(api.headers.get('content-encoding')).toBeNull()
    expect(api.headers.get('content-type')).toMatch(/^application\/json/)

    const unknownApi = await get('/api/nope', { accept: 'text/html', 'accept-encoding': 'br' })
    expect(unknownApi.status).toBe(404)
    expect(unknownApi.headers.get('content-encoding')).toBeNull()
    expect(unknownApi.headers.get('content-type')).toMatch(/^application\/json/)
  })
})
