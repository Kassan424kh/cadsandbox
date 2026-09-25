// Editor chrome context: the engine (Editor), the design document, the project session and
// React hooks that subscribe to engine state (zustand) and document changes (CadDocument.onChange).
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useStore } from 'zustand'
import { useShallow } from 'zustand/shallow'
import type { AnyNode, CadDocument, DocChangeEvent, NodeBase, UnitsSettings } from '@cadsandbox/doc'
import type { Editor, EditorState } from '@cadsandbox/render'
import type { DesignHandle, LibraryStore, ProjectSession } from '../data/types'

export interface EditorContextValue {
  editor: Editor
  /** false while the render engine (createEditor) is unavailable and a placeholder engine is used. */
  engineAvailable: boolean
  doc: CadDocument
  session: ProjectSession
  handle: DesignHandle
  fileId: string
  library: LibraryStore | null
  onOpenFile(fileId: string): void
  onExit(): void
  /** Import a project archive (.csbx) as a new project and open it (absent: not available here). */
  onImportProject?(file: File): void
  readOnly: boolean
}

export const EditorContext = createContext<EditorContextValue | null>(null)

export function useEditorCtx(): EditorContextValue {
  const ctx = useContext(EditorContext)
  if (!ctx) throw new Error('useEditorCtx must be used inside <EditorContext.Provider>')
  return ctx
}

export function useEditor(): Editor {
  return useEditorCtx().editor
}

/** Subscribe to a slice of the engine state (primitive or shallow-compared object). */
export function useEditorState<T>(selector: (s: EditorState) => T): T {
  const { editor } = useEditorCtx()
  return useStore(editor.store, useShallow(selector))
}

/** Minimum spacing of document-driven React updates during change bursts (drags, remote streams). */
const DOC_UI_INTERVAL_MS = 120

/** Increments whenever the document changes (optionally filtered by event). */
export function useDocVersion(filter?: (e: DocChangeEvent) => boolean): number {
  const { doc } = useEditorCtx()
  const [version, setVersion] = useState(0)
  useEffect(() => {
    let pending = false
    let last = 0
    let timer = 0
    const bump = () => {
      timer = 0
      pending = false
      last = performance.now()
      setVersion((v) => v + 1)
    }
    const off = doc.onChange((e) => {
      if (filter && !filter(e)) return
      if (pending) return
      pending = true
      // Coalesce change bursts: interactive drags write the document ~15×/s and every subscriber
      // re-rendering per write costs more than the frame itself. First change → next frame; the
      // rest at most every DOC_UI_INTERVAL_MS with the trailing change always delivered.
      const wait = DOC_UI_INTERVAL_MS - (performance.now() - last)
      if (wait > 0) timer = window.setTimeout(bump, wait)
      else requestAnimationFrame(bump)
    })
    return () => {
      off()
      if (timer) clearTimeout(timer)
    }
    // filter is expected to be stable (module-level) — callers pass constants.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc])
  return version
}

/** Derive data from the document; recomputed on (filtered) document changes and whenever one of
 *  `deps` changes — pass every prop/state value the selector closes over (e.g. an id), otherwise
 *  the previous result is returned until the next document change. */
export function useDocSelector<T>(selector: (doc: CadDocument) => T, filter?: (e: DocChangeEvent) => boolean, deps: readonly unknown[] = []): T {
  const { doc } = useEditorCtx()
  const version = useDocVersion(filter)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => selector(doc), [doc, version, ...deps])
}

// Common filters (module-level so subscriptions stay stable)
export const onNodes = (e: DocChangeEvent) => e.nodes.added.size > 0 || e.nodes.removed.size > 0 || e.nodes.updated.size > 0
export const onMeta = (e: DocChangeEvent) => e.meta
export const onMaterials = (e: DocChangeEvent) => e.materials.size > 0
export const onLayers = (e: DocChangeEvent) => e.layers
export const onViews = (e: DocChangeEvent) => e.views
export const onSheets = (e: DocChangeEvent) => e.sheets
export const onComments = (e: DocChangeEvent) => e.comments
export const onComponents = (e: DocChangeEvent) => e.components.size > 0
export const onStructure = (e: DocChangeEvent) => onNodes(e) || e.components.size > 0

export function useUnits(): UnitsSettings {
  return useDocSelector((d) => d.meta.units, onMeta)
}

/** doc.getNode returns the generic NodeBase; narrow it to the AnyNode union for switch-on-type code. */
export const asAny = (n: NodeBase | undefined): AnyNode | undefined => n as AnyNode | undefined

export function useNode(id: string | null | undefined): AnyNode | undefined {
  return useDocSelector((d) => (id ? asAny(d.getNode(id)) : undefined), onNodes, [id])
}

/** Selected nodes (resolved against the document, in selection order). */
export function useSelectionNodes(): AnyNode[] {
  const selection = useEditorState((s) => s.selection)
  const { doc } = useEditorCtx()
  const version = useDocVersion(onNodes)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => selection.map((id) => asAny(doc.getNode(id))).filter((n): n is AnyNode => !!n), [selection, doc, version])
}
