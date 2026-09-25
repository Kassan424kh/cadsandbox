// annotate.dimension — linear / aligned (2 points + offset), angular (vertex + 2 points + offset),
// radius / diameter (click a circle/arc or center + point). Hovering a wall face or a line and
// clicking auto-picks both end points; the next click sets the offset. Creates a 'dimension' node.
import type { AnyNode, DimensionKind, DimensionParams, Vec2, Vec3 } from '@cadsandbox/doc'
import type { ToolOptionSpec, ToolPointerEvent } from '../types'
import { ToolBase, isPrimary } from '../util/base'
import { DEFAULT_DIM_STYLE, dimensionDrawing, dimensionValue } from '../util/dimension'
import { formatAngleDeg } from '../util/input'
import { LAYERS, lengthOption, newNode, selectOption } from '../util/nodes'
import { closestPointOnSegment, signedLineDistance } from '../util/polygon'
import { entityCurves } from '../util/scene'
import { toPlane, v2, v3 } from '../util/vec'
import { wallFaces } from '../util/walls'

const KINDS: DimensionKind[] = ['linear', 'aligned', 'angular', 'radius', 'diameter']

export const DIMENSION_OPTIONS: ToolOptionSpec[] = [
  selectOption('kind', 'Kind', 'aligned', KINDS),
  lengthOption('textSize', 'Text size', 0.2, 0.01),
  { key: 'associative', label: 'Associative (follow objects)', kind: 'boolean', default: true },
]

interface Picked {
  /** World points */
  points: Vec3[]
  refs?: DimensionParams['refs']
}

export class DimensionTool extends ToolBase {
  readonly id = 'annotate.dimension' as const
  override readonly specs = DIMENSION_OPTIONS
  /** World points collected so far (linear/aligned: p1,p2; angular: vertex,p1,p2; radius: center,on) */
  private pts: Vec3[] = []
  private refs: DimensionParams['refs'] = []
  private cursor: Vec3 | null = null

  protected override start(): void {
    this.pts = []
    this.refs = []
    this.hint(this.stepHint())
  }
  protected isBusy(): boolean {
    return this.pts.length > 0
  }
  protected reset(): void {
    this.pts = []
    this.refs = []
    this.cursor = null
    this.clearAll()
    this.clearInput()
    this.hint(this.stepHint())
  }
  protected override optionsChanged(): void {
    this.reset()
  }

  private kind(): DimensionKind {
    return this.optStr<DimensionKind>('kind', 'aligned', KINDS)
  }
  private needed(): number {
    return this.kind() === 'angular' ? 3 : 2
  }
  private stepHint(): string {
    const k = this.kind()
    const n = this.pts.length
    if (k === 'radius' || k === 'diameter') return n === 0 ? 'Click a circle or arc (or its center)' : 'Click a point on the circle'
    if (k === 'angular') return ['Angular dimension: click the vertex', 'Click a point on the first leg', 'Click a point on the second leg', 'Click to place the arc'][n] ?? ''
    return ['Dimension: click the first point · or click a wall face / line to dimension it', 'Click the second point', 'Click to place the dimension line · type the offset'][n] ?? ''
  }

  /** Auto-dimension: end points of a hovered wall face or drafting edge. */
  private autoPick(e: ToolPointerEvent): Picked | null {
    const hit = this.ctx.pick(e, (n) => n.type === 'wall' || n.type === 'line' || n.type === 'polyline' || n.type === 'rect' || n.type === 'slab')
    if (!hit) return null
    const node = this.ctx.node(hit.nodeId) as AnyNode | undefined
    if (!node) return null
    const local = this.ctx.toLocal(node.parent, hit.point)
    const p: Vec2 = [local[0], local[1]]
    const W = (q: Vec2): Vec3 => this.ctx.toWorld(node.parent, [q[0], q[1], local[2]])
    if (node.type === 'wall') {
      const faces = wallFaces(node.params)
      const side = hit.wallSide ?? (signedLineDistance(p, node.params.a, node.params.b) >= 0 ? 'left' : 'right')
      const f = side === 'left' ? faces.left : faces.right
      return { points: [W(f.a), W(f.b)], refs: [{ node: node.id, anchor: `${side}-a` }, { node: node.id, anchor: `${side}-b` }] }
    }
    if (node.type === 'line') return { points: [W(node.params.a), W(node.params.b)], refs: [{ node: node.id, anchor: 'a' }, { node: node.id, anchor: 'b' }] }
    // nearest straight edge of a polyline/rect/slab outline
    let best: { a: Vec2; b: Vec2; d: number } | null = null
    entityCurves(node).forEach((c) => {
      if (c.kind !== 'seg') return
      const d = v2.dist(p, closestPointOnSegment(p, c.a, c.b))
      if (!best || d < best.d) best = { a: c.a, b: c.b, d }
    })
    const edge = best as { a: Vec2; b: Vec2; d: number } | null
    return edge ? { points: [W(edge.a), W(edge.b)] } : null
  }

  private pickCircle(e: ToolPointerEvent): Picked | null {
    const hit = this.ctx.pick(e, (n) => n.type === 'circle' || n.type === 'arc')
    if (!hit) return null
    const node = this.ctx.node(hit.nodeId) as AnyNode | undefined
    if (!node || (node.type !== 'circle' && node.type !== 'arc')) return null
    const center = this.ctx.toWorld(node.parent, node.t.p)
    const r = node.params.radius
    const d = v3.sub(hit.point, center)
    const dl = Math.hypot(d[0], d[1])
    const on: Vec3 = dl > 1e-9 ? [center[0] + (d[0] / dl) * r, center[1] + (d[1] / dl) * r, center[2]] : [center[0] + r, center[1], center[2]]
    return { points: [center, on], refs: [{ node: node.id, anchor: 'center' }, { node: node.id, anchor: 'radius' }] }
  }

  onPointerDown(e: ToolPointerEvent): boolean {
    if (!isPrimary(e)) return false
    const k = this.kind()
    if (this.pts.length === 0) {
      const picked = k === 'radius' || k === 'diameter' ? this.pickCircle(e) : k === 'angular' ? null : this.autoPick(e)
      if (picked) {
        this.pts = picked.points
        this.refs = this.optBool('associative', true) && picked.refs ? picked.refs : []
        this.clearAll()
        if (k === 'radius' || k === 'diameter') return this.commit(0), true
        this.hint(this.stepHint())
        return true
      }
    }
    const s = this.snap(e, this.pts[this.pts.length - 1] ?? null)
    if (this.pts.length < this.needed()) {
      this.pts.push(s.point)
      this.clearAll()
      if ((k === 'radius' || k === 'diameter') && this.pts.length === 2) return this.commit(0), true
      this.hint(this.stepHint())
      this.redraw()
      return true
    }
    this.commit(this.offsetFor(s.point))
    return true
  }

  onPointerMove(e: ToolPointerEvent): void {
    this.clearAll()
    const s = this.snap(e, this.pts[this.pts.length - 1] ?? null)
    this.cursor = s.point
    this.redraw()
  }

  onInput(text: string): void {
    if (this.pts.length < this.needed()) return void this.ctx.notify('info', 'Pick the measured points first, then type the offset')
    const d = this.ctx.parseLength(text)
    if (d === null) return void this.ctx.notify('warning', `Cannot read "${text}"`)
    const cur = this.cursor ? this.offsetFor(this.cursor) : 1
    this.commit(Math.abs(d) * (cur < 0 ? -1 : 1))
  }

  /** Signed offset for a pointer position (plane space). */
  private offsetFor(world: Vec3): number {
    const plane = this.plane()
    const k = this.kind()
    const uv = this.pts.map((p) => toPlane(plane, p))
    const c = toPlane(plane, world)
    if (k === 'angular') return v2.dist(c, uv[0])
    const dir = this.dimDirection(uv, c)
    const n = v2.perp(dir)
    return v2.dot(v2.sub(c, uv[0]), n)
  }

  /** Measurement direction (aligned: p1→p2; linear: axis chosen from where the offset is dragged). */
  private dimDirection(uv: Vec2[], cursor: Vec2 | null): Vec2 {
    if (this.kind() === 'aligned') {
      const d = v2.sub(uv[1], uv[0])
      return v2.len(d) < 1e-9 ? [1, 0] : v2.norm(d)
    }
    return this.linearAxis(uv, cursor) === 'x' ? [1, 0] : [0, 1]
  }

  private linearAxis(uv: Vec2[], cursor: Vec2 | null): 'x' | 'y' {
    if (cursor) {
      const mid = v2.mid(uv[0], uv[1])
      const d = v2.sub(cursor, mid)
      // Dragging away vertically → horizontal dimension line → measures X.
      return Math.abs(d[1]) >= Math.abs(d[0]) ? 'x' : 'y'
    }
    return Math.abs(uv[1][0] - uv[0][0]) >= Math.abs(uv[1][1] - uv[0][1]) ? 'x' : 'y'
  }

  private params(offset: number, cursor: Vec2 | null): DimensionParams {
    const plane = this.plane()
    const parent = this.parent()
    const k = this.kind()
    const uv = this.pts.map((p) => toPlane(plane, p))
    const p: DimensionParams = {
      kind: k,
      points: this.pts.map((w) => this.toLocal(w, parent)),
      offset,
    }
    if (k === 'linear') p.axis = this.linearAxis(uv, cursor)
    if (this.refs?.length) p.refs = this.refs
    return p
  }

  private redraw(): void {
    const plane = this.plane()
    if (!this.pts.length) return
    const k = this.kind()
    if (this.pts.length < this.needed()) {
      const pts = this.cursor ? [...this.pts, this.cursor] : this.pts
      if (pts.length >= 2) this.lines(pts, { style: 'rubber' })
      if (pts.length === 2 && k !== 'angular') this.distanceLabel(pts[0], pts[1])
      return
    }
    const offset = this.cursor ? this.offsetFor(this.cursor) : 0.5
    const cursorUV = this.cursor ? toPlane(plane, this.cursor) : null
    const params = this.params(offset, cursorUV)
    // Preview in plane space (points relative to plane origin).
    const previewParams: DimensionParams = { ...params, points: this.pts.map((w) => [...toPlane(plane, w), 0] as Vec3) }
    this.drawing(dimensionDrawing(previewParams, this.style()), plane)
    const value = dimensionValue(previewParams)
    const text = k === 'angular' ? formatAngleDeg(value) : this.fmt(value)
    this.input('Offset', this.fmt(Math.abs(offset)), text)
  }

  private style() {
    return { ...DEFAULT_DIM_STYLE, textSize: this.optNum('textSize', 0.2), format: (m: number) => this.ctx.formatLength(m), formatAngle: formatAngleDeg }
  }

  private commit(offset: number): void {
    const cursorUV = this.cursor ? toPlane(this.plane(), this.cursor) : null
    const params = this.params(offset, cursorUV)
    this.clearAll()
    this.clearInput()
    this.commitNodes([newNode('dimension', params, { parent: this.parent(), layer: LAYERS.dims, name: 'Dimension' })])
    this.pts = []
    this.refs = []
    this.hint(this.stepHint())
  }
}
