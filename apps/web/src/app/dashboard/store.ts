// Dashboard UI state shared between the sidebar, pages and dialogs.
import { create } from 'zustand'
import type { TemplateId } from '../templates'
import type { ProjectItem } from '../../data/projects'

export type ViewMode = 'grid' | 'list'

const VIEW_KEY = 'cadsandbox.dashboard.view'
const readView = (): ViewMode => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}

interface DashboardUI {
  newProject: { open: boolean; template: TemplateId; folderId: string | null; orgId: string | null }
  openNewProject(opts?: Partial<Omit<DashboardUI['newProject'], 'open'>>): void
  closeNewProject(): void
  share: ProjectItem | null
  setShare(p: ProjectItem | null): void
  upload: ProjectItem | null
  setUpload(p: ProjectItem | null): void
  supportOpen: boolean
  setSupportOpen(open: boolean): void
  view: ViewMode
  setView(v: ViewMode): void
}

export const useDashboardUI = create<DashboardUI>((set) => ({
  newProject: { open: false, template: 'empty', folderId: null, orgId: null },
  openNewProject: (opts = {}) => set({ newProject: { open: true, template: opts.template ?? 'empty', folderId: opts.folderId ?? null, orgId: opts.orgId ?? null } }),
  closeNewProject: () => set((s) => ({ newProject: { ...s.newProject, open: false } })),
  share: null,
  setShare: (share) => set({ share }),
  upload: null,
  setUpload: (upload) => set({ upload }),
  supportOpen: false,
  setSupportOpen: (supportOpen) => set({ supportOpen }),
  view: readView(),
  setView: (view) => {
    try {
      localStorage.setItem(VIEW_KEY, view)
    } catch {
      /* ignore */
    }
    set({ view })
  },
}))
