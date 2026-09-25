// UI state for the drafting/presentation features added by the CAD engineer: the PDF underlay import
// dialog (page + DPI), the video export dialog and the running sun study. Kept separate from ui-store
// so the chrome's dialog union stays untouched.
import { create } from 'zustand'
import type { SunStudy } from '@cadsandbox/render'

interface PresentationState {
  /** PDF file waiting for page/DPI selection (drop position kept for placement). */
  pdfImport: { file: File; at?: { clientX: number; clientY: number } } | null
  videoDialog: boolean
  sunStudy: SunStudy | null
  sunSpeed: number
  openPdfImport(file: File, at?: { clientX: number; clientY: number }): void
  closePdfImport(): void
  openVideoDialog(): void
  closeVideoDialog(): void
  setSunStudy(study: SunStudy | null): void
  setSunSpeed(hoursPerSecond: number): void
}

export const usePresentationStore = create<PresentationState>((set, get) => ({
  pdfImport: null,
  videoDialog: false,
  sunStudy: null,
  sunSpeed: 1.5,
  openPdfImport: (file, at) => set({ pdfImport: { file, at } }),
  closePdfImport: () => set({ pdfImport: null }),
  openVideoDialog: () => set({ videoDialog: true }),
  closeVideoDialog: () => set({ videoDialog: false }),
  setSunStudy: (sunStudy) => set({ sunStudy }),
  setSunSpeed: (sunSpeed) => {
    get().sunStudy?.setSpeed(sunSpeed)
    set({ sunSpeed })
  },
}))
