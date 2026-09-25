// draw.rect — 2-point (corner/corner or center/corner) and 3-point rotated rectangles with an
// optional corner radius. Creates a 'rect' node centered at t.p, rotated about the plane normal.
import type { Vec2 } from '@cadsandbox/doc'
import type { ToolOptionSpec, ToolPointerEvent } from '../types'
import { ToolBase, isPrimary } from '../util/base'
import { nodeTransformOnPlane, uvPolygonToWorld } from '../util/frame'
import { parseVcb } from '../util/input'
import { lengthOption, newNode, selectOption } from '../util/nodes'
import { rectCorners, rotatedRect, signedLineDistance } from '../util/polygon'
import { fromPlane, toPlane, v2 } from '../util/vec'

export const RECT_OPTIONS: ToolOptionSpec[] = [
  selectOption('mode', 'Mode', '2-point', [
    { value: '2-point', label: '2 points' },
    { value: '3-point', label: '3 points (rotated)' },
  ]),
  selectOption('from', 'From', 'corner', ['corner', 'center']),
  lengthOption('cornerRadius', 'Corner radius', 0),
]

export class RectTool extends ToolBase {
  readonly id = 'draw.rect' as const
  override readonly specs = RECT_OPTIONS
  /** Clicked points in plane UV */
  private pts: Vec2[] = []
  private cursor: Vec2 | null = null

  protected override start(): void {
    this.pts = []
    this.cursor = null
    this.hint('Rectangle: click the first corner')
  }

  protected isBusy(): boolean {
    return this.pts.length > 0
  }

  protected reset(): void {
    this.pts = []
    this.cursor = null
    this.clearAll()
    this.clearInput()
    this.hint('Rectangle: click the first corner')
  }

  private mode(): '2-point' | '3-point' {
    return this.optStr('mode', '2-point', ['2-point', '3-point'])
  }

  onPointerDown(e: ToolPointerEvent): boolean {
    if (!isPrimary(e)) return false
    const from = this.pts.length ? fromPlane(this.plane(), this.pts[this.pts.length - 1]) : null
    const s = this.snap(e, from)
    this.place(toPlane(this.plane(), s.point))
    return true
  }

  onPointerMove(e: ToolPointerEvent): void {
    this.clearAll()
    const from = this.pts.length ? fromPlane(this.plane(), this.pts[this.pts.length - 1]) : null
    const s = this.snap(e, from)
    this.cursor = toPlane(this.plane(), s.point)
    this.draw()
  }

  onInput(text: string): void {
    const v = parseVcb(text, this.ctx)
    if (!v || !this.pts.length) {
      this.ctx.notify('info', this.pts.length ? `Cannot read "${text}"` : 'Click the first corner first')
      return
    }
    const a = this.pts[0]
    if (this.mode() === '2-point') {
      let w = 0,
        h = 0
      if (v.kind === 'delta') (w = v.dx), (h = v.dy)
      else if (v.kind === 'length') (w = v.value), (h = v.value)
      else if (v.kind === 'polar') (w = Math.cos(v.angle) * v.length), (h = Math.sin(v.angle) * v.length)
      const sx = this.cursor && this.cursor[0] < a[0] ? -1 : 1
      const sy = this.cursor && this.cursor[1] < a[1] ? -1 : 1
      this.place([a[0] + Math.abs(w) * sx, a[1] + Math.abs(h) * sy])
      return
    }
    if (this.pts.length === 1) {
      // First edge by length (direction from the cursor) or polar.
      const dir = v.kind === 'polar' ? v2.fromAngle(v.angle) : this.cursor ? v2.norm(v2.sub(this.cursor, a)) : [1, 0]
      const len = v.kind === 'polar' ? v.length : v.kind === 'length' ? v.value : Math.hypot(v.dx, v.dy)
      this.place(v2.add(a, v2.scale(dir as Vec2, len)))
    } else {
      const b = this.pts[1]
      const n = v2.perp(v2.norm(v2.sub(b, a)))
      const h = v.kind === 'length' ? v.value : v.kind === 'polar' ? v.length : v.dy
      const side = this.cursor && signedLineDistance(this.cursor, a, b) < 0 ? -1 : 1
      this.place(v2.add(b, v2.scale(n, h * side)))
    }
  }

  private place(p: Vec2): void {
    this.pts.push(p)
    const need = this.mode() === '2-point' ? 2 : 3
    if (this.pts.length >= need) {
      this.commit()
      return
    }
    this.hint(this.pts.length === 1 && this.mode() === '3-point' ? 'Click the end of the first edge · type length' : 'Click the opposite corner · type width;height')
    this.clearAll()
    this.draw()
  }

  /** Corners (UV) + center/size/yaw for the current points and cursor. */
  private geometry(pts: Vec2[]): { corners: Vec2[]; center: Vec2; width: number; height: number; yaw: number } | null {
    if (pts.length < 2) return null
    const [a, b] = pts
    if (this.mode() === '2-point') {
      if (this.optStr('from', 'corner', ['corner', 'center']) === 'center') {
        const d = v2.sub(b, a)
        const corners = rectCorners(v2.sub(a, d), v2.add(a, d))
        return { corners, center: a, width: Math.abs(d[0]) * 2, height: Math.abs(d[1]) * 2, yaw: 0 }
      }
      const corners = rectCorners(a, b)
      return { corners, center: v2.mid(a, b), width: Math.abs(b[0] - a[0]), height: Math.abs(b[1] - a[1]), yaw: 0 }
    }
    const width = v2.dist(a, b)
    const yaw = v2.angle(v2.sub(b, a))
    const c = pts[2]
    const h = c ? signedLineDistance(c, a, b) : 0
    const n = v2.perp(v2.norm(v2.sub(b, a)))
    const center = v2.add(v2.mid(a, b), v2.scale(n, h / 2))
    return { corners: rotatedRect(center, width, Math.abs(h), yaw), center, width, height: Math.abs(h), yaw }
  }

  private draw(): void {
    if (!this.pts.length) {
      this.input('Width;Height', '', 'width;height')
      return
    }
    const pts = this.cursor ? [...this.pts, this.cursor] : this.pts
    const g = this.geometry(pts)
    if (!g) return
    const plane = this.plane()
    if (g.width > 1e-9 && g.height > 1e-9) {
      const world = uvPolygonToWorld(plane, g.corners)
      this.lines(world, { closed: true, style: 'rubber' })
      this.polygon(world, { opacity: 0.08 })
    } else if (this.mode() === '3-point' && pts.length === 2) {
      this.lines(uvPolygonToWorld(plane, pts), { style: 'rubber' })
    }
    const mid = fromPlane(plane, g.center)
    this.label(mid, `${this.fmt(g.width)} × ${this.fmt(g.height)}`, 'size')
    this.input(this.mode() === '3-point' && pts.length === 2 ? 'Length' : 'Width;Height', this.mode() === '3-point' && pts.length === 2 ? this.fmt(g.width) : `${this.fmt(g.width)};${this.fmt(g.height)}`)
  }

  private commit(): void {
    const g = this.geometry(this.pts)
    this.clearAll()
    this.clearInput()
    if (g && g.width > 1e-9 && g.height > 1e-9) {
      const parent = this.parent()
      const t = nodeTransformOnPlane(this.ctx, parent, this.plane(), g.center, g.yaw)
      const cornerRadius = Math.max(0, Math.min(this.optNum('cornerRadius', 0), Math.min(g.width, g.height) / 2))
      this.commitNodes([newNode('rect', { width: g.width, height: g.height, cornerRadius }, { parent, t })])
    }
    this.pts = []
    this.hint('Rectangle: click the first corner')
  }
}

