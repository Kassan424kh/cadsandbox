// Local version history: Yjs state snapshots stored in IndexedDB (cloud projects use the server's
// versions API instead). Auto versions are pruned to the newest AUTO_KEEP per document.
import * as Y from 'yjs'
import type { VersionDTO } from '@cadsandbox/shared'
import type { EditorUser } from '@cadsandbox/render'
import { db, type LocalVersionRecord } from '../local/db'
import { randomId } from '../ids'

const AUTO_KEEP = 20

function toDTO(r: LocalVersionRecord): VersionDTO {
  return {
    id: r.id,
    projectId: r.projectId,
    docName: r.docName,
    name: r.name,
    auto: r.auto,
    sizeBytes: r.update.byteLength,
    createdBy: r.createdBy,
    createdByName: r.createdByName,
    createdAt: new Date(r.createdAt).toISOString(),
  }
}

export class LocalVersionStore {
  constructor(
    private readonly projectId: string,
    private readonly user: EditorUser,
  ) {}

  async list(docName: string): Promise<VersionDTO[]> {
    const rows = await (await db()).getAllFromIndex('versions', 'byDoc', docName)
    return rows.filter((r) => r.projectId === this.projectId).sort((a, b) => b.createdAt - a.createdAt).map(toDTO)
  }

  async get(versionId: string): Promise<LocalVersionRecord | undefined> {
    const rec = await (await db()).get('versions', versionId)
    return rec?.projectId === this.projectId ? rec : undefined
  }

  /** Snapshot `ydoc` now (encoded synchronously, so the doc may be destroyed right after the call).
   *  Skips auto versions identical to the latest snapshot of the doc. */
  async create(docName: string, name: string, ydoc: Y.Doc, auto = false): Promise<VersionDTO | null> {
    const update = Y.encodeStateAsUpdate(ydoc)
    const d = await db()
    if (auto) {
      const latest = (await d.getAllFromIndex('versions', 'byDoc', docName)).sort((a, b) => b.createdAt - a.createdAt)[0]
      if (latest && sameState(latest.update, update)) return null
    }
    const rec: LocalVersionRecord = {
      id: randomId(16),
      projectId: this.projectId,
      docName,
      name: name.trim().slice(0, 120) || 'Version',
      auto,
      createdAt: Date.now(),
      createdBy: this.user.id,
      createdByName: this.user.name,
      update,
    }
    await d.put('versions', rec)
    if (auto) await this.prune(docName)
    return toDTO(rec)
  }

  private async prune(docName: string): Promise<void> {
    const d = await db()
    const autos = (await d.getAllFromIndex('versions', 'byDoc', docName)).filter((r) => r.auto).sort((a, b) => b.createdAt - a.createdAt)
    for (const r of autos.slice(AUTO_KEEP)) await d.delete('versions', r.id)
  }
}

/** Do two snapshots describe the same document state? */
function sameState(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false // deletions don't advance the state vector: compare sizes too
  const sa = Y.encodeStateVectorFromUpdate(a)
  const sb = Y.encodeStateVectorFromUpdate(b)
  if (sa.byteLength !== sb.byteLength) return false
  for (let i = 0; i < sa.byteLength; i++) if (sa[i] !== sb[i]) return false
  return true
}
