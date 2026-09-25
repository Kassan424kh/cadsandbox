// Version snapshots of collab docs (named + hourly auto versions).
import { and, desc, eq, sql } from 'drizzle-orm'
import type { VersionDTO } from '@cadsandbox/shared'
import type { DbOrTx } from '../db/client'
import { user, versions } from '../db/schema'
import { newId, openRecord, sealRecord, type KeyRing } from '../lib/crypto'

export type VersionRow = typeof versions.$inferSelect
export const AUTO_VERSIONS_KEPT = 50

const aad = (id: string) => `version:${id}`

export function versionDTO(v: Omit<VersionRow, 'state' | 'encrypted'>, createdByName: string | null): VersionDTO {
  return {
    id: v.id,
    projectId: v.projectId,
    docName: v.docName,
    name: v.name,
    auto: v.auto,
    sizeBytes: v.size,
    createdBy: v.createdBy,
    createdByName,
    createdAt: v.createdAt.toISOString(),
  }
}

export async function createVersion(
  db: DbOrTx,
  ring: KeyRing,
  input: { projectId: string; docName: string; name: string; auto: boolean; createdBy: string | null; state: Uint8Array },
): Promise<VersionRow> {
  const id = newId()
  const encrypted = !!ring.current
  const [row] = await db
    .insert(versions)
    .values({
      id,
      projectId: input.projectId,
      docName: input.docName,
      name: input.name.slice(0, 120),
      auto: input.auto,
      state: encrypted ? sealRecord(ring, input.state, aad(id)) : input.state,
      encrypted,
      size: input.state.byteLength,
      createdBy: input.createdBy,
    })
    .returning()
  return row!
}

export function versionState(ring: KeyRing, v: Pick<VersionRow, 'id' | 'state' | 'encrypted'>): Uint8Array {
  return v.encrypted ? new Uint8Array(openRecord(ring, v.state, aad(v.id))) : v.state
}

export async function listVersions(db: DbOrTx, projectId: string, docName?: string): Promise<VersionDTO[]> {
  const rows = await db
    .select({
      id: versions.id,
      projectId: versions.projectId,
      docName: versions.docName,
      name: versions.name,
      auto: versions.auto,
      size: versions.size,
      createdBy: versions.createdBy,
      createdAt: versions.createdAt,
      createdByName: user.name,
    })
    .from(versions)
    .leftJoin(user, eq(user.id, versions.createdBy))
    .where(docName ? and(eq(versions.projectId, projectId), eq(versions.docName, docName)) : eq(versions.projectId, projectId))
    .orderBy(desc(versions.createdAt))
    .limit(500)
  return rows.map((r) => versionDTO(r, r.createdByName ?? null))
}

/** Keep only the newest `keep` auto versions per doc. */
export async function pruneAutoVersions(db: DbOrTx, keep = AUTO_VERSIONS_KEPT): Promise<void> {
  await db.execute(sql`DELETE FROM versions WHERE id IN (
    SELECT id FROM (
      SELECT id, row_number() OVER (PARTITION BY doc_name ORDER BY created_at DESC) AS rn
      FROM versions WHERE auto = true
    ) ranked WHERE ranked.rn > ${keep})`)
}
