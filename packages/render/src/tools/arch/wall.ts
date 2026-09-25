// arch.wall — chain of wall segments (one 'wall' node per segment, ONE undo step), presets with
// material layers, justification, snapping to existing wall ends, typed length/angle, close on the
// first point, and a rectangle mode (2 clicks → 4 walls).
import type { NewNode, Vec2, Vec3, WallParams } from '@cadsandbox/doc'
import type { ToolOptionSpec, ToolPointerEvent } from '../types'
import { ChainTool } from '../util/chain'
import { LAYERS, WALL_PRESET_OPTIONS, boolOption, lengthOption, newNode, selectOption, wallParamsFromOptions } from '../util/nodes'
import { rectCorners } from '../util/polygon'
import { levelWalls } from '../util/regions'
import { fromPlane, toPlane, v2, v3 } from '../util/vec'
import { wallOutline } from '../util/walls'

export const WALL_OPTIONS: ToolOptionSpec[] = [
  { key: 'preset', label: 'Wall type', kind: 'select', default: 'custom', options: WALL_PRESET_OPTIONS },
  lengthOption('thickness', 'Thickness', 0.24, 0.01),
  lengthOption('height', 'Height (0 = level height)', 0),
  selectOption('justification', 'Justification', 'center', ['center', 'left', 'right']),
  lengthOption('baseOffset', 'Base offset', 0),
  boolOption('exterior', 'Exterior', false),
  selectOption('mode', 'Mode', 'chain', [
    { value: 'chain', label: 'Chain' },
    { value: 'rectangle', label: 'Rectangle (2 clicks)' },
  ]),
]

export class WallTool extends ChainTool {
  readonly id = 'arch.wall' as const
  override readonly specs = WALL_OPTIONS

  protected override start(): void {
    this.inputLabel = 'Length'
    super.start()
  }

  private mode(): 'chain' | 'rectangle' {
    return this.optStr('mode', 'chain', ['chain', 'rectangle'])
  }

  private params(): Omit<WallParams, 'a' | 'b'> {
    return wallParamsFromOptions(this.options, this.levelHeight())
  }

  protected override firstHint(): string {
    return this.mode() === 'rectangle' ? 'Wall rectangle: click the first corner' : 'Wall: click the start point · snap to existing wall ends'
  }
  protected override nextHint(): string {
    return this.mode() === 'rectangle'
      ? 'Click the opposite corner · type width;height'
      : 'Click the next point · type length or length<angle · C close loop · Backspace undo · Enter finish'
  }

  /** Prefer existing wall end points within the snap radius (wall joins). */
  protected override snapPoint(e: ToolPointerEvent) {
    const s = super.snapPoint(e)
    if (s.kind !== 'free' && s.kind !== 'grid') return s
    const parent = this.parent()
    const tol = 10 * this.ctx.worldPerPixel(s.point)
    let best: Vec3 | null = null
    let bestD = tol
    for (const w of levelWalls(this.ctx)) {
      for (const p of [w.params.a, w.params.b]) {
        const wp = this.ctx.toWorld(w.parent ?? parent, [p[0], p[1], 0])
        const d = v3.dist([wp[0], wp[1], s.point[2]], s.point)
        if (d < bestD) {
          bestD = d
          best = [wp[0], wp[1], s.point[2]]
        }
      }
    }
    if (!best) return s
    this.marker(best, 'endpoint')
    return { ...s, point: best, kind: 'endpoint' as const }
  }

  protected override pointAdded(): void {
    if (this.mode() === 'rectangle' && this.points.length >= 2) this.finishChain(false)
  }

  /** World outline polygon of a wall segment given world end points. */
  private segmentOutline(a: Vec3, b: Vec3): Vec3[] {
    const parent = this.parent()
    const la = this.toLocal2(a, parent),
      lb = this.toLocal2(b, parent)
    const outline = wallOutline({ ...this.params(), a: la, b: lb })
    return outline.map((p) => this.toWorld2(p, parent))
  }

  protected override drawChain(points: Vec3[], cursor: Vec3 | null): void {
    const plane = this.plane()
    if (this.mode() === 'rectangle') {
      const a = points[0]
      const b = cursor ?? points[1]
      if (!a || !b) return
      const corners = rectCorners(toPlane(plane, a), toPlane(plane, b)).map((p) => fromPlane(plane, p))
      for (let i = 0; i < 4; i++) {
        const o = this.segmentOutline(corners[i], corners[(i + 1) % 4])
        this.polygon(o, { opacity: 0.2 })
        this.lines(o, { closed: true, style: 'rubber' })
      }
      const d = v2.sub(toPlane(plane, b), toPlane(plane, a))
      this.label(v3.mid(a, b), `${this.fmt(Math.abs(d[0]))} × ${this.fmt(Math.abs(d[1]))}`, 'size')
      return
    }
    const pts = cursor ? [...points, cursor] : points
    for (let i = 0; i < pts.length - 1; i++) {
      if (v3.dist(pts[i], pts[i + 1]) < 1e-6) continue
      const o = this.segmentOutline(pts[i], pts[i + 1])
      this.polygon(o, { opacity: 0.2 })
      this.lines(o, { closed: true, style: 'rubber' })
    }
    if (pts.length >= 2) this.lines(pts, { style: 'guide', dashed: true })
    if (cursor && points.length) this.distanceLabel(points[points.length - 1], cursor)
  }

  protected commitChain(points: Vec3[], closed: boolean): void {
    const parent = this.parent()
    const params = this.params()
    let local: Vec2[]
    if (this.mode() === 'rectangle') {
      const plane = this.plane()
      local = rectCorners(toPlane(plane, points[0]), toPlane(plane, points[1])).map((p) => this.toLocal2(fromPlane(plane, p), parent))
      closed = true
      if (v2.dist(local[0], local[1]) < 1e-6 || v2.dist(local[1], local[2]) < 1e-6) return
    } else {
      local = points.map((p) => this.toLocal2(p, parent))
      // A chain ending on its start point is a closed loop.
      if (!closed && local.length >= 4 && v2.dist(local[0], local[local.length - 1]) < 1e-6) {
        local.pop()
        closed = true
      }
    }
    const nodes: NewNode[] = []
    const n = local.length
    const segs = closed ? n : n - 1
    for (let i = 0; i < segs; i++) {
      const a = local[i],
        b = local[(i + 1) % n]
      if (v2.dist(a, b) < 1e-6) continue
      nodes.push(newNode('wall', { ...params, layers: params.layers?.map((l) => ({ ...l })), a: [a[0], a[1]], b: [b[0], b[1]] }, { parent, layer: LAYERS.walls, name: 'Wall' }))
    }
    if (nodes.length) this.commitNodes(nodes)
  }

  /** Rectangle mode accepts "width;height" from the first corner. */
  override onInput(text: string): void {
    if (this.mode() === 'rectangle' && this.points.length === 1 && text.includes(';')) {
      const parts = text.split(';').map((s) => this.ctx.parseLength(s.trim()))
      if (parts.length === 2 && parts[0] !== null && parts[1] !== null) {
        const plane = this.plane()
        const a = toPlane(plane, this.points[0])
        const c = this.cursor ? toPlane(plane, this.cursor) : v2.add(a, [1, 1])
        const sx = c[0] < a[0] ? -1 : 1,
          sy = c[1] < a[1] ? -1 : 1
        this.addPoint(fromPlane(plane, [a[0] + Math.abs(parts[0]) * sx, a[1] + Math.abs(parts[1]) * sy]))
        return
      }
    }
    super.onInput(text)
  }
}
