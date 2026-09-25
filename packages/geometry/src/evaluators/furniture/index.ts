// Parametric furniture / fixtures: recognizable low-poly 3D + clean plan symbols for every
// FurnitureKind. Frame: origin at the center of the back edge on the floor, front faces −Y:
// x ∈ [−w/2, w/2], y ∈ [−d, 0], z ∈ [0, h]. Primary material = node material (or
// params.primaryMaterial), secondary = params.secondaryMaterial or a per-kind default.
import type { FurnitureKind, NodeBase } from '@cadsandbox/doc'
import type { GeometryResult } from '../../api'
import { DrawingBuilder } from '../../core/drawing'
import { PartSet } from '../../core/solids'
import { finish, snap } from '../result'
import { KITCHEN_BATH } from './kitchen-bath'
import { LIVING } from './living'
import { OUTDOOR } from './outdoor'

export interface FurnitureSpec {
  kind: FurnitureKind
  w: number
  d: number
  h: number
  variant: number
  /** null = node material */
  primary: string | null
  secondary: string
}

export type FurnitureBuilder = (parts: PartSet, s: FurnitureSpec, plan: DrawingBuilder) => void

const SECONDARY_DEFAULT: Partial<Record<FurnitureKind, string>> = {
  sofa: 'mat-steel-dark',
  armchair: 'mat-steel-dark',
  chair: 'mat-oak',
  stool: 'mat-steel-dark',
  'dining-table': 'mat-oak',
  'coffee-table': 'mat-steel-dark',
  desk: 'mat-steel-dark',
  'bed-single': 'mat-oak',
  'bed-double': 'mat-oak',
  nightstand: 'mat-oak',
  wardrobe: 'mat-oak',
  shelf: 'mat-oak',
  dresser: 'mat-oak',
  'tv-unit': 'mat-black-matte',
  'kitchen-base': 'mat-granite',
  'kitchen-wall': 'mat-granite',
  'kitchen-island': 'mat-granite',
  fridge: 'mat-steel-brushed',
  stove: 'mat-black-matte',
  oven: 'mat-black-matte',
  dishwasher: 'mat-steel-brushed',
  sink: 'mat-steel-brushed',
  toilet: 'mat-chrome',
  washbasin: 'mat-chrome',
  bathtub: 'mat-chrome',
  shower: 'mat-glass',
  'washing-machine': 'mat-black-matte',
  plant: 'mat-grass',
  tree: 'mat-grass',
  'lamp-floor': 'mat-emissive-white',
  'lamp-pendant': 'mat-emissive-white',
  rug: 'mat-fabric-beige',
  piano: 'mat-black-matte',
  car: 'mat-glass-tinted',
  person: 'mat-fabric-grey',
  bicycle: 'mat-black-matte',
}

const BUILDERS = { ...LIVING, ...KITCHEN_BATH, ...OUTDOOR } as Record<FurnitureKind, FurnitureBuilder>

export function evaluateFurniture(node: NodeBase<'furniture'>): GeometryResult {
  const p = node.params
  const spec: FurnitureSpec = {
    kind: p.kind,
    w: Math.max(0.05, p.width),
    d: Math.max(0.05, p.depth),
    h: Math.max(0.01, p.height),
    variant: p.variant ?? 0,
    primary: p.primaryMaterial ?? null,
    secondary: p.secondaryMaterial ?? SECONDARY_DEFAULT[p.kind] ?? 'mat-steel-dark',
  }
  const parts = new PartSet()
  const plan = new DrawingBuilder()
  const build = BUILDERS[p.kind] ?? LIVING.sofa
  build(parts, spec, plan)
  const { w, d, h } = spec
  const snaps = [
    snap('insertion', 0, 0, 0),
    snap('center', 0, -d / 2, 0),
    snap('endpoint', -w / 2, 0, 0),
    snap('endpoint', w / 2, 0, 0),
    snap('endpoint', -w / 2, -d, 0),
    snap('endpoint', w / 2, -d, 0),
    snap('midpoint', 0, -d, 0),
  ]
  return finish(parts.build(), {
    edges: 'auto',
    plan: plan.build(),
    snaps,
    quantities: { width: w, depth: d, height: h, footprint: w * d },
    extraBounds: { min: [-w / 2, -d, 0], max: [w / 2, 0, h] },
  })
}
