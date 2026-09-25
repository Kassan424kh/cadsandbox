// Global keyboard shortcuts: palette, help, escape, engine command shortcuts, tool keys, panels.
import { useEffect } from 'react'
import { TOOL_SHORTCUTS, type ToolId } from '@cadsandbox/render'
import { isEditableTarget, isModKey, matchesShortcut } from '../../ui'
import { useEditorCtx } from '../EditorContext'
import { useUiStore, type LeftTab } from '../ui-store'
import { useActions } from './actions'

const PANEL_KEYS: Record<string, LeftTab> = { s: 'scene', f: 'files', l: 'library', c: 'comments' }

export function useGlobalShortcuts(): void {
  const { editor, readOnly } = useEditorCtx()
  const actions = useActions()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUiStore.getState()
      // Palette & help work everywhere
      if (isModKey(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        ui.setPaletteOpen(!ui.paletteOpen)
        return
      }
      if (isEditableTarget(e.target)) {
        if (e.key === 'Escape') (e.target as HTMLElement).blur()
        return
      }
      if (e.key === '?' && !isModKey(e)) {
        e.preventDefault()
        ui.openDialog('shortcuts')
        return
      }
      if (ui.dialog || ui.paletteOpen) return
      const state = editor.getState()
      if (e.key === 'Escape') {
        if (ui.contextMenu) return ui.setContextMenu(null)
        if (ui.commentComposer) return ui.setCommentComposer(null)
        // The engine's window listener (registered first) already ran its Escape chain — cancel step →
        // exit tool → deselect → leave group → exit isolation — and marked the event. One press = one step.
        if (e.defaultPrevented) return
        e.preventDefault()
        if (state.tool !== 'select' || state.toolInput) return editor.cancel()
        if (state.isolated) return editor.isolate(null)
        if (state.editingContext) return void editor.commands.execute('object.exit')
        if (state.selection.length) return editor.select([])
        return
      }
      // The engine's own window keydown listener (registered before this one) handles tool keys and
      // marks what it consumed with preventDefault: VCB entry ("3.5m", "8'6\""), Enter after a typed
      // value, a tool's letter keys (C closes a line/cloud, R rotates a placement), Delete. Those
      // keys must not also confirm the tool or fire command/tool shortcuts (M → Measure mid-entry).
      if (e.defaultPrevented) return
      if (e.key === 'Enter' && state.tool !== 'select') {
        e.preventDefault()
        return void editor.commands.execute('tool.confirm')
      }
      // Panels: Alt+S/F/L/C
      if (e.altKey && !isModKey(e) && !e.shiftKey && PANEL_KEYS[e.key.toLowerCase()]) {
        e.preventDefault()
        ui.toggleLeftTab(PANEL_KEYS[e.key.toLowerCase()]!)
        return
      }
      // Engine commands (read-only users only get view/select commands)
      for (const cmd of editor.commands.list()) {
        if (!cmd.shortcut || !matchesShortcut(e, cmd.shortcut)) continue
        if (readOnly && !/^(view|render|edit\.select|level|gizmo|tool)/.test(cmd.id)) continue
        if (!editor.commands.canExecute(cmd.id)) return
        e.preventDefault()
        void editor.commands.execute(cmd.id)
        return
      }
      // Tool shortcuts (single keys, or Shift+key)
      if (!isModKey(e) && !e.altKey) {
        for (const [tool, key] of Object.entries(TOOL_SHORTCUTS) as [ToolId, string][]) {
          if (!matchesShortcut(e, key)) continue
          if (readOnly && !(tool === 'select' || tool === 'pan' || tool.startsWith('measure.'))) return
          e.preventDefault()
          actions.setTool(tool)
          return
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editor, actions, readOnly])
}
