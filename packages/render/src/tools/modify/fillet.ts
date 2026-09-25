// modify.fillet — round (or chamfer) the corner between two lines, or a polyline vertex.
// Radius 0 = sharp corner (lines are trimmed/extended to meet). Typed value sets the radius.
import type { AnyNode, NodeBase, Vec2 } from '@cadsandbox/doc'
import type { ToolOptionSpec, ToolPointerEvent } from '../types'
import { arcFromCenterStartEnd, bulgeFromArc, sampleArc, type ArcDef } from '../util/arcs'
import { ToolBase, isPrimary } from '../util/base'
import { boolOption, lengthOption } from '../util/nodes'
import { lineIntersection } from '../util/polygon'
import { nearestCurve, nodeToParent2, parentToNode2 } from '../util/scene'
import { v2 } from '../util/vec'

export const FILLET_OPTIONS: ToolOptionSpec[] = [
  lengthOption('radius', 'Radius (0 = sharp corner)', 0),
  boolOption('chamfer', 'Chamfer', false),
  lengthOption('chamferDistance', 'Chamfer distance', 0.1, 0.001),
]

type LineNode = NodeBase<'line'>

interface LinePick {
  node: LineNode
  /** Parent-local click point */
  point: Vec2
}

export interface CornerGeometry {
  corner: Vec2
  /** Unit directions from the corner toward the kept part of each line */
  u1: Vec2
  u2: Vec2
  /** Tangent points (equal to the corner for r = 0) */
  t1: Vec2
  t2: Vec2
  arc: ArcDef | null
  chamfer: boolean
}

/** Corner between two parent-space lines with click points selecting the kept portions. */
export function cornerGeometry(l1: { a: Vec2; b: Vec2; click: Vec2 }, l2: { a: Vec2; b: Vec2; click: Vec2 }, radius: number, chamfer: boolean, chamferDist: number): CornerGeometry | null {
  const corner = lineIntersection({ a: l1.a, b: l1.b }, { a: l2.a, b: l2.b })
  if (!corner) return null
  const keepDir = (l: { a: Vec2; b: Vec2; click: Vec2 }): Vec2 => {
    const d = v2.norm(v2.sub(l.b, l.a))
    return v2.dot(v2.sub(l.click, corner), d) >= 0 ? d : v2.scale(d, -1)
  }
  const u1 = keepDir(l1),
    u2 = keepDir(l2)
  const cosT = Math.max(-1, Math.min(1, v2.dot(u1, u2)))
  const theta = Math.acos(cosT)
  if (theta < 1e-6 || Math.abs(theta - Math.PI) < 1e-6) return null
  if (chamfer) {
    const t = chamferDist
    return { corner, u1, u2, t1: v2.add(corner, v2.scale(u1, t)), t2: v2.add(corner, v2.scale(u2, t)), arc: null, chamfer: true }
  }
  if (radius <= 1e-9) return { corner, u1, u2, t1: corner, t2: corner, arc: null, chamfer: false }
  const t = radius / Math.tan(theta / 2)
  const t1 = v2.add(corner, v2.scale(u1, t))
  const t2 = v2.add(corner, v2.scale(u2, t))
  const bis = v2.norm(v2.add(u1, u2))
  const center = v2.add(corner, v2.scale(bis, radius / Math.sin(theta / 2)))
  const ccw = v2.cross(v2.sub(t1, center), v2.sub(t2, center)) > 0
  return { corner, u1, u2, t1, t2, arc: arcFromCenterStartEnd(center, t1, t2, ccw), chamfer: false }
}

export class FilletTool extends ToolBase {
  readonly id = 'modify.fillet' as const
  override readonly specs = FILLET_OPTIONS
  private first: LinePick | null = null

  protected override start(): void {
    this.first = null
    this.hint('Fillet: click the first line (or a polyline vertex) · type the radius')
  }
  protected isBusy(): boolean {
    return this.first !== null
  }
  protected reset(): void {
    this.first = null
    this.clearAll()
    this.clearInput()
    this.hint('Fillet: click the first line (or a polyline vertex) · type the radius')
  }

  private radius(): number {
    return Math.max(0, this.optNum('radius', 0))
  }

  private pickAt(e: ToolPointerEvent): { node: AnyNode; point: Vec2 } | null {
    const hit = this.ctx.pick(e, (n) => n.type === 'line' || n.type === 'polyline')
    if (!hit) return null
    const node = this.ctx.node(hit.nodeId) as AnyNode | undefined
    if (!node || (node.type !== 'line' && node.type !== 'polyline') || this.ctx.doc.isEffectivelyLocked(node.id)) return null
    const local = this.ctx.toLocal(node.parent, hit.point)
    return { node, point: [local[0], local[1]] }
  }

  private lineInParent(n: LineNode): { a: Vec2; b: Vec2 } {
    const toP = nodeToParent2(n)
    return { a: toP(n.params.a), b: toP(n.params.b) }
  }

  private geometry(second: LinePick): CornerGeometry | null {
    const f = this.first!
    if (f.node.id === second.node.id || f.node.parent !== second.node.parent) return null
    const l1 = this.lineInParent(f.node),
      l2 = this.lineInParent(second.node)
    return cornerGeometry({ ...l1, click: f.point }, { ...l2, click: second.point }, this.radius(), this.optBool('chamfer', false), this.optNum('chamferDistance', 0.1))
  }

  private drawCorner(parent: string | null, g: CornerGeometry): void {
    const W = (p: Vec2) => this.ctx.toWorld(parent, [p[0], p[1], 0])
    if (g.arc) this.lines(sampleArc(g.arc).map(W), { style: 'rubber' })
    else if (g.chamfer) this.lines([W(g.t1), W(g.t2)], { style: 'rubber' })
    else this.marker(W(g.corner), 'intersection')
    this.lines([W(g.t1), W(g.corner), W(g.t2)], { style: 'guide', dashed: true })
  }

  onPointerMove(e: ToolPointerEvent): void {
    this.clearAll()
    const p = this.pickAt(e)
    this.ctx.setCursor(p ? 'pointer' : 'default')
    if (!p) return
    if (this.first && p.node.type === 'line') {
      const g = this.geometry({ node: p.node, point: p.point })
      if (g) this.drawCorner(p.node.parent, g)
    } else if (!this.first && p.node.type === 'polyline') {
      const v = this.polylineVertex(p.node, p.point)
      if (v) this.marker(this.ctx.toWorld(p.node.parent, [v.point[0], v.point[1], 0]), 'vertex')
    }
    this.input('Radius', this.fmt(this.radius()))
  }

  onPointerDown(e: ToolPointerEvent): boolean {
    if (!isPrimary(e)) return false
    const p = this.pickAt(e)
    if (!p) return true
    if (p.node.type === 'polyline') {
      const v = this.polylineVertex(p.node, p.point)
      if (v) this.filletPolyline(p.node, v.index)
      else this.ctx.notify('info', 'Click near a polyline vertex to fillet it')
      return true
    }
    if (p.node.type !== 'line') return true
    const line: LineNode = p.node
    if (!this.first) {
      this.first = { node: line, point: p.point }
      this.hint('Click the second line · type the radius')
      return true
    }
    const g = this.geometry({ node: line, point: p.point })
    if (!g) {
      this.ctx.notify('warning', 'Lines are parallel or not in the same group')
      return true
    }
    this.applyLines(this.first.node, line, g)
    return true
  }

  onInput(text: string): void {
    const r = this.ctx.parseLength(text)
    if (r === null) return void this.ctx.notify('warning', `Cannot read "${text}"`)
    this.options.radius = Math.max(0, r)
    this.hint(`Radius ${this.fmt(this.options.radius as number)} · ${this.first ? 'click the second line' : 'click the first line'}`)
  }

  private applyLines(n1: LineNode, n2: LineNode, g: CornerGeometry): void {
    this.clearAll()
    this.clearInput()
    this.first = null
    const doc = this.ctx.doc
    const patchEnd = (n: LineNode, u: Vec2, tangent: Vec2) => {
      // The endpoint on the far side of the corner (opposite to the kept direction) moves to the tangent point.
      const l = this.lineInParent(n)
      const toN = parentToNode2(n)
      const keepB = v2.dot(v2.sub(l.b, g.corner), u) >= v2.dot(v2.sub(l.a, g.corner), u)
      return keepB ? { a: toN(tangent) } : { b: toN(tangent) }
    }
    const ids = this.ctx.commit(() => {
      doc.updateNode(n1.id, { params: patchEnd(n1, g.u1, g.t1) })
      doc.updateNode(n2.id, { params: patchEnd(n2, g.u2, g.t2) })
      const out = [n1.id, n2.id]
      if (g.arc) {
        out.push(
          doc.addNode({
            type: 'arc',
            parent: n1.parent,
            layer: n1.layer,
            color: n1.color,
            name: 'Fillet',
            t: { p: [g.arc.center[0], g.arc.center[1], n1.t.p[2]], r: [0, 0, 0, 1], s: [1, 1, 1] },
            params: { radius: g.arc.radius, start: g.arc.start, end: g.arc.end },
          }),
        )
      } else if (g.chamfer) {
        out.push(doc.addNode({ type: 'line', parent: n1.parent, layer: n1.layer, color: n1.color, name: 'Chamfer', params: { a: g.t1, b: g.t2 } }))
      }
      return out
    })
    this.ctx.editor.select(ids)
    this.ctx.requestRender()
    this.hint('Fillet applied · click the first line of the next corner')
  }

  private polylineVertex(node: NodeBase<'polyline'>, p: Vec2): { index: number; point: Vec2 } | null {
    const toP = nodeToParent2(node)
    const tol = 12 * this.ctx.worldPerPixel(this.ctx.toWorld(node.parent, [p[0], p[1], 0]))
    const n = node.params.points.length
    let best: { index: number; point: Vec2; d: number } | null = null
    for (let i = 0; i < n; i++) {
      if (!node.params.closed && (i === 0 || i === n - 1)) continue
      const q = toP(node.params.points[i])
      const d = v2.dist(q, p)
      if (d <= tol && (!best || d < best.d)) best = { index: i, point: q, d }
    }
    return best ? { index: best.index, point: best.point } : null
  }

  private filletPolyline(node: NodeBase<'polyline'>, index: number): void {
    const r = this.radius()
    const pts = node.params.points
    const n = pts.length
    const prev = pts[(index + n - 1) % n],
      v = pts[index],
      next = pts[(index + 1) % n]
    const u1 = v2.norm(v2.sub(prev, v)),
      u2 = v2.norm(v2.sub(next, v))
    const theta = Math.acos(Math.max(-1, Math.min(1, v2.dot(u1, u2))))
    if (theta < 1e-6 || Math.abs(theta - Math.PI) < 1e-6) return
    const chamfer = this.optBool('chamfer', false)
    const t = chamfer ? this.optNum('chamferDistance', 0.1) : r / Math.tan(theta / 2)
    if (t <= 1e-9) return void this.ctx.notify('info', 'Set a radius first (type a value)')
    if (t >= v2.dist(v, prev) || t >= v2.dist(v, next)) return void this.ctx.notify('warning', 'Radius too large for this corner')
    const t1 = v2.add(v, v2.scale(u1, t)),
      t2 = v2.add(v, v2.scale(u2, t))
    let bulge = 0
    if (!chamfer) {
      const bis = v2.norm(v2.add(u1, u2))
      const center = v2.add(v, v2.scale(bis, r / Math.sin(theta / 2)))
      const ccw = v2.cross(v2.sub(t1, center), v2.sub(t2, center)) > 0
      bulge = bulgeFromArc(t1, t2, arcFromCenterStartEnd(center, t1, t2, ccw))
    }
    const newPts = [...pts.slice(0, index), t1, t2, ...pts.slice(index + 1)]
    const oldB = node.params.bulges ?? new Array(n).fill(0)
    const newB = [...oldB.slice(0, index), bulge, ...oldB.slice(index)]
    // segment before the vertex keeps its bulge (oldB[index-1]); the new t1→t2 segment gets `bulge`
    this.ctx.commit(() => this.ctx.doc.updateNode(node.id, { params: { points: newPts, bulges: newB.some((b) => b) ? newB : undefined } }))
    this.ctx.requestRender()
    this.hint('Vertex filleted · click another vertex or line')
  }
}
