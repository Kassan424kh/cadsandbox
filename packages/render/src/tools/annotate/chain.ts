// annotate.chain — Maßkette (chain dimension): click the stations (≥ 2), Enter / double-click, then
// click to place the dimension line (or type the offset). Creates ONE 'dimension' node of kind 'chain'
// whose intervals are labelled individually.
import type { DimensionParams, Vec2, Vec3 } from '@cadsandbox/doc'
import type { ToolOptionSpec, ToolPointerEvent } from '../types'
import { ChainTool } from '../util/chain'
import { DEFAULT_DIM_STYLE } from '../util/dimension'
import { chainDirection, chainDrawing, chainTotal } from '../util/dimensionChain'
import { isPrimary } from '../util/base'
import { LAYERS, lengthOption, newNode, selectOption } from '../util/nodes'
import { toPlane, v2 } from '../util/vec'

const AXES = ['auto', 'x', 'y'] as const

export const CHAIN_OPTIONS: ToolOptionSpec[] = [
  selectOption('axis', 'Direction', 'auto', [
    { value: 'auto', label: 'First → last point' },
    { value: 'x', label: 'Horizontal' },
    { value: 'y', label: 'Vertical' },
  ]),
  lengthOption('textSize', 'Text size', 0.2, 0.01),
]

export class ChainDimensionTool extends ChainTool {
  readonly id = 'annotate.chain' as const
  override readonly specs = CHAIN_OPTIONS
  /** Stations collected; set while the user places the dimension line. */
  private placing: Vec3[] | null = null

  protected override start(): void {
    this.allowClose = false
    this.minPoints = 2
    this.placing = null
    super.start()
  }
  protected override stop(): void {
    this.placing = null
    super.stop()
  }
  protected override isBusy(): boolean {
    return this.placing !== null || super.isBusy()
  }
  protected override reset(): void {
    this.placing = null
    super.reset()
  }
  protected override optionsChanged(): void {
    if (this.placing) this.redrawPlacing()
  }
  protected override firstHint(): string {
    return 'Chain dimension: click the first station (wall corners, opening edges…)'
  }
  protected override nextHint(): string {
    return 'Click the next station · Enter or double-click to place the dimension line · Backspace undo'
  }
  protected override updateHint(): void {
    if (this.placing) this.hint('Click to place the dimension line · type the offset · Esc back to the stations')
    else super.updateHint()
  }

  private axis(): DimensionParams['axis'] {
    const a = this.optStr('axis', 'auto', AXES)
    return a === 'auto' ? undefined : a
  }

  // ---- phase 1: stations (ChainTool) → phase 2: placement
  protected commitChain(points: Vec3[]): void {
    if (points.length < 2) return
    this.placing = points
    this.updateHint()
  }

  override onCancel(): boolean {
    if (this.placing) {
      // back to collecting: keep the stations
      this.points = this.placing
      this.placing = null
      this.clearAll()
      this.redraw()
      this.updateHint()
      return true
    }
    if (this.points.length) {
      this.reset()
      return true
    }
    return false
  }

  override onConfirm(): void {
    if (this.placing) {
      this.commitDimension(this.cursor ? this.offsetFor(this.cursor) : 0.6)
      return
    }
    super.onConfirm()
  }

  override onPointerDown(e: ToolPointerEvent): boolean {
    if (!this.placing) return super.onPointerDown(e)
    if (!isPrimary(e)) return false
    const s = this.snap(e, null)
    this.commitDimension(this.offsetFor(s.point))
    return true
  }

  override onPointerMove(e: ToolPointerEvent): void {
    if (!this.placing) return super.onPointerMove(e)
    this.clearAll()
    const s = this.snap(e, null)
    this.cursor = s.point
    this.redrawPlacing()
  }

  override onInput(text: string): void {
    if (!this.placing) return super.onInput(text)
    const d = this.ctx.parseLength(text)
    if (d === null) return void this.ctx.notify('warning', `Cannot read "${text}"`)
    const cur = this.cursor ? this.offsetFor(this.cursor) : 1
    this.commitDimension(Math.abs(d) * (cur < 0 ? -1 : 1))
  }

  // ---- helpers
  private stationsUV(): Vec2[] {
    const plane = this.plane()
    return (this.placing ?? []).map((p) => toPlane(plane, p))
  }

  /** Signed offset of the dimension line for a pointer position (plane space). */
  private offsetFor(world: Vec3): number {
    const uv = this.stationsUV()
    if (!uv.length) return 0
    const dir = chainDirection(uv, this.axis())
    const c = toPlane(this.plane(), world)
    return v2.dot(v2.sub(c, uv[0]!), v2.perp(dir))
  }

  private previewParams(offset: number): DimensionParams {
    const p: DimensionParams = { kind: 'chain', points: this.stationsUV().map((q) => [q[0], q[1], 0] as Vec3), offset }
    const axis = this.axis()
    if (axis) p.axis = axis
    return p
  }

  private redrawPlacing(): void {
    if (!this.placing) return
    const offset = this.cursor ? this.offsetFor(this.cursor) : 0.6
    const params = this.previewParams(offset)
    const style = { ...DEFAULT_DIM_STYLE, textSize: this.optNum('textSize', 0.2), format: (m: number) => this.ctx.formatLength(m) }
    this.drawing(chainDrawing(params, style), this.plane())
    this.input('Offset', this.fmt(Math.abs(offset)), `total ${this.fmt(chainTotal(params))}`)
  }

  private commitDimension(offset: number): void {
    const pts = this.placing
    if (!pts || pts.length < 2) return
    const parent = this.parent()
    const params: DimensionParams = { kind: 'chain', points: pts.map((w) => this.toLocal(w, parent)), offset }
    const axis = this.axis()
    if (axis) params.axis = axis
    const meta: Record<string, unknown> = {}
    const size = this.optNum('textSize', 0.2)
    if (size !== 0.2) meta.textSize = size
    this.clearAll()
    this.clearInput()
    this.commitNodes([newNode('dimension', params, { parent, layer: LAYERS.dims, name: 'Chain dimension', meta })])
    this.placing = null
    this.points = []
    this.cursor = null
    this.updateHint()
  }
}
