// Command implementations (clipboard, duplicate, booleans, align/distribute, mirror, bake, …).
import * as THREE from 'three'
import type { AnyNode, DocSnapshot, NewNode, Transform, Vec3 } from '@cadsandbox/doc'
import { SILENT_ORIGIN, composeMatrix, decomposeMatrix, invertMatrix, multiplyMatrices } from '@cadsandbox/doc'
import type { MeshBuffers } from '@cadsandbox/geometry'
import type { CommandId, Editor, ViewPreset } from '../api'
import type { Core } from '../core/types'
import type { Picker } from '../core/picker'
import type { ClipboardStore } from './clipboard'
import type { CommandHandlers } from './registry'
import { encodeCSBM } from '../geometryBridge'
import { scaleAbout, rotationAbout } from '../gizmo/transformSession'
import { boundsFromBox3 } from '../util/math'

export interface ActionDeps {
  core: Core
  editor: () => Editor
  clipboard: ClipboardStore
  picker: Picker
  /** World point under the last pointer position on the work plane (paste at cursor). */
  cursorWorld(): Vec3 | null
  setEditingContext(id: string | null): void
  confirmTool(): void
}

const SELECTION_COMMANDS = new Set<CommandId>([
  'edit.cut', 'edit.copy', 'edit.duplicate', 'edit.delete', 'object.group', 'object.hide', 'object.isolate', 'object.lock', 'object.makeComponent', 'object.explode', 'object.bake', 'object.enter',
  'boolean.union', 'boolean.subtract', 'boolean.intersect', 'transform.reset', 'transform.mirrorX', 'transform.mirrorY', 'transform.mirrorZ', 'transform.dropToFloor', 'transform.rotate90',
  'align.minX', 'align.centerX', 'align.maxX', 'align.minY', 'align.centerY', 'align.maxY', 'align.minZ', 'align.centerZ', 'align.maxZ', 'view.zoomSelection', 'edit.selectSimilar', 'object.ungroup',
])
const MULTI_COMMANDS = new Set<CommandId>(['distribute.x', 'distribute.y', 'distribute.z'])
const EDIT_COMMANDS = new Set<CommandId>([...SELECTION_COMMANDS, ...MULTI_COMMANDS, 'edit.paste', 'edit.pasteInPlace', 'edit.undo', 'edit.redo', 'object.unhideAll', 'object.unlockAll'])

export function createActions(d: ActionDeps): CommandHandlers {
  const { core } = d
  const doc = core.doc
  const sel = () => core.store.getState().selection
  const roots = () => doc.topLevel(sel()).filter((id) => !doc.isEffectivelyLocked(id))

  const withUndoStep = <R>(fn: () => R): R => {
    doc.stopCapturing()
    const r = doc.transact(fn)
    doc.stopCapturing()
    return r
  }

  const worldDelta = (ids: string[], delta: THREE.Matrix4): void => {
    withUndoStep(() => {
      const entries: [string, Transform][] = []
      for (const id of ids) {
        const n = doc.getNode(id)
        if (!n) continue
        const world = doc.getWorldMatrix(id)
        const arr = new Float64Array(16)
        for (let i = 0; i < 16; i++) arr[i] = delta.elements[i]!
        const next = multiplyMatrices(arr, world)
        entries.push([id, decomposeMatrix(multiplyMatrices(invertMatrix(doc.getWorldMatrix(n.parent)), next))])
      }
      doc.setTransforms(entries)
    })
  }

  const boundsOf = (ids: string[]): THREE.Box3 => core.sync.worldBounds(ids, new THREE.Box3())

  const align = (axis: 0 | 1 | 2, mode: 'min' | 'center' | 'max'): void => {
    const ids = roots()
    if (ids.length < 1) return
    const all = boundsOf(ids)
    if (all.isEmpty()) return
    const targetV = mode === 'min' ? all.min : mode === 'max' ? all.max : all.getCenter(new THREE.Vector3())
    const target = targetV.getComponent(axis)
    withUndoStep(() => {
      const entries: [string, Transform][] = []
      for (const id of ids) {
        const b = boundsOf([id])
        if (b.isEmpty()) continue
        const cur = mode === 'min' ? b.min.getComponent(axis) : mode === 'max' ? b.max.getComponent(axis) : (b.min.getComponent(axis) + b.max.getComponent(axis)) / 2
        const delta = target - cur
        if (Math.abs(delta) < 1e-9) continue
        const t: Vec3 = [0, 0, 0]
        t[axis] = delta
        const n = doc.getNode(id)!
        const next = multiplyMatrices(composeMatrix({ p: t, r: [0, 0, 0, 1], s: [1, 1, 1] }), doc.getWorldMatrix(id))
        entries.push([id, decomposeMatrix(multiplyMatrices(invertMatrix(doc.getWorldMatrix(n.parent)), next))])
      }
      doc.setTransforms(entries)
    })
  }

  const distribute = (axis: 0 | 1 | 2): void => {
    const ids = roots()
    if (ids.length < 3) return
    const items = ids.map((id) => ({ id, b: boundsOf([id]) })).filter((x) => !x.b.isEmpty())
    items.sort((a, b) => a.b.getCenter(_c).getComponent(axis) - b.b.getCenter(_c2).getComponent(axis))
    const first = items[0]!.b.getCenter(new THREE.Vector3()).getComponent(axis)
    const last = items[items.length - 1]!.b.getCenter(new THREE.Vector3()).getComponent(axis)
    const step = (last - first) / (items.length - 1)
    withUndoStep(() => {
      const entries: [string, Transform][] = []
      items.forEach((it, i) => {
        const cur = it.b.getCenter(_c).getComponent(axis)
        const delta = first + step * i - cur
        if (Math.abs(delta) < 1e-9) return
        const t: Vec3 = [0, 0, 0]
        t[axis] = delta
        const n = doc.getNode(it.id)!
        const next = multiplyMatrices(composeMatrix({ p: t, r: [0, 0, 0, 1], s: [1, 1, 1] }), doc.getWorldMatrix(it.id))
        entries.push([it.id, decomposeMatrix(multiplyMatrices(invertMatrix(doc.getWorldMatrix(n.parent)), next))])
      })
      doc.setTransforms(entries)
    })
  }

  const mirror = (axis: 0 | 1 | 2): void => {
    const ids = roots()
    const b = boundsOf(ids)
    if (b.isEmpty()) return
    const s: [number, number, number] = [1, 1, 1]
    s[axis] = -1
    worldDelta(ids, scaleAbout(b.getCenter(new THREE.Vector3()), new THREE.Matrix4(), s[0], s[1], s[2]))
  }

  const booleanOp = (op: 'union' | 'subtract' | 'intersect'): void => {
    const ids = roots()
    if (ids.length < (op === 'union' ? 1 : 2)) return
    const id = withUndoStep(() => {
      const parents = new Set(ids.map((r) => doc.getParent(r)))
      const parent = parents.size === 1 ? [...parents][0]! : null
      const first = doc.getChildren(parent).find((c) => ids.includes(c)) ?? null
      const b = boundsOf(ids)
      const center = b.isEmpty() ? doc.getWorldPosition(ids[0]!) : (boundsFromBox3(b).min.map((v, i) => (v + boundsFromBox3(b).max[i]!) / 2) as Vec3)
      const local = decomposeMatrix(multiplyMatrices(invertMatrix(doc.getWorldMatrix(parent)), composeMatrix({ p: [center[0], center[1], b.isEmpty() ? center[2] : b.min.z], r: [0, 0, 0, 1], s: [1, 1, 1] })))
      const bid = doc.addNode({ type: 'boolean', name: op === 'union' ? 'Union' : op === 'subtract' ? 'Subtract' : 'Intersect', parent, before: first, params: { op }, t: local })
      // keep the clicked order: first selected = base operand
      const ordered = sel().filter((s) => ids.includes(s))
      doc.moveNodes(ordered.length === ids.length ? ordered : ids, bid, null, true)
      return bid
    })
    d.editor().select([id], 'replace')
  }

  const pasteAt = async (inPlace: boolean): Promise<void> => {
    const snap = await d.clipboard.read()
    if (!snap) {
      core.emit('notify', { level: 'info', message: 'Clipboard is empty' })
      return
    }
    const parent = d.editor().getState().editingContext ?? core.activeLevelId()
    let offset: Vec3 = [0, 0, 0]
    if (!inPlace) {
      const cursor = d.cursorWorld()
      const origin = snap.bounds ? ([(snap.bounds.min[0] + snap.bounds.max[0]) / 2, (snap.bounds.min[1] + snap.bounds.max[1]) / 2, snap.bounds.min[2]] as Vec3) : (snap.nodes.find((n) => n.parent === null)?.t.p ?? [0, 0, 0])
      if (cursor) offset = [cursor[0] - origin[0], cursor[1] - origin[1], cursor[2] - origin[2]]
      else offset = [doc.meta.grid.size, 0, 0]
    }
    const ids = withUndoStep(() => doc.insertSnapshot(snap, { parent, offset }))
    d.editor().select(ids, 'replace')
    core.emit('created', { ids, tool: 'select' })
  }

  const bake = async (): Promise<void> => {
    const ids = roots().filter((id) => {
      const r = core.geometry.get(id)
      return !!r && r.parts.length > 0
    })
    if (!ids.length) {
      core.emit('notify', { level: 'warning', message: 'Nothing to bake (no evaluated geometry)' })
      return
    }
    await core.geometry.idle()
    const jobs: { id: string; hash: string; bounds: { min: Vec3; max: Vec3 }; node: AnyNode }[] = []
    for (const id of ids) {
      const r = core.geometry.get(id)
      const node = doc.getNode(id) as AnyNode | undefined
      if (!r || !node) continue
      const merged = mergeParts(r.parts.map((p) => p.mesh))
      const bytes = encodeCSBM(merged)
      const hash = await core.assets.put(bytes, 'application/octet-stream')
      jobs.push({ id, hash, bounds: r.bounds, node })
    }
    const newIds = withUndoStep(() => {
      const out: string[] = []
      for (const j of jobs) {
        const n = j.node
        const siblings = doc.getChildren(n.parent)
        const next = siblings[siblings.indexOf(n.id) + 1] ?? null
        const input: NewNode<'mesh'> = { type: 'mesh', name: `${n.name} (baked)`, parent: n.parent, before: next, t: n.t, material: n.material, color: n.color, layer: n.layer, meta: n.meta, params: { asset: j.hash, bounds: j.bounds } }
        out.push(doc.addNode(input))
        doc.deleteNodes([n.id])
      }
      return out
    })
    d.editor().select(newIds, 'replace')
    core.emit('notify', { level: 'success', message: `Baked ${newIds.length} object${newIds.length === 1 ? '' : 's'} to mesh` })
  }

  const selectSimilar = (): void => {
    const ids = sel()
    if (!ids.length) return
    const keys = new Set(ids.map((id) => similarityKey(doc.getNode(id) as AnyNode | undefined)))
    const ctx = core.store.getState().editingContext
    const out = d.picker.selectableRoots(ctx).filter((id) => keys.has(similarityKey(doc.getNode(id) as AnyNode | undefined)) && doc.isEffectivelyVisible(id) && !doc.isEffectivelyLocked(id))
    d.editor().select(out, 'replace')
  }

  const levelStep = (dir: 1 | -1): void => {
    const levels = doc.levels()
    if (!levels.length) return
    const cur = core.activeLevelId()
    const i = levels.findIndex((l) => l.id === cur)
    const next = levels[Math.min(levels.length - 1, Math.max(0, (i < 0 ? 0 : i) + dir))]
    if (next) d.editor().setActiveLevel(next.id)
  }

  const view = (preset: ViewPreset) => d.editor().setViewPreset(preset)

  const canExecute = (id: CommandId): boolean => {
    if (core.readOnly && EDIT_COMMANDS.has(id)) return false
    switch (id) {
      case 'edit.undo':
        return doc.canUndo()
      case 'edit.redo':
        return doc.canRedo()
      case 'edit.paste':
      case 'edit.pasteInPlace':
        return true
      case 'object.exit':
        return core.store.getState().editingContext !== null
      case 'object.enter': {
        const s = sel()
        if (s.length !== 1) return false
        const n = doc.getNode(s[0]!)
        return !!n && (n.type === 'group' || n.type === 'boolean')
      }
      case 'object.ungroup':
        return sel().some((id) => {
          const n = doc.getNode(id)
          return !!n && (n.type === 'group' || n.type === 'boolean')
        })
      case 'object.explode':
        return sel().some((id) => {
          const n = doc.getNode(id)
          return !!n && (n.type === 'group' || n.type === 'boolean' || n.type === 'instance')
        })
      case 'object.isolate':
        return sel().length > 0 || core.store.getState().isolated !== null
      case 'level.up':
      case 'level.down':
        return doc.levels().length > 1
    }
    if (MULTI_COMMANDS.has(id)) return roots().length >= 3
    if (id.startsWith('boolean.')) return roots().length >= (id === 'boolean.union' ? 1 : 2)
    if (SELECTION_COMMANDS.has(id)) return sel().length > 0
    return true
  }

  const execute = (id: CommandId, args?: unknown): void | Promise<void> => {
    const editor = d.editor()
    switch (id) {
      case 'edit.undo':
        doc.undo()
        return
      case 'edit.redo':
        doc.redo()
        return
      case 'edit.copy':
      case 'edit.cut': {
        const ids = doc.topLevel(sel())
        if (!ids.length) return
        const snap: DocSnapshot = doc.snapshot(ids)
        const b = boundsOf(ids)
        if (!b.isEmpty()) snap.bounds = boundsFromBox3(b)
        const p = d.clipboard.write(snap).then(() => core.store.setState({ clipboard: true }))
        if (id === 'edit.cut') {
          withUndoStep(() => doc.deleteNodes(ids))
          editor.select([], 'replace')
        }
        return p
      }
      case 'edit.paste':
        return pasteAt(false)
      case 'edit.pasteInPlace':
        return pasteAt(true)
      case 'edit.duplicate': {
        const ids = roots()
        if (!ids.length) return
        const b = boundsOf(ids)
        const dx = b.isEmpty() ? doc.meta.grid.size : Math.max(doc.meta.grid.size / doc.meta.grid.subdivisions, b.max.x - b.min.x) * 1.0 + doc.meta.grid.size / Math.max(1, doc.meta.grid.subdivisions)
        const copies = withUndoStep(() => doc.duplicateNodes(ids, [dx, 0, 0]))
        editor.select(copies, 'replace')
        core.emit('created', { ids: copies, tool: 'select' })
        return
      }
      case 'edit.delete': {
        const ids = roots()
        if (!ids.length) return
        withUndoStep(() => doc.deleteNodes(ids))
        editor.select([], 'replace')
        return
      }
      case 'edit.selectAll': {
        const ctx = core.store.getState().editingContext
        const hidden = core.hiddenIds()
        editor.select(d.picker.selectableRoots(ctx).filter((n) => doc.isEffectivelyVisible(n) && !doc.isEffectivelyLocked(n) && !hidden.has(n)), 'replace')
        return
      }
      case 'edit.selectNone':
        editor.select([], 'replace')
        return
      case 'edit.selectInvert': {
        const ctx = core.store.getState().editingContext
        const cur = new Set(sel())
        editor.select(d.picker.selectableRoots(ctx).filter((n) => !cur.has(n) && doc.isEffectivelyVisible(n) && !doc.isEffectivelyLocked(n)), 'replace')
        return
      }
      case 'edit.selectSimilar':
        selectSimilar()
        return
      case 'object.group': {
        const gid = withUndoStep(() => doc.groupNodes(roots()))
        if (gid) editor.select([gid], 'replace')
        return
      }
      case 'object.ungroup': {
        const freed = withUndoStep(() => sel().flatMap((id) => doc.ungroup(id)))
        editor.select(freed, 'replace')
        return
      }
      case 'object.hide': {
        const ids = sel()
        withUndoStep(() => doc.updateNodes(ids.map((id) => ({ id, patch: { visible: false } }))))
        editor.select([], 'replace')
        return
      }
      case 'object.unhideAll': {
        const hidden = doc.allNodes().filter((n) => !n.visible && !doc.isDefinitionNode(n.id)).map((n) => n.id)
        if (hidden.length) withUndoStep(() => doc.updateNodes(hidden.map((id) => ({ id, patch: { visible: true } }))))
        return
      }
      case 'object.isolate': {
        const state = core.store.getState()
        editor.isolate(state.isolated ? null : sel())
        return
      }
      case 'object.lock':
        withUndoStep(() => doc.updateNodes(sel().map((id) => ({ id, patch: { locked: true } }))))
        return
      case 'object.unlockAll': {
        const locked = doc.allNodes().filter((n) => n.locked).map((n) => n.id)
        if (locked.length) withUndoStep(() => doc.updateNodes(locked.map((id) => ({ id, patch: { locked: false } }))))
        return
      }
      case 'object.makeComponent': {
        const ids = roots()
        const name = typeof args === 'string' ? args : (doc.getNode(ids[0]!)?.name ?? 'Component')
        const r = withUndoStep(() => doc.createComponent(ids, name))
        if (r) editor.select([r.instanceId], 'replace')
        return
      }
      case 'object.explode': {
        const out = withUndoStep(() =>
          sel().flatMap((id) => {
            const n = doc.getNode(id)
            if (!n) return []
            if (n.type === 'instance') return doc.explodeInstance(id)
            if (n.type === 'group' || n.type === 'boolean') return doc.ungroup(id)
            return [id]
          }),
        )
        editor.select(out, 'replace')
        return
      }
      case 'object.bake':
        return bake()
      case 'object.enter': {
        const s = sel()
        if (s.length === 1) {
          d.setEditingContext(s[0]!)
          editor.select([], 'replace')
        }
        return
      }
      case 'object.exit': {
        const ctx = core.store.getState().editingContext
        if (ctx) {
          const parent = doc.getParent(ctx)
          const pn = parent ? doc.getNode(parent) : undefined
          d.setEditingContext(pn && (pn.type === 'group' || pn.type === 'boolean') ? parent : null)
          editor.select([ctx], 'replace')
        }
        return
      }
      case 'boolean.union':
        booleanOp('union')
        return
      case 'boolean.subtract':
        booleanOp('subtract')
        return
      case 'boolean.intersect':
        booleanOp('intersect')
        return
      case 'transform.reset':
        withUndoStep(() => doc.setTransforms(roots().map((id) => [id, { p: doc.getNode(id)!.t.p, r: [0, 0, 0, 1], s: [1, 1, 1] }] as [string, Transform])))
        return
      case 'transform.mirrorX':
        mirror(0)
        return
      case 'transform.mirrorY':
        mirror(1)
        return
      case 'transform.mirrorZ':
        mirror(2)
        return
      case 'transform.dropToFloor': {
        const ids = roots()
        const floor = core.activeLevelElevation()
        withUndoStep(() => {
          const entries: [string, Transform][] = []
          for (const id of ids) {
            const b = boundsOf([id])
            if (b.isEmpty()) continue
            const dz = floor - b.min.z
            if (Math.abs(dz) < 1e-9) continue
            const n = doc.getNode(id)!
            const next = multiplyMatrices(composeMatrix({ p: [0, 0, dz], r: [0, 0, 0, 1], s: [1, 1, 1] }), doc.getWorldMatrix(id))
            entries.push([id, decomposeMatrix(multiplyMatrices(invertMatrix(doc.getWorldMatrix(n.parent)), next))])
          }
          doc.setTransforms(entries)
        })
        return
      }
      case 'transform.rotate90': {
        const ids = roots()
        const b = boundsOf(ids)
        if (b.isEmpty()) return
        worldDelta(ids, rotationAbout(b.getCenter(new THREE.Vector3()), new THREE.Vector3(0, 0, 1), Math.PI / 2))
        return
      }
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
        editor.setGizmo('translate')
        return
      case 'gizmo.rotate':
        editor.setGizmo('rotate')
        return
      case 'gizmo.scale':
        editor.setGizmo('scale')
        return
      case 'gizmo.toggleSpace':
        core.store.setState({ transformSpace: core.store.getState().transformSpace === 'world' ? 'local' : 'world' })
        core.requestRender()
        return
      case 'view.zoomExtents':
        editor.zoomToFit(undefined, true)
        return
      case 'view.zoomSelection':
        editor.zoomToFit(sel(), true)
        return
      case 'view.top':
        return view('top')
      case 'view.bottom':
        return view('bottom')
      case 'view.front':
        return view('front')
      case 'view.back':
        return view('back')
      case 'view.left':
        return view('left')
      case 'view.right':
        return view('right')
      case 'view.iso':
        return view('iso')
      case 'view.perspective':
        return view('perspective')
      case 'view.toggleProjection': {
        const vp = core.viewports.activeViewport
        vp.setProjection(vp.isOrtho ? 'perspective' : 'orthographic', true)
        core.viewports.refreshChrome()
        core.store.setState({ viewports: core.viewports.states() })
        core.requestRender()
        return
      }
      case 'view.layoutSingle':
        editor.setLayout('single')
        return
      case 'view.layoutSplit':
        editor.setLayout('split')
        return
      case 'view.layoutQuad':
        editor.setLayout('quad')
        return
      case 'view.toggleGrid':
        core.store.setState({ gridVisible: !core.store.getState().gridVisible })
        core.requestRender()
        return
      case 'view.toggleSnap':
        editor.setSnapping({ enabled: !core.store.getState().snapping.enabled })
        return
      case 'view.toggleOrtho':
        editor.setSnapping({ ortho: !core.store.getState().snapping.ortho })
        return
      case 'view.saveView': {
        const vp = core.viewports.activeViewport
        const name = typeof args === 'string' ? args : `View ${doc.listViews().length + 1}`
        doc.saveView({ name, camera: vp.getCameraState(), renderMode: vp.renderMode, levelId: vp.planLevel, sectionId: vp.section })
        core.emit('notify', { level: 'success', message: `Saved "${name}"` })
        return
      }
      case 'render.shaded':
        return editor.setRenderMode('shaded')
      case 'render.realistic':
        return editor.setRenderMode('realistic')
      case 'render.clay':
        return editor.setRenderMode('clay')
      case 'render.wireframe':
        return editor.setRenderMode('wireframe')
      case 'render.xray':
        return editor.setRenderMode('xray')
      case 'render.hiddenLine':
        return editor.setRenderMode('hidden-line')
      case 'render.technical':
        return editor.setRenderMode('technical')
      case 'level.up':
        return levelStep(1)
      case 'level.down':
        return levelStep(-1)
      case 'tool.cancel':
        editor.cancel()
        return
      case 'tool.confirm':
        d.confirmTool()
        return
    }
  }

  return { canExecute, execute }
}

function similarityKey(n: AnyNode | undefined): string {
  if (!n) return ''
  const p = n.params as Record<string, unknown>
  const sub = n.type === 'primitive' ? String(p.shape) : n.type === 'furniture' ? String(p.kind) : n.type === 'opening' ? `${String(p.kind)}:${String(p.style)}` : n.type === 'instance' ? String(p.component) : ''
  return `${n.type}|${sub}|${n.material ?? ''}`
}

/** Merge mesh parts (same local space) into one buffer set. */
export function mergeParts(parts: MeshBuffers[]): MeshBuffers {
  let vcount = 0
  let icount = 0
  let hasUV = true
  for (const p of parts) {
    const n = p.positions.length / 3
    vcount += n
    icount += p.indices ? p.indices.length : n
    if (!p.uvs || p.uvs.length !== n * 2) hasUV = false
  }
  const positions = new Float32Array(vcount * 3)
  const normals = new Float32Array(vcount * 3)
  const uvs = hasUV ? new Float32Array(vcount * 2) : undefined
  const indices = new Uint32Array(icount)
  let vo = 0
  let io = 0
  for (const p of parts) {
    const n = p.positions.length / 3
    positions.set(p.positions, vo * 3)
    if (p.normals && p.normals.length === n * 3) normals.set(p.normals, vo * 3)
    if (uvs && p.uvs) uvs.set(p.uvs, vo * 2)
    if (p.indices) for (let i = 0; i < p.indices.length; i++) indices[io++] = p.indices[i]! + vo
    else for (let i = 0; i < n; i++) indices[io++] = vo + i
    vo += n
  }
  return { positions, normals, uvs, indices }
}

export { SILENT_ORIGIN }

const _c = new THREE.Vector3()
const _c2 = new THREE.Vector3()
