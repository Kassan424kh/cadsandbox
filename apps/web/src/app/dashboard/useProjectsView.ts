// Merges local (device) and cloud lists into what a dashboard view shows.
import { useMemo } from 'react'
import { useAuth } from '../../data/auth/AuthProvider'
import { useServer } from '../../data/online'
import { useCloudFolders, useCloudProjects, useLocalFolders, useLocalProjects } from '../../data/queries'
import type { FolderItem, ProjectItem } from '../../data/projects'

export type ListView = 'all' | 'shared' | 'starred' | 'trash' | 'recent'

const SCOPE = { all: 'mine', shared: 'shared', starred: 'starred', trash: 'trash', recent: 'recent' } as const

export interface ProjectsViewData {
  signedIn: boolean
  /** Cloud projects for this view (signed in) — or local ones when signed out. */
  primary: ProjectItem[]
  /** Signed in: local projects not uploaded yet ("On this device"). */
  device: ProjectItem[]
  folders: FolderItem[]
  /** Sub-folders of the current folder. */
  subfolders: FolderItem[]
  folderMode: FolderItem['mode']
  loading: boolean
  error: unknown
  fromCache: boolean
}

export function useProjectsView(view: ListView, folderId: string | null = null): ProjectsViewData {
  const auth = useAuth()
  const { available } = useServer()
  const signedIn = auth.status === 'signed-in'
  const local = useLocalProjects()
  const localFolders = useLocalFolders()
  const cloud = useCloudProjects({ scope: SCOPE[view] }, signedIn)
  const cloudFolders = useCloudFolders(null, signedIn && available !== false && (view === 'all' || view === 'recent'))

  return useMemo(() => {
    const locals = local.data ?? []
    const clouds = cloud.data?.items ?? []
    const byView = (list: ProjectItem[], isLocal: boolean): ProjectItem[] => {
      switch (view) {
        case 'trash':
          return list.filter((p) => p.deletedAt)
        case 'starred':
          return list.filter((p) => !p.deletedAt && p.starred)
        case 'shared':
          return isLocal ? [] : list.filter((p) => !p.deletedAt)
        case 'recent':
          return list.filter((p) => !p.deletedAt)
        case 'all':
          return list.filter((p) => !p.deletedAt && (isLocal && signedIn ? true : (p.folderId ?? null) === folderId) && (isLocal || !p.orgId))
      }
    }
    const folders = signedIn ? (cloudFolders.data ?? []).filter((f) => !f.orgId) : (localFolders.data ?? [])
    const primary = signedIn ? byView(clouds, false) : byView(locals, true)
    const device = signedIn && view !== 'shared' && (view !== 'all' || folderId === null) ? byView(locals, true) : []
    return {
      signedIn,
      primary,
      device,
      folders,
      subfolders: view === 'all' ? folders.filter((f) => (f.parentId ?? null) === folderId) : [],
      folderMode: signedIn ? 'cloud' : 'local',
      loading: local.isLoading || (signedIn && cloud.isLoading),
      error: signedIn ? cloud.error : null,
      fromCache: !!cloud.data?.fromCache,
    }
  }, [local.data, local.isLoading, cloud.data, cloud.isLoading, cloud.error, cloudFolders.data, localFolders.data, signedIn, view, folderId])
}
