// ChainTool: base for "click, click, click… Enter" tools (line, polyline, wall, railing, leader,
// area measure, polygon modes). Handles snapping with `from` = previous point, the rubber band,
// VCB input (length / length<angle / dx;dy), Backspace, closing on the first point, Enter/Esc/dblclick.
import type { Vec2, Vec3 } from '@cadsandbox/doc'
import type { ToolPointerEvent } from '../types'
import { ToolBase, isPrimary } from './base'
import { formatAngleDeg, parseVcb } from './input'
import { fromPlane, toPlane, v2, v3 } from './vec'

export abstract class ChainTool extends ToolBase {
  /** Committed chain points in world space. */
  protected points: Vec3[] = []
  /** Current snapped pointer position (world). */
  protected cursor: Vec3 | null = null
  protected minPoints = 2
  protected allowClose = true
  /** Pixel radius for "click the first point to close". */
  protected closeRadiusPx = 8
  protected inputLabel = 'Length'

  protected override start(): void {
    this.points = []
    this.cursor = null
    this.updateHint()
  }

  protected override stop(): void {
    this.points = []
    this.cursor = null
  }

  protected isBusy(): boolean {
    return this.points.length > 0
  }

  protected reset(): void {
    this.points = []
    this.cursor = null
    this.clearAll()
    this.clearInput()
    this.updateHint()
  }

  // ---- abstract behaviour
  /** Create document content from the chain. Called with ≥ minPoints points. */
  protected abstract commitChain(points: Vec3[], closed: boolean): void
  /** Draw the pending chain + rubber band; default: polyline preview + length label. */
  protected drawChain(points: Vec3[], cursor: Vec3 | null): void {
    const pts = cursor ? [...points, cursor] : points
    if (pts.length >= 2) this.lines(pts, { style: 'rubber' })
    if (cursor && points.length) this.distanceLabel(points[points.length - 1], cursor)
  }
  protected firstHint(): string {
    return 'Click the start point'
  }
  protected nextHint(): string {
    return `Click the next point · type ${this.inputLabel.toLowerCase()} or length<angle · Backspace undo · Enter finish${this.allowClose ? ' · C close' : ''}`
  }

  protected updateHint(): void {
    this.hint(this.points.length ? this.nextHint() : this.firstHint())
  }

  /** Hook: a point was added (e.g. wall tool commits per segment previews). */
  protected pointAdded(_p: Vec3): void {}

  // ---- input handling
  onPointerDown(e: ToolPointerEvent): boolean {
    if (!isPrimary(e)) return false
    const s = this.snapPoint(e)
    if (this.allowClose && this.points.length >= 3 && this.nearFirst(s.point)) {
      this.close()
      return true
    }
    this.addPoint(s.point)
    return true
  }

  onPointerMove(e: ToolPointerEvent): void {
    this.clearAll()
    const s = this.snapPoint(e)
    this.cursor = s.point
    this.redraw()
    this.updateInput()
  }

  onDoubleClick(_e: ToolPointerEvent): boolean {
    this.finishChain(false)
    return true
  }

  override onConfirm(): void {
    this.finishChain(false)
  }

  override onCancel(): boolean {
    if (!this.points.length) return false
    this.finishChain(false)
    return true
  }

  protected override onBackspace(): boolean {
    if (!this.points.length) return false
    this.points.pop()
    this.clearAll()
    this.redraw()
    this.updateHint()
    return true
  }

  protected override onKey(key: string, _e: KeyboardEvent): boolean {
    if ((key === 'c' || key === 'C') && this.allowClose && this.points.length >= 3) {
      this.close()
      return true
    }
    return false
  }

  onInput(text: string): void {
    const v = parseVcb(text, this.ctx)
    if (!v) {
      this.ctx.notify('warning', `Cannot read "${text}"`)
      return
    }
    const plane = this.plane()
    const last = this.points[this.points.length - 1]
    if (!last) {
      if (v.kind === 'delta') this.addPoint(fromPlane(plane, [v.dx, v.dy], v.dz))
      else this.ctx.notify('info', 'Click the start point first')
      return
    }
    const luv = toPlane(plane, last)
    let next: Vec3 | null = null
    if (v.kind === 'delta') next = fromPlane(plane, v2.add(luv, [v.dx, v.dy]), v.dz)
    else if (v.kind === 'polar') next = fromPlane(plane, v2.add(luv, v2.fromAngle(v.angle, v.length)))
    else if (v.kind === 'length') {
      const dir = this.currentDirection(luv)
      if (!dir) {
        this.ctx.notify('info', 'Move the pointer to set the direction, then type the length')
        return
      }
      next = fromPlane(plane, v2.add(luv, v2.scale(dir, v.value)))
    }
    if (next) this.addPoint(next)
  }

  /** Direction (plane space) from the last point toward the cursor. */
  protected currentDirection(lastUV: Vec2): Vec2 | null {
    if (!this.cursor) return null
    const d = v2.sub(toPlane(this.plane(), this.cursor), lastUV)
    return v2.len(d) < 1e-9 ? null : v2.norm(d)
  }

  // ---- chain ops
  protected snapPoint(e: ToolPointerEvent) {
    const from = this.points[this.points.length - 1] ?? null
    return this.snap(e, from)
  }

  protected addPoint(p: Vec3): void {
    const last = this.points[this.points.length - 1]
    if (last && v3.dist(last, p) < 1e-9) return
    this.points.push(p)
    this.pointAdded(p)
    this.clearAll()
    this.redraw()
    this.updateHint()
  }

  protected nearFirst(p: Vec3): boolean {
    const first = this.points[0]
    if (!first) return false
    const tol = this.closeRadiusPx * this.ctx.worldPerPixel(first)
    return v3.dist(first, p) <= tol
  }

  protected close(): void {
    this.finishChain(true)
  }

  protected finishChain(closed: boolean): void {
    const pts = this.points
    this.clearAll()
    this.clearInput()
    if (pts.length >= this.minPoints) this.commitChain(pts.map((p) => [...p] as Vec3), closed)
    this.points = []
    this.cursor = null
    this.updateHint()
  }

  protected redraw(): void {
    this.drawChain(this.points, this.cursor)
  }

  protected updateInput(): void {
    const last = this.points[this.points.length - 1]
    if (!last || !this.cursor) {
      this.input(this.inputLabel, '', 'length or x;y')
      return
    }
    const plane = this.plane()
    const d = v2.sub(toPlane(plane, this.cursor), toPlane(plane, last))
    const len = v2.len(d)
    this.input(this.inputLabel, this.fmt(len), `length<angle · ${formatAngleDeg(Math.atan2(d[1], d[0]))}`)
  }
}
