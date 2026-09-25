// annotate.levelmark — Höhenkote: click a point to place a height marker. The geometry engine labels
// it with the node's WORLD elevation (±0.00 style, relative to project zero or as absolute NN height —
// see the Units settings), so markers stay correct when levels move.
import type { LevelmarkParams, Vec3 } from '@cadsandbox/doc'
import { makeNode } from '@cadsandbox/doc'
import type { ToolOptionSpec, ToolPointerEvent } from '../types'
import { ToolBase, isPrimary } from '../util/base'
import { LAYERS, lengthOption, newNode, selectOption, transformAt } from '../util/nodes'

const VARIANTS: LevelmarkParams['variant'][] = ['plan', 'section']
const PREFIXES = ['none', 'OKFF', 'OKRF', 'OK', 'UK'] as const

export const LEVELMARK_OPTIONS: ToolOptionSpec[] = [
  selectOption('variant', 'Variant', 'plan', [
    { value: 'plan', label: 'Plan symbol' },
    { value: 'section', label: 'Section / elevation flag' },
  ]),
  selectOption('prefix', 'Prefix', 'none', [
    { value: 'none', label: '—' },
    { value: 'OKFF', label: 'OKFF (finished floor)' },
    { value: 'OKRF', label: 'OKRF (structural floor)' },
    { value: 'OK', label: 'OK (top)' },
    { value: 'UK', label: 'UK (underside)' },
  ]),
  lengthOption('textSize', 'Text size', 0.2, 0.01),
]

export class LevelmarkTool extends ToolBase {
  readonly id = 'annotate.levelmark' as const
  override readonly specs = LEVELMARK_OPTIONS

  protected override start(): void {
    this.hint('Height marker: click a point (snaps to floors, edges and grid) · the elevation is taken from the point')
  }
  protected isBusy(): boolean {
    return false
  }
  protected reset(): void {
    this.clearAll()
  }

  private params(): LevelmarkParams {
    const prefix = this.optStr('prefix', 'none', PREFIXES)
    const p: LevelmarkParams = { variant: this.optStr<LevelmarkParams['variant']>('variant', 'plan', VARIANTS) }
    if (prefix !== 'none') p.prefix = prefix
    return p
  }
  private meta(): Record<string, unknown> {
    const size = this.optNum('textSize', 0.2)
    return size !== 0.2 ? { textSize: size } : {}
  }

  onPointerMove(e: ToolPointerEvent): void {
    this.clearAll()
    const s = this.snap(e, null, { surfaces: !this.ctx.isPlanView(e.viewport) })
    // Ghost in world space (parent = none) so the preview text shows the world elevation.
    this.ghost(makeNode({ type: 'levelmark', t: transformAt(s.point), params: this.params(), meta: this.meta() }), { opacity: 0.6 })
  }

  onPointerDown(e: ToolPointerEvent): boolean {
    if (!isPrimary(e)) return false
    const s = this.snap(e, null, { surfaces: !this.ctx.isPlanView(e.viewport) })
    this.clearAll()
    const parent = this.parent()
    const local: Vec3 = this.toLocal(s.point, parent)
    this.commitNodes([newNode('levelmark', this.params(), { parent, layer: LAYERS.anno, name: 'Height marker', t: transformAt(local), meta: this.meta() })])
    this.hint('Height marker placed · click to place another · Esc to finish')
    return true
  }
}
