// Base for slab / roof / room: 'auto' mode = click inside a wall loop (outline from the wall
// graph), 'polygon' mode = draw the outline as a chain of points.
import type { Vec2, Vec3 } from '@cadsandbox/doc'
import type { ToolPointerEvent } from '../types'
import { isPrimary } from '../util/base'
import { ChainTool } from '../util/chain'
import { formatArea } from '../util/input'
import { centroid, signedArea } from '../util/polygon'
import { WallGraphCache, outlineToWorld } from '../util/regions'

export abstract class RegionChainTool extends ChainTool {
  protected cache!: WallGraphCache
  protected minPointsPolygon = 3

  protected override start(): void {
    this.cache = new WallGraphCache(this.ctx)
    this.minPoints = this.minPointsPolygon
    super.start()
  }
  protected override stop(): void {
    this.cache?.dispose()
    super.stop()
  }

  protected abstract regionMode(): 'auto' | 'polygon'
  /** Parent-local outline for a click at parent-local `point` (auto mode). */
  protected abstract autoOutline(point: Vec2): Vec2[] | null
  protected abstract commitOutline(outline: Vec2[], auto: boolean): void
  protected abstract autoHint(): string

  protected override firstHint(): string {
    return this.regionMode() === 'auto' ? this.autoHint() : 'Click the first corner of the outline'
  }
  protected override nextHint(): string {
    return 'Click the next corner · C or click the first point to close · Backspace undo'
  }

  protected override isBusy(): boolean {
    return this.regionMode() === 'polygon' && this.points.length > 0
  }

  override onPointerMove(e: ToolPointerEvent): void {
    if (this.regionMode() === 'polygon') return super.onPointerMove(e)
    this.clearAll()
    const hit = this.planeHit(e)
    if (!hit) return
    const outline = this.autoOutline(this.toLocal2(hit))
    if (!outline || outline.length < 3) {
      this.ctx.setCursor('not-allowed')
      return
    }
    this.ctx.setCursor('crosshair')
    const world = outlineToWorld(this.ctx, this.parent(), outline)
    this.polygon(world, { opacity: 0.25 })
    this.lines(world, { closed: true, style: 'rubber' })
    const c = centroid(outline)
    this.label(this.toWorld2(c), formatArea(Math.abs(signedArea(outline))), 'measure')
  }

  override onPointerDown(e: ToolPointerEvent): boolean {
    if (this.regionMode() === 'polygon') return super.onPointerDown(e)
    if (!isPrimary(e)) return false
    const hit = this.planeHit(e)
    if (!hit) return true
    const outline = this.autoOutline(this.toLocal2(hit))
    this.clearAll()
    if (!outline || outline.length < 3) {
      this.ctx.notify('info', 'Click inside a closed loop of walls (or switch to polygon mode)')
      return true
    }
    this.commitOutline(outline, true)
    return true
  }

  protected override drawChain(points: Vec3[], cursor: Vec3 | null): void {
    const pts = cursor ? [...points, cursor] : points
    if (pts.length >= 2) this.lines(pts, { style: 'rubber', closed: pts.length >= 3 })
    if (pts.length >= 3) this.polygon(pts, { opacity: 0.15 })
    if (cursor && points.length) this.distanceLabel(points[points.length - 1], cursor)
  }

  protected commitChain(points: Vec3[]): void {
    const parent = this.parent()
    const local = points.map((p) => this.toLocal2(p, parent))
    if (Math.abs(signedArea(local)) < 1e-6) return void this.ctx.notify('warning', 'Outline has no area')
    this.commitOutline(signedArea(local) < 0 ? local.reverse() : local, false)
  }
}
