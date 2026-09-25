// draw.line — chained line segments; every segment becomes its own 'line' node (ONE undo step).
import type { NewNode, Vec3 } from '@cadsandbox/doc'
import type { ToolOptionSpec } from '../types'
import { ChainTool } from '../util/chain'
import { boolOption, newNode } from '../util/nodes'

export const LINE_OPTIONS: ToolOptionSpec[] = [boolOption('chain', 'Chain segments', true)]

export class LineTool extends ChainTool {
  readonly id = 'draw.line' as const
  override readonly specs = LINE_OPTIONS

  protected override firstHint(): string {
    return 'Line: click the start point · type x;y for exact coordinates'
  }

  protected override pointAdded(): void {
    // Single-segment mode: finish as soon as the second point lands.
    if (!this.optBool('chain', true) && this.points.length >= 2) this.finishChain(false)
  }

  protected commitChain(points: Vec3[], closed: boolean): void {
    const parent = this.parent()
    const nodes: NewNode[] = []
    const n = points.length
    const segs = closed ? n : n - 1
    for (let i = 0; i < segs; i++) {
      const a = this.toLocal2(points[i], parent)
      const b = this.toLocal2(points[(i + 1) % n], parent)
      nodes.push(newNode('line', { a, b }, { parent }))
    }
    this.commitNodes(nodes)
  }
}
