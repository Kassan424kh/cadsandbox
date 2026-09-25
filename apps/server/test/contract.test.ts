import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { routes } from '@cadsandbox/shared'
import { createApp } from '../src/http/app'
import { testServer, type TestServer } from './helpers'

let s: TestServer
beforeAll(async () => {
  s = await testServer()
})
afterAll(() => s.close())

describe('API contract parity', () => {
  it('registers every route of the shared route table', () => {
    const app = createApp(s.deps)
    const registered = new Set(app.routes.map((r) => `${r.method} ${r.path}`))
    const missing = Object.entries(routes)
      .filter(([, def]) => !def.startsWith('WS ') && !def.startsWith('ALL '))
      .filter(([, def]) => !registered.has(def))
      .map(([key]) => key)
    expect(missing).toEqual([])
    expect(registered.has('POST /api/auth/*')).toBe(true)
  })

  it('serves the public config DTO', async () => {
    const r = await s.json('GET', '/api/config')
    expect(r.body).toMatchObject({ appName: 'CadSandbox', collabPath: '/collab', features: { collab: true, passkeys: true }, limits: { maxBlobBytes: 209715200 } })
  })
})
