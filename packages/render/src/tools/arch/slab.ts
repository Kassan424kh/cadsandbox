// arch.slab — click inside a wall loop (building footprint to the outer wall faces, or a single
// room) or draw the outline; options kind / thickness / offset.
import type { SlabKind, Vec2 } from '@cadsandbox/doc'
import type { ToolOptionSpec } from '../types'
import { lengthOption, newNode, selectOption } from '../util/nodes'
import { buildingOutlineAt, roomOutlineAt } from '../util/regions'
import { RegionChainTool } from './regionTool'

const KINDS: SlabKind[] = ['floor', 'ceiling', 'foundation', 'roof', 'balcony']

export const SLAB_OPTIONS: ToolOptionSpec[] = [
  selectOption('mode', 'Mode', 'auto', [
    { value: 'auto', label: 'Click inside walls' },
    { value: 'polygon', label: 'Draw outline' },
  ]),
  selectOption('extent', 'Extent', 'building', [
    { value: 'building', label: 'Whole wall loop (outer faces)' },
    { value: 'room', label: 'Single room (inner faces)' },
  ]),
  selectOption('kind', 'Kind', 'floor', KINDS),
  lengthOption('thickness', 'Thickness', 0.2, 0.01),
  lengthOption('offset', 'Top offset', 0),
]

export class SlabTool extends RegionChainTool {
  readonly id = 'arch.slab' as const
  override readonly specs = SLAB_OPTIONS

  protected regionMode(): 'auto' | 'polygon' {
    return this.optStr('mode', 'auto', ['auto', 'polygon'])
  }
  protected autoHint(): string {
    return 'Slab: click inside a loop of walls · options: extent, kind, thickness'
  }
  protected autoOutline(point: Vec2): Vec2[] | null {
    const wg = this.cache.get()
    if (this.optStr('extent', 'building', ['building', 'room']) === 'room') return roomOutlineAt(this.ctx, wg, point)?.outline ?? null
    return buildingOutlineAt(this.ctx, wg, point)?.outline ?? null
  }
  protected commitOutline(outline: Vec2[]): void {
    const kind = this.optStr<SlabKind>('kind', 'floor', KINDS)
    this.commitNodes([
      newNode(
        'slab',
        { kind, outline: outline.map((p) => [p[0], p[1]] as Vec2), thickness: Math.max(0.01, this.optNum('thickness', 0.2)), offset: this.optNum('offset', 0) },
        { parent: this.parent(), name: kind === 'floor' ? 'Floor slab' : `${kind.charAt(0).toUpperCase()}${kind.slice(1)} slab` },
      ),
    ])
  }
}
