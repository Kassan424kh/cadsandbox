import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ErrorReporter, parseStack, reportFromLog } from '../src/lib/error-reports'
import { testServer, type TestServer } from './helpers'

describe('error reports', () => {
  it('parses V8 and Firefox/Safari stacks, oldest call first', () => {
    const v8 = 'TypeError: boom\n    at inner (/app/dist/index.js:10:5)\n    at /app/node_modules/x/y.js:3:1\n    at outer (/app/dist/index.js:20:7)'
    expect(parseStack(v8).map((f) => [f.function, f.lineno, f.in_app])).toEqual([
      ['outer', 20, true],
      ['?', 3, false],
      ['inner', 10, true],
    ])
    const ff = 'inner@https://cadsandbox.com/assets/editor-1.js:1:200\n@https://cadsandbox.com/assets/index-2.js:1:50'
    expect(parseStack(ff).map((f) => f.function)).toEqual(['?', 'inner'])
  })

  it('posts an envelope to the DSN host with the key, deduplicating repeats', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))
    const r = new ErrorReporter('https://publickey@errors.example.test/7', { release: '1.2.3', environment: 'production' })
    r.report({ platform: 'node', message: 'job failed: db down', type: 'Error', tags: { job: 'blob-gc' } })
    r.report({ platform: 'node', message: 'job failed: db down', type: 'Error', tags: { job: 'blob-gc' } })
    await new Promise((res) => setTimeout(res, 10))
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]!
    expect(url).toBe('https://errors.example.test/api/7/envelope/')
    expect((init!.headers as Record<string, string>)['X-Sentry-Auth']).toContain('sentry_key=publickey')
    const [, item, event] = String(init!.body).trim().split('\n').map((l) => JSON.parse(l))
    expect(item).toEqual({ type: 'event' })
    expect(event).toMatchObject({ platform: 'node', release: '1.2.3', environment: 'production', tags: { job: 'blob-gc' } })
    expect(event.exception.values[0]).toMatchObject({ type: 'Error', value: 'job failed: db down' })
    fetchSpy.mockRestore()
  })

  it('turns pino error calls into reports without shipping arbitrary fields', () => {
    const r = reportFromLog([{ err: { message: 'x is undefined', name: 'TypeError', stack: 'TypeError: x\n    at f (a.js:1:1)' }, route: '/api/projects/:id', email: 'someone@example.com' }, 'unhandled error'])
    expect(r).toMatchObject({ message: 'unhandled error: x is undefined', type: 'TypeError', tags: { route: '/api/projects/:id' } })
    expect(JSON.stringify(r)).not.toContain('someone@example.com')
  })
})

describe('/api/client-errors', () => {
  let s: TestServer
  beforeAll(async () => {
    s = await testServer()
  })
  afterAll(() => s.close())

  it('accepts browser reports (a no-op without a DSN)', async () => {
    const res = await s.req('POST', '/api/client-errors', { json: { message: 'boom', type: 'TypeError', stack: 'TypeError: boom\n    at f (x.js:1:1)', path: '/p/abc?share=secret' } })
    expect(res.status).toBe(204)
    expect((await s.json('GET', '/api/config')).body.features.errorReporting).toBe(false)
  })
})
