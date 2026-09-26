// Placeholder engine used while @cadsandbox/render's createEditor is unavailable (built in
// parallel). Implements the full Editor contract against the CadDocument so the whole chrome —
// outliner, inspector, commands, undo, levels, layers, comments — works without a viewport.
import { createStore } from 'zustand/vanilla'
import type { AnyNode, CadDocument, CameraState, DocSnapshot, NewNode, Quat, RenderMode, Transform, Vec3 } from '@cadsandbox/doc'
import { identityTransform, multiplyQuat, quatFromAxisAngle } from '@cadsandbox/doc'
import type { GeometryService } from '@cadsandbox/geometry'
import type { CommandId, CommandInfo, Editor, EditorEvents, EditorOptions, EditorState, GizmoMode, SnapSettings, ToolId, ViewLayout, ViewPreset, ViewportState } from '@cadsandbox/render'

export const DEFAULT_SNAPPING: SnapSettings = {
  enabled: true,
  grid: true,
  endpoint: true,
  midpoint: true,
  center: true,
  intersection: true,
  perpendicular: true,
  parallel: false,
  nearest: false,
  extension: true,
  angle: true,
  angleStepDeg: 15,
  ortho: false,
  radiusPx: 10,
}

const PRESET_LABEL: Record<ViewPreset, string> = { top: 'Top', bottom: 'Bottom', front: 'Front', back: 'Back', left: 'Left', right: 'Right', iso: 'Isometric', perspective: 'Perspective' }

function viewport(index: number, preset: ViewPreset, renderMode: RenderMode = 'shaded'): ViewportState {
  return { index, preset, projection: preset === 'perspective' ? 'perspective' : 'orthographic', renderMode, label: PRESET_LABEL[preset], planLevel: null, section: null }
}

export function defaultViewports(layout: ViewLayout): ViewportState[] {
  if (layout === 'single') return [viewport(0, 'perspective')]
  if (layout === 'split') return [viewport(0, 'front', 'technical'), viewport(1, 'perspective')]
  return [viewport(0, 'top', 'technical'), viewport(1, 'front', 'technical'), viewport(2, 'right', 'technical'), viewport(3, 'perspective')]
}

export function defaultEditorState(opts: Pick<EditorOptions, 'theme' | 'readOnly'>, doc: CadDocument): EditorState {
  const levels = doc.levels()
  return {
    ready: true,
    selection: [],
    hover: null,
    selectionBounds: null,
    tool: 'select',
    toolOptions: {},
    toolHint: '',
    toolInput: null,
    gizmo: 'translate',
    transformSpace: 'world',
    layout: 'split',
    viewports: defaultViewports('split'),
    activeViewport: 1,
    snapping: { ...DEFAULT_SNAPPING },
    navigation: { trackpadGestures: false, viewOnly: false },
    gridVisible: doc.meta.grid.visible,
    activeLevel: doc.meta.activeLevel ?? levels[0]?.id ?? null,
    isolated: null,
    editingContext: null,
    cursorWorld: null,
    measure: null,
    realistic: { active: false, samples: 0, targetSamples: 256 },
    canUndo: doc.canUndo(),
    canRedo: doc.canRedo(),
    clipboard: false,
    remoteUsers: [],
    following: null,
    stats: { fps: 0, frameMs: 0, triangles: 0, drawCalls: 0, nodes: doc.nodeIds().length, geometryPending: 0, gpu: '—', backend: 'webgl2', quality: 'medium' },
    theme: opts.theme,
    readOnly: !!opts.readOnly,
  }
}

const COMMANDS: CommandInfo[] = [
  { id: 'edit.undo', label: 'Undo', category: 'Edit', shortcut: 'Mod+Z', icon: 'Undo2' },
  { id: 'edit.redo', label: 'Redo', category: 'Edit', shortcut: 'Mod+Shift+Z', icon: 'Redo2' },
  { id: 'edit.cut', label: 'Cut', category: 'Edit', shortcut: 'Mod+X', icon: 'Scissors' },
  { id: 'edit.copy', label: 'Copy', category: 'Edit', shortcut: 'Mod+C', icon: 'Copy' },
  { id: 'edit.paste', label: 'Paste', category: 'Edit', shortcut: 'Mod+V', icon: 'ClipboardPaste' },
  { id: 'edit.pasteInPlace', label: 'Paste in place', category: 'Edit', shortcut: 'Mod+Shift+V' },
  { id: 'edit.duplicate', label: 'Duplicate', category: 'Edit', shortcut: 'Mod+D', icon: 'Copy' },
  { id: 'edit.delete', label: 'Delete', category: 'Edit', shortcut: 'Delete', icon: 'Trash' },
  { id: 'edit.selectAll', label: 'Select all', category: 'Edit', shortcut: 'Mod+A' },
  { id: 'edit.selectNone', label: 'Deselect', category: 'Edit', shortcut: 'Mod+Shift+A' },
  { id: 'edit.selectInvert', label: 'Invert selection', category: 'Edit', shortcut: 'Mod+I' },
  { id: 'edit.selectSimilar', label: 'Select similar', category: 'Edit' },
  { id: 'object.group', label: 'Group', category: 'Object', shortcut: 'Mod+G', icon: 'Group' },
  { id: 'object.ungroup', label: 'Ungroup', category: 'Object', shortcut: 'Mod+Shift+G', icon: 'Ungroup' },
  { id: 'object.hide', label: 'Hide', category: 'Object', shortcut: 'Shift+H', icon: 'EyeOff' },
  { id: 'object.unhideAll', label: 'Unhide all', category: 'Object', shortcut: 'Alt+H', icon: 'Eye' },
  { id: 'object.isolate', label: 'Isolate', category: 'Object', shortcut: 'Shift+I', icon: 'Focus' },
  { id: 'object.lock', label: 'Lock', category: 'Object', shortcut: 'Shift+L', icon: 'Lock' },
  { id: 'object.unlockAll', label: 'Unlock all', category: 'Object', shortcut: 'Mod+Shift+L', icon: 'LockOpen' },
  { id: 'object.makeComponent', label: 'Make component', category: 'Object', shortcut: 'Mod+Shift+K', icon: 'Component' },
  { id: 'object.explode', label: 'Explode', category: 'Object', icon: 'Boxes' },
  { id: 'object.bake', label: 'Bake to mesh', category: 'Object' },
  { id: 'object.enter', label: 'Edit group', category: 'Object', shortcut: 'Enter' },
  { id: 'object.exit', label: 'Exit group', category: 'Object', shortcut: 'Escape' },
  { id: 'boolean.union', label: 'Union', category: 'Boolean', icon: 'Combine' },
  { id: 'boolean.subtract', label: 'Subtract', category: 'Boolean' },
  { id: 'boolean.intersect', label: 'Intersect', category: 'Boolean' },
  { id: 'transform.reset', label: 'Reset transform', category: 'Transform' },
  { id: 'transform.mirrorX', label: 'Mirror X', category: 'Transform' },
  { id: 'transform.mirrorY', label: 'Mirror Y', category: 'Transform' },
  { id: 'transform.mirrorZ', label: 'Mirror Z', category: 'Transform' },
  { id: 'transform.dropToFloor', label: 'Drop to floor', category: 'Transform', shortcut: 'End' },
  { id: 'transform.rotate90', label: 'Rotate 90°', category: 'Transform', shortcut: 'Shift+R' },
  { id: 'align.minX', label: 'Align left (X)', category: 'Align' },
  { id: 'align.centerX', label: 'Align center (X)', category: 'Align' },
  { id: 'align.maxX', label: 'Align right (X)', category: 'Align' },
  { id: 'align.minY', label: 'Align front (Y)', category: 'Align' },
  { id: 'align.centerY', label: 'Align center (Y)', category: 'Align' },
  { id: 'align.maxY', label: 'Align back (Y)', category: 'Align' },
  { id: 'align.minZ', label: 'Align bottom (Z)', category: 'Align' },
  { id: 'align.centerZ', label: 'Align middle (Z)', category: 'Align' },
  { id: 'align.maxZ', label: 'Align top (Z)', category: 'Align' },
  { id: 'distribute.x', label: 'Distribute X', category: 'Align' },
  { id: 'distribute.y', label: 'Distribute Y', category: 'Align' },
  { id: 'distribute.z', label: 'Distribute Z', category: 'Align' },
  { id: 'gizmo.translate', label: 'Move gizmo', category: 'Transform', shortcut: 'G', icon: 'Move3d' },
  { id: 'gizmo.rotate', label: 'Rotate gizmo', category: 'Transform', shortcut: 'E', icon: 'Rotate3d' },
  { id: 'gizmo.scale', label: 'Scale gizmo', category: 'Transform', shortcut: 'B', icon: 'Scale3d' },
  { id: 'gizmo.toggleSpace', label: 'Toggle world/local', category: 'Transform' },
  { id: 'view.zoomExtents', label: 'Zoom extents', category: 'View', shortcut: 'Shift+Z', icon: 'Maximize' },
  { id: 'view.zoomSelection', label: 'Zoom to selection', category: 'View', shortcut: 'Z', icon: 'Focus' },
  { id: 'view.top', label: 'Top view', category: 'View', shortcut: '7' },
  { id: 'view.bottom', label: 'Bottom view', category: 'View', shortcut: 'Mod+7' },
  { id: 'view.front', label: 'Front view', category: 'View', shortcut: '1' },
  { id: 'view.back', label: 'Back view', category: 'View', shortcut: 'Mod+1' },
  { id: 'view.left', label: 'Left view', category: 'View', shortcut: 'Mod+3' },
  { id: 'view.right', label: 'Right view', category: 'View', shortcut: '3' },
  { id: 'view.iso', label: 'Isometric view', category: 'View', shortcut: '9' },
  { id: 'view.perspective', label: 'Perspective view', category: 'View', shortcut: '0' },
  { id: 'view.toggleProjection', label: 'Toggle perspective/ortho', category: 'View', shortcut: '5' },
  { id: 'view.layoutSingle', label: 'Single viewport', category: 'View', shortcut: 'Alt+1' },
  { id: 'view.layoutSplit', label: 'Split viewports', category: 'View', shortcut: 'Alt+2' },
  { id: 'view.layoutQuad', label: 'Quad viewports', category: 'View', shortcut: 'Alt+4' },
  { id: 'view.toggleGrid', label: 'Toggle grid', category: 'View', shortcut: 'Shift+G' },
  { id: 'view.toggleSnap', label: 'Toggle snapping', category: 'View', shortcut: 'Shift+S' },
  { id: 'view.toggleOrtho', label: 'Toggle ortho lock', category: 'View', shortcut: 'F8' },
  { id: 'view.saveView', label: 'Save view', category: 'View', icon: 'Bookmark' },
  { id: 'render.shaded', label: 'Shaded', category: 'Render' },
  { id: 'render.realistic', label: 'Realistic', category: 'Render' },
  { id: 'render.clay', label: 'Clay', category: 'Render' },
  { id: 'render.wireframe', label: 'Wireframe', category: 'Render' },
  { id: 'render.xray', label: 'X-ray', category: 'Render' },
  { id: 'render.hiddenLine', label: 'Hidden line', category: 'Render' },
  { id: 'render.technical', label: 'Technical', category: 'Render' },
  { id: 'level.up', label: 'Level up', category: 'Level', shortcut: 'PageUp' },
  { id: 'level.down', label: 'Level down', category: 'Level', shortcut: 'PageDown' },
  { id: 'tool.cancel', label: 'Cancel', category: 'Tool', shortcut: 'Escape' },
  { id: 'tool.confirm', label: 'Confirm', category: 'Tool', shortcut: 'Enter' },
]

const stubGeometry = (): GeometryService => ({
  get: () => undefined,
  onUpdate: () => () => {},
  isConsumed: () => false,
  invalidate: () => {},
  idle: async () => {},
  preview: async () => ({ parts: [], bounds: { min: [0, 0, 0], max: [0, 0, 0] } }),
  previewSync: () => null,
    getComponentGeometry: () => [],
    keyOf: () => undefined,
  worldBounds: () => null,
  stats: { pending: 0, evaluated: 0, cacheSize: 0, lastEvalMs: 0 },
  dispose: () => {},
})

export function createPlaceholderEditor(options: EditorOptions): Editor {
  const { doc } = options
  const store = createStore<EditorState>(() => defaultEditorState(options, doc))
  const set = store.setState
  const get = store.getState
  const listeners = new Map<keyof EditorEvents, Set<(e: never) => void>>()
  const emit = <K extends keyof EditorEvents>(event: K, payload: EditorEvents[K]) => {
    listeners.get(event)?.forEach((l) => (l as (e: EditorEvents[K]) => void)(payload))
  }
  const notify = (level: EditorEvents['notify']['level'], message: string) => emit('notify', { level, message })
  let clipboard: DocSnapshot | null = null

  const offDoc = doc.onChange((e) => {
    const s = get()
    const patch: Partial<EditorState> = { canUndo: doc.canUndo(), canRedo: doc.canRedo() }
    if (e.nodes.removed.size) {
      const sel = s.selection.filter((id) => doc.hasNode(id))
      if (sel.length !== s.selection.length) patch.selection = sel
      if (s.activeLevel && !doc.hasNode(s.activeLevel)) patch.activeLevel = doc.levels()[0]?.id ?? null
    }
    if (e.nodes.added.size || e.nodes.removed.size) patch.stats = { ...s.stats, nodes: doc.nodeIds().length }
    if (e.meta) patch.gridVisible = doc.meta.grid.visible
    set(patch)
  })

  const top = () => doc.topLevel(get().selection)
  const editable = () => !get().readOnly
  const selectable = (n: AnyNode) => n.type !== 'level' && !doc.isDefinitionNode(n.id) && n.parent !== '__defs__'

  const withSelection = (fn: (ids: string[]) => void) => {
    const ids = top()
    if (ids.length === 0) return notify('info', 'Nothing selected')
    fn(ids)
  }
  const setTransforms = (fn: (n: AnyNode) => Transform) =>
    withSelection((ids) => doc.transact(() => doc.setTransforms(ids.map((id) => [id, fn(doc.getNode(id) as AnyNode)] as [string, Transform]))))
  const align = (axis: 0 | 1 | 2, mode: 'min' | 'center' | 'max') =>
    withSelection((ids) => {
      if (ids.length < 2) return
      const vals = ids.map((id) => doc.getWorldPosition(id)[axis])
      const target = mode === 'min' ? Math.min(...vals) : mode === 'max' ? Math.max(...vals) : (Math.min(...vals) + Math.max(...vals)) / 2
      setTransforms((n) => {
        const world = doc.getWorldPosition(n.id)
        const p: Vec3 = [...n.t.p]
        p[axis] += target - world[axis]
        return { ...n.t, p }
      })
    })
  const distribute = (axis: 0 | 1 | 2) =>
    withSelection((ids) => {
      if (ids.length < 3) return
      const sorted = [...ids].sort((a, b) => doc.getWorldPosition(a)[axis] - doc.getWorldPosition(b)[axis])
      const first = doc.getWorldPosition(sorted[0]!)[axis]
      const last = doc.getWorldPosition(sorted[sorted.length - 1]!)[axis]
      const step = (last - first) / (sorted.length - 1)
      doc.transact(() =>
        doc.setTransforms(
          sorted.map((id, i) => {
            const n = doc.getNode(id)!
            const world = doc.getWorldPosition(id)
            const p: Vec3 = [...n.t.p]
            p[axis] += first + i * step - world[axis]
            return [id, { ...n.t, p }] as [string, Transform]
          }),
        ),
      )
    })
  const setRender = (mode: RenderMode) => {
    const s = get()
    set({ viewports: s.viewports.map((v) => (v.index === s.activeViewport ? { ...v, renderMode: mode } : v)), realistic: { ...s.realistic, active: mode === 'realistic' } })
  }
  const setPreset = (preset: ViewPreset, index = get().activeViewport) =>
    set({ viewports: get().viewports.map((v) => (v.index === index ? { ...v, preset, projection: preset === 'perspective' ? 'perspective' : 'orthographic', label: PRESET_LABEL[preset] } : v)) })
  const booleanOp = (op: 'union' | 'subtract' | 'intersect') =>
    withSelection((ids) => {
      if (ids.length < 2) return notify('warning', 'Select at least two objects')
      doc.transact(() => {
        const parent = doc.getParent(ids[0]!)
        const bid = doc.addNode({ type: 'boolean', name: op[0]!.toUpperCase() + op.slice(1), parent, params: { op } })
        doc.moveNodes(ids, bid)
        editor.select([bid])
      })
    })

  const execute = (id: CommandId): void => {
    const s = get()
    const mutating = !/^(view|render|gizmo|level|tool|edit\.select|edit\.copy)/.test(id)
    if (mutating && !editable()) return notify('warning', 'This project is read-only')
    switch (id) {
      case 'edit.undo':
        return doc.undo()
      case 'edit.redo':
        return doc.redo()
      case 'edit.delete':
        return withSelection((ids) => doc.deleteNodes(ids))
      case 'edit.duplicate':
        return withSelection((ids) => editor.select(doc.duplicateNodes(ids, [0.5, 0, 0])))
      case 'edit.copy':
        return withSelection((ids) => {
          clipboard = doc.snapshot(ids)
          set({ clipboard: true })
        })
      case 'edit.cut':
        return withSelection((ids) => {
          clipboard = doc.snapshot(ids)
          set({ clipboard: true })
          doc.deleteNodes(ids)
        })
      case 'edit.paste':
      case 'edit.pasteInPlace':
        if (!clipboard) return
        return editor.select(doc.insertSnapshot(clipboard, { parent: s.activeLevel, offset: id === 'edit.paste' ? [0.5, 0.5, 0] : [0, 0, 0] }))
      case 'edit.selectAll':
        return editor.select(doc.allNodes().filter((n) => selectable(n) && n.visible && doc.getParent(n.id) === (s.editingContext ?? doc.getParent(n.id)) && (s.activeLevel ? doc.getLevelOf(n.id) === s.activeLevel || n.parent === null : true)).map((n) => n.id))
      case 'edit.selectNone':
        return editor.select([])
      case 'edit.selectInvert': {
        const sel = new Set(s.selection)
        return editor.select(doc.allNodes().filter((n) => selectable(n) && n.visible && !sel.has(n.id)).map((n) => n.id))
      }
      case 'edit.selectSimilar': {
        const types = new Set(s.selection.map((i) => doc.getNode(i)?.type))
        return editor.select(doc.allNodes().filter((n) => types.has(n.type) && selectable(n)).map((n) => n.id))
      }
      case 'object.group':
        return withSelection((ids) => {
          const g = doc.groupNodes(ids)
          if (g) editor.select([g])
        })
      case 'object.ungroup':
        return withSelection((ids) => editor.select(ids.flatMap((i) => (doc.getNode(i)?.type === 'group' ? doc.ungroup(i) : [i]))))
      case 'object.hide':
        return withSelection((ids) => {
          doc.updateNodes(ids.map((i) => ({ id: i, patch: { visible: false } })))
          editor.select([])
        })
      case 'object.unhideAll':
        return doc.updateNodes(doc.allNodes().filter((n) => !n.visible).map((n) => ({ id: n.id, patch: { visible: true } })))
      case 'object.isolate':
        return s.isolated ? editor.isolate(null) : withSelection((ids) => editor.isolate(ids))
      case 'object.lock':
        return withSelection((ids) => doc.updateNodes(ids.map((i) => ({ id: i, patch: { locked: !doc.getNode(i)?.locked } }))))
      case 'object.unlockAll':
        return doc.updateNodes(doc.allNodes().filter((n) => n.locked).map((n) => ({ id: n.id, patch: { locked: false } })))
      case 'object.makeComponent':
        return withSelection((ids) => {
          const r = doc.createComponent(ids, doc.getNode(ids[0]!)?.name ?? 'Component')
          if (r) editor.select([r.instanceId])
        })
      case 'object.explode':
        return withSelection((ids) => editor.select(ids.flatMap((i) => (doc.getNode(i)?.type === 'instance' ? doc.explodeInstance(i) : doc.getNode(i)?.type === 'group' ? doc.ungroup(i) : [i]))))
      case 'object.bake':
        return notify('info', 'Baking needs the geometry engine')
      case 'object.enter':
        return withSelection((ids) => {
          const n = doc.getNode(ids[0]!)
          if (n && (n.type === 'group' || n.type === 'instance')) set({ editingContext: n.id, selection: [] })
        })
      case 'object.exit':
        return set({ editingContext: s.editingContext ? doc.getParent(s.editingContext) : null })
      case 'boolean.union':
        return booleanOp('union')
      case 'boolean.subtract':
        return booleanOp('subtract')
      case 'boolean.intersect':
        return booleanOp('intersect')
      case 'transform.reset':
        return setTransforms((n) => ({ ...identityTransform(), p: n.t.p }))
      case 'transform.mirrorX':
        return setTransforms((n) => ({ ...n.t, s: [-n.t.s[0], n.t.s[1], n.t.s[2]] }))
      case 'transform.mirrorY':
        return setTransforms((n) => ({ ...n.t, s: [n.t.s[0], -n.t.s[1], n.t.s[2]] }))
      case 'transform.mirrorZ':
        return setTransforms((n) => ({ ...n.t, s: [n.t.s[0], n.t.s[1], -n.t.s[2]] }))
      case 'transform.dropToFloor':
        return setTransforms((n) => ({ ...n.t, p: [n.t.p[0], n.t.p[1], 0] }))
      case 'transform.rotate90':
        return setTransforms((n) => ({ ...n.t, r: multiplyQuat(quatFromAxisAngle([0, 0, 1], Math.PI / 2), n.t.r) as Quat }))
      case 'align.minX':
        return align(0, 'min')
      case 'align.centerX':
        return align(0, 'center')
      case 'align.maxX':
        return align(0, 'max')
      case 'align.minY':
        return align(1, 'min')
      case 'align.centerY':
        return align(1, 'center')
      case 'align.maxY':
        return align(1, 'max')
      case 'align.minZ':
        return align(2, 'min')
      case 'align.centerZ':
        return align(2, 'center')
      case 'align.maxZ':
        return align(2, 'max')
      case 'distribute.x':
        return distribute(0)
      case 'distribute.y':
        return distribute(1)
      case 'distribute.z':
        return distribute(2)
      case 'gizmo.translate':
        return set({ gizmo: 'translate' })
      case 'gizmo.rotate':
        return set({ gizmo: 'rotate' })
      case 'gizmo.scale':
        return set({ gizmo: 'scale' })
      case 'gizmo.toggleSpace':
        return set({ transformSpace: s.transformSpace === 'world' ? 'local' : 'world' })
      case 'view.zoomExtents':
      case 'view.zoomSelection':
        return
      case 'view.top':
        return setPreset('top')
      case 'view.bottom':
        return setPreset('bottom')
      case 'view.front':
        return setPreset('front')
      case 'view.back':
        return setPreset('back')
      case 'view.left':
        return setPreset('left')
      case 'view.right':
        return setPreset('right')
      case 'view.iso':
        return setPreset('iso')
      case 'view.perspective':
        return setPreset('perspective')
      case 'view.toggleProjection': {
        const v = s.viewports[s.activeViewport]
        return setPreset(v?.projection === 'perspective' ? 'iso' : 'perspective')
      }
      case 'view.layoutSingle':
        return editor.setLayout('single')
      case 'view.layoutSplit':
        return editor.setLayout('split')
      case 'view.layoutQuad':
        return editor.setLayout('quad')
      case 'view.toggleGrid':
        return set({ gridVisible: !s.gridVisible })
      case 'view.toggleSnap':
        return set({ snapping: { ...s.snapping, enabled: !s.snapping.enabled } })
      case 'view.toggleOrtho':
        return set({ snapping: { ...s.snapping, ortho: !s.snapping.ortho } })
      case 'view.saveView':
        return void doc.saveView({ name: `View ${doc.listViews().length + 1}`, camera: editor.getCamera(), renderMode: s.viewports[s.activeViewport]?.renderMode, levelId: s.activeLevel })
      case 'render.shaded':
        return setRender('shaded')
      case 'render.realistic':
        return setRender('realistic')
      case 'render.clay':
        return setRender('clay')
      case 'render.wireframe':
        return setRender('wireframe')
      case 'render.xray':
        return setRender('xray')
      case 'render.hiddenLine':
        return setRender('hidden-line')
      case 'render.technical':
        return setRender('technical')
      case 'level.up':
      case 'level.down': {
        const levels = doc.levels().sort((a, b) => a.t.p[2] - b.t.p[2])
        const i = levels.findIndex((l) => l.id === s.activeLevel)
        const next = levels[i + (id === 'level.up' ? 1 : -1)]
        if (next) editor.setActiveLevel(next.id)
        return
      }
      case 'tool.cancel':
        return editor.cancel()
      case 'tool.confirm':
        return
    }
  }

  const editor: Editor = {
    doc,
    geometry: options.geometry ?? stubGeometry(),
    store,
    commands: {
      list: () => COMMANDS,
      get: (id) => COMMANDS.find((c) => c.id === id),
      canExecute: (id) => {
        const s = get()
        if (id === 'edit.undo') return s.canUndo
        if (id === 'edit.redo') return s.canRedo
        if (id === 'edit.paste' || id === 'edit.pasteInPlace') return s.clipboard
        if (/^(edit\.(delete|duplicate|copy|cut)|object\.(group|hide|lock|makeComponent|isolate|explode|enter)|boolean|transform|align|distribute)/.test(id)) return s.selection.length > 0 || (id === 'object.isolate' && !!s.isolated)
        if (id === 'object.ungroup') return s.selection.some((i) => doc.getNode(i)?.type === 'group')
        if (id === 'object.exit') return !!s.editingContext
        return true
      },
      execute: (id) => execute(id),
    },
    getState: get,
    on: (event, listener) => {
      const set_ = listeners.get(event) ?? new Set()
      set_.add(listener as (e: never) => void)
      listeners.set(event, set_)
      return () => set_.delete(listener as (e: never) => void)
    },
    setTool: (tool: ToolId, opts = {}) => {
      set({ tool, toolOptions: opts, toolHint: tool === 'select' ? '' : 'Viewport engine is loading — tools become interactive once it is ready', toolInput: null })
    },
    submitToolInput: () => {},
    cancel: () => set({ tool: 'select', toolOptions: {}, toolHint: '', toolInput: null, measure: null }),
    select: (ids, mode = 'replace') => {
      const cur = get().selection
      let next: string[]
      if (mode === 'replace') next = ids
      else if (mode === 'add') next = [...new Set([...cur, ...ids])]
      else if (mode === 'remove') next = cur.filter((i) => !ids.includes(i))
      else next = [...cur.filter((i) => !ids.includes(i)), ...ids.filter((i) => !cur.includes(i))]
      set({ selection: next.filter((i) => doc.hasNode(i)) })
    },
    setHover: (hover) => set({ hover }),
    setLayout: (layout) => {
      const vps = defaultViewports(layout)
      set({ layout, viewports: vps, activeViewport: Math.min(get().activeViewport, vps.length - 1) })
    },
    setViewPreset: (preset, vp) => setPreset(preset, vp),
    setRenderMode: (mode, vp) => {
      const index = vp ?? get().activeViewport
      set({ viewports: get().viewports.map((v) => (v.index === index ? { ...v, renderMode: mode } : v)) })
    },
    setActiveViewport: (activeViewport) => set({ activeViewport }),
    setActiveLevel: (levelId) => {
      set({ activeLevel: levelId })
      if (doc.meta.activeLevel !== levelId && editable()) doc.transact(() => doc.setMeta({ activeLevel: levelId }), 'cadsandbox:silent')
    },
    setSnapping: (patch) => set({ snapping: { ...get().snapping, ...patch } }),
    setNavigation: (patch) => set({ navigation: { ...get().navigation, ...patch } }),
    setViewCubeOffset: () => {},
    setGizmo: (gizmo: GizmoMode) => set({ gizmo }),
    setTheme: (theme) => set({ theme }),
    setQuality: (q) => set({ stats: { ...get().stats, quality: q === 'auto' ? 'medium' : q } }),
    zoomToFit: () => {},
    getCamera: (): CameraState => ({ position: [8, -8, 6], target: [0, 0, 1], up: [0, 0, 1], fov: 50, projection: 'perspective' }),
    setCamera: () => {},
    follow: (following) => set({ following }),
    isolate: (isolated) => set({ isolated }),
    insert: async (content, at) => {
      const parent = get().activeLevel
      const world: Vec3 | undefined = at && 'world' in at ? at.world : undefined
      let ids: string[]
      if (Array.isArray(content)) {
        ids = doc.transact(() =>
          doc.addNodes(
            content.map((n: NewNode) => ({
              ...n,
              parent: n.parent === undefined ? parent : n.parent,
              t: world ? { ...(n.t ?? identityTransform()), p: world } : n.t,
            })),
          ),
        )
      } else {
        ids = doc.insertSnapshot(content, { parent, offset: world ?? [0, 0, 0] })
      }
      editor.select(ids)
      emit('created', { ids, tool: 'place' })
      return ids
    },
    dragPreview: () => {},
    pick: () => null,
    project: () => null,
    screenshot: async (opts) => {
      const w = opts?.width ?? 640
      const h = opts?.height ?? 400
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')!
      const dark = get().theme === 'dark'
      if (!opts?.transparent) {
        ctx.fillStyle = dark ? '#0e0e11' : '#e9e9ee'
        ctx.fillRect(0, 0, w, h)
      }
      ctx.strokeStyle = dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'
      for (let x = 0; x <= w; x += 32) {
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, h)
        ctx.stroke()
      }
      for (let y = 0; y <= h; y += 32) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(w, y)
        ctx.stroke()
      }
      return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), opts?.mime ?? 'image/png'))
    },
    vectorize: async () => ({ lines: [], fills: [], texts: [], bounds: { min: [0, 0], max: [0, 0] } }),
    renderView: async (_source, o) => editor.screenshot({ width: o.width, height: o.height }),
    startRealistic: (target = 256) => set({ realistic: { active: true, samples: 0, targetSamples: target } }),
    stopRealistic: () => set({ realistic: { ...get().realistic, active: false } }),
    visibleNodes: () => doc.allNodes().filter((n) => doc.isEffectivelyVisible(n.id) && !doc.isDefinitionNode(n.id)),
    resize: () => {},
    dispose: () => {
      offDoc()
      listeners.clear()
    },
  }
  return editor
}
