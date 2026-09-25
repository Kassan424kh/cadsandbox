// annotate.calibrate — bring an image underlay (scanned plan, imported PDF page) to real size: click
// two points on the image, type the real distance between them → the image node is rescaled about
// the first point (essential before tracing over scans).
import type { NodeBase, NodePatch, Vec2, Vec3 } from '@cadsandbox/doc'
import type { ToolOptionSpec, ToolPointerEvent } from '../types'
import { ToolBase, isPrimary } from '../util/base'
import { v3 } from '../util/vec'

export const CALIBRATE_OPTIONS: ToolOptionSpec[] = []

/** Patch scaling an image node by `factor` about `anchor` (parent-space XY point that must stay put). */
export function calibratedImagePatch(node: NodeBase<'image'>, anchor: Vec2, factor: number): NodePatch<'image'> {
  const p = node.t.p
  const meta = { ...node.meta } as Record<string, unknown>
  const img = meta.image as { pixels?: [number, number]; metersPerPixel?: number } | undefined
  if (img && typeof img.metersPerPixel === 'number') meta.image = { ...img, metersPerPixel: img.metersPerPixel * factor }
  return {
    t: { ...node.t, p: [anchor[0] + (p[0] - anchor[0]) * factor, anchor[1] + (p[1] - anchor[1]) * factor, p[2]] },
    params: { width: node.params.width * factor, height: node.params.height * factor },
    meta,
  }
}

export class CalibrateTool extends ToolBase {
  readonly id = 'annotate.calibrate' as const
  override readonly specs = CALIBRATE_OPTIONS
  private image: string | null = null
  private pts: Vec3[] = []
  private cursor: Vec3 | null = null

  protected override start(): void {
    this.hint('Calibrate underlay: click the first point on the image (one end of a known dimension)')
  }
  protected isBusy(): boolean {
    return this.pts.length > 0
  }
  protected reset(): void {
    this.image = null
    this.pts = []
    this.cursor = null
    this.clearAll()
    this.clearInput()
    this.start()
  }

  onPointerDown(e: ToolPointerEvent): boolean {
    if (!isPrimary(e)) return false
    if (this.pts.length >= 2) return true
    if (this.pts.length === 0) {
      const hit = this.ctx.pick(e, (n) => n.type === 'image')
      if (!hit) {
        this.ctx.notify('info', 'Click on an image underlay (PDF page or scanned plan) to calibrate it')
        return true
      }
      this.image = hit.nodeId
    }
    const s = this.snap(e, this.pts[0] ?? null)
    this.pts.push(s.point)
    this.clearAll()
    if (this.pts.length === 1) this.hint('Click the second point (the other end of the known dimension)')
    else {
      const measured = this.measured()
      this.hint('Type the REAL distance between the two points and press Enter · Esc cancel')
      this.input('Real distance', this.fmt(measured), this.fmt(measured))
      this.redraw()
    }
    return true
  }

  onPointerMove(e: ToolPointerEvent): void {
    this.clearAll()
    if (this.pts.length === 1) {
      const s = this.snap(e, this.pts[0]!)
      this.cursor = s.point
      this.lines([this.pts[0]!, s.point], { style: 'rubber' })
      this.distanceLabel(this.pts[0]!, s.point)
    } else if (this.pts.length === 2) this.redraw()
  }

  onInput(text: string): void {
    if (this.pts.length < 2) return void this.ctx.notify('info', 'Click the two points on the image first')
    const real = this.ctx.parseLength(text)
    if (real === null || real <= 0) return void this.ctx.notify('warning', `Cannot read "${text}"`)
    const measured = this.measured()
    if (measured < 1e-6) return void this.ctx.notify('warning', 'The two points coincide — pick two distinct points')
    this.apply(real / measured)
  }

  private measured(): number {
    return this.pts.length >= 2 ? v3.dist(this.pts[0]!, this.pts[1]!) : 0
  }

  private redraw(): void {
    if (this.pts.length < 2) return
    this.lines([this.pts[0]!, this.pts[1]!], { style: 'annotation' })
    this.marker(this.pts[0]!, 'endpoint')
    this.marker(this.pts[1]!, 'endpoint')
    this.distanceLabel(this.pts[0]!, this.pts[1]!)
  }

  private apply(factor: number): void {
    const id = this.image
    const node = id ? this.ctx.node<'image'>(id) : undefined
    if (!node || node.type !== 'image') {
      this.ctx.notify('warning', 'The image underlay is gone')
      return this.reset()
    }
    const anchorLocal = this.ctx.toLocal(node.parent, this.pts[0]!)
    const patch = calibratedImagePatch(node, [anchorLocal[0], anchorLocal[1]], factor)
    this.ctx.commit(() => this.ctx.doc.updateNode(node.id, patch))
    this.ctx.requestRender()
    this.ctx.notify('success', `Underlay scaled ×${factor.toFixed(4)} · now ${this.fmt(node.params.width * factor)} wide`)
    this.reset()
  }
}
