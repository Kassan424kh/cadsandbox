// draw.hatch — click inside a closed region bounded by lines/polylines/walls → 'hatch' node whose
// boundary is the enclosing planar face (islands become holes). Hover previews the region.
import type { HatchPattern, Vec2 } from '@cadsandbox/doc'
import type { ToolOptionSpec, ToolPointerEvent } from '../types'
import { ToolBase, isPrimary } from '../util/base'
import { formatArea } from '../util/input'
import { LAYERS, angleOption, newNode, numberOption, selectOption } from '../util/nodes'
import { buildPlanarGraph, regionAt, type PlanarGraph, type Region } from '../util/planar'
import { centroid, signedArea } from '../util/polygon'
import { outlineToWorld, regionSegments } from '../util/regions'

export const HATCH_PATTERNS: HatchPattern[] = [
  'ansi31',
  'ansi32',
  'ansi37',
  'solid',
  'concrete',
  'reinforced-concrete',
  'brick',
  'masonry',
  'insulation',
  'earth',
  'gravel',
  'sand',
  'wood',
  'timber',
  'steel',
  'glass',
  'tiles',
  'grass',
  'water',
  'dots',
  'grid',
]

export const HATCH_OPTIONS: ToolOptionSpec[] = [
  selectOption('pattern', 'Pattern', 'ansi31', HATCH_PATTERNS),
  numberOption('scale', 'Scale', 1, 0.05, 50),
  angleOption('angle', 'Angle', 0),
  { key: 'includeWalls', label: 'Wall faces bound regions', kind: 'boolean', default: true },
]

export class HatchTool extends ToolBase {
  readonly id = 'draw.hatch' as const
  override readonly specs = HATCH_OPTIONS
  private graph: PlanarGraph | null = null
  private unsubscribe: (() => void) | null = null
  private hover: Region | null = null

  protected override start(): void {
    this.hint('Hatch: click inside a closed region · options: pattern, scale, angle')
    this.unsubscribe = this.ctx.doc.onChange(() => (this.graph = null))
  }
  protected override stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.graph = null
  }
  protected override optionsChanged(): void {
    this.graph = null
  }
  protected isBusy(): boolean {
    return false
  }
  protected reset(): void {
    this.clearAll()
  }

  private ensureGraph(): PlanarGraph {
    if (!this.graph) {
      const segs = regionSegments(this.ctx, { drafting: true, walls: this.optBool('includeWalls', true) ? 'outline' : false })
      this.graph = buildPlanarGraph(segs)
    }
    return this.graph
  }

  private regionAtPointer(e: ToolPointerEvent): Region | null {
    const hit = this.planeHit(e)
    if (!hit) return null
    const p = this.toLocal2(hit)
    return regionAt(this.ensureGraph(), p)
  }

  onPointerMove(e: ToolPointerEvent): void {
    this.clearAll()
    this.hover = this.regionAtPointer(e)
    if (!this.hover) return
    const parent = this.parent()
    const world = outlineToWorld(this.ctx, parent, this.hover.outline)
    this.polygon(world, { opacity: 0.25 })
    this.lines(world, { closed: true, style: 'rubber' })
    for (const h of this.hover.holes) this.lines(outlineToWorld(this.ctx, parent, h), { closed: true, style: 'rubber' })
    const holeArea = this.hover.holes.reduce((s, h) => s + Math.abs(signedArea(h)), 0)
    const c = centroid(this.hover.outline)
    this.label(this.ctx.toWorld(parent, [c[0], c[1], 0]), formatArea(this.hover.face.area - holeArea), 'measure')
  }

  onPointerDown(e: ToolPointerEvent): boolean {
    if (!isPrimary(e)) return false
    const region = this.regionAtPointer(e)
    this.clearAll()
    if (!region) {
      this.ctx.notify('info', 'No closed region here — draw lines, polylines or walls that enclose the point')
      return true
    }
    const parent = this.parent()
    this.commitNodes([
      newNode(
        'hatch',
        {
          boundary: region.outline.map((p) => [p[0], p[1]] as Vec2),
          ...(region.holes.length ? { holes: region.holes.map((h) => h.map((p) => [p[0], p[1]] as Vec2)) } : {}),
          pattern: this.optStr<HatchPattern>('pattern', 'ansi31', HATCH_PATTERNS),
          scale: Math.max(0.01, this.optNum('scale', 1)),
          angle: this.optNum('angle', 0),
        },
        { parent, layer: LAYERS.hatch },
      ),
    ])
    return true
  }
}
