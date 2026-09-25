// draw.spline — click control points, the curve passes through them (Catmull-Rom → cubic Bézier
// handles). 'C' closes. Creates a 'spline' node with PathData in parent-local XY.
import type { Contour, PathPoint, Vec2, Vec3 } from '@cadsandbox/doc'
import type { ToolOptionSpec } from '../types'
import { ChainTool } from '../util/chain'
import { newNode, numberOption } from '../util/nodes'
import { sampleContour } from '../util/scene'
import { fromPlane, toPlane, v2 } from '../util/vec'

export const SPLINE_OPTIONS: ToolOptionSpec[] = [numberOption('tension', 'Tension', 0.5, 0, 1)]

/** Interpolating contour through `points` (Catmull-Rom tangents, tension 0.5 = classic). */
export function interpolatingContour(points: readonly Vec2[], closed: boolean, tension = 0.5): Contour {
  const n = points.length
  const pts: PathPoint[] = []
  const k = (1 - tension) * (2 / 3) + tension * (1 / 3) // handle length factor (0.5 → 1/2)
  for (let i = 0; i < n; i++) {
    const p = points[i]
    let prev: Vec2 | null = null
    let next: Vec2 | null = null
    if (closed) {
      prev = points[(i + n - 1) % n]
      next = points[(i + 1) % n]
    } else {
      prev = i > 0 ? points[i - 1] : null
      next = i < n - 1 ? points[i + 1] : null
    }
    const pp: PathPoint = { p: [p[0], p[1]] }
    if (n < 3 && !closed) {
      pts.push(pp)
      continue
    }
    const t: Vec2 = prev && next ? v2.scale(v2.sub(next, prev), 0.5) : next ? v2.sub(next, p) : prev ? v2.sub(p, prev) : [0, 0]
    const h = v2.scale(t, k * 0.5)
    if (prev || closed) pp.hi = v2.sub(p, h)
    if (next || closed) pp.ho = v2.add(p, h)
    pts.push(pp)
  }
  return { points: pts, closed }
}

export class SplineTool extends ChainTool {
  readonly id = 'draw.spline' as const
  override readonly specs = SPLINE_OPTIONS

  protected override firstHint(): string {
    return 'Spline: click the first point'
  }
  protected override nextHint(): string {
    return 'Click the next point · Backspace undo · C close · Enter finish'
  }

  protected override drawChain(points: Vec3[], cursor: Vec3 | null): void {
    const plane = this.plane()
    const uv = points.map((p) => toPlane(plane, p))
    if (cursor) uv.push(toPlane(plane, cursor))
    if (uv.length < 2) return
    const c = interpolatingContour(uv, false, this.optNum('tension', 0.5))
    this.lines(
      sampleContour(c, 10).map((p) => fromPlane(plane, p)),
      { style: 'rubber' },
    )
    if (cursor && points.length) this.distanceLabel(points[points.length - 1], cursor)
  }

  protected commitChain(points: Vec3[], closed: boolean): void {
    const parent = this.parent()
    const local = points.map((p) => this.toLocal2(p, parent))
    const contour = interpolatingContour(local, closed, this.optNum('tension', 0.5))
    this.commitNodes([newNode('spline', { path: { contours: [contour] } }, { parent })])
  }
}
