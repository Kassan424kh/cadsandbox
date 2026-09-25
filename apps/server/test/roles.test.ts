import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { member, organization, orgProjectGrants, projectMembers, projects, shareLinks, supportGrants, tickets } from '../src/db/schema'
import { hashSecret, hashToken, newId } from '../src/lib/crypto'
import { resolveProjectAccess, type Viewer } from '../src/services/access'
import { listProjects } from '../src/services/projects'
import { testServer, type TestServer, type TestUser } from './helpers'

let s: TestServer
const u: Record<string, TestUser> = {}
const P = 'proj-roles-1'
const TOKEN = 'tok_' + 'a'.repeat(40)
const PW_TOKEN = 'tok_' + 'b'.repeat(40)
const VIEW_TOKEN = 'tok_' + 'c'.repeat(40)

const role = async (v: Partial<Viewer>, opts: { includeDeleted?: boolean; publicSharing?: boolean } = {}) =>
  (await resolveProjectAccess(s.deps.db, P, { userId: null, systemRole: null, ...v }, { publicSharing: opts.publicSharing ?? true, includeDeleted: opts.includeDeleted }))?.role ?? null
const setVisibility = (v: 'private' | 'link' | 'public') => s.deps.db.update(projects).set({ visibility: v }).where(eq(projects.id, P))

beforeAll(async () => {
  s = await testServer()
  for (const n of ['alice', 'bob', 'carol', 'dave', 'erin', 'frank', 'gina', 'sam']) u[n] = await s.signup(`${n}@example.com`)
  await s.setRole(u.sam!.id, 'support')
  const db = s.deps.db
  await db.insert(projects).values({ id: P, ownerId: u.alice!.id, name: 'Roles', visibility: 'link' })
  await db.insert(projectMembers).values([
    { id: newId(), projectId: P, userId: u.bob!.id, role: 'editor' },
    { id: newId(), projectId: P, userId: u.carol!.id, role: 'commenter' },
    { id: newId(), projectId: P, userId: u.dave!.id, role: 'viewer' },
  ])
  await db.insert(organization).values({ id: 'org1', name: 'Org', slug: 'org' })
  await db.insert(member).values([
    { id: newId(), organizationId: 'org1', userId: u.erin!.id, role: 'member' },
    { id: newId(), organizationId: 'org1', userId: u.dave!.id, role: 'member' },
  ])
  await db.insert(orgProjectGrants).values({ projectId: P, orgId: 'org1', role: 'editor' })
  await db.insert(shareLinks).values([
    { id: 'link1', projectId: P, tokenHash: hashToken(TOKEN), role: 'editor' },
    { id: 'link2', projectId: P, tokenHash: hashToken(PW_TOKEN), role: 'viewer', passwordHash: await hashSecret('secret') },
    { id: 'link3', projectId: P, tokenHash: hashToken(VIEW_TOKEN), role: 'viewer' },
  ])
  await db.insert(projectMembers).values({ id: newId(), projectId: P, userId: u.frank!.id, role: 'editor', linkId: 'link1' })
})

afterAll(() => s.close())

describe('effective project role', () => {
  it('owner, direct members and org grants', async () => {
    expect(await role({ userId: u.alice!.id })).toBe('owner')
    expect(await role({ userId: u.bob!.id })).toBe('editor')
    expect(await role({ userId: u.carol!.id })).toBe('commenter')
    expect(await role({ userId: u.erin!.id })).toBe('editor')
    expect(await role({ userId: u.gina!.id })).toBeNull()
  })

  it('takes the maximum over all sources', async () => {
    // dave: direct viewer + org grant editor
    expect(await role({ userId: u.dave!.id })).toBe('editor')
  })

  it('accepted share links count only while links are active', async () => {
    expect(await role({ userId: u.frank!.id })).toBe('editor')
    await setVisibility('private')
    expect(await role({ userId: u.frank!.id })).toBeNull()
    expect(await role({ shareToken: TOKEN })).toBeNull()
    await setVisibility('link')
    await s.deps.db.update(shareLinks).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(shareLinks.id, 'link1'))
    expect(await role({ userId: u.frank!.id })).toBeNull()
    await s.deps.db.update(shareLinks).set({ expiresAt: null }).where(eq(shareLinks.id, 'link1'))
  })

  it('guest credentials: viewer links only; password links only via a signed grant', async () => {
    expect(await role({ shareToken: VIEW_TOKEN })).toBe('viewer')
    // Editor links must be accepted by a signed-in user — the raw token gives guests nothing.
    expect(await role({ shareToken: TOKEN })).toBeNull()
    expect(await role({ userId: u.gina!.id, shareToken: TOKEN })).toBeNull()
    expect(await role({ shareToken: PW_TOKEN })).toBeNull()
    const grant = s.deps.grants.issue('link2', P, null).grant
    const withGrants = { userId: null, systemRole: null, shareToken: grant }
    expect((await resolveProjectAccess(s.deps.db, P, withGrants, { publicSharing: true, grants: s.deps.grants }))?.role).toBe('viewer')
    expect(await resolveProjectAccess(s.deps.db, P, withGrants, { publicSharing: true })).toBeNull()
    // A grant for one project does not open another, and grants for editor links are ignored.
    expect(await resolveProjectAccess(s.deps.db, P, { ...withGrants, shareToken: s.deps.grants.issue('link2', 'other-project', null).grant }, { publicSharing: true, grants: s.deps.grants })).toBeNull()
    expect(await resolveProjectAccess(s.deps.db, P, { ...withGrants, shareToken: s.deps.grants.issue('link1', P, null).grant }, { publicSharing: true, grants: s.deps.grants })).toBeNull()
    expect(await role({ shareToken: 'tok_' + 'z'.repeat(40) })).toBeNull()
    expect(await role({})).toBeNull()
  })

  it('public visibility gives read access to everyone (unless public sharing is disabled)', async () => {
    await setVisibility('public')
    expect(await role({})).toBe('viewer')
    expect(await role({ userId: u.gina!.id })).toBe('viewer')
    expect(await role({ userId: u.bob!.id })).toBe('editor')
    expect(await role({}, { publicSharing: false })).toBeNull()
    await setVisibility('link')
  })

  it('support staff need a valid, unrevoked user grant', async () => {
    const staff = { userId: u.sam!.id, systemRole: 'support' as const }
    expect(await role(staff)).toBeNull()
    await s.deps.db.insert(tickets).values({ id: 't1', userId: u.alice!.id, subject: 'Help' })
    await s.deps.db.insert(supportGrants).values({ id: 'g1', ticketId: 't1', projectId: P, grantedBy: u.alice!.id, expiresAt: new Date(Date.now() + 86_400_000) })
    const a = await resolveProjectAccess(s.deps.db, P, staff, { publicSharing: true })
    expect(a?.role).toBe('viewer')
    expect(a?.via).toBe('support')
    // A non-staff user gets nothing from the grant.
    expect(await role({ userId: u.gina!.id })).toBeNull()
    await s.deps.db.update(supportGrants).set({ revokedAt: new Date() }).where(eq(supportGrants.id, 'g1'))
    expect(await role(staff)).toBeNull()
    await s.deps.db.update(supportGrants).set({ revokedAt: null, expiresAt: new Date(Date.now() - 1000) }).where(eq(supportGrants.id, 'g1'))
    expect(await role(staff)).toBeNull()
  })

  it('trashed projects are only visible to the owner (restore/permanent delete)', async () => {
    await s.deps.db.update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, P))
    expect(await role({ userId: u.alice!.id })).toBeNull()
    expect(await role({ userId: u.alice!.id }, { includeDeleted: true })).toBe('owner')
    expect(await role({ userId: u.bob!.id }, { includeDeleted: true })).toBeNull()
    await s.deps.db.update(projects).set({ deletedAt: null }).where(eq(projects.id, P))
  })

  it('SQL role ranking used for listings matches', async () => {
    const shared = await listProjects(s.deps.db, u.dave!.id, { scope: 'shared', page: 1, pageSize: 10 })
    expect(shared.items.map((p) => [p.id, p.role])).toEqual([[P, 'editor']])
    const none = await listProjects(s.deps.db, u.gina!.id, { scope: 'all', page: 1, pageSize: 10 })
    expect(none.total).toBe(0)
    const mine = await listProjects(s.deps.db, u.alice!.id, { scope: 'mine', page: 1, pageSize: 10 })
    expect(mine.items[0]?.role).toBe('owner')
  })

  it('private projects are 404 (not 403) for outsiders over HTTP', async () => {
    const r = await s.req('GET', `/api/projects/${P}`, { cookie: u.gina!.cookie })
    expect(r.status).toBe(404)
    const anon = await s.req('GET', `/api/projects/${P}`)
    expect(anon.status).toBe(404)
    const viewer = await s.req('PATCH', `/api/projects/${P}`, { cookie: u.carol!.cookie, json: { name: 'x' } })
    expect(viewer.status).toBe(403)
  })
})
