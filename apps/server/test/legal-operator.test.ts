import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { auditLog } from '../src/db/schema'
import { testServer, type TestServer, type TestUser } from './helpers'

let s: TestServer
let admin: TestUser
let member: TestUser
const details = {
  name: 'Example Operator',
  street: 'Musterstraße 1',
  postalCity: '12345 Musterstadt',
  country: 'Deutschland',
  email: 'hello@example.com',
  phone: '+49 123 456789',
  vatId: 'DE000000000',
  registerCourt: '',
  registerNumber: '',
  representedBy: '',
  contentResponsible: '',
  privacyEmail: '',
}

beforeAll(async () => {
  s = await testServer()
  admin = await s.signup('legal-admin@example.com')
  member = await s.signup('legal-member@example.com')
  await s.setRole(admin.id, 'admin')
})
afterAll(() => s.close())

describe('legal operator details', () => {
  it('are empty until an admin saves them', async () => {
    expect((await s.json('GET', '/api/legal/operator')).body).toEqual({ operator: null, updatedAt: null })
  })

  it('can only be changed by admins, and validated', async () => {
    expect((await s.json('PUT', '/api/admin/legal/operator', { cookie: member.cookie, json: details })).status).toBe(403)
    expect((await s.json('PUT', '/api/admin/legal/operator', { cookie: admin.cookie, json: { ...details, email: 'not-an-email' } })).status).toBe(400)
  })

  it('are public once saved, and the change is audited', async () => {
    const put = await s.json('PUT', '/api/admin/legal/operator', { cookie: admin.cookie, json: details })
    expect(put.status).toBe(200)
    const got = await s.json('GET', '/api/legal/operator')
    expect(got.body.operator).toEqual(details)
    expect(got.body.updatedAt).toEqual(expect.any(String))
    const entries = await s.deps.db.select().from(auditLog).where(and(eq(auditLog.action, 'admin.legal.update'), eq(auditLog.actorId, admin.id)))
    expect(entries).toHaveLength(1)
  })
})
