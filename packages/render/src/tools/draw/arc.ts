// draw.arc — 3-point (start, point on arc, end) or center-start-end arcs → 'arc' node at the center.
import type { Vec2 } from '@cadsandbox/doc'
import type { ToolOptionSpec, ToolPointerEvent } from '../types'
import { arcFrom3Points, arcFromCenterStartEnd, arcLength, sampleArc, type ArcDef } from '../util/arcs'
import { ToolBase, isPrimary } from '../util/base'
import { nodeTransformOnPlane, uvPolygonToWorld } from '../util/frame'
import { formatAngleDeg, parseVcb } from '../util/input'
import { newNode, selectOption } from '../util/nodes'
import { fromPlane, toPlane, v2 } from '../util/vec'

export const ARC_OPTIONS: ToolOptionSpec[] = [
  selectOption('mode', 'Mode', '3-point', [
    { value: '3-point', label: 'Start, point, end' },
    { value: 'center', label: 'Center, start, end' },
  ]),
]

type Mode = '3-point' | 'center'

export class ArcTool extends ToolBase {
  readonly id = 'draw.arc' as const
  override readonly specs = ARC_OPTIONS
  private pts: Vec2[] = []
  private cursor: Vec2 | null = null

  protected override start(): void {
    this.pts = []
    this.hint(this.stepHint())
  }
  protected isBusy(): boolean {
    return this.pts.length > 0
  }
  protected reset(): void {
    this.pts = []
    this.cursor = null
    this.clearAll()
    this.clearInput()
    this.hint(this.stepHint())
  }
  private mode(): Mode {
    return this.optStr<Mode>('mode', '3-point', ['3-point', 'center'])
  }
  private stepHint(): string {
    const n = this.pts.length
    if (this.mode() === 'center') return ['Arc: click the center', 'Click the start point · type radius', 'Click the end point · type angle'][n] ?? ''
    return ['Arc: click the start point', 'Click a point on the arc', 'Click the end point'][n] ?? ''
  }

  onPointerDown(e: ToolPointerEvent): boolean {
    if (!isPrimary(e)) return false
    const s = this.snap(e, this.from())
    this.place(toPlane(this.plane(), s.point))
    return true
  }

  onPointerMove(e: ToolPointerEvent): void {
    this.clearAll()
    const s = this.snap(e, this.from())
    this.cursor = toPlane(this.plane(), s.point)
    this.draw()
  }

  private from() {
    return this.pts.length ? fromPlane(this.plane(), this.pts[this.pts.length - 1]) : null
  }

  onInput(text: string): void {
    const v = parseVcb(text, this.ctx)
    if (!v || !this.pts.length) return void this.ctx.notify('info', 'Click the first point, then type a value')
    if (this.mode() === 'center' && this.pts.length === 1) {
      const r = v.kind === 'length' ? v.value : v.kind === 'polar' ? v.length : Math.hypot(v.dx, v.dy)
      const dir = v.kind === 'polar' ? v2.fromAngle(v.angle) : this.cursor && v2.dist(this.cursor, this.pts[0]) > 1e-9 ? v2.norm(v2.sub(this.cursor, this.pts[0])) : ([1, 0] as Vec2)
      this.place(v2.add(this.pts[0], v2.scale(dir, r)))
      return
    }
    if (this.mode() === 'center' && this.pts.length === 2) {
      // Sweep angle typed → end point on the circle.
      const ang = this.ctx.parseAngle(text)
      if (ang === null) return void this.ctx.notify('warning', `Cannot read angle "${text}"`)
      const r = v2.dist(this.pts[0], this.pts[1])
      const a0 = v2.angle(v2.sub(this.pts[1], this.pts[0]))
      this.place(v2.add(this.pts[0], v2.fromAngle(a0 + ang, r)))
      return
    }
    if (v.kind === 'delta' || v.kind === 'polar') {
      const last = this.pts[this.pts.length - 1]
      this.place(v.kind === 'delta' ? v2.add(last, [v.dx, v.dy]) : v2.add(last, v2.fromAngle(v.angle, v.length)))
    }
  }

  private place(p: Vec2): void {
    this.pts.push(p)
    if (this.pts.length >= 3) return this.commit()
    this.hint(this.stepHint())
    this.clearAll()
    this.draw()
  }

  private arc(pts: Vec2[]): ArcDef | null {
    if (pts.length < 3) return null
    if (this.mode() === 'center') {
      // CCW unless the cursor/end lies clockwise of the start (shorter way round).
      const a0 = v2.angle(v2.sub(pts[1], pts[0]))
      const a1 = v2.angle(v2.sub(pts[2], pts[0]))
      let d = a1 - a0
      while (d <= -Math.PI) d += Math.PI * 2
      while (d > Math.PI) d -= Math.PI * 2
      return arcFromCenterStartEnd(pts[0], pts[1], pts[2], d >= 0)
    }
    return arcFrom3Points(pts[0], pts[1], pts[2])
  }

  private draw(): void {
    const plane = this.plane()
    const pts = this.cursor ? [...this.pts, this.cursor] : this.pts
    if (pts.length === 2) {
      this.lines(uvPolygonToWorld(plane, pts), { style: 'guide', dashed: true })
      const d = v2.dist(pts[0], pts[1])
      this.label(fromPlane(plane, v2.mid(pts[0], pts[1])), this.mode() === 'center' ? `R ${this.fmt(d)}` : this.fmt(d))
      this.input(this.mode() === 'center' ? 'Radius' : 'Chord', this.fmt(d))
      return
    }
    const arc = this.arc(pts)
    if (!arc) return
    this.lines(uvPolygonToWorld(plane, sampleArc(arc)), { style: 'rubber' })
    if (this.mode() === 'center') this.lines([fromPlane(plane, arc.center), fromPlane(plane, pts[1]), fromPlane(plane, arc.center), fromPlane(plane, pts[2])], { style: 'guide', dashed: true })
    const sweep = arc.end - arc.start
    this.label(fromPlane(plane, arc.center), `R ${this.fmt(arc.radius)} · ${formatAngleDeg(sweep)} · L ${this.fmt(arcLength(arc))}`, 'size')
    this.input(this.mode() === 'center' ? 'Angle' : 'Radius', this.mode() === 'center' ? formatAngleDeg(sweep) : this.fmt(arc.radius))
  }

  private commit(): void {
    const arc = this.arc(this.pts)
    this.clearAll()
    this.clearInput()
    if (arc && arc.radius > 1e-9) {
      const parent = this.parent()
      const t = nodeTransformOnPlane(this.ctx, parent, this.plane(), arc.center)
      this.commitNodes([newNode('arc', { radius: arc.radius, start: arc.start, end: arc.end }, { parent, t })])
    } else this.ctx.notify('warning', 'Points are collinear — no arc created')
    this.pts = []
    this.hint(this.stepHint())
  }
}
