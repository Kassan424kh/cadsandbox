import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { collections, folders, organization, projects } from '../src/db/schema'
import { hardDeleteUser } from '../src/services/users'
import { testServer, type TestServer, type TestUser } from './helpers'

let s: TestServer
let alice: TestUser

beforeAll(async () => {
  s = await testServer()
  alice = await s.signup('del-alice@example.com')
  await s.setVerified(alice.id)
})
afterAll(() => s.close())

const projectRow = async (id: string) => (await s.deps.db.select().from(projects).where(eq(projects.id, id)))[0]

describe('account deletion', () => {
  it('hands organisation content to the organisation owner and deletes only personal content', async () => {
    const org = await s.json('POST', '/api/auth/organization/create', { cookie: alice.cookie, json: { name: 'Keep Studio', slug: 'keep-studio' } })
    const orgId = org.body.id as string
    const bob = await s.signup('del-bob@example.com')
    await s.setVerified(bob.id)
    await s.deps.auth.api.addMember({ body: { userId: bob.id, organizationId: orgId, role: 'admin' } })

    const folder = await s.json('POST', '/api/folders', { cookie: bob.cookie, json: { name: 'Bob’s org folder', orgId } })
    expect(folder.status).toBe(201)
    const orgProject = await s.json('POST', '/api/projects', { cookie: bob.cookie, json: { name: 'Client house', orgId, folderId: folder.body.id } })
    const personal = await s.json('POST', '/api/projects', { cookie: bob.cookie, json: { name: 'Private sketch' } })
    const orgCollection = await s.json('POST', '/api/collections', { cookie: bob.cookie, json: { name: 'Studio details', orgId } })
    expect([orgProject.status, personal.status, orgCollection.status]).toEqual([201, 201, 201])

    const result = await hardDeleteUser(s.deps.db, s.deps.events, bob.id, s.deps.log)
    expect(result?.projects).toEqual([personal.body.id])

    expect(await projectRow(personal.body.id)).toBeUndefined()
    const kept = await projectRow(orgProject.body.id)
    expect(kept).toMatchObject({ ownerId: alice.id, orgId, folderId: folder.body.id })
    const [f] = await s.deps.db.select().from(folders).where(eq(folders.id, folder.body.id))
    expect(f?.ownerId).toBe(alice.id)
    const [col] = await s.deps.db.select().from(collections).where(eq(collections.id, orgCollection.body.id))
    expect(col?.ownerId).toBe(alice.id)
    expect((await s.json('GET', `/api/projects/${orgProject.body.id}`, { cookie: alice.cookie })).body.role).toBe('owner')
  })

  it('deletes the projects of an organisation nobody else is left in', async () => {
    const carol = await s.signup('del-carol@example.com')
    await s.setVerified(carol.id)
    const org = await s.json('POST', '/api/auth/organization/create', { cookie: carol.cookie, json: { name: 'Solo', slug: 'solo-studio' } })
    const p = await s.json('POST', '/api/projects', { cookie: carol.cookie, json: { name: 'Solo work', orgId: org.body.id } })
    const result = await hardDeleteUser(s.deps.db, s.deps.events, carol.id, s.deps.log)
    expect(result?.projects).toEqual([p.body.id])
    expect(await projectRow(p.body.id)).toBeUndefined()
    expect(await s.deps.db.select().from(organization).where(eq(organization.id, org.body.id))).toHaveLength(0)
  })
})
