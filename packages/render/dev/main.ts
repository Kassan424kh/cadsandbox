// Dev harness: builds a small demo document and mounts the editor with a stand-in geometry
// service. Run: ../../node_modules/.bin/vite packages/render/dev (from the repo root).
import '../../../apps/web/src/styles/tokens.css'
import { CadDocument, type RenderMode } from '@cadsandbox/doc'
import type { CommandId, EditorAssets, ToolId, ViewLayout } from '../src'
import { createEditor, TOOL_SHORTCUTS } from '../src'
import { createFakeGeometryService } from './fakeGeometry'

const doc = CadDocument.create('Demo', { withLevel: true })
const level = doc.levels()[0]!.id

// demo content: a room with walls, a slab, furniture, primitives with materials, drafting entities
doc.transact(() => {
  const walls: [number, number, number, number][] = [
    [0, 0, 6, 0],
    [6, 0, 6, 4],
    [6, 4, 0, 4],
    [0, 4, 0, 0],
  ]
  for (const [ax, ay, bx, by] of walls) doc.addNode({ type: 'wall', parent: level, params: { a: [ax, ay], b: [bx, by], thickness: 0.24, height: 2.75, baseOffset: 0, justification: 'center' } })
  doc.addNode({ type: 'slab', parent: level, params: { kind: 'floor', outline: [[-0.12, -0.12], [6.12, -0.12], [6.12, 4.12], [-0.12, 4.12]], thickness: 0.2, offset: 0 }, material: 'mat-parquet-oak' })
  doc.addNode({ type: 'primitive', name: 'Marble block', parent: level, t: { p: [1.2, 1.2, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }, params: { shape: 'box', width: 0.8, depth: 0.8, height: 0.6 }, material: 'mat-marble' })
  doc.addNode({ type: 'primitive', name: 'Glass sphere', parent: level, t: { p: [3, 2, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }, params: { shape: 'sphere', radius: 0.45 }, material: 'mat-glass' })
  doc.addNode({ type: 'primitive', name: 'Brass cylinder', parent: level, t: { p: [4.6, 1, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }, params: { shape: 'cylinder', radius: 0.3, height: 1.2 }, material: 'mat-gold' })
  doc.addNode({ type: 'primitive', name: 'Red box', parent: level, t: { p: [4.5, 3, 0], r: [0, 0, 0.3826834, 0.9238795], s: [1, 1, 1] }, params: { shape: 'box', width: 0.5, depth: 0.5, height: 0.5 }, color: '#ff3b30' })
  doc.addNode({ type: 'furniture', name: 'Sofa', parent: level, t: { p: [2.2, 3.7, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }, params: { kind: 'sofa', width: 2.2, depth: 0.9, height: 0.8 }, material: 'mat-fabric-grey' })
  doc.addNode({ type: 'column', parent: level, t: { p: [-1.5, 2, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }, params: { shape: 'round', width: 0.3, depth: 0.3, height: 2.75, baseOffset: 0 } })
  doc.addNode({ type: 'line', parent: level, params: { a: [-2, -1.5], b: [8, -1.5] } })
  doc.addNode({ type: 'circle', parent: level, t: { p: [7.5, 2, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }, params: { radius: 0.6 } })
  doc.addNode({ type: 'text', parent: level, t: { p: [-2, -2.2, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }, params: { text: 'Living Room · 24 m²', size: 0.25, font: 'sans', align: 'left', depth: 0 } })
  doc.addNode({ type: 'light', parent: level, t: { p: [3, 2, 2.4], r: [0, 0, 0, 1], s: [1, 1, 1] }, params: { kind: 'point', color: '#ffe4c0', intensity: 120, castShadow: true } })
})
doc.undoManager.clear()

const assets: EditorAssets = {
  get: async () => null,
  url: async () => null,
  put: async (bytes) => {
    const hash = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
    return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('')
  },
}

const container = document.getElementById('viewport')!
const editor = createEditor({
  container,
  doc,
  assets,
  user: { id: 'dev', name: 'Dev', color: '#3fb6ff' },
  geometry: createFakeGeometryService(doc),
  theme: 'dark',
})
;(window as unknown as { editor: unknown; doc: unknown }).editor = editor
;(window as unknown as { editor: unknown; doc: unknown }).doc = doc

// ------------------------------------------------------------------ chrome
const bar = document.getElementById('bar')!
const button = (label: string, onClick: () => void, key?: string): HTMLButtonElement => {
  const b = document.createElement('button')
  b.textContent = label
  if (key) b.dataset.key = key
  b.onclick = onClick
  bar.appendChild(b)
  return b
}
const sep = () => {
  const s = document.createElement('span')
  s.style.cssText = 'width:1px;height:20px;background:var(--cs-border-strong)'
  bar.appendChild(s)
}
const tools: ToolId[] = ['select', 'pan', 'orbit', 'zoom-window', 'walk', 'draw.line', 'draw.rect', 'arch.wall', 'measure.distance', 'annotate.dimension']
for (const t of tools) button(t, () => editor.setTool(t), `tool:${t}`)
button('place box', () => editor.setTool('place', { node: { type: 'primitive', params: { shape: 'box', width: 0.6, depth: 0.6, height: 0.6 }, color: '#1ed760' } }), 'tool:place')
sep()
const layouts: ViewLayout[] = ['single', 'split', 'quad']
for (const l of layouts) button(l, () => editor.setLayout(l), `layout:${l}`)
sep()
const modes: RenderMode[] = ['shaded', 'realistic', 'clay', 'wireframe', 'xray', 'hidden-line', 'technical']
for (const m of modes) button(m, () => editor.setRenderMode(m), `mode:${m}`)
sep()
button('theme', () => {
  const next = editor.getState().theme === 'dark' ? 'light' : 'dark'
  document.documentElement.dataset.theme = next
  editor.setTheme(next)
})
button('fit', () => editor.zoomToFit())
button('top', () => editor.setViewPreset('top'))
button('front', () => editor.setViewPreset('front'))
button('persp', () => editor.setViewPreset('perspective'))
button('shot', async () => {
  const blob = await editor.screenshot({ width: 1280, height: 800 })
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank')
})
button('gizmo', () => {
  const g = editor.getState().gizmo
  editor.setGizmo(g === 'translate' ? 'rotate' : g === 'rotate' ? 'scale' : 'translate')
})

const hint = document.getElementById('hint')!
const stats = document.getElementById('stats')!
const vcb = document.getElementById('vcb')!
editor.store.subscribe((s) => {
  hint.textContent = s.toolHint || `${s.tool} · ${s.selection.length} selected`
  stats.textContent = `${s.stats.fps} fps · ${s.stats.frameMs} ms · ${s.stats.triangles} tris · ${s.stats.drawCalls} calls · ${s.stats.nodes} nodes · ${s.stats.quality} · ${s.stats.gpu.slice(0, 40)}${s.realistic.active ? ` · ${s.realistic.samples} spp` : ''}`
  vcb.textContent = s.toolInput ? `${s.toolInput.label}: ${s.toolInput.value || s.toolInput.placeholder || ''}` : s.cursorWorld ? s.cursorWorld.map((v) => v.toFixed(2)).join(', ') : ''
  for (const b of bar.querySelectorAll<HTMLButtonElement>('button[data-key]')) {
    const [kind, value] = b.dataset.key!.split(':')
    b.classList.toggle('on', (kind === 'tool' && value === s.tool) || (kind === 'layout' && value === s.layout) || (kind === 'mode' && value === s.viewports[s.activeViewport]?.renderMode))
  }
})
editor.on('notify', (e) => console.log(`[notify:${e.level}]`, e.message))
editor.on('contextmenu', (e) => console.log('contextmenu', e))
editor.on('created', (e) => console.log('created', e))

// command shortcuts (the app binds these globally in production)
const isMac = /Mac/.test(navigator.platform)
window.addEventListener('keydown', (ev) => {
  const t = ev.target as HTMLElement
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
  const mod = isMac ? ev.metaKey : ev.ctrlKey
  const run = (id: CommandId) => {
    ev.preventDefault()
    void editor.commands.execute(id)
  }
  if (mod && ev.key.toLowerCase() === 'z') return run(ev.shiftKey ? 'edit.redo' : 'edit.undo')
  if (mod && ev.key.toLowerCase() === 'c') return run('edit.copy')
  if (mod && ev.key.toLowerCase() === 'v') return run(ev.shiftKey ? 'edit.pasteInPlace' : 'edit.paste')
  if (mod && ev.key.toLowerCase() === 'x') return run('edit.cut')
  if (mod && ev.key.toLowerCase() === 'd') return run('edit.duplicate')
  if (mod && ev.key.toLowerCase() === 'a') return run('edit.selectAll')
  if (mod && ev.key.toLowerCase() === 'g') return run(ev.shiftKey ? 'object.ungroup' : 'object.group')
  if (!mod && !ev.altKey && ev.key.length === 1 && !editor.getState().toolInput) {
    const key = ev.shiftKey ? `Shift+${ev.key.toUpperCase()}` : ev.key.toUpperCase()
    for (const [tool, sc] of Object.entries(TOOL_SHORTCUTS)) if (sc === key) {
      ev.preventDefault()
      editor.setTool(tool as ToolId)
      return
    }
    if (ev.key === 'g') return run('gizmo.translate')
    if (ev.key === 'q') return run('gizmo.rotate')
    if (ev.key === 'e') return run('gizmo.scale')
  }
})
