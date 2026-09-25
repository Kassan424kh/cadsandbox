// arch.stair — click the start, move to set direction + run length (preview footprint, treads and
// the up arrow), click again → 'stair' node (climbs along local +Y). Options kind / width / rise
// (default = level height) / riser count / turn / railing / structure.
import type { StairKind, StairParams, Vec2 } from '@cadsandbox/doc'
import type { ToolOptionSpec, ToolPointerEvent } from '../types'
import { ToolBase, isPrimary } from '../util/base'
import { nodeTransformOnPlane } from '../util/frame'
import { parseVcb } from '../util/input'
import { lengthOption, newNode, numberOption, selectOption } from '../util/nodes'
import { fromPlane, toPlane, v2 } from '../util/vec'

const KINDS: StairKind[] = ['straight', 'l-shape', 'u-shape', 'spiral']

export const STAIR_OPTIONS: ToolOptionSpec[] = [
  selectOption('kind', 'Kind', 'straight', KINDS),
  lengthOption('width', 'Width', 1.0, 0.6),
  lengthOption('rise', 'Total rise (0 = level height)', 0),
  numberOption('riserCount', 'Risers (0 = auto)', 0, 0, 60),
  lengthOption('treadDepth', 'Tread depth', 0.27, 0.2, 0.4),
  selectOption('turn', 'Turn', 'left', ['left', 'right']),
  selectOption('railing', 'Railing', 'right', ['none', 'left', 'right', 'both']),
  selectOption('structure', 'Structure', 'solid', ['solid', 'stringer', 'floating']),
]

/** DIN 18065 comfort rule: 2·riser + tread ≈ 0.63 m, riser ≤ 0.19 m. */
export function autoRiserCount(rise: number): number {
  return Math.max(2, Math.ceil(rise / 0.19 - 1e-9), Math.round(rise / 0.175))
}

export class StairTool extends ToolBase {
  readonly id = 'arch.stair' as const
  override readonly specs = STAIR_OPTIONS
  private startUV: Vec2 | null = null
  private cursor: Vec2 | null = null

  protected override start(): void {
    this.startUV = null
    this.hint('Stair: click the start (bottom) point')
  }
  protected isBusy(): boolean {
    return this.startUV !== null
  }
  protected reset(): void {
    this.startUV = null
    this.cursor = null
    this.clearAll()
    this.clearInput()
    this.hint('Stair: click the start (bottom) point')
  }

  private rise(): number {
    const r = this.optNum('rise', 0)
    return r > 0 ? r : this.levelHeight()
  }
  private risers(): number {
    const n = Math.round(this.optNum('riserCount', 0))
    return n > 0 ? n : autoRiserCount(this.rise())
  }

  onPointerDown(e: ToolPointerEvent): boolean {
    if (!isPrimary(e)) return false
    const s = this.snap(e, this.startUV ? fromPlane(this.plane(), this.startUV) : null)
    const uv = toPlane(this.plane(), s.point)
    if (!this.startUV) {
      this.startUV = uv
      this.hint('Move to set the direction and run length, click to place · type the length')
      return true
    }
    this.commit(uv)
    return true
  }

  onPointerMove(e: ToolPointerEvent): void {
    this.clearAll()
    const s = this.snap(e, this.startUV ? fromPlane(this.plane(), this.startUV) : null)
    this.cursor = toPlane(this.plane(), s.point)
    if (this.startUV) this.draw(this.startUV, this.cursor)
  }

  onInput(text: string): void {
    if (!this.startUV) return void this.ctx.notify('info', 'Click the start point first')
    const v = parseVcb(text, this.ctx)
    if (!v) return void this.ctx.notify('warning', `Cannot read "${text}"`)
    const dir = v.kind === 'polar' ? v2.fromAngle(v.angle) : this.cursor && v2.dist(this.cursor, this.startUV) > 1e-9 ? v2.norm(v2.sub(this.cursor, this.startUV)) : ([0, 1] as Vec2)
    const len = v.kind === 'length' ? v.value : v.kind === 'polar' ? v.length : Math.hypot(v.dx, v.dy)
    this.commit(v2.add(this.startUV, v2.scale(dir, len)))
  }

  /** Footprint of the first flight for preview (UV). */
  private footprint(start: Vec2, end: Vec2): { corners: Vec2[]; treads: [Vec2, Vec2][]; dir: Vec2; length: number } | null {
    const d = v2.sub(end, start)
    const length = v2.len(d)
    if (length < 1e-6) return null
    const dir = v2.scale(d, 1 / length)
    const n = v2.perp(dir)
    const hw = this.optNum('width', 1) / 2
    const corners = [v2.add(start, v2.scale(n, hw)), v2.add(start, v2.scale(n, -hw)), v2.add(end, v2.scale(n, -hw)), v2.add(end, v2.scale(n, hw))]
    const risers = this.risers()
    const treads: [Vec2, Vec2][] = []
    const count = this.optStr('kind', 'straight', KINDS) === 'straight' ? risers - 1 : Math.max(1, Math.floor(length / this.optNum('treadDepth', 0.27)))
    for (let i = 1; i <= count; i++) {
      const p = v2.add(start, v2.scale(dir, (length * i) / (count + 1)))
      treads.push([v2.add(p, v2.scale(n, hw)), v2.add(p, v2.scale(n, -hw))])
    }
    return { corners, treads, dir, length }
  }

  private draw(start: Vec2, end: Vec2): void {
    const fp = this.footprint(start, end)
    if (!fp) return
    const plane = this.plane()
    const W = (p: Vec2) => fromPlane(plane, p)
    this.polygon(fp.corners.map(W), { opacity: 0.2 })
    this.lines(fp.corners.map(W), { closed: true, style: 'rubber' })
    for (const t of fp.treads) this.lines([W(t[0]), W(t[1])], { style: 'symbol' })
    // Up arrow along the centre line.
    const head = v2.add(start, v2.scale(fp.dir, fp.length))
    const back = v2.add(head, v2.scale(fp.dir, -0.25))
    const n = v2.perp(fp.dir)
    this.lines([W(start), W(head), W(v2.add(back, v2.scale(n, 0.1))), W(head), W(v2.add(back, v2.scale(n, -0.1)))], { style: 'symbol' })
    const risers = this.risers()
    const riser = this.rise() / risers
    const tread = this.optStr('kind', 'straight', KINDS) === 'straight' ? fp.length / Math.max(1, risers - 1) : this.optNum('treadDepth', 0.27)
    this.label(W(v2.mid(start, end)), `${risers} × ${this.fmt(riser)} / ${this.fmt(tread)} · run ${this.fmt(fp.length)}`, 'size')
    this.input('Length', this.fmt(fp.length))
  }

  private commit(end: Vec2): void {
    const start = this.startUV!
    const fp = this.footprint(start, end)
    this.clearAll()
    this.clearInput()
    this.startUV = null
    this.hint('Stair: click the start (bottom) point')
    if (!fp) return
    const kind = this.optStr<StairKind>('kind', 'straight', KINDS)
    const risers = this.risers()
    let treadDepth = this.optNum('treadDepth', 0.27)
    if (kind === 'straight') treadDepth = Math.max(0.2, Math.min(0.4, fp.length / Math.max(1, risers - 1)))
    const parent = this.parent()
    // Local +Y must point along the run direction.
    const yaw = v2.angle(fp.dir) - Math.PI / 2
    const t = nodeTransformOnPlane(this.ctx, parent, this.plane(), start, yaw)
    const params: StairParams = {
      kind,
      width: Math.max(0.6, this.optNum('width', 1)),
      rise: this.rise(),
      riserCount: risers,
      treadDepth,
      landingDepth: Math.max(this.optNum('width', 1), 1),
      turn: this.optStr('turn', 'left', ['left', 'right']),
      structure: this.optStr('structure', 'solid', ['solid', 'stringer', 'floating']),
      railing: this.optStr('railing', 'right', ['none', 'left', 'right', 'both']),
      railingHeight: 0.9,
      nosing: 0.03,
    }
    if (kind === 'spiral') {
      params.innerRadius = 0.15
      params.sweepDeg = 270
    }
    this.commitNodes([newNode('stair', params, { parent, t, name: 'Stair' })])
  }
}
