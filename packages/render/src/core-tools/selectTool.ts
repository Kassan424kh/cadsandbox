// Select tool: click / Shift-add / Mod-toggle, window (→) and crossing (←) box selection, direct
// drag of selected objects, hover highlight, double-click to enter groups, Escape to exit.
import * as THREE from 'three'
import type { Tool, ToolContext, ToolPointerEvent } from '../tools/types'
import type { CoreToolDeps } from './deps'
import { boxMode, isClickDrag, normalizeRect } from '../picking/boxSelect'
import type { PickHit } from '../core/picker'

const HINT = 'Click to select · Shift add · ⌘/Ctrl toggle · drag → window, ← crossing · double-click enters groups'

export class SelectTool implements Tool {
  readonly id = 'select' as const
  private d: CoreToolDeps
  private ctx!: ToolContext
  private down: { e: ToolPointerEvent; hit: PickHit | null; target: string | null; dragging: 'none' | 'box' | 'move' } | null = null
  private hoverRaf = 0
  private pendingHover: ToolPointerEvent | null = null

  constructor(d: CoreToolDeps) {
    this.d = d
  }

  activate(ctx: ToolContext): void {
    this.ctx = ctx
    ctx.setHint(HINT)
    ctx.setCursor('')
  }

  deactivate(): void {
    this.d.directDrag.cancel()
    this.clearBox()
    this.down = null
    if (this.hoverRaf) cancelAnimationFrame(this.hoverRaf)
    this.hoverRaf = 0
    this.d.editor().setHover(null)
  }

  private pickAt(e: ToolPointerEvent): PickHit | null {
    const vp = this.d.core.viewports.at(e.viewport)
    const state = this.d.core.store.getState()
    return this.d.picker.pick(vp, _ndc.set(e.ndc[0], e.ndc[1]), { skipLocked: true, within: state.editingContext, hidden: this.d.core.hiddenIds() })
  }

  onPointerDown(e: ToolPointerEvent): boolean {
    if (e.button !== 0) return false
    const hit = this.pickAt(e)
    const state = this.d.core.store.getState()
    const target = hit ? this.d.picker.selectionTarget(hit.nodeId, state.editingContext) : null
    this.down = { e, hit, target, dragging: 'none' }
    const selected = target ? state.selection.includes(target) || state.selection.some((s) => this.d.core.doc.isAncestor(s, target)) : false
    if (hit && selected && !e.shift && !e.mod && !this.d.core.readOnly) {
      const ids = state.selection
      this.d.directDrag.begin(e, hit, ids)
      this.down.dragging = 'move'
    }
    return true
  }

  onPointerMove(e: ToolPointerEvent): void {
    const d = this.down
    if (!d) {
      this.scheduleHover(e)
      return
    }
    if (d.dragging === 'move') {
      this.d.directDrag.move(e)
      return
    }
    if (d.dragging === 'none' && !isClickDrag(d.e.clientX, d.e.clientY, e.clientX, e.clientY)) d.dragging = 'box'
    if (d.dragging === 'box') {
      const vp = this.d.core.viewports.at(e.viewport)
      const rect = this.d.core.ctx.container.getBoundingClientRect()
      const x0 = d.e.clientX - rect.left - vp.rect.x
      const y0 = d.e.clientY - rect.top - vp.rect.y
      const x1 = e.clientX - rect.left - vp.rect.x
      const y1 = e.clientY - rect.top - vp.rect.y
      this.d.overlay.showRect(vp, { x0, y0, x1, y1 }, boxMode(x0, x1))
    }
  }

  onPointerUp(e: ToolPointerEvent): boolean {
    const d = this.down
    this.down = null
    if (!d) return false
    const editor = this.d.editor()
    if (d.dragging === 'move') {
      const moved = this.d.directDrag.end()
      if (moved) return true
      // treated as click on an already selected object
      if (d.target) editor.select([d.target], 'replace')
      return true
    }
    if (d.dragging === 'box') {
      const vp = this.d.core.viewports.at(e.viewport)
      const rect = this.d.core.ctx.container.getBoundingClientRect()
      const x0 = d.e.clientX - rect.left - vp.rect.x
      const y0 = d.e.clientY - rect.top - vp.rect.y
      const x1 = e.clientX - rect.left - vp.rect.x
      const y1 = e.clientY - rect.top - vp.rect.y
      this.clearBox()
      const state = this.d.core.store.getState()
      const ids = this.d.picker.boxSelect(vp, normalizeRect(x0, y0, x1, y1), boxMode(x0, x1), state.editingContext, this.d.core.hiddenIds())
      editor.select(ids, e.shift ? 'add' : e.mod ? 'toggle' : 'replace')
      return true
    }
    // click
    if (d.target) editor.select([d.target], e.shift ? 'add' : e.mod ? 'toggle' : 'replace')
    else if (!e.shift && !e.mod) editor.select([], 'replace')
    return true
  }

  onDoubleClick(e: ToolPointerEvent): boolean {
    const hit = this.pickAt(e)
    if (!hit) return false
    const state = this.d.core.store.getState()
    const target = this.d.picker.selectionTarget(hit.nodeId, state.editingContext)
    const node = this.d.core.doc.getNode(target)
    if (node && (node.type === 'group' || node.type === 'boolean')) {
      this.d.setEditingContext(target)
      const inner = this.d.picker.selectionTarget(hit.nodeId, target)
      this.d.editor().select([inner], 'replace')
      this.d.core.emit('dblclick', { nodeId: target })
      return true
    }
    this.d.core.emit('dblclick', { nodeId: target })
    return true
  }

  onCancel(): boolean {
    if (this.d.directDrag.active) {
      this.d.directDrag.cancel()
      this.down = null
      return true
    }
    const state = this.d.core.store.getState()
    if (state.selection.length) {
      this.d.editor().select([], 'replace')
      return true
    }
    if (state.editingContext) {
      this.d.setEditingContext(null)
      return true
    }
    return false
  }

  onKeyDown(ev: KeyboardEvent): boolean {
    if (this.d.directDrag.active && ev.key === 'Escape') {
      this.d.directDrag.cancel()
      this.down = null
      return true
    }
    return false
  }

  private scheduleHover(e: ToolPointerEvent): void {
    this.pendingHover = e
    if (this.hoverRaf) return
    this.hoverRaf = requestAnimationFrame(() => {
      this.hoverRaf = 0
      const ev = this.pendingHover
      this.pendingHover = null
      if (!ev) return
      const hit = this.pickAt(ev)
      const state = this.d.core.store.getState()
      const target = hit ? this.d.picker.selectionTarget(hit.nodeId, state.editingContext) : null
      this.d.editor().setHover(target)
      this.ctx.setCursor(target && state.selection.includes(target) ? 'move' : target ? 'pointer' : '')
    })
  }

  private clearBox(): void {
    for (const vp of this.d.core.viewports.viewports) this.d.overlay.showRect(vp, null)
  }
}

const _ndc = new THREE.Vector2()
