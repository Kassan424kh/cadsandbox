// annotate.leader — arrow point + bends, Enter → inline prompt for the note → 'leader' node.
import type { Vec3 } from '@cadsandbox/doc'
import type { ToolOptionSpec } from '../types'
import { ChainTool } from '../util/chain'
import { LAYERS, newNode } from '../util/nodes'
import { toPlane, fromPlane, v2 } from '../util/vec'

export const LEADER_OPTIONS: ToolOptionSpec[] = [{ key: 'arrowSize', label: 'Arrow size', kind: 'length', default: 0.15, min: 0.01 }]

export class LeaderTool extends ChainTool {
  readonly id = 'annotate.leader' as const
  override readonly specs = LEADER_OPTIONS

  protected override start(): void {
    this.allowClose = false
    super.start()
  }
  protected override firstHint(): string {
    return 'Leader: click the arrow point (what the note refers to)'
  }
  protected override nextHint(): string {
    return 'Click the next bend · Enter or double-click to type the note'
  }

  protected override drawChain(points: Vec3[], cursor: Vec3 | null): void {
    super.drawChain(points, cursor)
    const pts = cursor ? [...points, cursor] : points
    if (pts.length < 2) return
    // Arrow head at the first point.
    const plane = this.plane()
    const a = toPlane(plane, pts[0]),
      b = toPlane(plane, pts[1])
    const d = v2.sub(b, a)
    if (v2.len(d) < 1e-9) return
    const u = v2.norm(d)
    const n = v2.perp(u)
    const s = this.optNum('arrowSize', 0.15)
    const base = v2.add(a, v2.scale(u, s))
    this.lines([fromPlane(plane, v2.add(base, v2.scale(n, s * 0.3))), pts[0], fromPlane(plane, v2.sub(base, v2.scale(n, s * 0.3)))], { style: 'annotation' })
  }

  protected commitChain(points: Vec3[]): void {
    const parent = this.parent()
    const local = points.map((p) => this.toLocal2(p, parent))
    const anchor = points[points.length - 1]
    void this.ctx.overlay.prompt(anchor, '', { placeholder: 'Note' }).then((text) => {
      if (!this.isActive() || text === null || !text.trim()) return
      this.commitNodes([newNode('leader', { points: local, text }, { parent, layer: LAYERS.anno, name: text.length > 24 ? `${text.slice(0, 24)}…` : text })])
    })
  }
}
