// Device cache of cloud projects: metadata (for the offline dashboard) and the Yjs/blob caches that
// make cloud projects work offline. Cleared on sign-out so shared computers keep nothing behind.
import type { ProjectDTO } from '@cadsandbox/shared'
import { docNames } from '@cadsandbox/shared'
import { db, type CachedCloudProject } from './local/db'
import { releaseProjectBlobs } from './local/blobs'
import { deleteDocState, listDocDatabases } from './yjs'

export async function cacheCloudProjects(list: ProjectDTO[]): Promise<void> {
  if (!list.length) return
  const d = await db()
  const tx = d.transaction('cloudProjects', 'readwrite')
  const t = Date.now()
  for (const p of list) await tx.store.put({ ...p, cachedAt: t })
  await tx.done
}

export async function getCachedCloudProject(id: string): Promise<CachedCloudProject | undefined> {
  return (await db()).get('cloudProjects', id)
}

export async function listCachedCloudProjects(): Promise<CachedCloudProject[]> {
  return (await db()).getAll('cloudProjects')
}

export async function forgetCloudProject(id: string): Promise<void> {
  await (await db()).delete('cloudProjects', id)
}

/**
 * Drop this device's cached copy of one cloud project (Yjs docs, blobs no library item needs,
 * thumbnail, metadata) — after the caller's access was revoked or changed. Local copies of a
 * revoked project must not stay readable, and a demoted editor's unsynced edits can never be
 * pushed, so the next open starts from the server state.
 */
export async function forgetCloudProjectData(id: string): Promise<void> {
  const d = await db()
  const local = await d.get('projects', id)
  if (local && !local.uploadedAt) return // a device-only project with the same id: never touch it
  await deleteDocState(docNames.manifest(id))
  for (const name of await listDocDatabases(`file:${id}:`)) await deleteDocState(name)
  const libraryHashes = new Set((await d.getAll('collectionItems')).flatMap((i) => i.assets))
  await releaseProjectBlobs(id, libraryHashes)
  await d.delete('thumbnails', id)
  await d.delete('cloudProjects', id)
}

/** Blob runtime cache of the service worker (see vite.config.ts). */
export const SW_BLOB_CACHE = 'cadsandbox-blobs'

/** Remove every cached copy of cloud data from this device (local projects are kept). */
export async function clearCloudCache(): Promise<void> {
  const d = await db()
  const local = await d.getAll('projects')
  const keep = new Set(local.filter((p) => !p.uploadedAt).map((p) => p.id))
  const cloudIds = new Set<string>([...(await d.getAllKeys('cloudProjects')), ...local.filter((p) => p.uploadedAt).map((p) => p.id)])

  const dbNames = [...(await listDocDatabases('project:')), ...(await listDocDatabases('file:'))]
  for (const name of dbNames) {
    const parsed = docNames.parse(name)
    if (parsed && !keep.has(parsed.projectId)) cloudIds.add(parsed.projectId)
  }
  for (const id of cloudIds) {
    await deleteDocState(docNames.manifest(id))
    for (const name of dbNames) if (name.startsWith(`file:${id}:`)) await deleteDocState(name)
    const libraryHashes = new Set((await d.getAll('collectionItems')).flatMap((i) => i.assets))
    await releaseProjectBlobs(id, libraryHashes)
    await d.delete('thumbnails', id)
    for (const key of await d.getAllKeysFromIndex('versions', 'byProject', id)) await d.delete('versions', key)
  }
  await d.clear('cloudProjects')
  for (const p of local.filter((x) => x.uploadedAt)) await d.delete('projects', p.id)
  try {
    await caches?.delete(SW_BLOB_CACHE)
  } catch {
    /* Cache API unavailable */
  }
}
