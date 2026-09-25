// draw.pen — Figma/Spline pen: click = corner, drag = smooth Bézier handles. Clicking the first
// anchor closes the path → an extruded 'shape' (profile 'path', depth option) = Spline "Draw".
// Enter/double-click finishes an open path as a 'spline'.
import type { PathPoint, Vec2, Vec3 } from '@cadsandbox/doc'
import type { ToolOptionSpec, ToolPointerEvent } from '../types'
import { ToolBase, isPrimary } from '../util/base'
import { nodeTransformOnPlane } from '../util/frame'
import { boolOption, lengthOption, newNode } from '../util/nodes'
import { bounds2, signedArea } from '../util/polygon'
import { sampleContour } from '../util/scene'
import { fromPlane, toPlane, v2, v3 } from '../util/vec'

export const PEN_OPTIONS: ToolOptionSpec[] = [
  lengthOption('depth', 'Extrude depth', 0.1),
  boolOption('closeCreatesShape', 'Closing creates a 3D shape', true),
  lengthOption('bevel', 'Bevel', 0),
]

export class PenTool extends ToolBase {
  readonly id = 'draw.pen' as const
  override readonly specs = PEN_OPTIONS
  /** Anchors in plane UV coordinates. */
  private anchors: PathPoint[] = []
  private dragging: { index: number; downAt: Vec2 } | null = null
  private cursor: Vec2 | null = null

  protected override start(): void {
    this.anchors = []
    this.dragging = null
    this.hint('Pen: click to add a corner, drag to pull out smooth handles · click the first point to close')
  }
  protected isBusy(): boolean {
    return this.anchors.length > 0
  }
  protected reset(): void {
    this.anchors = []
    this.dragging = null
    this.cursor = null
    this.clearAll()
    this.clearInput()
    this.hint('Pen: click to add a corner, drag to pull out smooth handles · click the first point to close')
  }

  private lastWorld(): Vec3 | null {
    const a = this.anchors[this.anchors.length - 1]
    return a ? fromPlane(this.plane(), a.p) : null
  }

  onPointerDown(e: ToolPointerEvent): boolean {
    if (!isPrimary(e)) return false
    const s = this.snap(e, this.lastWorld())
    const uv = toPlane(this.plane(), s.point)
    if (this.anchors.length >= 3 && this.nearFirst(s.point)) {
      this.finish(true)
      return true
    }
    this.anchors.push({ p: uv })
    this.dragging = { index: this.anchors.length - 1, downAt: uv }
    this.redraw()
    this.hint('Drag to shape the curve, release for a corner · Backspace removes the last anchor · Enter finishes')
    return true
  }

  onPointerMove(e: ToolPointerEvent): void {
    this.clearAll()
    if (this.dragging) {
      const hit = this.ctx.rayPlane(e, this.plane())
      if (hit) {
        const uv = toPlane(this.plane(), hit)
        const a = this.anchors[this.dragging.index]
        const px = this.ctx.worldPerPixel(hit)
        if (v2.dist(uv, a.p) > 3 * px) {
          a.ho = uv
          a.hi = v2.sub(v2.scale(a.p, 2), uv)
        } else {
          delete a.ho
          delete a.hi
        }
      }
      this.redraw()
      return
    }
    const s = this.snap(e, this.lastWorld())
    this.cursor = toPlane(this.plane(), s.point)
    this.redraw()
  }

  onPointerUp(e: ToolPointerEvent): boolean {
    if (!this.dragging) return false
    this.dragging = null
    this.clearAll()
    const hit = this.ctx.rayPlane(e, this.plane())
    if (hit) this.cursor = toPlane(this.plane(), hit)
    this.redraw()
    return true
  }

  onDoubleClick(): boolean {
    this.finish(false)
    return true
  }
  override onConfirm(): void {
    this.finish(false)
  }
  override onCancel(): boolean {
    if (!this.anchors.length) return false
    if (this.anchors.length >= 2) this.finish(false)
    else this.reset()
    return true
  }
  protected override onBackspace(): boolean {
    if (!this.anchors.length) return false
    this.anchors.pop()
    this.clearAll()
    this.redraw()
    return true
  }
  protected override onKey(key: string): boolean {
    if ((key === 'c' || key === 'C') && this.anchors.length >= 3) {
      this.finish(true)
      return true
    }
    return false
  }

  private nearFirst(world: Vec3): boolean {
    const first = this.anchors[0]
    if (!first) return false
    const fw = fromPlane(this.plane(), first.p)
    return v3.dist(fw, world) <= 8 * this.ctx.worldPerPixel(fw)
  }

  private redraw(): void {
    const plane = this.plane()
    const pts: PathPoint[] = this.anchors.map((a) => ({ ...a }))
    if (this.cursor && !this.dragging && pts.length) pts.push({ p: this.cursor })
    if (pts.length >= 2) {
      const sampled = sampleContour({ points: pts, closed: false }, 12)
      this.lines(
        sampled.map((p) => fromPlane(plane, p)),
        { style: 'rubber' },
      )
    }
    for (const a of this.anchors) {
      const w = fromPlane(plane, a.p)
      this.marker(w, 'vertex')
      if (a.hi && a.ho) this.lines([fromPlane(plane, a.hi), w, fromPlane(plane, a.ho)], { style: 'guide' })
    }
    if (this.anchors.length >= 3) {
      const area = Math.abs(signedArea(sampleContour({ points: this.anchors, closed: true }, 8)))
      this.input('Depth', this.fmt(this.optNum('depth', 0.1)), `area ${area.toFixed(2)} m²`)
    }
  }

  onInput(text: string): void {
    const d = this.ctx.parseLength(text)
    if (d === null) return void this.ctx.notify('warning', `Cannot read "${text}"`)
    this.options.depth = d
    if (this.anchors.length >= 3) this.finish(true)
  }

  private finish(closed: boolean): void {
    const anchors = this.anchors
    this.clearAll()
    this.clearInput()
    this.anchors = []
    this.dragging = null
    this.cursor = null
    if (anchors.length < 2) return
    const parent = this.parent()
    const plane = this.plane()
    const mapPoint = (uv: Vec2): Vec2 => this.toLocal2(fromPlane(plane, uv), parent)
    if (closed && this.optBool('closeCreatesShape', true) && anchors.length >= 3) {
      const sampled = sampleContour({ points: anchors, closed: true }, 8)
      const bb = bounds2(sampled)!
      const center: Vec2 = [(bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2]
      const rel = (uv: Vec2): Vec2 => [uv[0] - center[0], uv[1] - center[1]]
      const contour = {
        closed: true,
        points: anchors.map((a) => ({ p: rel(a.p), ...(a.hi ? { hi: rel(a.hi) } : {}), ...(a.ho ? { ho: rel(a.ho) } : {}) })),
      }
      const t = nodeTransformOnPlane(this.ctx, parent, plane, center)
      this.commitNodes([
        newNode(
          'shape',
          {
            profile: 'path',
            width: bb.max[0] - bb.min[0],
            height: bb.max[1] - bb.min[1],
            depth: Math.max(0, this.optNum('depth', 0.1)),
            bevel: Math.max(0, this.optNum('bevel', 0)),
            bevelSegments: 3,
            direction: 'up',
            path: { contours: [contour] },
          },
          { parent, t, name: 'Shape' },
        ),
      ])
    } else {
      const contour = {
        closed,
        points: anchors.map((a) => ({ p: mapPoint(a.p), ...(a.hi ? { hi: mapPoint(a.hi) } : {}), ...(a.ho ? { ho: mapPoint(a.ho) } : {}) })),
      }
      this.commitNodes([newNode('spline', { path: { contours: [contour] } }, { parent })])
    }
    this.hint('Pen: click to add a corner, drag to pull out smooth handles · click the first point to close')
  }
}
