// arch.roof — pick a wall loop (eave outline = outer wall faces) or draw the outline; options
// kind / pitch / overhang / thickness / eave elevation.
import type { RoofKind, Vec2 } from '@cadsandbox/doc'
import type { ToolOptionSpec } from '../types'
import { lengthOption, newNode, numberOption, selectOption } from '../util/nodes'
import { buildingOutlineAt } from '../util/regions'
import { RegionChainTool } from './regionTool'

const KINDS: RoofKind[] = ['flat', 'shed', 'gable', 'hip', 'mansard', 'gambrel', 'pyramid']

export const ROOF_OPTIONS: ToolOptionSpec[] = [
  selectOption('mode', 'Mode', 'auto', [
    { value: 'auto', label: 'Click inside walls' },
    { value: 'polygon', label: 'Draw outline' },
  ]),
  selectOption('kind', 'Kind', 'gable', KINDS),
  numberOption('pitchDeg', 'Pitch (°)', 35, 0, 89),
  lengthOption('overhang', 'Overhang', 0.5),
  lengthOption('thickness', 'Thickness', 0.25, 0.01),
  lengthOption('baseOffset', 'Eave elevation (0 = level height)', 0),
  selectOption('ridgeAxis', 'Ridge axis', 'auto', ['auto', 'x', 'y']),
]

export class RoofTool extends RegionChainTool {
  readonly id = 'arch.roof' as const
  override readonly specs = ROOF_OPTIONS

  protected regionMode(): 'auto' | 'polygon' {
    return this.optStr('mode', 'auto', ['auto', 'polygon'])
  }
  protected autoHint(): string {
    return 'Roof: click inside a loop of walls · options: kind, pitch, overhang'
  }
  protected autoOutline(point: Vec2): Vec2[] | null {
    return buildingOutlineAt(this.ctx, this.cache.get(), point)?.outline ?? null
  }
  protected commitOutline(outline: Vec2[]): void {
    const base = this.optNum('baseOffset', 0)
    this.commitNodes([
      newNode(
        'roof',
        {
          kind: this.optStr<RoofKind>('kind', 'gable', KINDS),
          outline: outline.map((p) => [p[0], p[1]] as Vec2),
          pitchDeg: Math.max(0, Math.min(89, this.optNum('pitchDeg', 35))),
          overhang: Math.max(0, this.optNum('overhang', 0.5)),
          thickness: Math.max(0.01, this.optNum('thickness', 0.25)),
          baseOffset: base > 0 ? base : this.levelHeight(),
          ridgeAxis: this.optStr<'auto' | 'x' | 'y'>('ridgeAxis', 'auto', ['auto', 'x', 'y']),
        },
        { parent: this.parent(), name: 'Roof' },
      ),
    ])
  }
}
