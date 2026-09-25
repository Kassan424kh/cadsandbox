// Local (on-device) projects and folders. Content lives in y-indexeddb databases named after the
// collab doc names, metadata in the `projects`/`folders` stores. Works fully offline, no account.
import * as Y from 'yjs'
import { ProjectManifest, SILENT_ORIGIN } from '@cadsandbox/doc'
import { LIMITS, docNames } from '@cadsandbox/shared'
import { db, type LocalFolderRecord, type LocalProjectRecord } from './db'
import { releaseProjectBlobs, projectBlobHashes, linkBlob } from './blobs'
import { deleteDocState, listDocDatabases, loadDoc, readDocState, writeDocState } from '../yjs'
import { randomId } from '../ids'

/** Project ids must satisfy the server's `^[\w-]{8,64}$` so local projects can keep them on upload. */
export const newProjectId = (): string => randomId(16)

const now = () => Date.now()

// ------------------------------------------------------------------ projects

export async function listLocalProjects(): Promise<LocalProjectRecord[]> {
  const all = await (await db()).getAll('projects')
  return all.filter((p) => !p.uploadedAt)
}

export async function getLocalProject(id: string): Promise<LocalProjectRecord | undefined> {
  const rec = await (await db()).get('projects', id)
  return rec && !rec.uploadedAt ? rec : undefined
}

export async function putLocalProject(rec: LocalProjectRecord): Promise<void> {
  await (await db()).put('projects', rec)
}

export async function patchLocalProject(id: string, patch: Partial<Omit<LocalProjectRecord, 'id'>>): Promise<LocalProjectRecord | undefined> {
  const d = await db()
  const tx = d.transaction('projects', 'readwrite')
  const cur = await tx.store.get(id)
  if (!cur) return undefined
  const next = { ...cur, ...patch }
  await tx.store.put(next)
  await tx.done
  return next
}

/** Update a project's manifest info (name/description) in its persisted Yjs doc. */
async function patchManifestInfo(projectId: string, patch: { name?: string; description?: string }): Promise<void> {
  const name = docNames.manifest(projectId)
  const ydoc = await loadDoc(name)
  try {
    const before = Y.encodeStateVector(ydoc)
    const m = new ProjectManifest(ydoc)
    ydoc.transact(() => {
      if (patch.name !== undefined) m.infoMap.set('name', patch.name)
      if (patch.description !== undefined) m.infoMap.set('description', patch.description)
    }, SILENT_ORIGIN)
    m.destroy()
    await writeDocState(name, Y.encodeStateAsUpdate(ydoc, before))
  } finally {
    ydoc.destroy()
  }
}

export async function renameLocalProject(id: string, name: string): Promise<void> {
  const trimmed = name.trim().slice(0, 120)
  if (!trimmed) return
  await patchLocalProject(id, { name: trimmed, updatedAt: now() })
  await patchManifestInfo(id, { name: trimmed })
}

export async function setLocalProjectDescription(id: string, description: string): Promise<void> {
  await patchLocalProject(id, { description: description.slice(0, 2000), updatedAt: now() })
  await patchManifestInfo(id, { description })
}

export const starLocalProject = (id: string, starred: boolean) => patchLocalProject(id, { starred })
export const moveLocalProject = (id: string, folderId: string | null) => patchLocalProject(id, { folderId, updatedAt: now() })
export const trashLocalProject = (id: string) => patchLocalProject(id, { deletedAt: now() })
export const restoreLocalProject = (id: string) => patchLocalProject(id, { deletedAt: null })

/** Design file ids referenced by a project's manifest. */
export async function projectDesignIds(projectId: string): Promise<string[]> {
  const ydoc = await loadDoc(docNames.manifest(projectId))
  try {
    const m = new ProjectManifest(ydoc)
    const ids = m.designFiles().map((f) => f.id)
    m.destroy()
    return ids
  } finally {
    ydoc.destroy()
  }
}

/** Every local Yjs database of a project (manifest + all design files, including deleted ones). */
async function projectDocNames(projectId: string): Promise<string[]> {
  const names = new Set<string>([docNames.manifest(projectId)])
  for (const f of await projectDesignIds(projectId)) names.add(docNames.file(projectId, f))
  for (const n of await listDocDatabases(`file:${projectId}:`)) names.add(n)
  return [...names]
}

/** Permanently remove a project's local data (docs, blobs no one else uses, versions, thumbnail). */
export async function purgeLocalProjectData(projectId: string): Promise<void> {
  for (const n of await projectDocNames(projectId)) await deleteDocState(n)
  const d = await db()
  const libraryHashes = new Set((await d.getAll('collectionItems')).flatMap((i) => i.assets))
  await releaseProjectBlobs(projectId, libraryHashes)
  const tx = d.transaction(['versions', 'thumbnails'], 'readwrite')
  const versions = tx.objectStore('versions')
  for (const key of await versions.index('byProject').getAllKeys(projectId)) await versions.delete(key)
  await tx.objectStore('thumbnails').delete(projectId)
  await tx.done
}

export async function deleteLocalProjectForever(id: string): Promise<void> {
  await purgeLocalProjectData(id)
  await (await db()).delete('projects', id)
}

/** Copy a project (docs, blob references, thumbnail) under a new id. */
export async function duplicateLocalProject(id: string, name?: string): Promise<string> {
  const src = await getLocalProject(id)
  if (!src) throw new Error('Project not found')
  const copyId = newProjectId()
  const copyName = (name ?? `${src.name} (copy)`).slice(0, 120)
  for (const fileId of await projectDesignIds(id)) {
    const state = await readDocState(docNames.file(id, fileId))
    if (state) await writeDocState(docNames.file(copyId, fileId), state)
  }
  const manifestState = await readDocState(docNames.manifest(id))
  if (manifestState) await writeDocState(docNames.manifest(copyId), manifestState)
  await patchManifestInfo(copyId, { name: copyName })
  for (const hash of await projectBlobHashes(id)) await linkBlob(copyId, hash, false)
  const d = await db()
  const thumb = await d.get('thumbnails', id)
  if (thumb) await d.put('thumbnails', { ...thumb, projectId: copyId })
  const t = now()
  await d.put('projects', { ...src, id: copyId, name: copyName, starred: false, createdAt: t, updatedAt: t, deletedAt: null, uploadedAt: null, lastOpenedAt: null })
  return copyId
}

/** Remove trashed projects older than the retention period (mirrors the server's 30 days). */
export async function purgeExpiredTrash(): Promise<number> {
  const cutoff = now() - LIMITS.trashRetentionDays * 86_400_000
  const expired = (await listLocalProjects()).filter((p) => p.deletedAt && p.deletedAt < cutoff)
  for (const p of expired) await deleteLocalProjectForever(p.id)
  return expired.length
}

// ------------------------------------------------------------------ folders

export async function listLocalFolders(): Promise<LocalFolderRecord[]> {
  return (await db()).getAll('folders')
}

export async function createLocalFolder(name: string, parentId: string | null): Promise<LocalFolderRecord> {
  const t = now()
  const rec: LocalFolderRecord = { id: randomId(12), name: name.trim().slice(0, 120) || 'Folder', parentId, createdAt: t, updatedAt: t }
  await (await db()).put('folders', rec)
  return rec
}

export async function updateLocalFolder(id: string, patch: { name?: string; parentId?: string | null }): Promise<void> {
  const d = await db()
  const cur = await d.get('folders', id)
  if (!cur) return
  if (patch.parentId !== undefined && patch.parentId !== null) {
    // refuse cycles: the new parent must not be the folder itself or one of its descendants
    const all = await d.getAll('folders')
    const byId = new Map(all.map((f) => [f.id, f]))
    for (let p: string | null = patch.parentId; p; p = byId.get(p)?.parentId ?? null) if (p === id) return
  }
  await d.put('folders', {
    ...cur,
    ...(patch.name !== undefined ? { name: patch.name.trim().slice(0, 120) || cur.name } : {}),
    ...(patch.parentId !== undefined ? { parentId: patch.parentId } : {}),
    updatedAt: now(),
  })
}

/** Delete a folder; its projects and sub-folders move to the parent (same as the server). */
export async function deleteLocalFolder(id: string): Promise<void> {
  const d = await db()
  const cur = await d.get('folders', id)
  if (!cur) return
  const tx = d.transaction(['folders', 'projects'], 'readwrite')
  for (const f of await tx.objectStore('folders').getAll()) {
    if (f.parentId === id) await tx.objectStore('folders').put({ ...f, parentId: cur.parentId, updatedAt: now() })
  }
  for (const p of await tx.objectStore('projects').getAll()) {
    if (p.folderId === id) await tx.objectStore('projects').put({ ...p, folderId: cur.parentId })
  }
  await tx.objectStore('folders').delete(id)
  await tx.done
}

// ------------------------------------------------------------------ thumbnails

const thumbUrls = new Map<string, { url: string; updatedAt: number }>()

export async function putThumbnail(projectId: string, blob: Blob): Promise<void> {
  await (await db()).put('thumbnails', { projectId, blob, updatedAt: now() })
}

/** Object URL of a stored thumbnail (cached per version; old URLs are revoked). */
export async function thumbnailUrl(projectId: string): Promise<string | null> {
  const rec = await (await db()).get('thumbnails', projectId)
  if (!rec) return null
  const cached = thumbUrls.get(projectId)
  if (cached && cached.updatedAt === rec.updatedAt) return cached.url
  if (cached) URL.revokeObjectURL(cached.url)
  const url = URL.createObjectURL(rec.blob)
  thumbUrls.set(projectId, { url, updatedAt: rec.updatedAt })
  return url
}
