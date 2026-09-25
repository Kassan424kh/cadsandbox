// measure.distance / measure.area / measure.angle — no document changes; results go to the editor
// store (`measure`) and stay on screen until the next measurement or Esc.
import type { Vec3 } from '@cadsandbox/doc'
import type { MeasureResult } from '../../api'
import type { ToolContext, ToolOptionSpec, ToolPointerEvent } from '../types'
import { ToolBase, isPrimary } from '../util/base'
import { ChainTool } from '../util/chain'
import { formatAngleDeg, formatArea, formatDelta, parseVcb } from '../util/input'
import { boolOption } from '../util/nodes'
import { perimeter, signedArea } from '../util/polygon'
import { fromPlane, toPlane, v2, v3 } from '../util/vec'

function publish(ctx: ToolContext, measure: MeasureResult | null): void {
  ctx.editor.store.setState({ measure })
}

export const DISTANCE_OPTIONS: ToolOptionSpec[] = [boolOption('keep', 'Keep previous measurements', false)]

export class DistanceTool extends ToolBase {
  readonly id = 'measure.distance' as const
  override readonly specs = DISTANCE_OPTIONS
  private a: Vec3 | null = null
  /** Result labels stay until the next measurement starts. */
  private resultHandles = new Set<string>()

  protected override start(): void {
    this.a = null
    this.hint('Measure: click the first point')
  }
  protected override stop(): void {
    this.clearResult()
    publish(this.ctx, null)
  }
  protected isBusy(): boolean {
    return this.a !== null
  }
  protected reset(): void {
    this.a = null
    this.clearAll()
    this.clearResult()
    publish(this.ctx, null)
    this.hint('Measure: click the first point')
  }
  private clearResult(): void {
    for (const h of this.resultHandles) {
      this.ctx.overlay.remove(h)
      this.ctx.preview.remove(h)
    }
    this.resultHandles.clear()
  }

  onPointerDown(e: ToolPointerEvent): boolean {
    if (!isPrimary(e)) return false
    const s = this.snap(e, this.a)
    if (!this.a) {
      if (!this.optBool('keep', false)) this.clearResult()
      this.a = s.point
      this.hint('Click the second point · type a length to measure along the pointer direction')
      return true
    }
    this.finish(this.a, s.point)
    return true
  }

  onPointerMove(e: ToolPointerEvent): void {
    this.clearAll()
    const s = this.snap(e, this.a)
    if (!this.a) return
    this.lines([this.a, s.point], { style: 'rubber' })
    const d = v3.sub(s.point, this.a)
    this.label(v3.mid(this.a, s.point), `${this.fmt(v3.len(d))}  ${formatDelta(this.ctx, d[0], d[1], d[2])}`)
    this.input('Length', this.fmt(v3.len(d)))
  }

  onInput(text: string): void {
    if (!this.a) return void this.ctx.notify('info', 'Click the first point first')
    const v = parseVcb(text, this.ctx)
    if (!v) return
    const plane = this.plane()
    const a = toPlane(plane, this.a)
    if (v.kind === 'delta') this.finish(this.a, fromPlane(plane, v2.add(a, [v.dx, v.dy]), v.dz))
    else if (v.kind === 'polar') this.finish(this.a, fromPlane(plane, v2.add(a, v2.fromAngle(v.angle, v.length))))
  }

  private finish(a: Vec3, b: Vec3): void {
    this.clearAll()
    this.clearInput()
    const d = v3.sub(b, a)
    const value = v3.len(d)
    this.resultHandles.add(this.ctx.preview.lines([a, b], { style: 'annotation' }))
    this.resultHandles.add(this.ctx.overlay.label(v3.mid(a, b), `${this.fmt(value)}  ${formatDelta(this.ctx, d[0], d[1], d[2])}`, { variant: 'measure' }))
    publish(this.ctx, { kind: 'distance', value, delta: d, points: [a, b] })
    this.a = null
    this.hint(`Distance ${this.fmt(value)} · click to start a new measurement · Esc clears`)
  }
}

export class AreaTool extends ChainTool {
  readonly id = 'measure.area' as const
  private resultHandles = new Set<string>()

  protected override start(): void {
    this.minPoints = 3
    super.start()
  }
  protected override stop(): void {
    this.clearResult()
    publish(this.ctx, null)
    super.stop()
  }
  protected override reset(): void {
    this.clearResult()
    publish(this.ctx, null)
    super.reset()
  }
  private clearResult(): void {
    for (const h of this.resultHandles) {
      this.ctx.overlay.remove(h)
      this.ctx.preview.remove(h)
    }
    this.resultHandles.clear()
  }
  protected override firstHint(): string {
    return 'Measure area: click the polygon corners · Enter/C closes'
  }
  protected override pointAdded(): void {
    if (this.points.length === 1) this.clearResult()
  }

  protected override drawChain(points: Vec3[], cursor: Vec3 | null): void {
    const pts = cursor ? [...points, cursor] : points
    if (pts.length >= 2) this.lines(pts, { style: 'rubber', closed: pts.length >= 3 })
    if (pts.length >= 3) {
      this.polygon(pts, { opacity: 0.15 })
      const plane = this.plane()
      const uv = pts.map((p) => toPlane(plane, p))
      this.label(pts[0], `${formatArea(Math.abs(signedArea(uv)))} · P ${this.fmt(perimeter(uv))}`)
    }
    if (cursor && points.length) this.distanceLabel(points[points.length - 1], cursor)
  }

  protected commitChain(points: Vec3[]): void {
    const plane = this.plane()
    const uv = points.map((p) => toPlane(plane, p))
    const area = Math.abs(signedArea(uv))
    const per = perimeter(uv)
    this.resultHandles.add(this.ctx.preview.polygon(points, { opacity: 0.2 }))
    this.resultHandles.add(this.ctx.preview.lines(points, { closed: true, style: 'annotation' }))
    const c = uv.reduce((s, p) => v2.add(s, p), [0, 0] as [number, number])
    this.resultHandles.add(this.ctx.overlay.label(fromPlane(plane, v2.scale(c, 1 / uv.length)), `${formatArea(area)} · perimeter ${this.fmt(per)}`, { variant: 'measure' }))
    publish(this.ctx, { kind: 'area', value: area, points })
    this.hint(`Area ${formatArea(area)} · perimeter ${this.fmt(per)} · click to start a new polygon`)
  }
}

export class AngleTool extends ToolBase {
  readonly id = 'measure.angle' as const
  private pts: Vec3[] = []
  private resultHandles = new Set<string>()

  protected override start(): void {
    this.pts = []
    this.hint('Measure angle: click the vertex, then a point on each leg')
  }
  protected override stop(): void {
    this.clearResult()
    publish(this.ctx, null)
  }
  protected isBusy(): boolean {
    return this.pts.length > 0
  }
  protected reset(): void {
    this.pts = []
    this.clearAll()
    this.clearResult()
    publish(this.ctx, null)
    this.hint('Measure angle: click the vertex, then a point on each leg')
  }
  private clearResult(): void {
    for (const h of this.resultHandles) {
      this.ctx.overlay.remove(h)
      this.ctx.preview.remove(h)
    }
    this.resultHandles.clear()
  }

  private angleOf(v: Vec3, a: Vec3, b: Vec3): number {
    const plane = this.plane()
    const uv = toPlane(plane, v),
      ua = toPlane(plane, a),
      ub = toPlane(plane, b)
    const d1 = v2.sub(ua, uv),
      d2 = v2.sub(ub, uv)
    if (v2.len(d1) < 1e-9 || v2.len(d2) < 1e-9) return 0
    return Math.acos(Math.max(-1, Math.min(1, v2.dot(v2.norm(d1), v2.norm(d2)))))
  }

  onPointerDown(e: ToolPointerEvent): boolean {
    if (!isPrimary(e)) return false
    const s = this.snap(e, this.pts[0] ?? null)
    if (!this.pts.length) this.clearResult()
    this.pts.push(s.point)
    if (this.pts.length === 3) {
      const [v, a, b] = this.pts
      const ang = this.angleOf(v, a, b)
      this.clearAll()
      this.resultHandles.add(this.ctx.preview.lines([a, v, b], { style: 'annotation' }))
      this.resultHandles.add(this.ctx.overlay.label(v, formatAngleDeg(ang), { variant: 'measure' }))
      publish(this.ctx, { kind: 'angle', value: ang, points: [v, a, b] })
      this.pts = []
      this.hint(`Angle ${formatAngleDeg(ang)} · click to measure another`)
      return true
    }
    this.hint(this.pts.length === 1 ? 'Click a point on the first leg' : 'Click a point on the second leg')
    return true
  }

  onPointerMove(e: ToolPointerEvent): void {
    this.clearAll()
    const s = this.snap(e, this.pts[0] ?? null)
    if (!this.pts.length) return
    const v = this.pts[0]
    if (this.pts.length === 1) this.lines([v, s.point], { style: 'rubber' })
    else {
      this.lines([this.pts[1], v, s.point], { style: 'rubber' })
      this.label(v, formatAngleDeg(this.angleOf(v, this.pts[1], s.point)))
    }
  }
}
