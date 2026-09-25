// Projects: list/create/get/update, trash/restore/permanent delete, duplicate, thumbnails, org listing.
import type { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { docNames, LIMITS, schemas, type ProjectDTO } from '@cadsandbox/shared'
import { blobs, orgProjectGrants, projects, stars } from '../db/schema'
import { newId, sha256Hex } from '../lib/crypto'
import { badRequest, conflict, forbidden, notFound, quotaExceeded } from '../lib/errors'
import { isImpersonating, jsonBody, optionalJsonBody, param, projectAccess, queryParams, requireAuth, requireRealUser, sessionOf, type AppEnv, type Ctx } from '../http/context'
import { jsonLimit, KB, register } from '../http/router'
import { isStaff } from '../services/access'
import { audit } from '../services/audit'
import { membershipRole } from '../services/orgs'
import { accessDTO, countOwnedProjects, duplicateProject, hardDeleteProjects, listProjects, projectDTO, refreshProjectSize, storageUsage, touchRecent } from '../services/projects'
import { readLimited } from '../services/uploads'
import { systemRole } from '../services/users'
import { assertProjectFolder } from './folders'
import { safeContentType, sniffMime } from '../storage'

/** Impersonating admins see project metadata, never content previews (thumbnails are content). */
const forImpersonation = (c: Ctx, p: ProjectDTO): ProjectDTO => {
  const s = sessionOf(c)
  return s && isImpersonating(s) ? { ...p, thumbnailUrl: null } : p
}

const folderParam = (q: Record<string, string>) => {
  const out: Record<string, unknown> = { ...q }
  if ('folderId' in q) out.folderId = q.folderId === '' || q.folderId === 'null' || q.folderId === 'root' ? null : q.folderId
  return out
}

async function assertProjectQuota(c: Ctx, userId: string): Promise<void> {
  const d = c.get('deps')
  const s = sessionOf(c)
  if (s && isStaff(systemRole(s.user.role))) return
  if ((await countOwnedProjects(d.db, userId)) >= d.config.maxProjectsFree) throw quotaExceeded(`Project limit reached (${d.config.maxProjectsFree})`)
}

export function projectRoutes(app: Hono<AppEnv>): void {
  register(app, 'listProjects', async (c) => {
    const s = requireAuth(c)
    const d = c.get('deps')
    const q = queryParams(c, schemas.listProjects, folderParam)
    if (q.scope === 'org') {
      if (!q.orgId || !(await membershipRole(d.db, q.orgId, s.user.id))) throw notFound('Organisation not found')
    }
    const page = await listProjects(d.db, s.user.id, q)
    return c.json({ ...page, items: page.items.map((p) => forImpersonation(c, p)) })
  })

  register(app, 'createProject', jsonLimit(16 * KB), async (c) => {
    const s = requireAuth(c)
    const d = c.get('deps')
    const input = await jsonBody(c, schemas.createProject)
    await assertProjectQuota(c, s.user.id)
    const orgId = input.orgId ?? null
    if (orgId && !(await membershipRole(d.db, orgId, s.user.id))) throw notFound('Organisation not found')
    if (input.folderId) await assertProjectFolder(d.db, input.folderId, { ownerId: s.user.id, orgId }, s.user.id)
    const id = input.id ?? newId()
    const [exists] = await d.db.select({ id: projects.id }).from(projects).where(eq(projects.id, id)).limit(1)
    if (exists) throw conflict('Project id already exists')
    const row = await d.db.transaction(async (tx) => {
      const [p] = await tx
        .insert(projects)
        .values({ id, ownerId: s.user.id, orgId, folderId: input.folderId ?? null, name: input.name, description: input.description ?? '' })
        .returning()
      // Projects created in an organisation space are editable by its members.
      if (orgId) await tx.insert(orgProjectGrants).values({ projectId: id, orgId, role: 'editor', addedBy: s.user.id })
      return p!
    })
    return c.json(projectDTO(row, s.user.name, 'owner', false), 201)
  })

  register(app, 'getProject', async (c) => {
    const a = await projectAccess(c, param(c, 'id'), 'view', { includeDeleted: true, metadata: true })
    const d = c.get('deps')
    const s = sessionOf(c)
    const uid = s?.user.id ?? null
    const impersonating = !!s && isImpersonating(s)
    if (uid && !a.project.deletedAt && a.via !== 'support' && !impersonating) await touchRecent(d.db, uid, a.project.id)
    const dto = await accessDTO(d.db, a, uid)
    // Impersonation: content is at most readable (with the user's support grant), never writable.
    return c.json(impersonating ? { ...forImpersonation(c, dto), role: 'viewer' as const } : dto)
  })

  register(app, 'updateProject', jsonLimit(16 * KB), async (c) => {
    const s = requireAuth(c)
    const d = c.get('deps')
    const id = param(c, 'id')
    const input = await jsonBody(c, schemas.updateProject)
    const manages = input.name !== undefined || input.description !== undefined || input.folderId !== undefined || input.visibility !== undefined
    if (input.visibility !== undefined) requireRealUser(c, 'Sharing changes are not allowed while impersonating a user')
    let a = await projectAccess(c, id, manages ? 'manage' : 'view', { metadata: true })
    if (a.via === 'support') throw forbidden('Support access is read-only')
    if (input.starred !== undefined) {
      if (input.starred) await d.db.insert(stars).values({ userId: s.user.id, projectId: id }).onConflictDoNothing()
      else await d.db.delete(stars).where(and(eq(stars.userId, s.user.id), eq(stars.projectId, id)))
    }
    if (manages) {
      if (input.visibility === 'public' && !d.config.features.publicSharing) throw badRequest('Public sharing is disabled on this server')
      if (input.folderId) await assertProjectFolder(d.db, input.folderId, a.project, s.user.id)
      const patch: Partial<typeof projects.$inferInsert> = { updatedAt: new Date() }
      if (input.name !== undefined) patch.name = input.name
      if (input.description !== undefined) patch.description = input.description
      if (input.folderId !== undefined) patch.folderId = input.folderId
      if (input.visibility !== undefined) patch.visibility = input.visibility
      const [row] = await d.db.update(projects).set(patch).where(eq(projects.id, id)).returning()
      if (input.visibility !== undefined && input.visibility !== a.project.visibility) {
        await audit(d.db, { actorId: s.user.id, actorEmail: s.user.email, action: 'project.visibility', targetType: 'project', targetId: id, ip: c.get('ip'), meta: { from: a.project.visibility, to: input.visibility } }, d.log)
        d.events.projectChanged(id)
      }
      if ((input.name !== undefined || input.description !== undefined) && (await d.collab.getState(docNames.manifest(id)))) {
        await d.collab.transact(docNames.manifest(id), (doc) => {
          const info = doc.getMap<unknown>('project')
          if (input.name !== undefined && info.get('name') !== input.name) info.set('name', input.name)
          if (input.description !== undefined && info.get('description') !== input.description) info.set('description', input.description)
        })
      }
      a = { ...a, project: row! }
    }
    return c.json(forImpersonation(c, await accessDTO(d.db, a, s.user.id)))
  })

  register(app, 'trashProject', async (c) => {
    const s = requireAuth(c)
    const d = c.get('deps')
    const a = await projectAccess(c, param(c, 'id'), 'manage', { metadata: true })
    const [row] = await d.db.update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, a.project.id)).returning()
    await audit(d.db, { actorId: s.user.id, actorEmail: s.user.email, action: 'project.trash', targetType: 'project', targetId: a.project.id, ip: c.get('ip') }, d.log)
    d.events.projectChanged(a.project.id)
    return c.json(projectDTO(row!, s.user.name, 'owner', false))
  })

  register(app, 'restoreProject', async (c) => {
    const s = requireAuth(c)
    const d = c.get('deps')
    const a = await projectAccess(c, param(c, 'id'), 'manage', { includeDeleted: true, metadata: true })
    if (!a.project.deletedAt) return c.json(await accessDTO(d.db, a, s.user.id))
    const [row] = await d.db.update(projects).set({ deletedAt: null, updatedAt: new Date() }).where(eq(projects.id, a.project.id)).returning()
    await audit(d.db, { actorId: s.user.id, actorEmail: s.user.email, action: 'project.restore', targetType: 'project', targetId: a.project.id, ip: c.get('ip') }, d.log)
    return c.json(await accessDTO(d.db, { ...a, project: row! }, s.user.id))
  })

  register(app, 'deleteProject', async (c) => {
    const s = requireRealUser(c, 'Deleting projects permanently is not allowed while impersonating a user')
    const d = c.get('deps')
    const a = await projectAccess(c, param(c, 'id'), 'delete', { includeDeleted: true, metadata: true })
    await hardDeleteProjects(d, [a.project.id])
    await audit(d.db, { actorId: s.user.id, actorEmail: s.user.email, action: 'project.delete', targetType: 'project', targetId: a.project.id, ip: c.get('ip'), meta: { name: a.project.name } }, d.log)
    return c.json({ ok: true })
  })

  register(app, 'duplicateProject', jsonLimit(16 * KB), async (c) => {
    const s = requireRealUser(c, 'Copying projects is not allowed while impersonating a user')
    const d = c.get('deps')
    const a = await projectAccess(c, param(c, 'id'), 'view')
    if (a.via === 'support') throw notFound('Project not found')
    const input = await optionalJsonBody(c, schemas.duplicateProject)
    await assertProjectQuota(c, s.user.id)
    if ((await storageUsage(d.db, s.user.id)) + Number(a.project.sizeBytes) > d.config.storageQuotaBytes) throw quotaExceeded()
    const sameOwner = a.project.ownerId === s.user.id
    if (input.folderId) await assertProjectFolder(d.db, input.folderId, { ownerId: s.user.id, orgId: sameOwner ? a.project.orgId : null }, s.user.id)
    const row = await duplicateProject(d, a.project, s.user.id, input)
    await audit(d.db, { actorId: s.user.id, actorEmail: s.user.email, action: 'project.duplicate', targetType: 'project', targetId: row.id, ip: c.get('ip'), meta: { source: a.project.id } }, d.log)
    return c.json(projectDTO(row, s.user.name, 'owner', false), 201)
  })

  register(app, 'putThumbnail', async (c) => {
    requireAuth(c)
    const d = c.get('deps')
    const a = await projectAccess(c, param(c, 'id'), 'edit')
    const data = await readLimited(c.req.raw.body, LIMITS.maxThumbnailBytes)
    const mime = sniffMime(data.subarray(0, 64))
    if (mime !== 'image/webp' && mime !== 'image/png') throw badRequest('Thumbnail must be image/webp or image/png')
    const hash = sha256Hex(data)
    const [existing] = await d.db.select().from(blobs).where(eq(blobs.hash, hash)).limit(1)
    if (!existing || !(await d.blobs.exists(hash, existing.encrypted))) {
      const { encrypted } = await d.blobs.putBuffer(hash, data)
      await d.db.insert(blobs).values({ hash, size: data.length, mime, encrypted }).onConflictDoUpdate({ target: blobs.hash, set: { encrypted } })
    }
    await d.db.update(projects).set({ thumbnailHash: hash }).where(eq(projects.id, a.project.id))
    await refreshProjectSize(d.db, a.project.id)
    return c.json({ thumbnailUrl: `/api/projects/${encodeURIComponent(a.project.id)}/thumbnail?v=${hash.slice(0, 16)}` })
  })

  register(app, 'getThumbnail', async (c) => {
    const d = c.get('deps')
    const a = await projectAccess(c, param(c, 'id'), 'view', { includeDeleted: true })
    const hash = a.project.thumbnailHash
    if (!hash) throw notFound('No thumbnail')
    const [b] = await d.db.select().from(blobs).where(eq(blobs.hash, hash)).limit(1)
    if (!b) throw notFound('No thumbnail')
    const etag = `"${hash}"`
    const versioned = c.req.query('v') === hash.slice(0, 16)
    const headers: Record<string, string> = {
      'Content-Type': safeContentType(b.mime),
      ETag: etag,
      'Cache-Control': versioned ? 'private, max-age=31536000, immutable' : 'private, no-cache',
    }
    if (c.req.header('if-none-match') === etag) return new Response(null, { status: 304, headers })
    if (c.req.method === 'HEAD') return new Response(null, { status: 200, headers: { ...headers, 'Content-Length': String(b.size) } })
    const data = await d.blobs.getBuffer(hash, b.encrypted, LIMITS.maxThumbnailBytes * 2)
    if (!data) throw notFound('No thumbnail')
    return new Response(new Uint8Array(data), { headers: { ...headers, 'Content-Length': String(data.length) } })
  })

  register(app, 'orgProjects', async (c) => {
    const s = requireAuth(c)
    const d = c.get('deps')
    const orgId = param(c, 'orgId')
    if (!(await membershipRole(d.db, orgId, s.user.id))) throw notFound('Organisation not found')
    const page = await listProjects(d.db, s.user.id, { scope: 'org', orgId, page: 1, pageSize: 1000 })
    return c.json(page.items.map((p) => forImpersonation(c, p)) satisfies ProjectDTO[])
  })
}
