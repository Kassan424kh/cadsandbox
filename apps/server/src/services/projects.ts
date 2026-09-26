// Project queries & mutations shared by routes and jobs.
import { and, count, desc, eq, exists, ilike, inArray, isNotNull, isNull, ne, or, sql, type SQL } from 'drizzle-orm'
import * as Y from 'yjs'
import { docNames, type Page, type ProjectDTO, type ProjectRole, type Schemas, type WriteBlock } from '@cadsandbox/shared'
import { rowsOf, type DbOrTx } from '../db/client'
import { blobs, collabDocs, orgProjectGrants, projectBlobs, projects, recents, stars, user } from '../db/schema'
import type { Deps } from '../deps'
import { newId } from '../lib/crypto'
import { roleFromRank, roleRankSql, type ProjectAccess, type ProjectRow } from './access'

export function projectDTO(p: ProjectRow, ownerName: string, role: ProjectRole, starred: boolean): ProjectDTO {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    ownerId: p.ownerId,
    ownerName,
    orgId: p.orgId,
    folderId: p.folderId,
    visibility: p.visibility,
    role,
    thumbnailUrl: p.thumbnailHash ? `/api/projects/${encodeURIComponent(p.id)}/thumbnail?v=${p.thumbnailHash.slice(0, 16)}` : null,
    starred,
    sizeBytes: Number(p.sizeBytes),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    deletedAt: p.deletedAt ? p.deletedAt.toISOString() : null,
  }
}

export async function accessDTO(db: DbOrTx, a: ProjectAccess, userId: string | null): Promise<ProjectDTO> {
  const [owner] = await db.select({ name: user.name }).from(user).where(eq(user.id, a.project.ownerId)).limit(1)
  let starred = false
  if (userId) {
    const [s] = await db
      .select({ p: stars.projectId })
      .from(stars)
      .where(and(eq(stars.userId, userId), eq(stars.projectId, a.project.id)))
      .limit(1)
    starred = !!s
  }
  return projectDTO(a.project, owner?.name ?? '', a.role, starred)
}

export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`)

export interface ListInput extends Omit<Schemas['listProjects'], 'folderId'> {
  folderId?: string | null
}

/** Projects visible to `userId` for a dashboard scope. */
export async function listProjects(db: DbOrTx, userId: string, q: ListInput): Promise<Page<ProjectDTO>> {
  const rank = roleRankSql(userId)
  const conds: SQL[] = []
  const starredSql = sql<boolean>`EXISTS (SELECT 1 FROM stars s WHERE s.project_id = ${projects.id} AND s.user_id = ${userId})`
  switch (q.scope) {
    case 'mine':
      conds.push(eq(projects.ownerId, userId), isNull(projects.deletedAt))
      break
    case 'shared':
      conds.push(ne(projects.ownerId, userId), isNull(projects.deletedAt), sql`${rank} > 0`)
      break
    case 'org':
      conds.push(
        isNull(projects.deletedAt),
        sql`${rank} > 0`,
        or(
          eq(projects.orgId, q.orgId!),
          exists(
            db
              .select({ x: sql`1` })
              .from(orgProjectGrants)
              .where(and(eq(orgProjectGrants.projectId, projects.id), eq(orgProjectGrants.orgId, q.orgId!))),
          ),
        )!,
      )
      break
    case 'trash':
      conds.push(eq(projects.ownerId, userId), isNotNull(projects.deletedAt))
      break
    case 'starred':
      conds.push(isNull(projects.deletedAt), sql`${rank} > 0`, starredSql)
      break
    case 'recent':
      conds.push(isNull(projects.deletedAt), sql`${rank} > 0`, sql`EXISTS (SELECT 1 FROM recents r WHERE r.project_id = ${projects.id} AND r.user_id = ${userId})`)
      break
    default:
      conds.push(isNull(projects.deletedAt), sql`${rank} > 0`)
  }
  if (q.folderId !== undefined) conds.push(q.folderId === null ? isNull(projects.folderId) : eq(projects.folderId, q.folderId))
  if (q.q) conds.push(ilike(projects.name, `%${escapeLike(q.q)}%`))
  const where = and(...conds)

  const order =
    q.scope === 'recent'
      ? [desc(sql`(SELECT r.opened_at FROM recents r WHERE r.project_id = ${projects.id} AND r.user_id = ${userId})`)]
      : q.scope === 'trash'
        ? [desc(projects.deletedAt)]
        : [desc(projects.updatedAt), desc(projects.id)]

  const [rows, [total]] = await Promise.all([
    db
      .select({ p: projects, ownerName: user.name, rank, starred: starredSql })
      .from(projects)
      .innerJoin(user, eq(user.id, projects.ownerId))
      .where(where)
      .orderBy(...order)
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ n: count() }).from(projects).where(where),
  ])
  return {
    items: rows.map((r) => projectDTO(r.p, r.ownerName, roleFromRank(Number(r.rank)) ?? 'viewer', !!r.starred)),
    total: Number(total?.n ?? 0),
    page: q.page,
    pageSize: q.pageSize,
  }
}

export async function touchRecent(db: DbOrTx, userId: string, projectId: string): Promise<void> {
  await db
    .insert(recents)
    .values({ userId, projectId, openedAt: new Date() })
    .onConflictDoUpdate({ target: [recents.userId, recents.projectId], set: { openedAt: new Date() } })
}

/**
 * Bytes charged to a user's quota: distinct blobs of owned projects + own assets + collab docs +
 * library items (JSON payload and thumbnail) in the user's collections.
 */
export async function storageUsage(db: DbOrTx, userId: string): Promise<number> {
  const res = await db.execute(sql`SELECT (
      SELECT COALESCE(SUM(b.size), 0) FROM blobs b WHERE b.hash IN (
        SELECT pb.hash FROM project_blobs pb JOIN projects p ON p.id = pb.project_id WHERE p.owner_id = ${userId}
        UNION SELECT ua.hash FROM user_assets ua WHERE ua.user_id = ${userId}
        UNION SELECT p.thumbnail_hash FROM projects p WHERE p.owner_id = ${userId} AND p.thumbnail_hash IS NOT NULL)
    ) + (SELECT COALESCE(SUM(cd.size), 0) FROM collab_docs cd JOIN projects p ON p.id = cd.project_id WHERE p.owner_id = ${userId})
      + (SELECT COALESCE(SUM(octet_length(COALESCE(ci.payload::text, '')) + octet_length(COALESCE(ci.thumbnail, ''))), 0)
           FROM collection_items ci JOIN collections col ON col.id = ci.collection_id WHERE col.owner_id = ${userId}) AS n`)
  return Number(rowsOf<{ n: string | number }>(res)[0]?.n ?? 0)
}

export interface WriteLimits {
  storageQuotaBytes: number
  maxDocBytes: number
}

/**
 * Why edits to a project's documents are paused for everyone: one of its designs outgrew the
 * per-document limit, or its owner is out of storage (the owner pays for shared projects). null = OK.
 */
export async function writeBlock(db: DbOrTx, project: { id: string; ownerId: string }, limits: WriteLimits): Promise<WriteBlock | null> {
  const [big] = await db
    .select({ name: collabDocs.name })
    .from(collabDocs)
    .where(and(eq(collabDocs.projectId, project.id), sql`${collabDocs.size} > ${limits.maxDocBytes}`))
    .limit(1)
  if (big) return 'design_too_large'
  if ((await storageUsage(db, project.ownerId)) >= limits.storageQuotaBytes) return 'storage_full'
  return null
}

/** Recompute projects.size_bytes (docs + distinct blobs + thumbnail). */
export async function refreshProjectSize(db: DbOrTx, projectId: string, touch = false): Promise<void> {
  await db
    .update(projects)
    .set({
      sizeBytes: sql`(SELECT COALESCE(SUM(cd.size), 0) FROM ${collabDocs} cd WHERE cd.project_id = ${projectId})
        + (SELECT COALESCE(SUM(b.size), 0) FROM ${blobs} b WHERE b.hash IN (
            SELECT pb.hash FROM ${projectBlobs} pb WHERE pb.project_id = ${projectId}
            UNION SELECT p2.thumbnail_hash FROM ${projects} p2 WHERE p2.id = ${projectId} AND p2.thumbnail_hash IS NOT NULL))`,
      ...(touch ? { updatedAt: new Date() } : {}),
    })
    .where(eq(projects.id, projectId))
}

/** Cloud projects counted against the project limit — trashed ones don't count. */
export async function countOwnedProjects(db: DbOrTx, userId: string): Promise<number> {
  const [r] = await db
    .select({ n: count() })
    .from(projects)
    .where(and(eq(projects.ownerId, userId), isNull(projects.deletedAt)))
  return Number(r?.n ?? 0)
}

/** Names of all collab docs of a project: persisted ones plus any live, not-yet-stored ones. */
export async function projectDocNames(db: DbOrTx, projectId: string, live: string[] = []): Promise<string[]> {
  const rows = await db.select({ name: collabDocs.name }).from(collabDocs).where(eq(collabDocs.projectId, projectId))
  return [...new Set([...rows.map((r) => r.name), ...live])].sort()
}

/** Rewrite the manifest's project name in a Yjs state (used by duplicate). */
export function renameManifestState(state: Uint8Array, name: string): Uint8Array {
  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, state)
    doc.transact(() => doc.getMap('project').set('name', name))
    return Y.encodeStateAsUpdate(doc)
  } finally {
    doc.destroy()
  }
}

/** Copy a project: row, collab docs (manifest renamed), blob references. Not members/links. */
export async function duplicateProject(
  deps: Deps,
  source: ProjectRow,
  ownerId: string,
  input: { name?: string; folderId?: string | null },
): Promise<ProjectRow> {
  const id = newId()
  const name = (input.name ?? `${source.name} (copy)`).slice(0, 120)
  const docs = await projectDocNames(deps.db, source.id, deps.collab.liveDocNames(source.id))
  const states: { name: string; state: Uint8Array }[] = []
  for (const docName of docs) {
    const parsed = docNames.parse(docName)
    if (!parsed || parsed.projectId !== source.id) continue
    const state = await deps.collab.getState(docName)
    if (!state) continue
    const target = parsed.fileId ? docNames.file(id, parsed.fileId) : docNames.manifest(id)
    states.push({ name: target, state: parsed.fileId ? state : renameManifestState(state, name) })
  }
  const sameOwner = source.ownerId === ownerId
  const [row] = await deps.db.transaction(async (tx) => {
    const inserted = await tx
      .insert(projects)
      .values({
        id,
        ownerId,
        orgId: sameOwner ? source.orgId : null,
        folderId: input.folderId !== undefined ? input.folderId : sameOwner ? source.folderId : null,
        visibility: 'private',
        name,
        description: source.description,
        thumbnailHash: source.thumbnailHash,
      })
      .returning()
    await tx.execute(sql`INSERT INTO project_blobs (project_id, hash) SELECT ${id}, hash FROM project_blobs WHERE project_id = ${source.id} ON CONFLICT DO NOTHING`)
    if (sameOwner && source.orgId) {
      await tx.execute(sql`INSERT INTO org_project_grants (project_id, org_id, role, added_by) SELECT ${id}, org_id, role, ${ownerId} FROM org_project_grants WHERE project_id = ${source.id} AND org_id = ${source.orgId} ON CONFLICT DO NOTHING`)
    }
    return inserted
  })
  for (const s of states) await deps.collab.writeState(s.name, id, s.state)
  await refreshProjectSize(deps.db, id)
  return row!
}

/** Permanently delete projects (cascade removes docs, versions, members, links, grants, blob refs). */
export async function hardDeleteProjects(deps: Deps, ids: string[]): Promise<void> {
  if (!ids.length) return
  for (const id of ids) await deps.collab.closeProject(id)
  await deps.db.delete(projects).where(inArray(projects.id, ids))
  for (const id of ids) deps.events.projectChanged(id)
}
