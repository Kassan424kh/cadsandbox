// Unified dashboard model: local (device) and cloud projects/folders look the same to the UI.
import type { FolderDTO, ProjectDTO, ProjectRole, ProjectVisibility } from '@cadsandbox/shared'
import type { LocalFolderRecord, LocalProjectRecord } from './local/db'
import { thumbnailUrl } from './local/projects'

export type ProjectMode = 'local' | 'cloud'

export interface ProjectItem {
  id: string
  name: string
  description: string
  mode: ProjectMode
  folderId: string | null
  orgId: string | null
  starred: boolean
  role: ProjectRole
  ownerName: string | null
  visibility: ProjectVisibility | 'device'
  thumbnailUrl: string | null
  sizeBytes: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface FolderItem {
  id: string
  name: string
  parentId: string | null
  orgId: string | null
  mode: ProjectMode
  createdAt: string
  updatedAt: string
}

const iso = (t: number | null | undefined) => (t ? new Date(t).toISOString() : null)

export function projectFromCloud(p: ProjectDTO): ProjectItem {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    mode: 'cloud',
    folderId: p.folderId,
    orgId: p.orgId,
    starred: p.starred,
    role: p.role,
    ownerName: p.ownerName,
    visibility: p.visibility,
    thumbnailUrl: p.thumbnailUrl,
    sizeBytes: p.sizeBytes,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    deletedAt: p.deletedAt,
  }
}

export async function projectFromLocal(r: LocalProjectRecord): Promise<ProjectItem> {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    mode: 'local',
    folderId: r.folderId,
    orgId: null,
    starred: r.starred,
    role: 'owner',
    ownerName: null,
    visibility: 'device',
    thumbnailUrl: await thumbnailUrl(r.id),
    sizeBytes: r.sizeBytes,
    createdAt: iso(r.createdAt)!,
    updatedAt: iso(r.updatedAt)!,
    deletedAt: iso(r.deletedAt),
  }
}

export function folderFromCloud(f: FolderDTO): FolderItem {
  return { ...f, mode: 'cloud' }
}

export function folderFromLocal(f: LocalFolderRecord): FolderItem {
  return { id: f.id, name: f.name, parentId: f.parentId, orgId: null, mode: 'local', createdAt: iso(f.createdAt)!, updatedAt: iso(f.updatedAt)! }
}

export type SortKey = 'updated' | 'name' | 'created'

export function sortProjects(list: ProjectItem[], key: SortKey): ProjectItem[] {
  const out = [...list]
  if (key === 'name') out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }))
  else if (key === 'created') out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  else out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return out
}

export function matchesQuery(p: { name: string; description?: string }, q: string): boolean {
  const s = q.trim().toLowerCase()
  if (!s) return true
  return p.name.toLowerCase().includes(s) || (p.description ?? '').toLowerCase().includes(s)
}

/** Breadcrumb path from the root to `folderId`. */
export function folderPath(folders: FolderItem[], folderId: string | null): FolderItem[] {
  const byId = new Map(folders.map((f) => [f.id, f]))
  const out: FolderItem[] = []
  const seen = new Set<string>()
  for (let cur = folderId ? byId.get(folderId) : undefined; cur && !seen.has(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
    seen.add(cur.id)
    out.unshift(cur)
  }
  return out
}
