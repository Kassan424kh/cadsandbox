// draw.circle — center-radius (default), 2-point (diameter) and 3-point circles → 'circle' node.
import type { Vec2 } from '@cadsandbox/doc'
import type { ToolOptionSpec, ToolPointerEvent } from '../types'
import { circleFrom3Points, sampleCircle } from '../util/arcs'
import { ToolBase, isPrimary } from '../util/base'
import { nodeTransformOnPlane, uvPolygonToWorld } from '../util/frame'
import { parseVcb } from '../util/input'
import { newNode, selectOption } from '../util/nodes'
import { fromPlane, toPlane, v2 } from '../util/vec'

export const CIRCLE_OPTIONS: ToolOptionSpec[] = [
  selectOption('mode', 'Mode', 'center-radius', [
    { value: 'center-radius', label: 'Center, radius' },
    { value: '2-point', label: '2 points (diameter)' },
    { value: '3-point', label: '3 points' },
  ]),
  selectOption('inputAs', 'Type value as', 'radius', ['radius', 'diameter']),
]

type Mode = 'center-radius' | '2-point' | '3-point'

export class CircleTool extends ToolBase {
  readonly id = 'draw.circle' as const
  override readonly specs = CIRCLE_OPTIONS
  private pts: Vec2[] = []
  private cursor: Vec2 | null = null

  protected override start(): void {
    this.pts = []
    this.hint(this.firstHint())
  }
  protected isBusy(): boolean {
    return this.pts.length > 0
  }
  protected reset(): void {
    this.pts = []
    this.cursor = null
    this.clearAll()
    this.clearInput()
    this.hint(this.firstHint())
  }
  private mode(): Mode {
    return this.optStr<Mode>('mode', 'center-radius', ['center-radius', '2-point', '3-point'])
  }
  private firstHint(): string {
    return this.mode() === 'center-radius' ? 'Circle: click the center' : 'Circle: click the first point'
  }

  onPointerDown(e: ToolPointerEvent): boolean {
    if (!isPrimary(e)) return false
    const s = this.snap(e, this.pts.length ? fromPlane(this.plane(), this.pts[0]) : null)
    this.place(toPlane(this.plane(), s.point))
    return true
  }

  onPointerMove(e: ToolPointerEvent): void {
    this.clearAll()
    const s = this.snap(e, this.pts.length ? fromPlane(this.plane(), this.pts[0]) : null)
    this.cursor = toPlane(this.plane(), s.point)
    this.draw()
  }

  onInput(text: string): void {
    const v = parseVcb(text, this.ctx)
    if (!v) return void this.ctx.notify('warning', `Cannot read "${text}"`)
    if (!this.pts.length) return void this.ctx.notify('info', 'Click the center first')
    const value = v.kind === 'length' ? v.value : v.kind === 'polar' ? v.length : Math.hypot(v.dx, v.dy)
    if (this.mode() === 'center-radius') {
      const r = this.optStr('inputAs', 'radius', ['radius', 'diameter']) === 'diameter' ? value / 2 : value
      const dir = this.cursor && v2.dist(this.cursor, this.pts[0]) > 1e-9 ? v2.norm(v2.sub(this.cursor, this.pts[0])) : [1, 0]
      this.place(v2.add(this.pts[0], v2.scale(dir as Vec2, r)))
    } else if (this.mode() === '2-point') {
      const dir = this.cursor && v2.dist(this.cursor, this.pts[0]) > 1e-9 ? v2.norm(v2.sub(this.cursor, this.pts[0])) : [1, 0]
      this.place(v2.add(this.pts[0], v2.scale(dir as Vec2, value)))
    }
  }

  private place(p: Vec2): void {
    this.pts.push(p)
    const need = this.mode() === '3-point' ? 3 : 2
    if (this.pts.length >= need) return this.commit()
    this.hint(this.mode() === 'center-radius' ? 'Click to set the radius · type radius' : this.mode() === '2-point' ? 'Click the opposite point of the diameter' : `Click point ${this.pts.length + 1} of 3`)
    this.clearAll()
    this.draw()
  }

  private circle(pts: Vec2[]): { center: Vec2; radius: number } | null {
    if (pts.length < 2) return null
    switch (this.mode()) {
      case 'center-radius':
        return { center: pts[0], radius: v2.dist(pts[0], pts[1]) }
      case '2-point':
        return { center: v2.mid(pts[0], pts[1]), radius: v2.dist(pts[0], pts[1]) / 2 }
      default:
        return pts.length >= 3 ? circleFrom3Points(pts[0], pts[1], pts[2]) : { center: v2.mid(pts[0], pts[1]), radius: v2.dist(pts[0], pts[1]) / 2 }
    }
  }

  private draw(): void {
    if (!this.pts.length) return this.input('Radius', '', 'radius')
    const pts = this.cursor ? [...this.pts, this.cursor] : this.pts
    const c = this.circle(pts)
    if (!c || c.radius < 1e-9) return
    const plane = this.plane()
    this.lines(uvPolygonToWorld(plane, sampleCircle(c.center, c.radius)), { closed: true, style: 'rubber' })
    if (this.mode() === 'center-radius' && this.cursor) this.lines([fromPlane(plane, c.center), fromPlane(plane, this.cursor)], { style: 'guide', dashed: true })
    this.label(fromPlane(plane, c.center), `R ${this.fmt(c.radius)} · Ø ${this.fmt(c.radius * 2)}`, 'size')
    const asDiameter = this.optStr('inputAs', 'radius', ['radius', 'diameter']) === 'diameter'
    this.input(asDiameter ? 'Diameter' : 'Radius', this.fmt(asDiameter ? c.radius * 2 : c.radius))
  }

  private commit(): void {
    const c = this.circle(this.pts)
    this.clearAll()
    this.clearInput()
    if (c && c.radius > 1e-9) {
      const parent = this.parent()
      const t = nodeTransformOnPlane(this.ctx, parent, this.plane(), c.center)
      this.commitNodes([newNode('circle', { radius: c.radius }, { parent, t })])
    } else this.ctx.notify('warning', 'Points are collinear — no circle created')
    this.pts = []
    this.hint(this.firstHint())
  }
}
