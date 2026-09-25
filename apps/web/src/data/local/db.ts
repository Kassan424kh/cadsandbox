// IndexedDB (via `idb`) for everything the app keeps on this device: local projects + folders,
// thumbnails, content-addressed blobs (sha256), local version snapshots, the local library and a
// metadata cache of cloud projects for offline use. Yjs documents live in their own y-indexeddb
// databases named after `docNames` (see ../yjs.ts).
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { CollectionDTO, CollectionItemDTO, ProjectDTO } from '@cadsandbox/shared'

export interface LocalProjectRecord {
  id: string
  name: string
  description: string
  folderId: string | null
  starred: boolean
  createdAt: number
  updatedAt: number
  /** Soft-deleted (trash) timestamp. */
  deletedAt: number | null
  sizeBytes: number
  /** Set once the project has been uploaded to the cloud (it then lives on as a cloud project). */
  uploadedAt?: number | null
  lastOpenedAt?: number | null
}

export interface LocalFolderRecord {
  id: string
  name: string
  parentId: string | null
  createdAt: number
  updatedAt: number
}

export interface BlobRecord {
  hash: string
  bytes: ArrayBuffer
  mime: string
  size: number
  createdAt: number
}

/** Which project references which blob; `pending` = 1 while not yet uploaded to the server (cloud).
 *  Numeric because booleans are not valid IndexedDB keys. */
export interface ProjectBlobRecord {
  projectId: string
  hash: string
  pending: 0 | 1
  addedAt: number
}

export interface LocalVersionRecord {
  id: string
  projectId: string
  docName: string
  name: string
  auto: boolean
  createdAt: number
  createdBy: string | null
  createdByName: string | null
  /** Y.encodeStateAsUpdate of the document at snapshot time. */
  update: Uint8Array
}

export interface ThumbnailRecord {
  projectId: string
  blob: Blob
  updatedAt: number
}

export interface CachedCloudProject extends ProjectDTO {
  cachedAt: number
}

interface CadSandboxDB extends DBSchema {
  projects: { key: string; value: LocalProjectRecord; indexes: { byFolder: string } }
  folders: { key: string; value: LocalFolderRecord }
  thumbnails: { key: string; value: ThumbnailRecord }
  blobs: { key: string; value: BlobRecord }
  projectBlobs: { key: [string, string]; value: ProjectBlobRecord; indexes: { byProject: string; byHash: string; byPending: [string, number] } }
  versions: { key: string; value: LocalVersionRecord; indexes: { byDoc: string; byProject: string } }
  collections: { key: string; value: CollectionDTO }
  collectionItems: { key: string; value: CollectionItemDTO; indexes: { byCollection: string } }
  cloudProjects: { key: string; value: CachedCloudProject }
}

export type LocalDB = IDBPDatabase<CadSandboxDB>

const DB_NAME = 'cadsandbox'
const DB_VERSION = 1
let dbPromise: Promise<LocalDB> | null = null

export function db(): Promise<LocalDB> {
  dbPromise ??= openDB<CadSandboxDB>(DB_NAME, DB_VERSION, {
    upgrade(d) {
      const projects = d.createObjectStore('projects', { keyPath: 'id' })
      projects.createIndex('byFolder', 'folderId')
      d.createObjectStore('folders', { keyPath: 'id' })
      d.createObjectStore('thumbnails', { keyPath: 'projectId' })
      d.createObjectStore('blobs', { keyPath: 'hash' })
      const pb = d.createObjectStore('projectBlobs', { keyPath: ['projectId', 'hash'] })
      pb.createIndex('byProject', 'projectId')
      pb.createIndex('byHash', 'hash')
      pb.createIndex('byPending', ['projectId', 'pending'])
      const versions = d.createObjectStore('versions', { keyPath: 'id' })
      versions.createIndex('byDoc', 'docName')
      versions.createIndex('byProject', 'projectId')
      d.createObjectStore('collections', { keyPath: 'id' })
      const items = d.createObjectStore('collectionItems', { keyPath: 'id' })
      items.createIndex('byCollection', 'collectionId')
      d.createObjectStore('cloudProjects', { keyPath: 'id' })
    },
    blocking() {
      // Another tab upgrades the schema: close so it can proceed; we reopen lazily.
      void dbPromise?.then((x) => x.close())
      dbPromise = null
    },
  })
  return dbPromise
}

/** Ask the browser to keep our data under storage pressure (best effort). */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.()
    return e ? { usage: e.usage ?? 0, quota: e.quota ?? 0 } : null
  } catch {
    return null
  }
}
