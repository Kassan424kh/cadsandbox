// React Query hooks for lists (REST + IndexedDB) and the unified project/folder actions.
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { GrantRole, ProjectDTO } from '@cadsandbox/shared'
import { api, type ListProjectsQuery } from './api/endpoints'
import { isApiError } from './api/client'
import { cacheCloudProjects, listCachedCloudProjects } from './cloud-cache'
import {
  createLocalFolder,
  deleteLocalFolder,
  deleteLocalProjectForever,
  duplicateLocalProject,
  listLocalFolders,
  listLocalProjects,
  moveLocalProject,
  renameLocalProject,
  restoreLocalProject,
  starLocalProject,
  trashLocalProject,
  updateLocalFolder,
} from './local/projects'
import { closeSession } from './session/manager'
import { folderFromCloud, folderFromLocal, projectFromCloud, projectFromLocal, type FolderItem, type ProjectItem, type ProjectMode } from './projects'

export const qk = {
  config: ['config'] as const,
  me: ['me'] as const,
  announcements: ['announcements'] as const,
  localProjects: ['local', 'projects'] as const,
  localFolders: ['local', 'folders'] as const,
  cloudProjects: (q: ListProjectsQuery) => ['cloud', 'projects', q] as const,
  cloudProjectsAll: ['cloud', 'projects'] as const,
  cloudFolders: (orgId: string | null) => ['cloud', 'folders', orgId] as const,
  cloudFoldersAll: ['cloud', 'folders'] as const,
  project: (id: string) => ['cloud', 'project', id] as const,
  members: (id: string) => ['cloud', 'members', id] as const,
  links: (id: string) => ['cloud', 'links', id] as const,
  orgGrants: (id: string) => ['cloud', 'orgGrants', id] as const,
  orgProjects: (orgId: string) => ['cloud', 'orgProjects', orgId] as const,
  versions: (projectId: string, docName: string) => ['versions', projectId, docName] as const,
  tickets: ['support', 'tickets'] as const,
  ticket: (id: string) => ['support', 'ticket', id] as const,
}

// ------------------------------------------------------------------ lists

export function useLocalProjects() {
  return useQuery({
    queryKey: qk.localProjects,
    queryFn: async () => Promise.all((await listLocalProjects()).map(projectFromLocal)),
    staleTime: 5_000,
  })
}

export function useLocalFolders() {
  return useQuery({ queryKey: qk.localFolders, queryFn: async () => (await listLocalFolders()).map(folderFromLocal), staleTime: 5_000 })
}

/** Cloud projects; falls back to the device cache when the server is unreachable. */
export function useCloudProjects(q: ListProjectsQuery, enabled: boolean) {
  return useQuery({
    queryKey: qk.cloudProjects(q),
    enabled,
    queryFn: async (): Promise<{ items: ProjectItem[]; total: number; fromCache: boolean }> => {
      try {
        const page = await api.projects.list({ pageSize: 200, ...q })
        void cacheCloudProjects(page.items)
        return { items: page.items.map(projectFromCloud), total: page.total, fromCache: false }
      } catch (err) {
        if (!(isApiError(err) && err.isNetwork)) throw err
        const cached = (await listCachedCloudProjects()).filter((p) => !p.deletedAt === (q.scope !== 'trash'))
        const items = cached
          .filter((p) => (q.scope === 'starred' ? p.starred : q.scope === 'shared' ? p.role !== 'owner' : true))
          .filter((p) => (q.folderId === undefined ? true : p.folderId === q.folderId))
          .map(projectFromCloud)
        return { items, total: items.length, fromCache: true }
      }
    },
  })
}

export function useCloudFolders(orgId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: qk.cloudFolders(orgId),
    enabled,
    queryFn: async () => (await api.folders.list(orgId)).map(folderFromCloud),
  })
}

export function useOrgProjects(orgId: string, enabled = true) {
  return useQuery({
    queryKey: qk.orgProjects(orgId),
    enabled,
    queryFn: async () => (await api.orgProjects(orgId)).map(projectFromCloud),
  })
}

export function useAnnouncements(enabled: boolean) {
  return useQuery({ queryKey: qk.announcements, queryFn: api.announcements, enabled, staleTime: 5 * 60_000, retry: false })
}

export function useMembers(projectId: string, enabled = true) {
  return useQuery({ queryKey: qk.members(projectId), queryFn: () => api.members.list(projectId), enabled })
}
export function useLinks(projectId: string, enabled = true) {
  return useQuery({ queryKey: qk.links(projectId), queryFn: () => api.links.list(projectId), enabled })
}
export function useOrgGrants(projectId: string, enabled = true) {
  return useQuery({ queryKey: qk.orgGrants(projectId), queryFn: () => api.orgGrants.list(projectId), enabled })
}

// ------------------------------------------------------------------ project actions (local + cloud)

export function invalidateProjects(qc: QueryClient): Promise<void> {
  return Promise.all([
    qc.invalidateQueries({ queryKey: qk.localProjects }),
    qc.invalidateQueries({ queryKey: qk.cloudProjectsAll }),
    qc.invalidateQueries({ queryKey: ['cloud', 'orgProjects'] }),
  ]).then(() => undefined)
}

type Target = { id: string; mode: ProjectMode }

export function useProjectActions() {
  const qc = useQueryClient()
  const done = () => invalidateProjects(qc)
  const m = <V,>(fn: (v: V) => Promise<unknown>) => useMutation({ mutationFn: fn, onSettled: done })
  return {
    rename: m(({ id, mode, name }: Target & { name: string }) => (mode === 'local' ? renameLocalProject(id, name) : api.projects.update(id, { name }))),
    star: m(({ id, mode, starred }: Target & { starred: boolean }) => (mode === 'local' ? starLocalProject(id, starred) : api.projects.update(id, { starred }))),
    move: m(({ id, mode, folderId }: Target & { folderId: string | null }) =>
      mode === 'local' ? moveLocalProject(id, folderId) : api.projects.update(id, { folderId }),
    ),
    trash: m(({ id, mode }: Target) => {
      closeSession(id)
      return mode === 'local' ? trashLocalProject(id) : api.projects.trash(id)
    }),
    restore: m(({ id, mode }: Target) => (mode === 'local' ? restoreLocalProject(id) : api.projects.restore(id))),
    remove: m(({ id, mode }: Target) => {
      closeSession(id)
      return mode === 'local' ? deleteLocalProjectForever(id) : api.projects.remove(id)
    }),
    duplicate: m(({ id, mode, name }: Target & { name?: string }) =>
      mode === 'local' ? duplicateLocalProject(id, name) : api.projects.duplicate(id, name ? { name } : {}),
    ),
    setVisibility: m(({ id, visibility }: { id: string; visibility: ProjectDTO['visibility'] }) => api.projects.update(id, { visibility })),
  }
}

export function invalidateFolders(qc: QueryClient): Promise<void> {
  return Promise.all([qc.invalidateQueries({ queryKey: qk.localFolders }), qc.invalidateQueries({ queryKey: qk.cloudFoldersAll })]).then(() => undefined)
}

export function useFolderActions() {
  const qc = useQueryClient()
  const done = () => Promise.all([invalidateFolders(qc), invalidateProjects(qc)])
  const m = <V,>(fn: (v: V) => Promise<unknown>) => useMutation({ mutationFn: fn, onSettled: done })
  return {
    create: m(({ mode, name, parentId, orgId }: { mode: ProjectMode; name: string; parentId: string | null; orgId?: string | null }) =>
      mode === 'local' ? createLocalFolder(name, parentId) : api.folders.create({ name, parentId, orgId: orgId ?? null }),
    ),
    rename: m(({ folder, name }: { folder: FolderItem; name: string }) =>
      folder.mode === 'local' ? updateLocalFolder(folder.id, { name }) : api.folders.update(folder.id, { name }),
    ),
    move: m(({ folder, parentId }: { folder: FolderItem; parentId: string | null }) =>
      folder.mode === 'local' ? updateLocalFolder(folder.id, { parentId }) : api.folders.update(folder.id, { parentId }),
    ),
    remove: m(({ folder }: { folder: FolderItem }) => (folder.mode === 'local' ? deleteLocalFolder(folder.id) : api.folders.remove(folder.id))),
  }
}

// ------------------------------------------------------------------ sharing

export function useShareActions(projectId: string) {
  const qc = useQueryClient()
  const inv = (key: readonly unknown[]) => () => qc.invalidateQueries({ queryKey: key })
  return {
    addMember: useMutation({ mutationFn: (v: { email: string; role: GrantRole }) => api.members.add(projectId, v.email, v.role), onSettled: inv(qk.members(projectId)) }),
    updateMember: useMutation({
      mutationFn: (v: { userId: string; role: GrantRole }) => api.members.update(projectId, v.userId, v.role),
      onSettled: inv(qk.members(projectId)),
    }),
    removeMember: useMutation({ mutationFn: (userId: string) => api.members.remove(projectId, userId), onSettled: inv(qk.members(projectId)) }),
    createLink: useMutation({
      mutationFn: (v: { role: GrantRole; expiresAt?: string | null; password?: string }) => api.links.create(projectId, v),
      onSettled: inv(qk.links(projectId)),
    }),
    removeLink: useMutation({ mutationFn: (linkId: string) => api.links.remove(projectId, linkId), onSettled: inv(qk.links(projectId)) }),
    setOrgGrant: useMutation({
      mutationFn: (v: { orgId: string; role: GrantRole }) => api.orgGrants.set(projectId, v.orgId, v.role),
      onSettled: inv(qk.orgGrants(projectId)),
    }),
    removeOrgGrant: useMutation({ mutationFn: (orgId: string) => api.orgGrants.remove(projectId, orgId), onSettled: inv(qk.orgGrants(projectId)) }),
  }
}
