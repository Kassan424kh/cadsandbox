// arch.beam — two points at the level height (axis elevation option) → 'beam' node on the
// structure layer; typed length/angle supported.
import type { BeamParams, Vec3 } from '@cadsandbox/doc'
import type { ToolOptionSpec } from '../types'
import { ChainTool } from '../util/chain'
import { LAYERS, lengthOption, newNode, selectOption } from '../util/nodes'
import { toPlane, fromPlane, v2, v3 } from '../util/vec'

const SHAPES: BeamParams['shape'][] = ['rect', 'i-beam', 'round']

export const BEAM_OPTIONS: ToolOptionSpec[] = [
  selectOption('shape', 'Shape', 'rect', SHAPES),
  lengthOption('width', 'Width', 0.2, 0.02),
  lengthOption('height', 'Height', 0.4, 0.02),
  lengthOption('elevation', 'Axis elevation (0 = level height)', 0),
  { key: 'chain', label: 'Chain beams', kind: 'boolean', default: false },
]

export class BeamTool extends ChainTool {
  readonly id = 'arch.beam' as const
  override readonly specs = BEAM_OPTIONS

  protected override start(): void {
    this.allowClose = false
    super.start()
  }
  protected override firstHint(): string {
    return 'Beam: click the start point'
  }
  protected override nextHint(): string {
    return 'Click the end point · type length or length<angle'
  }
  protected override pointAdded(): void {
    if (!this.optBool('chain', false) && this.points.length >= 2) this.finishChain(false)
  }

  private elevation(): number {
    const e = this.optNum('elevation', 0)
    return e > 0 ? e : this.levelHeight()
  }

  protected override drawChain(points: Vec3[], cursor: Vec3 | null): void {
    const pts = cursor ? [...points, cursor] : points
    const plane = this.plane()
    const z = this.elevation()
    const hw = this.optNum('width', 0.2) / 2
    for (let i = 0; i < pts.length - 1; i++) {
      const a = toPlane(plane, pts[i]),
        b = toPlane(plane, pts[i + 1])
      if (v2.dist(a, b) < 1e-9) continue
      const n = v2.perp(v2.norm(v2.sub(b, a)))
      const quad = [v2.add(a, v2.scale(n, hw)), v2.add(b, v2.scale(n, hw)), v2.add(b, v2.scale(n, -hw)), v2.add(a, v2.scale(n, -hw))].map((p) => fromPlane(plane, p, z))
      this.polygon(quad, { opacity: 0.25 })
      this.lines(quad, { closed: true, style: 'rubber' })
      this.lines([fromPlane(plane, a, z), fromPlane(plane, b, z)], { style: 'guide', dashed: true })
    }
    if (cursor && points.length) this.distanceLabel(points[points.length - 1], cursor)
  }

  protected commitChain(points: Vec3[]): void {
    const parent = this.parent()
    const z = this.elevation()
    const nodes = []
    for (let i = 0; i < points.length - 1; i++) {
      const a = this.toLocal2(points[i], parent),
        b = this.toLocal2(points[i + 1], parent)
      if (v3.dist(points[i], points[i + 1]) < 1e-6) continue
      nodes.push(
        newNode(
          'beam',
          {
            a: [a[0], a[1], z],
            b: [b[0], b[1], z],
            shape: this.optStr<BeamParams['shape']>('shape', 'rect', SHAPES),
            width: Math.max(0.02, this.optNum('width', 0.2)),
            height: Math.max(0.02, this.optNum('height', 0.4)),
          },
          { parent, layer: LAYERS.structure, name: 'Beam' },
        ),
      )
    }
    if (nodes.length) this.commitNodes(nodes)
  }
}
