// annotate.comment — click a point (optionally on an object) → the UI opens its comment composer
// via the 'commentRequest' event; the tool then returns to select.
import type { ToolPointerEvent } from '../types'
import { ToolBase, isPrimary } from '../util/base'

export class CommentTool extends ToolBase {
  readonly id = 'annotate.comment' as const

  protected override start(): void {
    this.hint('Comment: click where the comment should be anchored')
    this.ctx.setCursor('crosshair')
  }
  protected isBusy(): boolean {
    return false
  }
  protected reset(): void {
    this.clearAll()
  }

  onPointerMove(e: ToolPointerEvent): void {
    this.clearAll()
    const hit = this.ctx.pick(e)
    if (hit) this.marker(hit.point, 'face')
    else this.snap(e)
  }

  onPointerDown(e: ToolPointerEvent): boolean {
    if (!isPrimary(e)) return false
    const hit = this.ctx.pick(e)
    const point = hit?.point ?? this.snap(e).point
    this.clearAll()
    this.ctx.emit('commentRequest', { point, nodeId: hit?.nodeId ?? null, clientX: e.clientX, clientY: e.clientY })
    this.ctx.setTool('select')
    return true
  }
}
