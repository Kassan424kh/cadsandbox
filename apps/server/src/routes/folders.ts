// Folders — personal space (owner) or organisation space (org admins manage, members read).
import type { Hono } from 'hono'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { canOrg, schemas, type FolderDTO } from '@cadsandbox/shared'
import type { DbOrTx } from '../db/client'
import { folders, projects } from '../db/schema'
import { newId } from '../lib/crypto'
import { badRequest, forbidden, notFound } from '../lib/errors'
import { jsonBody, param, requireAuth, type AppEnv } from '../http/context'
import { jsonLimit, KB, register } from '../http/router'
import { membershipRole } from '../services/orgs'

type FolderRow = typeof folders.$inferSelect

const folderDTO = (f: FolderRow): FolderDTO => ({
  id: f.id,
  name: f.name,
  parentId: f.parentId,
  orgId: f.orgId,
  createdAt: f.createdAt.toISOString(),
  updatedAt: f.updatedAt.toISOString(),
})

/** Can `userId` read / manage folder `f`? Org folders: members read, org admins manage. */
export async function folderAccess(db: DbOrTx, f: FolderRow, userId: string): Promise<'read' | 'manage' | null> {
  if (!f.orgId) return f.ownerId === userId ? 'manage' : null
  const role = await membershipRole(db, f.orgId, userId)
  if (!role) return null
  return canOrg(role, 'manageProjects') || f.ownerId === userId ? 'manage' : 'read'
}

export async function loadFolder(db: DbOrTx, id: string, userId: string, need: 'read' | 'manage'): Promise<FolderRow> {
  const [f] = await db.select().from(folders).where(eq(folders.id, id)).limit(1)
  const a = f ? await folderAccess(db, f, userId) : null
  if (!f || !a) throw notFound('Folder not found')
  if (need === 'manage' && a !== 'manage') throw forbidden()
  return f
}

/** A project may live in its owner's personal folders or in folders of its organisation. */
export async function assertProjectFolder(db: DbOrTx, folderId: string, project: { ownerId: string; orgId: string | null }, userId: string): Promise<void> {
  const f = await loadFolder(db, folderId, userId, 'read')
  const ok = f.orgId ? f.orgId === project.orgId : f.ownerId === project.ownerId && !project.orgId
  if (!ok) throw badRequest('Folder belongs to a different space')
}

async function assertNoCycle(db: DbOrTx, folderId: string, newParent: string): Promise<void> {
  let cur: string | null = newParent
  for (let depth = 0; cur; depth++) {
    if (cur === folderId || depth > 64) throw badRequest('Folder cannot be moved into itself')
    const [p] = await db.select({ parentId: folders.parentId }).from(folders).where(eq(folders.id, cur)).limit(1)
    cur = p?.parentId ?? null
  }
}

export function folderRoutes(app: Hono<AppEnv>): void {
  register(app, 'listFolders', async (c) => {
    const s = requireAuth(c)
    const { db } = c.get('deps')
    const orgId = c.req.query('orgId')
    if (orgId) {
      if (!(await membershipRole(db, orgId, s.user.id))) throw notFound('Organisation not found')
      const rows = await db.select().from(folders).where(eq(folders.orgId, orgId)).orderBy(asc(folders.name))
      return c.json(rows.map(folderDTO))
    }
    const rows = await db
      .select()
      .from(folders)
      .where(and(eq(folders.ownerId, s.user.id), isNull(folders.orgId)))
      .orderBy(asc(folders.name))
    return c.json(rows.map(folderDTO))
  })

  register(app, 'createFolder', jsonLimit(16 * KB), async (c) => {
    const s = requireAuth(c)
    const { db } = c.get('deps')
    const input = await jsonBody(c, schemas.createFolder)
    const orgId = input.orgId ?? null
    if (orgId) {
      const role = await membershipRole(db, orgId, s.user.id)
      if (!role) throw notFound('Organisation not found')
      if (!canOrg(role, 'manageProjects')) throw forbidden()
    }
    if (input.parentId) {
      const parent = await loadFolder(db, input.parentId, s.user.id, 'manage')
      if ((parent.orgId ?? null) !== orgId) throw badRequest('Parent folder belongs to a different space')
    }
    const [row] = await db
      .insert(folders)
      .values({ id: newId(), ownerId: s.user.id, orgId, parentId: input.parentId ?? null, name: input.name })
      .returning()
    return c.json(folderDTO(row!), 201)
  })

  register(app, 'updateFolder', jsonLimit(16 * KB), async (c) => {
    const s = requireAuth(c)
    const { db } = c.get('deps')
    const f = await loadFolder(db, param(c, 'id'), s.user.id, 'manage')
    const input = await jsonBody(c, schemas.updateFolder)
    const patch: Partial<FolderRow> = { updatedAt: new Date() }
    if (input.name !== undefined) patch.name = input.name
    if (input.parentId !== undefined) {
      if (input.parentId) {
        const parent = await loadFolder(db, input.parentId, s.user.id, 'manage')
        if ((parent.orgId ?? null) !== (f.orgId ?? null)) throw badRequest('Parent folder belongs to a different space')
        await assertNoCycle(db, f.id, input.parentId)
      }
      patch.parentId = input.parentId
    }
    const [row] = await db.update(folders).set(patch).where(eq(folders.id, f.id)).returning()
    return c.json(folderDTO(row!))
  })

  register(app, 'deleteFolder', async (c) => {
    const s = requireAuth(c)
    const { db } = c.get('deps')
    const f = await loadFolder(db, param(c, 'id'), s.user.id, 'manage')
    await db.transaction(async (tx) => {
      // Contents move up one level (projects and sub-folders are never deleted with the folder).
      await tx.update(projects).set({ folderId: f.parentId }).where(eq(projects.folderId, f.id))
      await tx.update(folders).set({ parentId: f.parentId, updatedAt: new Date() }).where(eq(folders.parentId, f.id))
      await tx.delete(folders).where(eq(folders.id, f.id))
    })
    return c.json({ ok: true })
  })
}
