// zustand vanilla store holding the observable editor state (consumed by React via useStore).
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { EditorState, EditorStats, NavigationSettings, SnapSettings, Theme, ViewportState } from './api'

export const DEFAULT_NAVIGATION: NavigationSettings = { trackpadGestures: false, viewOnly: false }

export const DEFAULT_SNAPPING: SnapSettings = {
  enabled: true,
  grid: true,
  endpoint: true,
  midpoint: true,
  center: true,
  intersection: true,
  perpendicular: true,
  parallel: true,
  nearest: true,
  extension: true,
  angle: true,
  angleStepDeg: 15,
  ortho: false,
  radiusPx: 10,
}

export function defaultViewport(index: number, preset: ViewportState['preset'] = 'perspective'): ViewportState {
  const ortho = preset !== 'perspective' && preset !== 'iso' && preset !== 'custom'
  return {
    index,
    preset,
    projection: ortho ? 'orthographic' : 'perspective',
    renderMode: 'shaded',
    label: presetLabel(preset),
    planLevel: null,
    section: null,
  }
}

export function presetLabel(preset: ViewportState['preset']): string {
  switch (preset) {
    case 'top':
      return 'Top'
    case 'bottom':
      return 'Bottom'
    case 'front':
      return 'Front'
    case 'back':
      return 'Back'
    case 'left':
      return 'Left'
    case 'right':
      return 'Right'
    case 'iso':
      return 'Isometric'
    case 'perspective':
      return 'Perspective'
    default:
      return 'Custom'
  }
}

export function initialStats(gpu: string, quality: EditorStats['quality']): EditorStats {
  return { fps: 0, frameMs: 0, triangles: 0, drawCalls: 0, nodes: 0, geometryPending: 0, gpu, backend: 'webgl2', quality }
}

export function createEditorStore(theme: Theme, readOnly: boolean, gpu: string, quality: EditorStats['quality']): StoreApi<EditorState> {
  return createStore<EditorState>(() => ({
    ready: false,
    selection: [],
    hover: null,
    selectionBounds: null,
    tool: 'select',
    toolOptions: {},
    toolHint: '',
    toolInput: null,
    gizmo: 'translate',
    transformSpace: 'world',
    layout: 'single',
    viewports: [defaultViewport(0)],
    activeViewport: 0,
    snapping: { ...DEFAULT_SNAPPING },
    navigation: { ...DEFAULT_NAVIGATION },
    gridVisible: true,
    activeLevel: null,
    isolated: null,
    editingContext: null,
    cursorWorld: null,
    measure: null,
    realistic: { active: false, samples: 0, targetSamples: 256 },
    canUndo: false,
    canRedo: false,
    clipboard: false,
    remoteUsers: [],
    following: null,
    stats: initialStats(gpu, quality),
    theme,
    readOnly,
  }))
}

/** Shallow patch helper that skips no-op updates (keeps React renders minimal). */
export function patchStore(store: StoreApi<EditorState>, patch: Partial<EditorState>): void {
  const cur = store.getState()
  for (const k in patch) {
    if ((cur as unknown as Record<string, unknown>)[k] !== (patch as Record<string, unknown>)[k]) {
      store.setState(patch)
      return
    }
  }
}

export function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
