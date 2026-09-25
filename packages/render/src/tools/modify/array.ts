// modify.array — linear (count + spacing, or 2 clicks = spacing / total extent) and polar
// (center + count + sweep) arrays of the selection, as copies or component instances.
import { Matrix4 } from 'three'
import type { AnyNode, Transform, Vec3 } from '@cadsandbox/doc'
import { composeMatrix, decomposeMatrix, invertMatrix, makeNode, multiplyMatrices, quatFromAxisAngle } from '@cadsandbox/doc'
import type { ToolContext, ToolOptionSpec, ToolPointerEvent } from '../types'
import { ToolBase, isPrimary } from '../util/base'
import { parseCount, parseVcb } from '../util/input'
import { boolOption, lengthOption, numberOption, selectOption } from '../util/nodes'
import { fromPlane, toPlane, v2, v3 } from '../util/vec'

export const ARRAY_OPTIONS: ToolOptionSpec[] = [
  selectOption('mode', 'Mode', 'linear', ['linear', 'polar']),
  numberOption('count', 'Count', 3, 2, 500),
  lengthOption('spacing', 'Spacing (0 = by clicks)', 0),
  boolOption('fitTotal', 'Second click = total extent', false),
  numberOption('angleDeg', 'Polar sweep (°)', 360, 1, 360),
  boolOption('rotateItems', 'Rotate items (polar)', true),
  selectOption('result', 'Result', 'copies', ['copies', 'instances']),
]

/** World-space rigid transform applied to an item's world matrix for one array step. */
export type ArrayStep = (worldMatrix: Float64Array) => Float64Array

export function linearSteps(dir: Vec3, spacing: number, count: number): ArrayStep[] {
  const out: ArrayStep[] = []
  for (let i = 1; i < count; i++) {
    const off = v3.scale(dir, spacing * i)
    out.push((m) => {
      const t = new Float64Array(m)
      t[12] += off[0]
      t[13] += off[1]
      t[14] += off[2]
      return t
    })
  }
  return out
}

export function polarSteps(center: Vec3, count: number, sweep: number, rotateItems: boolean): ArrayStep[] {
  const out: ArrayStep[] = []
  const full = Math.abs(sweep - Math.PI * 2) < 1e-9
  const step = full ? sweep / count : sweep / Math.max(1, count - 1)
  for (let i = 1; i < count; i++) {
    const ang = step * i
    const rot = composeMatrix({ p: [0, 0, 0], r: quatFromAxisAngle([0, 0, 1], ang), s: [1, 1, 1] })
    out.push((m) => {
      const rel = new Float64Array(m)
      rel[12] -= center[0]
      rel[13] -= center[1]
      let r: Float64Array
      if (rotateItems) r = multiplyMatrices(rot, rel)
      else {
        r = rel
        const p = v2.rotate([rel[12], rel[13]], ang)
        r[12] = p[0]
        r[13] = p[1]
      }
      r[12] += center[0]
      r[13] += center[1]
      return r
    })
  }
  return out
}

function localTransform(ctx: ToolContext, parent: string | null, world: Float64Array): Transform {
  return decomposeMatrix(multiplyMatrices(invertMatrix(ctx.doc.getWorldMatrix(parent)), world))
}

/** Create the array in the document (ONE undo step). Returns the ids of the created copies/instances. */
export function applyArray(ctx: ToolContext, ids: string[], steps: ArrayStep[], result: 'copies' | 'instances'): string[] {
  const doc = ctx.doc
  const roots = doc.topLevel(ids)
  if (!roots.length || !steps.length) return []
  return ctx.commit(() => {
    const out: string[] = []
    if (result === 'instances') {
      const comp = doc.createComponent(roots, 'Array item')
      if (!comp) return out
      const inst = doc.getNode(comp.instanceId)!
      const base = doc.getWorldMatrix(comp.instanceId)
      for (const step of steps) {
        const t = localTransform(ctx, inst.parent, step(base))
        out.push(doc.addNode({ type: 'instance', parent: inst.parent, name: inst.name, layer: inst.layer, params: { component: comp.componentId }, t }))
      }
      return [comp.instanceId, ...out]
    }
    for (const step of steps) {
      const copies = doc.duplicateNodes(roots)
      copies.forEach((cid, i) => {
        const node = doc.getNode(cid)!
        doc.updateNode(cid, { t: localTransform(ctx, node.parent, step(doc.getWorldMatrix(roots[i]))) })
      })
      out.push(...copies)
    }
    return out
  })
}

export class ArrayTool extends ToolBase {
  readonly id = 'modify.array' as const
  override readonly specs = ARRAY_OPTIONS
  private base: Vec3 | null = null
  private cursor: Vec3 | null = null

  protected override start(): void {
    this.base = null
    this.hint(this.firstHint())
  }
  protected isBusy(): boolean {
    return this.base !== null
  }
  protected reset(): void {
    this.base = null
    this.clearAll()
    this.clearInput()
    this.hint(this.firstHint())
  }
  private mode(): 'linear' | 'polar' {
    return this.optStr('mode', 'linear', ['linear', 'polar'])
  }
  private count(): number {
    return Math.max(2, Math.round(this.optNum('count', 3)))
  }
  private firstHint(): string {
    if (!this.selection().length) return 'Array: select objects first (click one to select it)'
    return this.mode() === 'linear' ? `Linear array (${this.count()} items): click the base point · type a number to change the count` : `Polar array (${this.count()} items): click the center`
  }
  private selection(): string[] {
    return this.ctx.doc.topLevel(this.ctx.editor.getState().selection).filter((id) => !this.ctx.doc.isEffectivelyLocked(id))
  }

  private stepsFor(base: Vec3, second: Vec3 | null): ArrayStep[] | null {
    const count = this.count()
    if (this.mode() === 'polar') return polarSteps(base, count, (Math.max(1, Math.min(360, this.optNum('angleDeg', 360))) * Math.PI) / 180, this.optBool('rotateItems', true))
    const fixed = this.optNum('spacing', 0)
    if (!second) return fixed > 0 ? linearSteps([1, 0, 0], fixed, count) : null
    const d = v3.sub(second, base)
    const len = v3.len(d)
    if (len < 1e-9) return null
    const spacing = fixed > 0 ? fixed : this.optBool('fitTotal', false) ? len / (count - 1) : len
    return linearSteps(v3.norm(d), spacing, count)
  }

  private preview(steps: ArrayStep[]): void {
    for (const id of this.selection()) {
      const node = this.ctx.node(id) as AnyNode | undefined
      if (!node) continue
      const world = this.ctx.doc.getWorldMatrix(id)
      const parentMatrix = new Matrix4().fromArray(Array.from(this.ctx.doc.getWorldMatrix(node.parent)))
      for (const step of steps) {
        const t = localTransform(this.ctx, node.parent, step(world))
        this.ghost(makeNode({ ...node, t } as AnyNode, node.id) as AnyNode, { opacity: 0.45, parentMatrix })
      }
    }
  }

  onPointerDown(e: ToolPointerEvent): boolean {
    if (!isPrimary(e)) return false
    if (!this.selection().length) {
      const hit = this.ctx.pick(e)
      if (hit) {
        this.ctx.editor.select([hit.nodeId])
        this.hint(this.firstHint())
      } else this.ctx.notify('info', 'Select the objects to array first')
      return true
    }
    const s = this.snap(e, this.base)
    if (!this.base) {
      this.base = s.point
      if (this.mode() === 'polar' || this.optNum('spacing', 0) > 0) {
        this.finish(this.stepsFor(this.base, null))
        return true
      }
      this.hint(`Click the ${this.optBool('fitTotal', false) ? 'end of the array' : 'position of the second item'} · type length or length<angle`)
      return true
    }
    this.finish(this.stepsFor(this.base, s.point))
    return true
  }

  onPointerMove(e: ToolPointerEvent): void {
    this.clearAll()
    const s = this.snap(e, this.base)
    this.cursor = s.point
    if (!this.base) {
      if (this.mode() === 'polar') {
        const steps = this.stepsFor(s.point, null)
        if (steps) this.preview(steps)
      }
      return
    }
    const steps = this.stepsFor(this.base, s.point)
    if (!steps) return
    this.lines([this.base, s.point], { style: 'guide', dashed: true })
    this.preview(steps)
    this.input('Distance', this.fmt(v3.dist(this.base, s.point)), `${this.count()} items`)
  }

  onInput(text: string): void {
    if (!this.base) {
      const n = parseCount(text)
      if (n !== null && n >= 2 && n <= 500) {
        this.options.count = n
        this.hint(this.firstHint())
      } else this.ctx.notify('info', 'Type the item count, then click the base point')
      return
    }
    const v = parseVcb(text, this.ctx)
    if (!v) return void this.ctx.notify('warning', `Cannot read "${text}"`)
    const plane = this.plane()
    const b = toPlane(plane, this.base)
    let second: [number, number] | null = null
    if (v.kind === 'delta') second = v2.add(b, [v.dx, v.dy])
    else if (v.kind === 'polar') second = v2.add(b, v2.fromAngle(v.angle, v.length))
    else if (this.cursor) {
      const d = v2.sub(toPlane(plane, this.cursor), b)
      second = v2.len(d) > 1e-9 ? v2.add(b, v2.scale(v2.norm(d), v.value)) : v2.add(b, [v.value, 0])
    }
    if (!second) return void this.ctx.notify('info', 'Move the pointer to set the direction, or type length<angle')
    this.finish(this.stepsFor(this.base, fromPlane(plane, second)))
  }

  private finish(steps: ArrayStep[] | null): void {
    this.clearAll()
    this.clearInput()
    this.base = null
    if (!steps) return void this.ctx.notify('warning', 'Array spacing is zero')
    const ids = applyArray(this.ctx, this.selection(), steps, this.optStr('result', 'copies', ['copies', 'instances']))
    if (ids.length) {
      this.ctx.editor.select(ids)
      this.ctx.emit('created', { ids, tool: this.id })
      this.ctx.requestRender()
    }
    this.hint(this.firstHint())
  }
}
