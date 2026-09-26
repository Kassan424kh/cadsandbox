// Shared editor actions used by toolbars, menus, the palette and panels.
import { useMemo } from 'react'
import type { CommandId, ToolId } from '@cadsandbox/render'
import type { NewNode } from '@cadsandbox/doc'
import { useT } from '../../i18n'
import { toast } from '../../ui'
import { useEditorCtx } from '../EditorContext'
import { writeBlockMessage } from '../writeBlock'
import { TOOL_META, toolDefaults, toolOptionSpecs, useToolRegistry } from '../engine/tools'
import { useUiStore } from '../ui-store'

export function useActions() {
  const { editor, doc, readOnly, viewOnlyOnDevice, session } = useEditorCtx()
  const registry = useToolRegistry()
  const t = useT()
  return useMemo(() => {
    const guard = (): boolean => {
      if (readOnly) {
        toast.info(
          viewOnlyOnDevice
            ? t('editor.readOnlyDevice', 'Editing needs a larger screen — open this project on a tablet or computer to change it.')
            : session.writeBlock
              ? writeBlockMessage(t, session.writeBlock, session.role === 'owner')
              : t('editor.readOnlyHint', 'You have view access — ask the owner for edit rights to change this design.'),
        )
        return false
      }
      return true
    }
    const selection = () => editor.getState().selection
    return {
      run(id: CommandId) {
        void editor.commands.execute(id)
      },
      /** Activate a tool with its default options merged with `options`. */
      setTool(id: ToolId, options?: Record<string, unknown>) {
        if (id !== 'select' && !TOOL_META[id]?.group.match(/nav|select/) && id !== 'annotate.comment' && !id.startsWith('measure.') && !guard()) return
        const specs = toolOptionSpecs(id, registry)
        editor.setTool(id, { ...toolDefaults(specs), ...options })
      },
      /** Add tool: hover-preview + click to place a node. */
      place(node: NewNode, itemId?: string) {
        if (!guard()) return
        editor.setTool('place', { node, itemId })
      },
      setColor(hex: string | null, ids = selection()) {
        if (!guard() || ids.length === 0) return
        doc.updateNodes(ids.map((id) => ({ id, patch: { color: hex } })))
      },
      setMaterial(materialId: string | null, ids = selection()) {
        if (!guard() || ids.length === 0) return
        doc.updateNodes(ids.map((id) => ({ id, patch: { material: materialId } })))
      },
      setLayer(layerId: string | null, ids = selection()) {
        if (!guard() || ids.length === 0) return
        doc.updateNodes(ids.map((id) => ({ id, patch: { layer: layerId } })))
      },
      rename(id: string, name: string) {
        if (!guard()) return
        doc.updateNode(id, { name })
      },
      toggleVisible(id: string) {
        if (!guard()) return
        const n = doc.getNode(id)
        if (n) doc.updateNode(id, { visible: !n.visible })
      },
      toggleLocked(id: string) {
        if (!guard()) return
        const n = doc.getNode(id)
        if (n) doc.updateNode(id, { locked: !n.locked })
      },
      focus(ids: string[] = selection()) {
        editor.zoomToFit(ids.length ? ids : undefined, true)
      },
      saveToCollection(ids: string[] = selection()) {
        if (ids.length === 0) return
        useUiStore.getState().openDialog('saveToCollection', { ids })
      },
      readOnly,
      canEdit: !readOnly,
    }
  }, [editor, doc, readOnly, viewOnlyOnDevice, session, registry, t])
}

export type Actions = ReturnType<typeof useActions>
