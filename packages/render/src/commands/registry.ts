// CommandRegistry — metadata for every CommandId (labels, categories, platform-neutral shortcuts,
// lucide icon names) and dispatch to the action implementations.
import type { CommandId, CommandInfo, CommandRegistry } from '../api'

type Info = Omit<CommandInfo, 'id'>

export const COMMAND_INFO: Record<CommandId, Info> = {
  'edit.undo': { label: 'Undo', category: 'Edit', shortcut: 'Mod+Z', icon: 'undo-2' },
  'edit.redo': { label: 'Redo', category: 'Edit', shortcut: 'Mod+Shift+Z', icon: 'redo-2' },
  'edit.cut': { label: 'Cut', category: 'Edit', shortcut: 'Mod+X', icon: 'scissors' },
  'edit.copy': { label: 'Copy', category: 'Edit', shortcut: 'Mod+C', icon: 'copy' },
  'edit.paste': { label: 'Paste', category: 'Edit', shortcut: 'Mod+V', icon: 'clipboard-paste' },
  'edit.pasteInPlace': { label: 'Paste in Place', category: 'Edit', shortcut: 'Mod+Shift+V', icon: 'clipboard-check' },
  'edit.duplicate': { label: 'Duplicate', category: 'Edit', shortcut: 'Mod+D', icon: 'copy-plus' },
  'edit.delete': { label: 'Delete', category: 'Edit', shortcut: 'Delete', icon: 'trash-2' },
  'edit.selectAll': { label: 'Select All', category: 'Edit', shortcut: 'Mod+A', icon: 'box-select' },
  'edit.selectNone': { label: 'Deselect All', category: 'Edit', shortcut: 'Mod+Shift+A', icon: 'square-dashed' },
  'edit.selectInvert': { label: 'Invert Selection', category: 'Edit', shortcut: 'Mod+I', icon: 'flip-horizontal-2' },
  'edit.selectSimilar': { label: 'Select Similar', category: 'Edit', shortcut: 'Shift+G', icon: 'layers' },
  'object.group': { label: 'Group', category: 'Object', shortcut: 'Mod+G', icon: 'group' },
  'object.ungroup': { label: 'Ungroup', category: 'Object', shortcut: 'Mod+Shift+G', icon: 'ungroup' },
  'object.hide': { label: 'Hide', category: 'Object', shortcut: 'Shift+H', icon: 'eye-off' },
  'object.unhideAll': { label: 'Unhide All', category: 'Object', shortcut: 'Alt+H', icon: 'eye' },
  'object.isolate': { label: 'Isolate', category: 'Object', shortcut: 'Shift+I', icon: 'focus' },
  'object.lock': { label: 'Lock', category: 'Object', shortcut: 'Mod+L', icon: 'lock' },
  'object.unlockAll': { label: 'Unlock All', category: 'Object', shortcut: 'Mod+Shift+L', icon: 'lock-open' },
  'object.makeComponent': { label: 'Make Component', category: 'Object', shortcut: 'Mod+Shift+K', icon: 'component' },
  'object.explode': { label: 'Explode', category: 'Object', shortcut: 'Mod+Shift+E', icon: 'expand' },
  'object.bake': { label: 'Bake to Mesh', category: 'Object', icon: 'box' },
  'object.enter': { label: 'Edit Group', category: 'Object', shortcut: 'Enter', icon: 'log-in' },
  'object.exit': { label: 'Exit Group', category: 'Object', shortcut: 'Escape', icon: 'log-out' },
  'boolean.union': { label: 'Union', category: 'Boolean', icon: 'circle-plus' },
  'boolean.subtract': { label: 'Subtract', category: 'Boolean', icon: 'circle-minus' },
  'boolean.intersect': { label: 'Intersect', category: 'Boolean', icon: 'circle-dot' },
  'transform.reset': { label: 'Reset Transform', category: 'Transform', icon: 'rotate-ccw' },
  'transform.mirrorX': { label: 'Mirror X', category: 'Transform', icon: 'flip-horizontal' },
  'transform.mirrorY': { label: 'Mirror Y', category: 'Transform', icon: 'flip-vertical' },
  'transform.mirrorZ': { label: 'Mirror Z', category: 'Transform', icon: 'flip-vertical-2' },
  'transform.dropToFloor': { label: 'Drop to Floor', category: 'Transform', shortcut: 'End', icon: 'arrow-down-to-line' },
  'transform.rotate90': { label: 'Rotate 90°', category: 'Transform', shortcut: 'Mod+R', icon: 'rotate-cw-square' },
  'align.minX': { label: 'Align Left', category: 'Align', icon: 'align-start-vertical' },
  'align.centerX': { label: 'Align Center X', category: 'Align', icon: 'align-center-vertical' },
  'align.maxX': { label: 'Align Right', category: 'Align', icon: 'align-end-vertical' },
  'align.minY': { label: 'Align Front', category: 'Align', icon: 'align-start-horizontal' },
  'align.centerY': { label: 'Align Center Y', category: 'Align', icon: 'align-center-horizontal' },
  'align.maxY': { label: 'Align Back', category: 'Align', icon: 'align-end-horizontal' },
  'align.minZ': { label: 'Align Bottom', category: 'Align', icon: 'align-vertical-justify-start' },
  'align.centerZ': { label: 'Align Center Z', category: 'Align', icon: 'align-vertical-justify-center' },
  'align.maxZ': { label: 'Align Top', category: 'Align', icon: 'align-vertical-justify-end' },
  'distribute.x': { label: 'Distribute X', category: 'Align', icon: 'align-horizontal-space-around' },
  'distribute.y': { label: 'Distribute Y', category: 'Align', icon: 'align-vertical-space-around' },
  'distribute.z': { label: 'Distribute Z', category: 'Align', icon: 'align-vertical-distribute-center' },
  'gizmo.translate': { label: 'Move Gizmo', category: 'Transform', shortcut: 'G', icon: 'move' },
  'gizmo.rotate': { label: 'Rotate Gizmo', category: 'Transform', shortcut: 'Q', icon: 'rotate-3d' },
  'gizmo.scale': { label: 'Scale Gizmo', category: 'Transform', shortcut: 'E', icon: 'scaling' },
  'gizmo.toggleSpace': { label: 'Toggle World/Local', category: 'Transform', shortcut: 'Shift+W', icon: 'axis-3d' },
  'view.zoomExtents': { label: 'Zoom Extents', category: 'View', shortcut: 'Shift+Z', icon: 'maximize' },
  'view.zoomSelection': { label: 'Zoom to Selection', category: 'View', shortcut: 'Z', icon: 'zoom-in' },
  'view.top': { label: 'Top', category: 'View', shortcut: 'Num7', icon: 'square' },
  'view.bottom': { label: 'Bottom', category: 'View', shortcut: 'Mod+Num7', icon: 'square' },
  'view.front': { label: 'Front', category: 'View', shortcut: 'Num1', icon: 'square' },
  'view.back': { label: 'Back', category: 'View', shortcut: 'Mod+Num1', icon: 'square' },
  'view.left': { label: 'Left', category: 'View', shortcut: 'Mod+Num3', icon: 'square' },
  'view.right': { label: 'Right', category: 'View', shortcut: 'Num3', icon: 'square' },
  'view.iso': { label: 'Isometric', category: 'View', shortcut: 'Num0', icon: 'box' },
  'view.perspective': { label: 'Perspective', category: 'View', shortcut: 'Num5', icon: 'video' },
  'view.toggleProjection': { label: 'Toggle Ortho/Perspective', category: 'View', shortcut: 'Num5', icon: 'view' },
  'view.layoutSingle': { label: 'Single View', category: 'View', shortcut: 'Alt+1', icon: 'square' },
  'view.layoutSplit': { label: 'Split View', category: 'View', shortcut: 'Alt+2', icon: 'columns-2' },
  'view.layoutQuad': { label: 'Quad View', category: 'View', shortcut: 'Alt+4', icon: 'layout-grid' },
  'view.toggleGrid': { label: 'Toggle Grid', category: 'View', shortcut: "Mod+'", icon: 'grid-3x3' },
  'view.toggleSnap': { label: 'Toggle Snapping', category: 'View', shortcut: 'Mod+Shift+;', icon: 'magnet' },
  'view.toggleOrtho': { label: 'Toggle Ortho Lock', category: 'View', shortcut: 'F8', icon: 'move-diagonal' },
  'view.saveView': { label: 'Save View', category: 'View', icon: 'camera' },
  'render.shaded': { label: 'Shaded', category: 'Render', shortcut: 'Alt+Shift+1', icon: 'sun' },
  'render.realistic': { label: 'Realistic', category: 'Render', shortcut: 'Alt+Shift+2', icon: 'sparkles' },
  'render.clay': { label: 'Clay', category: 'Render', shortcut: 'Alt+Shift+3', icon: 'circle' },
  'render.wireframe': { label: 'Wireframe', category: 'Render', shortcut: 'Alt+Shift+4', icon: 'grid-2x2' },
  'render.xray': { label: 'X-Ray', category: 'Render', shortcut: 'Alt+Shift+5', icon: 'scan' },
  'render.hiddenLine': { label: 'Hidden Line', category: 'Render', shortcut: 'Alt+Shift+6', icon: 'pen-line' },
  'render.technical': { label: 'Technical', category: 'Render', shortcut: 'Alt+Shift+7', icon: 'ruler' },
  'level.up': { label: 'Level Up', category: 'Level', shortcut: 'PageUp', icon: 'chevrons-up' },
  'level.down': { label: 'Level Down', category: 'Level', shortcut: 'PageDown', icon: 'chevrons-down' },
  'tool.cancel': { label: 'Cancel', category: 'Tool', shortcut: 'Escape', icon: 'x' },
  'tool.confirm': { label: 'Confirm', category: 'Tool', shortcut: 'Enter', icon: 'check' },
}

export const COMMAND_IDS = Object.keys(COMMAND_INFO) as CommandId[]

export interface CommandHandlers {
  canExecute(id: CommandId): boolean
  execute(id: CommandId, args?: unknown): void | Promise<void>
}

export function createCommandRegistry(handlers: CommandHandlers): CommandRegistry {
  const infos: CommandInfo[] = COMMAND_IDS.map((id) => ({ id, ...COMMAND_INFO[id] }))
  const byId = new Map(infos.map((i) => [i.id, i]))
  return {
    list: () => infos.slice(),
    get: (id) => byId.get(id),
    canExecute: (id) => byId.has(id) && handlers.canExecute(id),
    execute: (id, args) => {
      if (!byId.has(id)) {
        console.warn(`[cadsandbox/render] unknown command "${id}"`)
        return
      }
      if (!handlers.canExecute(id)) return
      return handlers.execute(id, args)
    },
  }
}
