// draw.polyline — chained vertices with optional tangent arc segments ('A' toggles arc mode →
// DXF bulges). 'C' or clicking the first point closes the polyline.
import type { Vec2, Vec3 } from '@cadsandbox/doc'
import type { ToolOptionSpec } from '../types'
import { arcFromBulge, flattenPolyline, tangentBulge } from '../util/arcs'
import { ChainTool } from '../util/chain'
import { boolOption, newNode } from '../util/nodes'
import { fromPlane, toPlane, v2 } from '../util/vec'

export const POLYLINE_OPTIONS: ToolOptionSpec[] = [boolOption('arcMode', 'Arc segments (A)', false)]

export class PolylineTool extends ChainTool {
  readonly id = 'draw.polyline' as const
  override readonly specs = POLYLINE_OPTIONS
  /** bulges[i] belongs to segment points[i]→points[i+1] */
  private bulges: number[] = []
  private arcMode = false

  protected override start(): void {
    super.start()
    this.bulges = []
    this.arcMode = this.optBool('arcMode', false)
  }

  protected override optionsChanged(): void {
    this.arcMode = this.optBool('arcMode', false)
    this.updateHint()
  }

  protected override reset(): void {
    this.bulges = []
    super.reset()
  }

  protected override firstHint(): string {
    return 'Polyline: click the start point'
  }

  protected override nextHint(): string {
    return `${this.arcMode ? 'Arc' : 'Line'} segment: click the next point · A toggle arc · C close · Backspace undo · Enter finish`
  }

  protected override onKey(key: string, e: KeyboardEvent): boolean {
    if (key === 'a' || key === 'A') {
      this.arcMode = !this.arcMode
      this.options.arcMode = this.arcMode
      this.updateHint()
      this.clearAll()
      this.redraw()
      return true
    }
    return super.onKey(key, e)
  }

  protected override onBackspace(): boolean {
    if (!this.points.length) return false
    this.bulges.pop()
    return super.onBackspace()
  }

  protected override pointAdded(): void {
    const n = this.points.length
    if (n < 2) return
    this.bulges.push(this.bulgeFor(n - 2, this.uvPoints()[n - 1]))
  }

  private uvPoints(): Vec2[] {
    const plane = this.plane()
    return this.points.map((p) => toPlane(plane, p))
  }

  /** Bulge for the segment starting at vertex `i` ending at `end`, honoring arc mode and tangency. */
  private bulgeFor(i: number, end: Vec2): number {
    if (!this.arcMode) return 0
    const uv = this.uvPoints()
    const a = uv[i]
    const tangent = this.endTangent(i)
    if (!tangent) return 0
    return tangentBulge(a, end, tangent)
  }

  /** Tangent direction at vertex i (end tangent of the previous segment). */
  private endTangent(i: number): Vec2 | null {
    if (i === 0) return null
    const uv = this.uvPoints()
    const a = uv[i - 1],
      b = uv[i]
    const chord = v2.sub(b, a)
    if (v2.len(chord) < 1e-9) return null
    const bulge = this.bulges[i - 1] ?? 0
    if (Math.abs(bulge) < 1e-12) return v2.norm(chord)
    const theta = 4 * Math.atan(Math.abs(bulge))
    return v2.norm(v2.rotate(chord, Math.sign(bulge) * (theta / 2)))
  }

  protected override drawChain(points: Vec3[], cursor: Vec3 | null): void {
    const plane = this.plane()
    const uv = points.map((p) => toPlane(plane, p))
    const bulges = [...this.bulges]
    if (cursor && uv.length) {
      const c = toPlane(plane, cursor)
      bulges.push(this.bulgeFor(uv.length - 1, c))
      uv.push(c)
    }
    if (uv.length >= 2) {
      const flat = flattenPolyline(uv, bulges, false)
      this.lines(
        flat.map((p) => fromPlane(plane, p)),
        { style: 'rubber' },
      )
      if (cursor && points.length) {
        const last = uv[uv.length - 2],
          c = uv[uv.length - 1]
        const b = bulges[bulges.length - 1] ?? 0
        const arc = b ? arcFromBulge(last, c, b) : null
        const text = arc ? `R ${this.fmt(arc.radius)} · chord ${this.fmt(v2.dist(last, c))}` : this.fmt(v2.dist(last, c))
        this.label(fromPlane(plane, v2.mid(last, c)), text)
      }
    }
  }

  protected commitChain(points: Vec3[], closed: boolean): void {
    const parent = this.parent()
    const local = points.map((p) => this.toLocal2(p, parent))
    const bulges = this.bulges.slice(0, points.length - 1)
    while (bulges.length < points.length - 1) bulges.push(0)
    if (closed) bulges.push(0)
    const hasArcs = bulges.some((b) => Math.abs(b) > 1e-12)
    this.commitNodes([newNode('polyline', { points: local, closed, ...(hasArcs ? { bulges } : {}) }, { parent })])
    this.bulges = []
  }
}
