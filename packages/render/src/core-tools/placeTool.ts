// Place tool: a ghost of the content follows the cursor over surfaces / the work plane with
// snapping; click drops it (oriented to the surface normal where sensible), R rotates 90°, Esc
// cancels. Options: { node: NewNode } | { snapshot: DocSnapshot }.
import type { DocSnapshot, NewNode } from '@cadsandbox/doc'
import type { Tool, ToolContext, ToolPointerEvent } from '../tools/types'
import type { CoreToolDeps } from './deps'
import { GhostPreview, commitPlacement, placementFromSnap, type PlaceContent } from './placement'

export class PlaceTool implements Tool {
  readonly id = 'place' as const
  private d: CoreToolDeps
  private ctx!: ToolContext
  private ghost: GhostPreview
  private content: PlaceContent | null = null
  private yawSteps = 0
  private last: ToolPointerEvent | null = null

  constructor(d: CoreToolDeps) {
    this.d = d
    this.ghost = new GhostPreview(d.preview)
  }

  activate(ctx: ToolContext, options: Record<string, unknown>): void {
    this.ctx = ctx
    this.onOptions(options)
    ctx.setHint('Move to position · click to place · R rotate 90° · Esc cancel')
    ctx.setCursor('copy')
  }

  onOptions(options: Record<string, unknown>): void {
    const node = options.node as NewNode | undefined
    const snapshot = options.snapshot as DocSnapshot | undefined
    this.content = node ? { node } : snapshot ? { snapshot } : null
    this.yawSteps = typeof options.rotation === 'number' ? options.rotation : 0
    this.ghost.set(this.content)
    if (!this.content) {
      this.ctx.notify('warning', 'Nothing to place')
      this.ctx.setTool('select')
    }
    if (this.last) this.onPointerMove(this.last)
  }

  deactivate(): void {
    this.ghost.clear()
    this.d.snapVisuals.hide()
    this.last = null
  }

  onPointerMove(e: ToolPointerEvent): void {
    this.last = e
    if (!this.content) return
    const snap = this.ctx.snap(e, { surfaces: true })
    this.ghost.place(placementFromSnap(snap, this.yawSteps))
    this.ctx.requestRender()
  }

  onPointerDown(e: ToolPointerEvent): boolean {
    return e.button === 0
  }

  onPointerUp(e: ToolPointerEvent): boolean {
    if (e.button !== 0 || !this.content) return false
    const snap = this.ctx.snap(e, { surfaces: true })
    const placement = placementFromSnap(snap, this.yawSteps)
    const parent = this.ctx.defaultParent()
    const ids = commitPlacement(this.d.core.doc, this.content, placement, parent)
    if (ids.length) {
      this.d.editor().select(ids, 'replace')
      this.ctx.emit('created', { ids, tool: 'place' })
    }
    // one-shot: back to select (hold Shift to place more)
    if (!e.shift) this.ctx.setTool('select')
    return true
  }

  onKeyDown(ev: KeyboardEvent): boolean {
    if ((ev.key === 'r' || ev.key === 'R') && !ev.metaKey && !ev.ctrlKey) {
      this.yawSteps = (this.yawSteps + 1) % 4
      if (this.last) this.onPointerMove(this.last)
      return true
    }
    return false
  }

  onCancel(): boolean {
    // Esc exits the tool entirely (handled by the host when we return false)
    return false
  }
}
