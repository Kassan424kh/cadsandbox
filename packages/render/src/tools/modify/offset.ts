// modify.offset — click a 2D curve (line, polyline, rect, circle, arc, ellipse, spline, wall/slab
// outline), then click the side / distance or type it → parallel copy (or move the original).
import type { AnyNode, NewNode, NodePatch, Vec2 } from '@cadsandbox/doc'
import { makeNode } from '@cadsandbox/doc'
import type { ToolOptionSpec, ToolPointerEvent } from '../types'
import { flattenPolyline } from '../util/arcs'
import { ToolBase, isPrimary } from '../util/base'
import { lengthOption, selectOption } from '../util/nodes'
import { offsetPolyline, pointInPolygon, signedLineDistance } from '../util/polygon'
import { entityOutline, entitySegments, nearestCurve, samplePath } from '../util/scene'
import { v2 } from '../util/vec'

export const OFFSET_OPTIONS: ToolOptionSpec[] = [
  lengthOption('distance', 'Distance (0 = by pointer)', 0),
  selectOption('mode', 'Result', 'copy', [
    { value: 'copy', label: 'Copy' },
    { value: 'move', label: 'Move original' },
  ]),
]

const OFFSETTABLE: AnyNode['type'][] = ['line', 'polyline', 'rect', 'circle', 'arc', 'ellipse', 'spline', 'wall', 'slab', 'room', 'hatch']

export interface OffsetResult {
  /** New node to add (copy mode) */
  add?: NewNode
  /** Patch for the original (move mode) */
  patch?: NodePatch
}

/** Offset geometry of a node by signed distance d (positive = left of travel / outward for closed). */
export function offsetEntity(node: AnyNode, d: number, move: boolean): OffsetResult | null {
  const base = { parent: node.parent, layer: node.layer, material: node.material, color: node.color, name: node.name }
  switch (node.type) {
    case 'line': {
      const dir = v2.sub(node.params.b, node.params.a)
      if (v2.len(dir) < 1e-9) return null
      const n = v2.scale(v2.perp(v2.norm(dir)), d)
      const params = { a: v2.add(node.params.a, n), b: v2.add(node.params.b, n) }
      return move ? { patch: { params } } : { add: { type: 'line', ...base, t: node.t, params } }
    }
    case 'polyline': {
      const { points, bulges, closed } = node.params
      const hasArcs = bulges?.some((b) => Math.abs(b) > 1e-12)
      const src = hasArcs ? flattenPolyline(points, bulges, closed) : points
      const out = offsetPolyline(src, d, closed)
      const params = { points: out, closed, bulges: undefined }
      return move ? { patch: { params } } : { add: { type: 'polyline', ...base, t: node.t, params: { points: out, closed } } }
    }
    case 'rect': {
      const width = node.params.width + 2 * d
      const height = node.params.height + 2 * d
      if (width <= 1e-6 || height <= 1e-6) return null
      const cr = node.params.cornerRadius ? Math.max(0, node.params.cornerRadius + d) : 0
      const params = { width, height, cornerRadius: cr }
      return move ? { patch: { params } } : { add: { type: 'rect', ...base, t: node.t, params } }
    }
    case 'circle': {
      const radius = node.params.radius + d
      if (radius <= 1e-6) return null
      return move ? { patch: { params: { radius } } } : { add: { type: 'circle', ...base, t: node.t, params: { radius } } }
    }
    case 'arc': {
      const radius = node.params.radius + d
      if (radius <= 1e-6) return null
      return move ? { patch: { params: { radius } } } : { add: { type: 'arc', ...base, t: node.t, params: { ...node.params, radius } } }
    }
    case 'ellipse': {
      const rx = node.params.rx + d,
        ry = node.params.ry + d
      if (rx <= 1e-6 || ry <= 1e-6) return null
      return move ? { patch: { params: { rx, ry } } } : { add: { type: 'ellipse', ...base, t: node.t, params: { rx, ry } } }
    }
    case 'spline': {
      const c = samplePath(node.params.path)[0]
      if (!c) return null
      const out = offsetPolyline(c.points, d, c.closed)
      return { add: { type: 'polyline', ...base, t: node.t, params: { points: out, closed: c.closed } } }
    }
    default: {
      const outline = entityOutline(node)
      if (!outline) return null
      const out = offsetPolyline(outline, d, true)
      return { add: { type: 'polyline', ...base, name: `${node.name} offset`, params: { points: out, closed: true } } }
    }
  }
}

export class OffsetTool extends ToolBase {
  readonly id = 'modify.offset' as const
  override readonly specs = OFFSET_OPTIONS
  private target: AnyNode | null = null
  private cursor: Vec2 | null = null

  protected override start(): void {
    this.target = null
    this.hint('Offset: click the curve to offset')
  }
  protected isBusy(): boolean {
    return this.target !== null
  }
  protected reset(): void {
    this.target = null
    this.cursor = null
    this.clearAll()
    this.clearInput()
    this.hint('Offset: click the curve to offset')
  }

  private pickTarget(e: ToolPointerEvent): AnyNode | null {
    const hit = this.ctx.pick(e, (n) => OFFSETTABLE.includes(n.type))
    if (!hit) return null
    const n = this.ctx.node(hit.nodeId) as AnyNode | undefined
    return n && OFFSETTABLE.includes(n.type) && !this.ctx.doc.isEffectivelyLocked(n.id) ? n : null
  }

  /** Signed offset distance from the pointer position (parent-local) to the target. */
  private signedDistance(node: AnyNode, p: Vec2): number {
    const outline = entityOutline(node)
    const near = nearestCurve([node], p, Infinity)
    if (!near) return 0
    if (outline && outline.length >= 3 && node.type !== 'polyline') return pointInPolygon(p, outline) ? -near.distance : near.distance
    if (node.type === 'polyline' && node.params.closed && outline) return pointInPolygon(p, outline) ? -near.distance : near.distance
    // open curves: left of travel is positive
    const c = near.curve
    if (c.kind === 'seg') return signedLineDistance(p, c.a, c.b) >= 0 ? near.distance : -near.distance
    const r = v2.dist(p, c.arc.center)
    return r > c.arc.radius ? -near.distance : near.distance // outside a CCW arc = right side
  }

  private currentDistance(node: AnyNode, p: Vec2): number {
    const fixed = this.optNum('distance', 0)
    const signed = this.signedDistance(node, p)
    return fixed > 0 ? Math.sign(signed || 1) * fixed : signed
  }

  private previewOffset(node: AnyNode, d: number): void {
    const r = offsetEntity(node, d, false)
    if (!r?.add) return
    const ghost = makeNode(r.add) as AnyNode
    for (const s of entitySegments(ghost)) this.lines([this.ctx.toWorld(node.parent, [s.a[0], s.a[1], 0]), this.ctx.toWorld(node.parent, [s.b[0], s.b[1], 0])], { style: 'rubber' })
    this.input('Distance', this.fmt(Math.abs(d)))
  }

  onPointerMove(e: ToolPointerEvent): void {
    this.clearAll()
    if (!this.target) {
      const n = this.pickTarget(e)
      this.ctx.setCursor(n ? 'pointer' : 'default')
      if (n) for (const s of entitySegments(n)) this.lines([this.ctx.toWorld(n.parent, [s.a[0], s.a[1], 0]), this.ctx.toWorld(n.parent, [s.b[0], s.b[1], 0])], { style: 'guide' })
      return
    }
    const hit = this.planeHit(e)
    if (!hit) return
    const local = this.ctx.toLocal(this.target.parent, hit)
    this.cursor = [local[0], local[1]]
    this.previewOffset(this.target, this.currentDistance(this.target, this.cursor))
  }

  onPointerDown(e: ToolPointerEvent): boolean {
    if (!isPrimary(e)) return false
    if (!this.target) {
      this.target = this.pickTarget(e)
      if (!this.target) this.ctx.notify('info', 'Click a line, polyline, rectangle, circle, arc or wall')
      else this.hint('Move to the side of the offset and click · type the distance')
      return true
    }
    const hit = this.planeHit(e)
    if (!hit) return true
    const local = this.ctx.toLocal(this.target.parent, hit)
    this.apply(this.currentDistance(this.target, [local[0], local[1]]))
    return true
  }

  onInput(text: string): void {
    if (!this.target) return void this.ctx.notify('info', 'Click the curve first')
    const d = this.ctx.parseLength(text)
    if (d === null) return void this.ctx.notify('warning', `Cannot read "${text}"`)
    const side = this.cursor ? Math.sign(this.signedDistance(this.target, this.cursor) || 1) : 1
    this.apply(Math.abs(d) * side)
  }

  private apply(d: number): void {
    const node = this.target!
    this.clearAll()
    this.clearInput()
    this.target = null
    if (Math.abs(d) < 1e-6) return
    const move = this.optStr('mode', 'copy', ['copy', 'move']) === 'move'
    const r = offsetEntity(node, d, move)
    if (!r) return void this.ctx.notify('warning', 'Offset distance too large for this shape')
    if (r.add) this.commitNodes([r.add])
    else if (r.patch) {
      this.ctx.commit(() => this.ctx.doc.updateNode(node.id, r.patch!))
      this.ctx.requestRender()
    }
    this.hint('Offset: click the next curve to offset')
  }
}
