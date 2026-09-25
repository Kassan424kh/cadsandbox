// modify.pushpull — SketchUp-style push/pull: hover a planar face (highlight), drag along its
// normal or type a distance → changes the governing parameter (shape depth, primitive size, slab
// thickness/edge, wall height/thickness/length, column size…). Closed 2D entities extrude into a
// 'shape' node. Click-release without moving switches to click-move-click mode.
import { Matrix4 } from 'three'
import type { AnyNode, Vec3 } from '@cadsandbox/doc'
import type { ToolOptionSpec, ToolPointerEvent } from '../types'
import { ToolBase, isPrimary } from '../util/base'
import { boolOption } from '../util/nodes'
import { closestLineParamToRay, roundTo, v3 } from '../util/vec'
import { footprintOf, pushPlan, worldToLocalDir, type Face, type PushPlan } from './pushPlan'

export const PUSHPULL_OPTIONS: ToolOptionSpec[] = [boolOption('snapGrid', 'Snap distance to grid', true)]

interface Drag {
  face: Face
  plan: PushPlan
  start: Vec3
  d: number
  /** click-move-click mode (no drag) */
  sticky: boolean
  downAt: [number, number]
}

export class PushPullTool extends ToolBase {
  readonly id = 'modify.pushpull' as const
  override readonly specs = PUSHPULL_OPTIONS
  private hover: { face: Face; plan: PushPlan } | null = null
  private drag: Drag | null = null

  protected override start(): void {
    this.hover = null
    this.drag = null
    this.hint('Push/Pull: hover a face, then drag it along its normal · or click and type a distance')
  }
  protected isBusy(): boolean {
    return this.drag !== null
  }
  protected reset(): void {
    this.drag = null
    this.hover = null
    this.clearAll()
    this.clearInput()
    this.hint('Push/Pull: hover a face, then drag it along its normal · or click and type a distance')
  }

  private faceAt(e: ToolPointerEvent): { face: Face; plan: PushPlan } | null {
    const hit = this.ctx.pick(e)
    if (!hit) return null
    const node = this.ctx.node(hit.nodeId) as AnyNode | undefined
    if (!node || this.ctx.doc.isEffectivelyLocked(node.id)) return null
    let normal = hit.face?.normal ?? hit.normal
    // 2D entities lie on their plane: extrude along the work plane normal.
    if (!normal || ['polyline', 'rect', 'circle', 'ellipse', 'spline', 'hatch'].includes(node.type)) normal = this.plane().normal
    normal = v3.norm(normal)
    const face: Face = { node, normal, point: hit.face?.point ?? hit.point, local: worldToLocalDir(this.ctx, node, normal) }
    const plan = pushPlan(this.ctx, face)
    return plan ? { face, plan } : null
  }

  private parentMatrix(node: AnyNode): Matrix4 {
    return new Matrix4().fromArray(Array.from(this.ctx.doc.getWorldMatrix(node.parent)))
  }

  private highlight(face: Face, plan: PushPlan): void {
    this.marker(face.point, 'face')
    this.lines([face.point, v3.add(face.point, v3.scale(face.normal, 0.3))], { style: 'guide' })
    const fp = footprintOf(face.node)
    if (fp) this.lines(fp.map((p) => this.ctx.toWorld(face.node.parent, [p[0], p[1], face.node.t.p[2]])), { closed: true, style: 'rubber' })
    this.label(face.point, `${face.node.name} · ${plan.label}`, 'hint', [0, -18])
  }

  /** Signed distance along the face normal for the current pointer. */
  private distanceFor(drag: Drag, e: ToolPointerEvent): number {
    let d = closestLineParamToRay(drag.start, drag.face.normal, e.ray.origin, e.ray.direction)
    if (this.optBool('snapGrid', true) && !e.alt) {
      const grid = this.ctx.doc.meta.grid
      const step = grid.snap && grid.subdivisions > 0 ? grid.size / grid.subdivisions : 0.001
      d = roundTo(d, step)
    } else d = roundTo(d, 0.001)
    return d
  }

  onPointerMove(e: ToolPointerEvent): void {
    this.clearAll()
    if (this.drag) {
      this.drag.d = this.distanceFor(this.drag, e)
      this.preview(this.drag)
      return
    }
    this.hover = this.faceAt(e)
    if (!this.hover) {
      this.ctx.setCursor('default')
      this.clearInput()
      return
    }
    this.ctx.setCursor('ns-resize')
    this.highlight(this.hover.face, this.hover.plan)
    this.input('Distance', '', `changes ${this.hover.plan.label}`)
  }

  private preview(drag: Drag): void {
    const node = drag.plan.preview(drag.d)
    if (node) this.ghost(node, { opacity: 0.6, parentMatrix: this.parentMatrix(drag.face.node) })
    const tip = v3.add(drag.start, v3.scale(drag.face.normal, drag.d))
    this.lines([drag.start, tip], { style: 'guide', dashed: true })
    this.label(tip, `${drag.d >= 0 ? '+' : '−'}${this.fmt(Math.abs(drag.d))}`, 'size')
    this.input('Distance', this.fmt(drag.d))
  }

  onPointerDown(e: ToolPointerEvent): boolean {
    if (!isPrimary(e)) return false
    if (this.drag) {
      // click-move-click: second click commits
      this.drag.d = this.distanceFor(this.drag, e)
      this.commit(this.drag.face, this.drag.plan, this.drag.d)
      return true
    }
    const h = this.faceAt(e) ?? this.hover
    if (!h) return true
    this.clearAll()
    this.drag = { face: h.face, plan: h.plan, start: h.face.point, d: 0, sticky: false, downAt: [e.clientX, e.clientY] }
    this.hint(`Drag to push/pull ${h.plan.label} · type a distance · Alt: no grid snap`)
    return true
  }

  onPointerUp(e: ToolPointerEvent): boolean {
    if (!this.drag) return false
    const moved = Math.hypot(e.clientX - this.drag.downAt[0], e.clientY - this.drag.downAt[1])
    if (moved < 3 && !this.drag.sticky) {
      this.drag.sticky = true // click-move-click mode
      return true
    }
    this.drag.d = this.distanceFor(this.drag, e)
    this.commit(this.drag.face, this.drag.plan, this.drag.d)
    return true
  }

  onInput(text: string): void {
    const target = this.drag ?? this.hover
    if (!target) return void this.ctx.notify('info', 'Hover a face first, then type the distance')
    const d = this.ctx.parseLength(text)
    if (d === null) return void this.ctx.notify('warning', `Cannot read "${text}"`)
    this.commit(target.face, target.plan, d)
  }

  override onCancel(): boolean {
    if (!this.drag) return false
    this.drag = null
    this.clearAll()
    this.clearInput()
    this.hint('Push/Pull: hover a face, then drag it along its normal · or click and type a distance')
    return true
  }

  private commit(face: Face, plan: PushPlan, d: number): void {
    this.clearAll()
    this.clearInput()
    this.drag = null
    this.hover = null
    if (Math.abs(d) < 1e-6) return
    const op = plan.commit(d)
    if (!op) return
    const doc = this.ctx.doc
    const ids = this.ctx.commit(() => {
      if (op.kind === 'patch') {
        doc.updateNode(op.id, op.patch)
        return [op.id]
      }
      const id = doc.addNode(op.add)
      doc.deleteNodes([op.remove])
      return [id]
    })
    this.ctx.editor.select(ids)
    if (op.kind === 'replace') this.ctx.emit('created', { ids, tool: this.id })
    this.ctx.requestRender()
    this.hint(`${plan.label} ${d >= 0 ? '+' : '−'}${this.fmt(Math.abs(d))} · hover another face`)
  }
}
