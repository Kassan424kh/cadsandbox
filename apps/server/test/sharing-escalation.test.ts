import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testServer, type TestServer, type TestUser } from './helpers'

let s: TestServer
let owner: TestUser
let linkUser: TestUser
let direct: TestUser
let pid: string
let link: { id: string; token: string }

beforeAll(async () => {
  s = await testServer()
  owner = await s.signup('esc-owner@example.com')
  linkUser = await s.signup('esc-link@example.com')
  direct = await s.signup('esc-direct@example.com')
  for (const u of [owner, linkUser, direct]) await s.setVerified(u.id)
  pid = (await s.json('POST', '/api/projects', { cookie: owner.cookie, json: { name: 'Escalation' } })).body.id
  link = (await s.json('POST', `/api/projects/${pid}/links`, { cookie: owner.cookie, json: { role: 'editor' } })).body
  const acc = await s.json('POST', `/api/share/${link.token}/accept`, { cookie: linkUser.cookie })
  expect(acc.body.role).toBe('editor')
})
afterAll(() => s.close())

describe('editors who joined through a share link', () => {
  it('cannot turn their link access into a direct membership', async () => {
    const r = await s.json('PATCH', `/api/projects/${pid}/members/${linkUser.id}`, { cookie: linkUser.cookie, json: { role: 'editor' } })
    expect(r.status).toBe(403)
    const add = await s.json('POST', `/api/projects/${pid}/members`, { cookie: linkUser.cookie, json: { email: linkUser.email, role: 'editor' } })
    expect(add.status).toBe(403)
  })

  it('cannot create links, invite others or share into their organisation', async () => {
    expect((await s.json('POST', `/api/projects/${pid}/links`, { cookie: linkUser.cookie, json: { role: 'editor' } })).status).toBe(403)
    expect((await s.json('POST', `/api/projects/${pid}/members`, { cookie: linkUser.cookie, json: { email: 'someone@example.com', role: 'viewer' } })).status).toBe(403)
    const org = await s.json('POST', '/api/auth/organization/create', { cookie: linkUser.cookie, json: { name: 'Esc Org', slug: 'esc-org' } })
    expect(org.status).toBe(200)
    expect((await s.json('PUT', `/api/projects/${pid}/orgs/${org.body.id}`, { cookie: linkUser.cookie, json: { role: 'editor' } })).status).toBe(403)
  })

  it('may still leave the project themselves', async () => {
    const other = await s.signup('esc-leaver@example.com')
    await s.setVerified(other.id)
    await s.json('POST', `/api/share/${link.token}/accept`, { cookie: other.cookie })
    expect((await s.json('DELETE', `/api/projects/${pid}/members/${other.id}`, { cookie: other.cookie })).status).toBe(200)
  })

  it('are flagged in the member list and lose access when the link is deleted', async () => {
    const members = await s.json('GET', `/api/projects/${pid}/members`, { cookie: owner.cookie })
    expect(members.body.find((m: { userId: string }) => m.userId === linkUser.id)).toMatchObject({ role: 'editor', viaLink: true })
    expect(members.body.find((m: { userId: string }) => m.userId === owner.id)).toMatchObject({ role: 'owner', viaLink: false })
    expect((await s.json('DELETE', `/api/projects/${pid}/links/${link.id}`, { cookie: owner.cookie })).status).toBe(200)
    expect((await s.json('GET', `/api/projects/${pid}`, { cookie: linkUser.cookie })).status).toBe(404)
  })
})

describe('directly invited editors', () => {
  it('can share, even when they also hold a link membership, but not change their own role', async () => {
    const add = await s.json('POST', `/api/projects/${pid}/members`, { cookie: owner.cookie, json: { email: direct.email, role: 'editor' } })
    expect(add.status).toBe(201)
    const second = (await s.json('POST', `/api/projects/${pid}/links`, { cookie: owner.cookie, json: { role: 'editor' } })).body
    await s.json('POST', `/api/share/${second.token}/accept`, { cookie: direct.cookie })
    const members = await s.json('GET', `/api/projects/${pid}/members`, { cookie: owner.cookie })
    expect(members.body.find((m: { userId: string }) => m.userId === direct.id)).toMatchObject({ role: 'editor', viaLink: false })
    const invite = await s.json('POST', `/api/projects/${pid}/members`, { cookie: direct.cookie, json: { email: 'colleague@example.com', role: 'viewer' } })
    expect(invite.status).toBe(202)
    expect((await s.json('PATCH', `/api/projects/${pid}/members/${direct.id}`, { cookie: direct.cookie, json: { role: 'viewer' } })).status).toBe(400)
    expect((await s.json('POST', `/api/projects/${pid}/members`, { cookie: direct.cookie, json: { email: direct.email, role: 'editor' } })).status).toBe(400)
  })
})
