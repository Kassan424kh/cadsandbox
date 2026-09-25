// draw.ellipse — center + first axis end (rx, rotation) + second radius, or two-corner box mode.
import type { Vec2 } from '@cadsandbox/doc'
import type { ToolOptionSpec, ToolPointerEvent } from '../types'
import { sampleEllipse } from '../util/arcs'
import { ToolBase, isPrimary } from '../util/base'
import { nodeTransformOnPlane, uvPolygonToWorld } from '../util/frame'
import { parseVcb } from '../util/input'
import { newNode, selectOption } from '../util/nodes'
import { signedLineDistance } from '../util/polygon'
import { fromPlane, toPlane, v2 } from '../util/vec'

export const ELLIPSE_OPTIONS: ToolOptionSpec[] = [
  selectOption('mode', 'Mode', 'center', [
    { value: 'center', label: 'Center, axes' },
    { value: 'box', label: 'Bounding box' },
  ]),
]

type Mode = 'center' | 'box'

export class EllipseTool extends ToolBase {
  readonly id = 'draw.ellipse' as const
  override readonly specs = ELLIPSE_OPTIONS
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
    return this.optStr<Mode>('mode', 'center', ['center', 'box'])
  }
  private stepHint(): string {
    if (this.mode() === 'box') return this.pts.length ? 'Click the opposite corner · type width;height' : 'Ellipse: click the first corner of the bounding box'
    return ['Ellipse: click the center', 'Click the end of the first axis · type radius', 'Click to set the second radius · type radius'][this.pts.length] ?? ''
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
    if (!v || !this.pts.length) return void this.ctx.notify('info', 'Click the first point, then type a value')
    const c = this.pts[0]
    if (this.mode() === 'box') {
      const w = v.kind === 'delta' ? Math.abs(v.dx) : v.kind === 'length' ? v.value : v.length
      const h = v.kind === 'delta' ? Math.abs(v.dy) : v.kind === 'length' ? v.value : v.length
      const sx = this.cursor && this.cursor[0] < c[0] ? -1 : 1
      const sy = this.cursor && this.cursor[1] < c[1] ? -1 : 1
      return this.place([c[0] + w * sx, c[1] + h * sy])
    }
    const value = v.kind === 'length' ? v.value : v.kind === 'polar' ? v.length : Math.hypot(v.dx, v.dy)
    if (this.pts.length === 1) {
      const dir = v.kind === 'polar' ? v2.fromAngle(v.angle) : this.cursor && v2.dist(this.cursor, c) > 1e-9 ? v2.norm(v2.sub(this.cursor, c)) : ([1, 0] as Vec2)
      this.place(v2.add(c, v2.scale(dir, value)))
    } else {
      const n = v2.perp(v2.norm(v2.sub(this.pts[1], c)))
      this.place(v2.add(c, v2.scale(n, value)))
    }
  }

  private place(p: Vec2): void {
    this.pts.push(p)
    if (this.pts.length >= (this.mode() === 'box' ? 2 : 3)) return this.commit()
    this.hint(this.stepHint())
    this.clearAll()
    this.draw()
  }

  private ellipse(pts: Vec2[]): { center: Vec2; rx: number; ry: number; rotation: number } | null {
    if (pts.length < 2) return null
    if (this.mode() === 'box') {
      const [a, b] = pts
      return { center: v2.mid(a, b), rx: Math.abs(b[0] - a[0]) / 2, ry: Math.abs(b[1] - a[1]) / 2, rotation: 0 }
    }
    const c = pts[0]
    const rx = v2.dist(c, pts[1])
    const rotation = v2.angle(v2.sub(pts[1], c))
    const ry = pts[2] ? Math.abs(signedLineDistance(pts[2], c, pts[1])) : rx / 2
    return { center: c, rx, ry, rotation }
  }

  private draw(): void {
    if (!this.pts.length) return this.input('Radius', '', 'radius')
    const pts = this.cursor ? [...this.pts, this.cursor] : this.pts
    const el = this.ellipse(pts)
    if (!el || el.rx < 1e-9) return
    const plane = this.plane()
    if (el.ry > 1e-9) this.lines(uvPolygonToWorld(plane, sampleEllipse(el.center, el.rx, el.ry, el.rotation)), { closed: true, style: 'rubber' })
    if (this.mode() === 'center') this.lines([fromPlane(plane, el.center), fromPlane(plane, pts[1])], { style: 'guide', dashed: true })
    this.label(fromPlane(plane, el.center), `${this.fmt(el.rx)} × ${this.fmt(el.ry)}`, 'size')
    const second = this.mode() === 'center' && pts.length >= 3
    this.input(this.mode() === 'box' ? 'Width;Height' : second ? 'Radius 2' : 'Radius 1', this.mode() === 'box' ? `${this.fmt(el.rx * 2)};${this.fmt(el.ry * 2)}` : this.fmt(second ? el.ry : el.rx))
  }

  private commit(): void {
    const el = this.ellipse(this.pts)
    this.clearAll()
    this.clearInput()
    if (el && el.rx > 1e-9 && el.ry > 1e-9) {
      const parent = this.parent()
      const t = nodeTransformOnPlane(this.ctx, parent, this.plane(), el.center, el.rotation)
      this.commitNodes([newNode('ellipse', { rx: el.rx, ry: el.ry }, { parent, t })])
    }
    this.pts = []
    this.hint(this.stepHint())
  }
}
