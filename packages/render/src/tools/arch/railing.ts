// arch.railing — polyline path → 'railing' node; options height / style / post spacing.
import type { RailingParams, Vec3 } from '@cadsandbox/doc'
import type { ToolOptionSpec } from '../types'
import { ChainTool } from '../util/chain'
import { lengthOption, newNode, selectOption } from '../util/nodes'
import { toPlane, fromPlane, v2 } from '../util/vec'

const STYLES: RailingParams['style'][] = ['bars', 'glass', 'solid', 'cable']

export const RAILING_OPTIONS: ToolOptionSpec[] = [
  lengthOption('height', 'Height', 1.0, 0.3),
  selectOption('style', 'Style', 'bars', STYLES),
  lengthOption('postSpacing', 'Post spacing', 1.2, 0.2),
  lengthOption('baseOffset', 'Base offset', 0),
]

export class RailingTool extends ChainTool {
  readonly id = 'arch.railing' as const
  override readonly specs = RAILING_OPTIONS

  protected override start(): void {
    this.allowClose = false
    super.start()
  }
  protected override firstHint(): string {
    return 'Railing: click the start point'
  }
  protected override nextHint(): string {
    return 'Click the next point · type length or length<angle · Backspace undo · Enter finish'
  }

  protected override drawChain(points: Vec3[], cursor: Vec3 | null): void {
    super.drawChain(points, cursor)
    // Post markers at the spacing along the path.
    const pts = cursor ? [...points, cursor] : points
    const plane = this.plane()
    const spacing = Math.max(0.2, this.optNum('postSpacing', 1.2))
    const h = this.optNum('height', 1)
    for (let i = 0; i < pts.length - 1; i++) {
      const a = toPlane(plane, pts[i]),
        b = toPlane(plane, pts[i + 1])
      const len = v2.dist(a, b)
      const count = Math.max(1, Math.round(len / spacing))
      for (let k = 0; k <= count; k++) {
        const p = v2.lerp(a, b, k / count)
        this.lines([fromPlane(plane, p), fromPlane(plane, p, h)], { style: 'symbol' })
      }
    }
  }

  protected commitChain(points: Vec3[]): void {
    const parent = this.parent()
    const path = points.map((p) => this.toLocal2(p, parent))
    this.commitNodes([
      newNode(
        'railing',
        {
          path,
          height: Math.max(0.3, this.optNum('height', 1)),
          style: this.optStr<RailingParams['style']>('style', 'bars', STYLES),
          postSpacing: Math.max(0.2, this.optNum('postSpacing', 1.2)),
          baseOffset: this.optNum('baseOffset', 0),
        },
        { parent, name: 'Railing' },
      ),
    ])
  }
}
