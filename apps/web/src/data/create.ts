// Creating projects (local or cloud) from a seed, and uploading local projects to the cloud.
import * as Y from 'yjs'
import { docNames, type ProjectDTO } from '@cadsandbox/shared'
import { api } from './api/endpoints'
import { isApiError } from './api/client'
import { buildProject, type ProjectSeed } from './seed'
import { writeDocState } from './yjs'
import { getLocalProject, newProjectId, patchLocalProject, projectDesignIds, putLocalProject } from './local/projects'
import { db } from './local/db'
import { getBlob, markUploaded, projectBlobHashes } from './local/blobs'
import { cacheCloudProjects } from './cloud-cache'
import { closeSession } from './session/manager'
import { pushDocs } from './session/push'

export interface CreateProjectInput {
  name: string
  seed: ProjectSeed
  folderId?: string | null
  orgId?: string | null
  createdBy?: string | null
}

async function persistBuilt(projectId: string, built: ReturnType<typeof buildProject>): Promise<void> {
  await writeDocState(docNames.manifest(projectId), built.manifest)
  for (const [fileId, state] of built.designs) await writeDocState(docNames.file(projectId, fileId), state)
}

/** New on-device project (works offline, no account). Returns the project id. */
export async function createLocalProject(input: CreateProjectInput): Promise<string> {
  const id = newProjectId()
  const name = input.name.trim().slice(0, 120) || 'Untitled'
  const built = buildProject(name, input.seed, input.createdBy ?? null)
  await persistBuilt(id, built)
  const t = Date.now()
  await putLocalProject({
    id,
    name,
    description: input.seed.description ?? '',
    folderId: input.folderId ?? null,
    starred: false,
    createdAt: t,
    updatedAt: t,
    deletedAt: null,
    sizeBytes: built.manifest.byteLength + [...built.designs.values()].reduce((s, u) => s + u.byteLength, 0),
  })
  return id
}

/**
 * New cloud project: created via the API with a client id, seeded locally (offline cache) and
 * pushed to the collab server. If the push fails (offline), the content syncs on first open.
 */
export async function createCloudProject(input: CreateProjectInput): Promise<ProjectDTO> {
  const id = newProjectId()
  const name = input.name.trim().slice(0, 120) || 'Untitled'
  const project = await api.projects.create({ id, name, description: input.seed.description, folderId: input.folderId ?? null, orgId: input.orgId ?? null })
  const built = buildProject(name, input.seed, input.createdBy ?? null)
  await persistBuilt(project.id, built)
  await cacheCloudProjects([project])
  const docs = new Map<string, Y.Doc>()
  try {
    const add = (docName: string, state: Uint8Array) => {
      const d = new Y.Doc()
      Y.applyUpdate(d, state)
      docs.set(docName, d)
    }
    add(docNames.manifest(project.id), built.manifest)
    for (const [fileId, state] of built.designs) add(docNames.file(project.id, fileId), state)
    await pushDocs([...docs.keys()], { docs })
  } catch (err) {
    console.warn('[create] initial sync deferred until the project is opened', err)
  } finally {
    for (const d of docs.values()) d.destroy()
  }
  return project
}

export interface UploadProgress {
  step: 'create' | 'documents' | 'assets' | 'done'
  done: number
  total: number
}

/** Upload a local project to the cloud, keeping its id (local copies become the offline cache). */
export async function uploadLocalProject(projectId: string, onProgress?: (p: UploadProgress) => void): Promise<ProjectDTO> {
  const rec = await getLocalProject(projectId)
  if (!rec) throw new Error('Project not found on this device')
  closeSession(projectId) // flush and release its IndexedDB handles first
  onProgress?.({ step: 'create', done: 0, total: 1 })
  let project: ProjectDTO
  try {
    project = await api.projects.create({ id: rec.id, name: rec.name, description: rec.description })
  } catch (err) {
    // A previous attempt may already have created it (retry after a network failure).
    if (isApiError(err) && err.code === 'conflict') project = await api.projects.get(rec.id)
    else throw err
  }
  const names = [docNames.manifest(projectId), ...(await projectDesignIds(projectId)).map((f) => docNames.file(projectId, f))]
  await pushDocs(names, { onProgress: (done, total) => onProgress?.({ step: 'documents', done, total }) })

  const hashes = await projectBlobHashes(projectId)
  let done = 0
  for (const hash of hashes) {
    const blob = await getBlob(hash)
    if (blob && !(await api.blobs.exists(project.id, hash))) await api.blobs.put(project.id, hash, blob.bytes, blob.mime)
    await markUploaded(projectId, hash)
    onProgress?.({ step: 'assets', done: ++done, total: hashes.length })
  }
  const thumb = await (await db()).get('thumbnails', projectId)
  if (thumb) await api.projects.putThumbnail(project.id, thumb.blob).catch(() => undefined)

  await patchLocalProject(projectId, { uploadedAt: Date.now() })
  await cacheCloudProjects([project])
  onProgress?.({ step: 'done', done: 1, total: 1 })
  return project
}
