// Chrome-only UI state (panels, dialogs, palette). Engine state lives in editor.store.
import { create } from 'zustand'
import type { Vec3 } from '@cadsandbox/doc'

export type LeftTab = 'scene' | 'files' | 'library' | 'layers' | 'levels' | 'views' | 'comments' | 'sheets' | 'schedules' | 'analysis'
export type ChromeDialog = 'share' | 'support' | 'versions' | 'renderImage' | 'schedules' | 'shortcuts' | 'saveToCollection' | 'sheetEditor' | 'materialEditor' | 'importOptions' | null

export interface ContextMenuAnchor {
  x: number
  y: number
  nodeId: string | null
}

export interface CommentComposer {
  point: Vec3 | null
  nodeId: string | null
  clientX: number
  clientY: number
}

interface UiState {
  leftTab: LeftTab | null
  rightOpen: boolean
  paletteOpen: boolean
  dialog: ChromeDialog
  /** Material id being edited in the material editor dialog (null = create new). */
  editingMaterial: string | null
  /** Sheet open in the sheet editor */
  editingSheet: string | null
  commentComposer: CommentComposer | null
  contextMenu: ContextMenuAnchor | null
  activeComment: string | null
  /** Pending realistic render toggle ("Render" button) */
  onboardingStep: number | null
  /** Node ids to save into a collection */
  saveToCollectionIds: string[]

  setLeftTab(tab: LeftTab | null): void
  toggleLeftTab(tab: LeftTab): void
  setRightOpen(open: boolean): void
  setPaletteOpen(open: boolean): void
  openDialog(d: Exclude<ChromeDialog, null>, opts?: { materialId?: string | null; sheetId?: string | null; ids?: string[] }): void
  closeDialog(): void
  setCommentComposer(c: CommentComposer | null): void
  setContextMenu(a: ContextMenuAnchor | null): void
  setActiveComment(id: string | null): void
  setOnboardingStep(step: number | null): void
}

const LEFT_KEY = 'cs.editor.leftTab'
const readLeft = (): LeftTab | null => {
  try {
    const v = localStorage.getItem(LEFT_KEY)
    if (v === 'null') return null
    return (v as LeftTab | null) ?? 'scene'
  } catch {
    return 'scene'
  }
}

export const useUiStore = create<UiState>((set, get) => ({
  leftTab: readLeft(),
  rightOpen: true,
  paletteOpen: false,
  dialog: null,
  editingMaterial: null,
  editingSheet: null,
  commentComposer: null,
  contextMenu: null,
  activeComment: null,
  onboardingStep: null,
  saveToCollectionIds: [],

  setLeftTab(tab) {
    try {
      localStorage.setItem(LEFT_KEY, String(tab))
    } catch {
      /* ignore */
    }
    set({ leftTab: tab })
  },
  toggleLeftTab(tab) {
    get().setLeftTab(get().leftTab === tab ? null : tab)
  },
  setRightOpen: (rightOpen) => set({ rightOpen }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  openDialog: (dialog, opts) =>
    set({
      dialog,
      editingMaterial: opts?.materialId === undefined ? get().editingMaterial : opts.materialId,
      editingSheet: opts?.sheetId === undefined ? get().editingSheet : opts.sheetId,
      saveToCollectionIds: opts?.ids ?? get().saveToCollectionIds,
    }),
  closeDialog: () => set({ dialog: null }),
  setCommentComposer: (commentComposer) => set({ commentComposer }),
  setContextMenu: (contextMenu) => set({ contextMenu }),
  setActiveComment: (activeComment) => set({ activeComment }),
  setOnboardingStep: (onboardingStep) => set({ onboardingStep }),
}))
