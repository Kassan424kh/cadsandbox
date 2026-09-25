// arch.column — click to place a column (height = level height by default); optional grid array
// (countX × countY at spacingX/spacingY) placed as ONE undo step.
import type { ColumnParams, NewNode, Vec2 } from '@cadsandbox/doc'
import type { ToolOptionSpec, ToolPointerEvent } from '../types'
import { sampleCircle } from '../util/arcs'
import { ToolBase, isPrimary } from '../util/base'
import { nodeTransformOnPlane, uvPolygonToWorld } from '../util/frame'
import { parseVcb } from '../util/input'
import { LAYERS, angleOption, lengthOption, newNode, numberOption, selectOption } from '../util/nodes'
import { rotatedRect } from '../util/polygon'
import { toPlane, v2 } from '../util/vec'

const SHAPES: ColumnParams['shape'][] = ['rect', 'round', 'h-beam']

export const COLUMN_OPTIONS: ToolOptionSpec[] = [
  selectOption('shape', 'Shape', 'rect', SHAPES),
  lengthOption('width', 'Width', 0.3, 0.05),
  lengthOption('depth', 'Depth', 0.3, 0.05),
  lengthOption('height', 'Height (0 = level height)', 0),
  lengthOption('baseOffset', 'Base offset', 0),
  angleOption('rotation', 'Rotation', 0),
  numberOption('countX', 'Grid count X', 1, 1, 50),
  numberOption('countY', 'Grid count Y', 1, 1, 50),
  lengthOption('spacingX', 'Grid spacing X', 5, 0.1),
  lengthOption('spacingY', 'Grid spacing Y', 5, 0.1),
]

export class ColumnTool extends ToolBase {
  readonly id = 'arch.column' as const
  override readonly specs = COLUMN_OPTIONS

  protected override start(): void {
    this.hint('Column: click to place · options: shape, size, height, grid array · type x;y for an exact position')
  }
  protected isBusy(): boolean {
    return false
  }
  protected reset(): void {
    this.clearAll()
  }

  private params(): ColumnParams {
    const h = this.optNum('height', 0)
    return {
      shape: this.optStr<ColumnParams['shape']>('shape', 'rect', SHAPES),
      width: Math.max(0.05, this.optNum('width', 0.3)),
      depth: Math.max(0.05, this.optNum('depth', 0.3)),
      height: h > 0 ? h : this.levelHeight(),
      baseOffset: this.optNum('baseOffset', 0),
    }
  }

  /** Grid positions (UV) for an anchor at `uv`. */
  private positions(uv: Vec2): Vec2[] {
    const cx = Math.max(1, Math.round(this.optNum('countX', 1)))
    const cy = Math.max(1, Math.round(this.optNum('countY', 1)))
    const sx = this.optNum('spacingX', 5),
      sy = this.optNum('spacingY', 5)
    const rot = this.optNum('rotation', 0)
    const out: Vec2[] = []
    for (let i = 0; i < cx; i++) for (let j = 0; j < cy; j++) out.push(v2.add(uv, v2.rotate([i * sx, j * sy], rot)))
    return out
  }

  private footprint(uv: Vec2): Vec2[] {
    const p = this.params()
    const rot = this.optNum('rotation', 0)
    if (p.shape === 'round') return sampleCircle(uv, p.width / 2, 24)
    return rotatedRect(uv, p.width, p.depth, rot)
  }

  onPointerMove(e: ToolPointerEvent): void {
    this.clearAll()
    const s = this.snap(e)
    const uv = toPlane(this.plane(), s.point)
    const plane = this.plane()
    for (const p of this.positions(uv)) {
      const fp = uvPolygonToWorld(plane, this.footprint(p))
      this.polygon(fp, { opacity: 0.3 })
      this.lines(fp, { closed: true, style: 'rubber' })
    }
    const prm = this.params()
    this.label(s.point, `${this.fmt(prm.width)} × ${this.fmt(prm.depth)} · h ${this.fmt(prm.height)}`, 'size')
    this.input('Position', `${this.fmt(uv[0])};${this.fmt(uv[1])}`, 'x;y')
  }

  onPointerDown(e: ToolPointerEvent): boolean {
    if (!isPrimary(e)) return false
    const s = this.snap(e)
    this.place(toPlane(this.plane(), s.point))
    return true
  }

  onInput(text: string): void {
    const v = parseVcb(text, this.ctx)
    if (!v || v.kind !== 'delta') return void this.ctx.notify('warning', 'Type the position as x;y')
    this.place([v.dx, v.dy])
  }

  private place(uv: Vec2): void {
    this.clearAll()
    const parent = this.parent()
    const params = this.params()
    const rot = this.optNum('rotation', 0)
    const nodes: NewNode[] = this.positions(uv).map((p, i) =>
      newNode('column', { ...params }, { parent, layer: LAYERS.structure, t: nodeTransformOnPlane(this.ctx, parent, this.plane(), p, rot), name: i === 0 ? 'Column' : `Column ${i + 1}` }),
    )
    this.commitNodes(nodes)
  }
}
