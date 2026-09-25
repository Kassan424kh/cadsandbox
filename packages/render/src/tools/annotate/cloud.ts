// annotate.cloud — revision cloud: click the outline corners, close with C / the first point / Enter →
// one closed 'polyline' whose edges are split into outward arc scallops (DXF bulges), placed on the
// red 'Markup' layer (created on demand).
import type { Vec2, Vec3 } from '@cadsandbox/doc'
import { expandBulges } from '@cadsandbox/geometry'
import type { ToolOptionSpec } from '../types'
import { ChainTool } from '../util/chain'
import { lengthOption, newNode, numberOption } from '../util/nodes'
import { isCCW } from '../util/polygon'
import { fromPlane, toPlane, v2 } from '../util/vec'
import { MARKUP_COLOR, ensureMarkupLayer } from './markup'

export const CLOUD_OPTIONS: ToolOptionSpec[] = [lengthOption('arcLength', 'Arc length', 0.5, 0.05), numberOption('bulge', 'Arc bulge', 0.45, 0.1, 1)]

/**
 * Scalloped outline of a closed polygon: every edge is split into chords of ≈ `arcLength` that each
 * carry an outward bulge (positive DXF bulge = CCW arc = bulging to the right of travel, i.e. outward
 * for a counter-clockwise outline).
 */
export function cloudOutline(points: readonly Vec2[], arcLength: number, bulge: number): { points: Vec2[]; bulges: number[] } {
  const n = points.length
  const sign = isCCW(points) ? 1 : -1
  const out: Vec2[] = []
  const bulges: number[] = []
  const step = Math.max(0.01, arcLength)
  for (let i = 0; i < n; i++) {
    const a = points[i]!, b = points[(i + 1) % n]!
    const k = Math.max(1, Math.round(v2.dist(a, b) / step))
    for (let j = 0; j < k; j++) {
      out.push(v2.add(a, v2.scale(v2.sub(b, a), j / k)))
      bulges.push(sign * bulge)
    }
  }
  return { points: out, bulges }
}

export class CloudTool extends ChainTool {
  readonly id = 'annotate.cloud' as const
  override readonly specs = CLOUD_OPTIONS

  protected override start(): void {
    this.allowClose = true
    this.minPoints = 3
    super.start()
  }
  protected override firstHint(): string {
    return 'Revision cloud: click the first corner of the area to mark'
  }
  protected override nextHint(): string {
    return 'Click the next corner · C or click the first point to close · Enter finish · Backspace undo'
  }

  private cloud(uv: Vec2[]): { points: Vec2[]; bulges: number[] } {
    return cloudOutline(uv, this.optNum('arcLength', 0.5), this.optNum('bulge', 0.45))
  }

  protected override drawChain(points: Vec3[], cursor: Vec3 | null): void {
    super.drawChain(points, cursor)
    const pts = cursor ? [...points, cursor] : points
    if (pts.length < 3) return
    const plane = this.plane()
    const c = this.cloud(pts.map((p) => toPlane(plane, p)))
    const flat = expandBulges(c.points, c.bulges, true)
    this.lines(flat.map((q) => fromPlane(plane, q)), { closed: true, style: 'annotation', color: MARKUP_COLOR })
  }

  protected commitChain(points: Vec3[]): void {
    if (points.length < 3) return
    const plane = this.plane()
    const parent = this.parent()
    const c = this.cloud(points.map((p) => toPlane(plane, p)))
    const local = c.points.map((q) => this.toLocal2(fromPlane(plane, q), parent))
    const layer = this.ctx.commit(() => ensureMarkupLayer(this.ctx.doc))
    this.commitNodes([newNode('polyline', { points: local, bulges: c.bulges, closed: true }, { parent, layer, color: MARKUP_COLOR, name: 'Revision cloud' })])
  }
}
