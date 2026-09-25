// annotate.markup — freehand redline pen for reviews: press, drag, release → one smoothed open
// polyline on the red 'Markup' layer (created on demand). annotate.cloud shares the layer helper.
import type { CadDocument, Vec2, Vec3 } from '@cadsandbox/doc'
import type { ToolOptionSpec, ToolPointerEvent } from '../types'
import { ToolBase, isPrimary } from '../util/base'
import { lengthOption, newNode, numberOption } from '../util/nodes'
import { fromPlane, toPlane, v2 } from '../util/vec'

export const MARKUP_LAYER_ID = 'layer-markup'
export const MARKUP_COLOR = '#ef4444'

/** Id of the red 'Markup' drafting layer, creating it when the document has none. */
export function ensureMarkupLayer(doc: CadDocument): string {
  if (doc.getLayer(MARKUP_LAYER_ID)) return MARKUP_LAYER_ID
  const byName = doc.listLayers().find((l) => l.name.trim().toLowerCase() === 'markup')
  if (byName) return byName.id
  return doc.addLayer({ id: MARKUP_LAYER_ID, name: 'Markup', color: MARKUP_COLOR, lineWeight: 0.35, printable: true })
}

export const MARKUP_OPTIONS: ToolOptionSpec[] = [
  numberOption('smoothing', 'Smoothing (passes)', 2, 0, 5),
  lengthOption('tolerance', 'Simplify tolerance', 0.01, 0),
]

/** Chaikin corner cutting for open strokes (end points stay fixed). */
export function smoothStroke(points: readonly Vec2[], passes: number): Vec2[] {
  let pts = points.slice()
  for (let k = 0; k < passes && pts.length > 2; k++) {
    const out: Vec2[] = [pts[0]!]
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]!, b = pts[i + 1]!
      out.push(v2.add(v2.scale(a, 0.75), v2.scale(b, 0.25)), v2.add(v2.scale(a, 0.25), v2.scale(b, 0.75)))
    }
    out.push(pts[pts.length - 1]!)
    pts = out
  }
  return pts
}

/** Douglas–Peucker simplification of an open polyline. */
export function simplifyStroke(points: readonly Vec2[], tol: number): Vec2[] {
  if (points.length < 3 || tol <= 0) return points.slice()
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length) {
    const [i0, i1] = stack.pop()!
    const a = points[i0]!, b = points[i1]!
    let best = -1, bestD = tol
    for (let i = i0 + 1; i < i1; i++) {
      const d = pointSegmentDist(points[i]!, a, b)
      if (d > bestD) {
        bestD = d
        best = i
      }
    }
    if (best > 0) {
      keep[best] = 1
      stack.push([i0, best], [best, i1])
    }
  }
  return points.filter((_, i) => keep[i] === 1)
}

function pointSegmentDist(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = v2.sub(b, a)
  const l2 = v2.dot(ab, ab)
  const t = l2 < 1e-18 ? 0 : Math.max(0, Math.min(1, v2.dot(v2.sub(p, a), ab) / l2))
  return v2.dist(p, v2.add(a, v2.scale(ab, t)))
}

export class MarkupTool extends ToolBase {
  readonly id = 'annotate.markup' as const
  override readonly specs = MARKUP_OPTIONS
  private stroke: Vec3[] = []
  private down = false

  protected override start(): void {
    this.hint('Markup pen: press and drag to draw a redline · release to finish the stroke')
    this.ctx.setCursor('crosshair')
  }
  protected override stop(): void {
    this.ctx.setCursor('default')
  }
  protected isBusy(): boolean {
    return this.down
  }
  protected reset(): void {
    this.stroke = []
    this.down = false
    this.clearAll()
  }

  onPointerDown(e: ToolPointerEvent): boolean {
    if (!isPrimary(e)) return false
    const p = this.planeHit(e)
    if (!p) return false
    this.down = true
    this.stroke = [p]
    return true
  }

  onPointerMove(e: ToolPointerEvent): void {
    if (!this.down) return
    const p = this.planeHit(e)
    if (!p) return
    const last = this.stroke[this.stroke.length - 1]!
    // one sample every ~2 px keeps strokes light before smoothing
    if (v2.dist(toPlane(this.plane(), p), toPlane(this.plane(), last)) < this.ctx.worldPerPixel(last) * 2) return
    this.stroke.push(p)
    this.clearPreview()
    this.lines(this.stroke, { style: 'rubber', color: MARKUP_COLOR })
  }

  onPointerUp(e: ToolPointerEvent): boolean {
    if (!this.down) return false
    const p = this.planeHit(e)
    if (p) this.stroke.push(p)
    this.down = false
    this.finish()
    return true
  }

  private finish(): void {
    const plane = this.plane()
    const raw = this.stroke.map((p) => toPlane(plane, p))
    this.stroke = []
    this.clearAll()
    if (raw.length < 2) return
    const tol = Math.max(this.optNum('tolerance', 0.01), this.ctx.worldPerPixel(fromPlane(plane, raw[0]!)) * 0.75)
    const pts = smoothStroke(simplifyStroke(raw, tol), Math.round(this.optNum('smoothing', 2)))
    if (pts.length < 2) return
    const parent = this.parent()
    const local = pts.map((q) => this.toLocal2(fromPlane(plane, q), parent))
    const layer = this.ctx.commit(() => ensureMarkupLayer(this.ctx.doc))
    this.commitNodes([newNode('polyline', { points: local, closed: false }, { parent, layer, color: MARKUP_COLOR, name: 'Markup' })], false)
  }
}
