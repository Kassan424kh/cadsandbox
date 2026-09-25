// modify.trim / modify.extend — AutoCAD-like quick mode: hover a line / polyline segment / arc /
// circle → the portion between the nearest cutting edges is highlighted, click removes it (objects
// touching nothing are deleted). Extend: hover near an end → it grows to the next boundary curve.
import type { AnyNode, NewNode, NodeBase, Vec2 } from '@cadsandbox/doc'
import type { ToolContext, ToolPointerEvent } from '../types'
import { normalizeArc, type ArcDef } from '../util/arcs'
import { ToolBase, isPrimary } from '../util/base'
import { curveIntersections, curvePoint, cutParams, nearestParam, subCurve } from '../util/curveOps'
import { entityCurves, nearestCurve, siblingsOfType, type Curve, type CurveHit } from '../util/scene'
import { positiveAngle, v2, yawOf } from '../util/vec'

const TARGETS: AnyNode['type'][] = ['line', 'polyline', 'arc', 'circle']
const BOUNDARIES: AnyNode['type'][] = ['line', 'polyline', 'rect', 'circle', 'arc', 'ellipse', 'spline', 'wall']

export interface TrimPlan {
  /** Curve portion that will be removed (parent space) */
  removed: Curve
  apply(): void
}

function boundaryCurves(ctx: ToolContext, parent: string | null, exclude: string): Curve[] {
  const out: Curve[] = []
  for (const n of siblingsOfType(ctx.doc, parent, BOUNDARIES, [exclude])) out.push(...entityCurves(n))
  return out
}

/** Interval [t0,t1] of `cuts` (sorted, within (0,1)) containing tc, with 0/1 as outer bounds. */
function interval(cuts: number[], tc: number): [number, number] {
  let lo = 0,
    hi = 1
  for (const t of cuts) {
    if (t <= tc) lo = t
    else {
      hi = t
      break
    }
  }
  return [lo, hi]
}

function sampleArcWorld(ctx: ToolContext, parent: string | null, c: Curve): [number, number, number][] {
  const pts: Vec2[] = []
  if (c.kind === 'seg') pts.push(c.a, c.b)
  else {
    const n = 16
    for (let i = 0; i <= n; i++) pts.push(curvePoint(c, i / n))
  }
  return pts.map((p) => ctx.toWorld(parent, [p[0], p[1], 0]))
}

export function trimPlan(ctx: ToolContext, hit: CurveHit, cutters: Curve[]): TrimPlan | null {
  const node = hit.node
  const doc = ctx.doc
  const tc = nearestParam(hit.curve, hit.point)
  switch (node.type) {
    case 'line': {
      const cuts = cutParams(hit.curve, cutters)
      if (!cuts.length) return { removed: hit.curve, apply: () => doc.deleteNodes([node.id]) }
      const [t0, t1] = interval(cuts, tc)
      const removed = subCurve(hit.curve, t0, t1)
      const P = (t: number) => toNodeLocal(node, curvePoint(hit.curve, t))
      return {
        removed,
        apply() {
          if (t0 === 0) doc.updateNode(node.id, { params: { a: P(t1) } })
          else if (t1 === 1) doc.updateNode(node.id, { params: { b: P(t0) } })
          else {
            const b = node.params.b
            doc.updateNode(node.id, { params: { b: P(t0) } })
            doc.addNode({ type: 'line', parent: node.parent, layer: node.layer, color: node.color, t: node.t, name: node.name, params: { a: P(t1), b } })
          }
        },
      }
    }
    case 'arc': {
      const cuts = cutParams(hit.curve, cutters)
      if (!cuts.length) return { removed: hit.curve, apply: () => doc.deleteNodes([node.id]) }
      const [t0, t1] = interval(cuts, tc)
      const removed = subCurve(hit.curve, t0, t1)
      const arc = (hit.curve as { arc: ArcDef }).arc
      const yaw = yawOf(node.t.r)
      const sweep = arc.end - arc.start
      const ang = (t: number) => arc.start + sweep * t - yaw
      return {
        removed,
        apply() {
          if (t0 === 0) doc.updateNode(node.id, { params: { start: ang(t1) } })
          else if (t1 === 1) doc.updateNode(node.id, { params: { end: ang(t0) } })
          else {
            doc.updateNode(node.id, { params: { end: ang(t0) } })
            doc.addNode({ type: 'arc', parent: node.parent, layer: node.layer, color: node.color, t: node.t, name: node.name, params: { radius: node.params.radius, start: ang(t1), end: node.params.end } })
          }
        },
      }
    }
    case 'circle': {
      const cuts = cutParams(hit.curve, cutters)
      if (cuts.length < 2) return null
      // circular parameter space: interval containing tc, wrapping around
      let i = cuts.findIndex((t) => t > tc)
      if (i < 0) i = 0
      const t1 = cuts[i]
      const t0 = cuts[(i + cuts.length - 1) % cuts.length]
      const arc = (hit.curve as { arc: ArcDef }).arc
      const TAU = Math.PI * 2
      const removed: Curve = { kind: 'arc', arc: normalizeArc(arc.center, arc.radius, TAU * t0, TAU * t1) }
      const yaw = yawOf(node.t.r)
      return {
        removed,
        apply() {
          const kept = normalizeArc([0, 0], node.params.radius, TAU * t1 - yaw, TAU * t0 - yaw)
          doc.addNode({ type: 'arc', parent: node.parent, layer: node.layer, color: node.color, t: node.t, name: node.name, params: { radius: node.params.radius, start: kept.start, end: kept.end } })
          doc.deleteNodes([node.id])
        },
      }
    }
    case 'polyline':
      return polylineTrim(ctx, node, hit, cutters, tc)
    default:
      return null
  }
}

function toNodeLocal(node: AnyNode, p: Vec2): Vec2 {
  // Lines/polylines created by the tools have identity transforms; honour translation/yaw anyway.
  const yaw = yawOf(node.t.r)
  const c = Math.cos(-yaw),
    s = Math.sin(-yaw)
  const x = p[0] - node.t.p[0],
    y = p[1] - node.t.p[1]
  return [(x * c - y * s) / (node.t.s[0] || 1), (x * s + y * c) / (node.t.s[1] || 1)]
}

function polylineTrim(ctx: ToolContext, node: NodeBase<'polyline'>, hit: CurveHit, cutters: Curve[], tc: number): TrimPlan | null {
  const { points, bulges, closed } = node.params
  const k = hit.curveIndex
  if (bulges?.[k]) {
    ctx.notify('info', 'Trimming arc segments of polylines is not supported yet')
    return null
  }
  const cuts = cutParams(hit.curve, cutters)
  const n = points.length
  if (!cuts.length && !closed && n === 2) return { removed: hit.curve, apply: () => ctx.doc.deleteNodes([node.id]) }
  const [t0, t1] = interval(cuts, tc)
  const removed = subCurve(hit.curve, t0, t1)
  const P = (t: number) => toNodeLocal(node, curvePoint(hit.curve, t))
  const L = (i: number) => points[((i % n) + n) % n]
  const B = (i: number) => bulges?.[((i % n) + n) % n] ?? 0
  return {
    removed,
    apply() {
      const doc = ctx.doc
      const mk = (pts: Vec2[], bl: number[]): NewNode<'polyline'> => ({
        type: 'polyline',
        parent: node.parent,
        layer: node.layer,
        color: node.color,
        t: node.t,
        name: node.name,
        params: { points: pts, closed: false, ...(bl.some((b) => b) ? { bulges: bl } : {}) },
      })
      if (closed) {
        // Open the loop: start after the cut, walk around, end before the cut.
        const entries: { p: Vec2; bulge: number }[] = []
        if (t1 < 1) entries.push({ p: P(t1), bulge: 0 })
        for (let i = k + 1; i <= k + n; i++) {
          if (i === k + n && t0 === 0) break // the cut consumed vertex k
          entries.push({ p: L(i), bulge: B(i) })
        }
        if (t0 > 0) entries.push({ p: P(t0), bulge: 0 })
        const dedup = entries.filter((e, i, a) => i === 0 || v2.dist(e.p, a[i - 1].p) > 1e-9)
        const bl = dedup.slice(0, -1).map((e) => e.bulge)
        doc.updateNode(node.id, { params: { points: dedup.map((e) => e.p), closed: false, bulges: bl.some((b) => b) ? bl : undefined } })
        return
      }
      const first: Vec2[] = points.slice(0, k + 1)
      const firstB: number[] = (bulges ?? []).slice(0, k)
      if (t0 > 0) {
        first.push(P(t0))
        firstB.push(0)
      }
      const second: Vec2[] = []
      const secondB: number[] = []
      if (t1 < 1) {
        second.push(P(t1))
        secondB.push(0)
      }
      second.push(...points.slice(k + 1))
      secondB.push(...(bulges ?? []).slice(k + 1))
      const parts = [
        { pts: first, bl: firstB },
        { pts: second, bl: secondB.slice(0, Math.max(0, second.length - 1)) },
      ].filter((p) => p.pts.length >= 2)
      if (!parts.length) return doc.deleteNodes([node.id])
      doc.updateNode(node.id, { params: { points: parts[0].pts, closed: false, bulges: parts[0].bl.some((b) => b) ? parts[0].bl : undefined } })
      for (const p of parts.slice(1)) doc.addNode(mk(p.pts, p.bl))
    },
  }
}

abstract class EdgeTool extends ToolBase {
  protected isBusy(): boolean {
    return false
  }
  protected reset(): void {
    this.clearAll()
  }
  protected targetAt(e: ToolPointerEvent): CurveHit | null {
    const hit = this.ctx.pick(e, (n) => TARGETS.includes(n.type))
    if (!hit) return null
    const node = this.ctx.node(hit.nodeId) as AnyNode | undefined
    if (!node || !TARGETS.includes(node.type) || this.ctx.doc.isEffectivelyLocked(node.id)) return null
    const local = this.ctx.toLocal(node.parent, hit.point)
    return nearestCurve([node], [local[0], local[1]], Infinity)
  }
  protected boundaries(node: AnyNode): Curve[] {
    return boundaryCurves(this.ctx, node.parent, node.id)
  }
  protected showCurve(node: AnyNode, c: Curve, style: 'rubber' | 'guide'): void {
    this.lines(sampleArcWorld(this.ctx, node.parent, c), { style, dashed: style === 'rubber' })
  }
}

export class TrimTool extends EdgeTool {
  readonly id = 'modify.trim' as const
  protected override start(): void {
    this.hint('Trim: hover the part of a line, polyline, arc or circle to remove, then click')
  }
  private planAt(e: ToolPointerEvent): { hit: CurveHit; plan: TrimPlan } | null {
    const hit = this.targetAt(e)
    if (!hit) return null
    const plan = trimPlan(this.ctx, hit, this.boundaries(hit.node))
    return plan ? { hit, plan } : null
  }
  onPointerMove(e: ToolPointerEvent): void {
    this.clearAll()
    const p = this.planAt(e)
    this.ctx.setCursor(p ? 'pointer' : 'default')
    if (p) this.showCurve(p.hit.node, p.plan.removed, 'rubber')
  }
  onPointerDown(e: ToolPointerEvent): boolean {
    if (!isPrimary(e)) return false
    const p = this.planAt(e)
    this.clearAll()
    if (!p) return true
    this.ctx.commit(() => p.plan.apply())
    this.ctx.requestRender()
    return true
  }
}

export interface ExtendPlan {
  added: Curve
  apply(): void
}

export function extendPlan(ctx: ToolContext, hit: CurveHit, boundaries: Curve[]): ExtendPlan | null {
  const node = hit.node
  const doc = ctx.doc
  const c = hit.curve
  const t = nearestParam(c, hit.point)
  const atEnd = t >= 0.5 // extend the end nearer to the pointer
  if (c.kind === 'seg') {
    const infinite: Curve = { kind: 'seg', a: c.a, b: c.b }
    let best: { t: number; p: Vec2 } | null = null
    for (const b of boundaries) {
      for (const x of curveIntersections(infinite, b, true)) {
        if (atEnd ? x.ta > 1 + 1e-7 : x.ta < -1e-7) {
          if (!best || (atEnd ? x.ta < best.t : x.ta > best.t)) best = { t: x.ta, p: x.p }
        }
      }
    }
    if (!best) return null
    const target = best.p
    const added: Curve = atEnd ? { kind: 'seg', a: c.b, b: target } : { kind: 'seg', a: target, b: c.a }
    const local = toNodeLocal(node, target)
    return {
      added,
      apply() {
        if (node.type === 'line') doc.updateNode(node.id, { params: atEnd ? { b: local } : { a: local } })
        else if (node.type === 'polyline' && !node.params.closed) {
          const pts = node.params.points.map((p) => [p[0], p[1]] as Vec2)
          const k = hit.curveIndex
          if (atEnd && k === pts.length - 2) pts[pts.length - 1] = local
          else if (!atEnd && k === 0) pts[0] = local
          else return
          doc.updateNode(node.id, { params: { points: pts } })
        }
      },
    }
  }
  // arc: continue around the circle to the next boundary hit
  const arc = c.arc
  const full: Curve = { kind: 'arc', arc: { center: arc.center, radius: arc.radius, start: 0, end: Math.PI * 2 } }
  const sweep = arc.end - arc.start
  let bestAng: number | null = null
  for (const b of boundaries) {
    for (const x of curveIntersections(full, b)) {
      const ang = positiveAngle(v2.angle(v2.sub(x.p, arc.center)))
      const rel = atEnd ? positiveAngle(ang - arc.end) : positiveAngle(arc.start - ang)
      if (rel < 1e-6 || rel > Math.PI * 2 - sweep - 1e-6) continue
      if (bestAng === null || rel < bestAng) bestAng = rel
    }
  }
  if (bestAng === null || node.type !== 'arc') return null
  const added: Curve = atEnd ? { kind: 'arc', arc: normalizeArc(arc.center, arc.radius, arc.end, arc.end + bestAng) } : { kind: 'arc', arc: normalizeArc(arc.center, arc.radius, arc.start - bestAng, arc.start) }
  const delta = bestAng
  return {
    added,
    apply() {
      doc.updateNode(node.id, { params: atEnd ? { end: node.params.end + delta } : { start: node.params.start - delta } })
    },
  }
}

export class ExtendTool extends EdgeTool {
  readonly id = 'modify.extend' as const
  protected override start(): void {
    this.hint('Extend: hover near the end of a line, polyline or arc to extend it to the next edge, then click')
  }
  private planAt(e: ToolPointerEvent): { hit: CurveHit; plan: ExtendPlan } | null {
    const hit = this.targetAt(e)
    if (!hit) return null
    const plan = extendPlan(this.ctx, hit, this.boundaries(hit.node))
    return plan ? { hit, plan } : null
  }
  onPointerMove(e: ToolPointerEvent): void {
    this.clearAll()
    const p = this.planAt(e)
    this.ctx.setCursor(p ? 'pointer' : 'default')
    if (p) this.showCurve(p.hit.node, p.plan.added, 'rubber')
  }
  onPointerDown(e: ToolPointerEvent): boolean {
    if (!isPrimary(e)) return false
    const p = this.planAt(e)
    this.clearAll()
    if (!p) {
      this.ctx.notify('info', 'Nothing to extend to in that direction')
      return true
    }
    this.ctx.commit(() => p.plan.apply())
    this.ctx.requestRender()
    return true
  }
}
