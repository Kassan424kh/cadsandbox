// Library collections (personal or organisation) and their items. Item assets must live in the
// creator's own asset space — referencing someone else's hash would otherwise leak access to it.
import type { Hono } from 'hono'
import { and, asc, count, eq, inArray, isNull, or } from 'drizzle-orm'
import { canOrg, schemas, type CollectionDTO, type CollectionItemDTO } from '@cadsandbox/shared'
import type { DbOrTx } from '../db/client'
import { collectionItems, collections, member, userAssets } from '../db/schema'
import { newId } from '../lib/crypto'
import { badRequest, forbidden, notFound } from '../lib/errors'
import { jsonBody, param, requireAuth, requireRealUser, type AppEnv } from '../http/context'
import { jsonLimit, KB, MB, register } from '../http/router'
import { membershipRole } from '../services/orgs'
import { assertQuota } from '../services/uploads'

type CollectionRow = typeof collections.$inferSelect
const THUMB = /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/

const collectionDTO = (c: CollectionRow, itemCount: number): CollectionDTO => ({
  id: c.id,
  name: c.name,
  orgId: c.orgId,
  itemCount,
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
})

const itemDTO = (i: typeof collectionItems.$inferSelect): CollectionItemDTO => ({
  id: i.id,
  collectionId: i.collectionId,
  name: i.name,
  kind: i.kind,
  tags: i.tags,
  thumbnail: i.thumbnail ?? null,
  payload: i.payload,
  assets: i.assets,
  createdAt: i.createdAt.toISOString(),
})

/** 'read' for org members, 'write' (add items) for members/owner, 'manage' for owner or org admins. */
async function collectionAccess(db: DbOrTx, col: CollectionRow, userId: string): Promise<'read' | 'write' | 'manage' | null> {
  if (!col.orgId) return col.ownerId === userId ? 'manage' : null
  const role = await membershipRole(db, col.orgId, userId)
  if (!role) return null
  if (col.ownerId === userId || canOrg(role, 'manageProjects')) return 'manage'
  return 'write'
}

async function loadCollection(db: DbOrTx, id: string, userId: string, need: 'read' | 'write' | 'manage') {
  const [col] = await db.select().from(collections).where(eq(collections.id, id)).limit(1)
  const a = col ? await collectionAccess(db, col, userId) : null
  if (!col || !a) throw notFound('Collection not found')
  const rank = { read: 1, write: 2, manage: 3 }
  if (rank[a] < rank[need]) throw forbidden()
  return { col, access: a }
}

/** Library items and their assets are user content: not available to impersonating admins. */
const LIBRARY_BLOCKED = 'The library is not available while impersonating a user'

export function collectionRoutes(app: Hono<AppEnv>): void {
  register(app, 'listCollections', async (c) => {
    const s = requireAuth(c)
    const { db } = c.get('deps')
    const orgIds = (await db.select({ id: member.organizationId }).from(member).where(eq(member.userId, s.user.id))).map((r) => r.id)
    const cols = await db
      .select()
      .from(collections)
      .where(or(and(eq(collections.ownerId, s.user.id), isNull(collections.orgId)), orgIds.length ? inArray(collections.orgId, orgIds) : undefined))
      .orderBy(asc(collections.name))
    const counts = cols.length
      ? await db
          .select({ id: collectionItems.collectionId, n: count() })
          .from(collectionItems)
          .where(
            inArray(
              collectionItems.collectionId,
              cols.map((x) => x.id),
            ),
          )
          .groupBy(collectionItems.collectionId)
      : []
    const byId = new Map(counts.map((r) => [r.id, Number(r.n)]))
    return c.json(cols.map((x) => collectionDTO(x, byId.get(x.id) ?? 0)))
  })

  register(app, 'createCollection', jsonLimit(8 * KB), async (c) => {
    const s = requireRealUser(c, LIBRARY_BLOCKED)
    const { db } = c.get('deps')
    const input = await jsonBody(c, schemas.createCollection)
    const orgId = input.orgId ?? null
    if (orgId && !(await membershipRole(db, orgId, s.user.id))) throw notFound('Organisation not found')
    const [row] = await db.insert(collections).values({ id: newId(), ownerId: s.user.id, orgId, name: input.name }).returning()
    return c.json(collectionDTO(row!, 0), 201)
  })

  register(app, 'updateCollection', jsonLimit(8 * KB), async (c) => {
    const s = requireRealUser(c, LIBRARY_BLOCKED)
    const { db } = c.get('deps')
    const { col } = await loadCollection(db, param(c, 'id'), s.user.id, 'manage')
    const { name } = await jsonBody(c, schemas.updateCollection)
    const [row] = await db.update(collections).set({ name, updatedAt: new Date() }).where(eq(collections.id, col.id)).returning()
    const [n] = await db.select({ n: count() }).from(collectionItems).where(eq(collectionItems.collectionId, col.id))
    return c.json(collectionDTO(row!, Number(n?.n ?? 0)))
  })

  register(app, 'deleteCollection', async (c) => {
    const s = requireRealUser(c, LIBRARY_BLOCKED)
    const { db } = c.get('deps')
    const { col } = await loadCollection(db, param(c, 'id'), s.user.id, 'manage')
    await db.delete(collections).where(eq(collections.id, col.id))
    return c.json({ ok: true })
  })

  register(app, 'listCollectionItems', async (c) => {
    const s = requireRealUser(c, LIBRARY_BLOCKED)
    const { db } = c.get('deps')
    const { col } = await loadCollection(db, param(c, 'id'), s.user.id, 'read')
    const rows = await db.select().from(collectionItems).where(eq(collectionItems.collectionId, col.id)).orderBy(asc(collectionItems.createdAt)).limit(2000)
    return c.json(rows.map(itemDTO))
  })

  register(app, 'createCollectionItem', jsonLimit(8 * MB), async (c) => {
    const s = requireRealUser(c, LIBRARY_BLOCKED)
    const { db } = c.get('deps')
    const { col } = await loadCollection(db, param(c, 'id'), s.user.id, 'write')
    const input = await jsonBody(c, schemas.createCollectionItem)
    if (input.thumbnail && !THUMB.test(input.thumbnail)) throw badRequest('thumbnail must be a data:image URL (webp/png/jpeg)')
    // Library items count toward the creator's storage (see storageUsage).
    const bytes = Buffer.byteLength(JSON.stringify(input.payload ?? null)) + (input.thumbnail?.length ?? 0)
    await assertQuota(db, s.user.id, c.get('deps').config.storageQuotaBytes, bytes)
    const assets = [...new Set(input.assets)]
    if (assets.length) {
      const owned = await db
        .select({ hash: userAssets.hash })
        .from(userAssets)
        .where(and(eq(userAssets.userId, s.user.id), inArray(userAssets.hash, assets)))
      if (owned.length !== assets.length) throw badRequest('Upload every referenced asset to /api/assets/:hash first')
    }
    const [row] = await db
      .insert(collectionItems)
      .values({ id: newId(), collectionId: col.id, name: input.name, kind: input.kind, tags: input.tags, thumbnail: input.thumbnail ?? null, payload: input.payload ?? null, assets, createdBy: s.user.id })
      .returning()
    await db.update(collections).set({ updatedAt: new Date() }).where(eq(collections.id, col.id))
    return c.json(itemDTO(row!), 201)
  })

  register(app, 'deleteCollectionItem', async (c) => {
    const s = requireRealUser(c, LIBRARY_BLOCKED)
    const { db } = c.get('deps')
    const { col, access } = await loadCollection(db, param(c, 'id'), s.user.id, 'write')
    const [item] = await db
      .select()
      .from(collectionItems)
      .where(and(eq(collectionItems.id, param(c, 'itemId')), eq(collectionItems.collectionId, col.id)))
      .limit(1)
    if (!item) throw notFound('Item not found')
    if (access !== 'manage' && item.createdBy !== s.user.id) throw forbidden()
    await db.delete(collectionItems).where(eq(collectionItems.id, item.id))
    return c.json({ ok: true })
  })
}
