// Loads the render engine lazily and falls back to the placeholder when `createEditor` is not
// exported yet (the engine is developed concurrently) or throws (e.g. no WebGL2).
import type { CreateEditor, Editor, EditorOptions } from '@cadsandbox/render'
import { createPlaceholderEditor } from './placeholder'

export interface EngineResult {
  editor: Editor
  available: boolean
  error?: string
}

type RenderModule = Partial<{ createEditor: CreateEditor }>

let modulePromise: Promise<RenderModule> | null = null

function loadRenderModule(): Promise<RenderModule> {
  if (!modulePromise) {
    modulePromise = import('@cadsandbox/render').then((m) => m as unknown as RenderModule).catch(() => ({}) as RenderModule)
  }
  return modulePromise
}

export async function createEngine(options: EditorOptions): Promise<EngineResult> {
  const mod = await loadRenderModule()
  if (typeof mod.createEditor === 'function') {
    try {
      const editor = mod.createEditor(options)
      // dev-only debugging/profiling handle (stripped from production builds)
      if (import.meta.env.DEV) {
        ;(window as unknown as { __cs?: unknown }).__cs = editor
        // dev assertion: every rendered copy of a node (batch instances, standalone/picking meshes,
        // edges, wire) must sit at the document's world matrix
        const sync = (editor as unknown as { sync?: { placementViolations(): string[] } }).sync
        if (sync) {
          const timer = window.setInterval(() => {
            const violations = sync.placementViolations()
            if (violations.length) console.warn('[cadsandbox] scene placement violations:', violations)
          }, 2000)
          window.addEventListener('beforeunload', () => window.clearInterval(timer), { once: true })
        }
      }
      return { editor, available: true }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      console.warn('[cadsandbox] createEditor failed, using placeholder engine:', error)
      return { editor: createPlaceholderEditor(options), available: false, error }
    }
  }
  return { editor: createPlaceholderEditor(options), available: false }
}
