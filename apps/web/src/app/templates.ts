// Project templates, built with the public CadDocument API (so they stay valid as the model evolves).
import { quatFromAxisAngle, type CadDocument, type NewNode, type Quat, type Vec2, type Vec3 } from '@cadsandbox/doc'
import type { ProjectSeed } from '../data/seed'

export type TemplateId = 'empty' | 'floorplan' | 'product' | 'drawing'

export interface TemplateInfo {
  id: TemplateId
  /** i18n key + English fallback */
  name: [string, string]
  description: [string, string]
  units: 'mm' | 'cm' | 'm'
  seed(): ProjectSeed
}

const rotZ = (deg: number): Quat => quatFromAxisAngle([0, 0, 1], (deg * Math.PI) / 180)
const at = (p: Vec3, deg = 0) => ({ p, r: rotZ(deg), s: [1, 1, 1] as Vec3 })

// ------------------------------------------------------------------ Floor plan: furnished two-room house
function buildFloorPlan(doc: CadDocument): void {
  const W = 10
  const D = 7
  const T = 0.3 // exterior wall thickness (centre-line loop)
  const h = T / 2
  const level = doc.addNode({ type: 'level', name: 'Ground Floor', params: { height: 3, cutHeight: 1.1, number: 0 } })
  doc.setMeta({ activeLevel: level })

  const wall = (name: string, a: Vec2, b: Vec2, thickness = T, exterior = true) =>
    doc.addNode({ type: 'wall', name, parent: level, layer: 'layer-walls', params: { a, b, thickness, height: 2.75, baseOffset: 0, justification: 'center', exterior, structural: exterior } })
  const south = wall('Wall South', [0, 0], [W, 0])
  const east = wall('Wall East', [W, 0], [W, D])
  const north = wall('Wall North', [W, D], [0, D])
  const west = wall('Wall West', [0, D], [0, 0])
  const inner = wall('Partition', [6, 0], [6, D], 0.115, false)

  const door = (host: string, name: string, offset: number, width: number, hinge: 'left' | 'right' = 'left'): NewNode<'opening'> => ({
    type: 'opening',
    name,
    parent: host,
    layer: 'layer-openings',
    params: { kind: 'door', style: 'single', offset, width, height: 2.135, sill: 0, hinge, opensTo: 'left' },
  })
  const window = (host: string, name: string, offset: number, width: number, style: 'casement' | 'fixed' | 'tilt-turn' = 'tilt-turn'): NewNode<'opening'> => ({
    type: 'opening',
    name,
    parent: host,
    layer: 'layer-openings',
    params: { kind: 'window', style, offset, width, height: 1.35, sill: 0.9 },
  })
  doc.addNodes([
    door(south, 'Entrance', 1.6, 1.01),
    window(south, 'Window Dining', 3.9, 1.6),
    window(south, 'Window Study', 8.0, 1.2),
    window(east, 'Window Bedroom East', 3.5, 1.2),
    window(north, 'Window Bedroom North', 1.2, 1.0),
    window(north, 'Window Kitchen', 6.0, 2.0, 'fixed'),
    window(west, 'Window Living', 3.5, 1.4),
    door(inner, 'Bedroom Door', 5.2, 0.885, 'right'),
  ])

  const outer: Vec2[] = [
    [-h, -h],
    [W + h, -h],
    [W + h, D + h],
    [-h, D + h],
  ]
  doc.addNode({ type: 'slab', name: 'Floor Slab', parent: level, layer: 'layer-structure', params: { kind: 'floor', outline: outer, thickness: 0.2, offset: 0 } })
  doc.addNode({
    type: 'roof',
    name: 'Gable Roof',
    parent: level,
    layer: 'layer-structure',
    params: { kind: 'gable', outline: outer, pitchDeg: 35, overhang: 0.5, thickness: 0.25, baseOffset: 2.75, ridgeAxis: 'x' },
  })

  const ih = 0.115 / 2
  doc.addNodes([
    {
      type: 'room',
      name: 'Living / Kitchen',
      parent: level,
      layer: 'layer-anno',
      params: { outline: [[h, h], [6 - ih, h], [6 - ih, D - h], [h, D - h]], number: '0.01', usage: 'NUF1', showLabel: true, floorFinish: 'mat-parquet-oak' },
    },
    {
      type: 'room',
      name: 'Bedroom',
      parent: level,
      layer: 'layer-anno',
      params: { outline: [[6 + ih, h], [W - h, h], [W - h, D - h], [6 + ih, D - h]], number: '0.02', usage: 'NUF1', showLabel: true, floorFinish: 'mat-oak' },
    },
  ])

  type Kind = NonNullable<NewNode<'furniture'>['params']>['kind']
  const f = (kind: Kind, name: string, p: Vec3, deg: number, extra: Partial<{ width: number; depth: number; height: number; primaryMaterial: string }> = {}): NewNode<'furniture'> => ({
    type: 'furniture',
    name,
    parent: level,
    layer: 'layer-furniture',
    t: at(p, deg),
    params: { kind, ...extra },
  })
  const inY = D - h // north wall inner face
  doc.addNodes([
    // living
    f('rug', 'Rug', [1.2, 4.2, 0], 90, { width: 2.4, depth: 1.8 }),
    f('sofa', 'Sofa', [h, 4.2, 0], 90, { primaryMaterial: 'mat-fabric-grey' }),
    f('coffee-table', 'Coffee Table', [1.45, 4.2, 0], 90, { primaryMaterial: 'mat-walnut' }),
    f('tv-unit', 'TV Unit', [6 - ih, 4.2, 0], -90),
    f('plant', 'Plant', [0.55, 6.35, 0], 0),
    f('dining-table', 'Dining Table', [3.0, 1.95, 0], 0, { primaryMaterial: 'mat-oak' }),
    f('chair', 'Chair', [2.55, 2.45, 0], 0),
    f('chair', 'Chair', [3.45, 2.45, 0], 0),
    f('chair', 'Chair', [2.55, 0.55, 0], 180),
    f('chair', 'Chair', [3.45, 0.55, 0], 180),
    // kitchen run along the north wall
    f('kitchen-base', 'Kitchen Base', [3.3, inY, 0], 0),
    f('sink', 'Sink', [4.0, inY, 0], 0),
    f('stove', 'Stove', [4.7, inY, 0], 0),
    f('fridge', 'Fridge', [5.4, inY, 0], 0),
    // bedroom
    f('bed-double', 'Double Bed', [W - h, 4.0, 0], -90, { primaryMaterial: 'mat-fabric-beige' }),
    f('nightstand', 'Nightstand', [W - h, 5.25, 0], -90),
    f('nightstand', 'Nightstand', [W - h, 2.75, 0], -90),
    f('wardrobe', 'Wardrobe', [7.15, inY, 0], 0),
    f('desk', 'Desk', [8.0, h, 0], 180, { primaryMaterial: 'mat-oak' }),
    f('chair', 'Desk Chair', [8.0, 1.4, 0], 0),
  ])
}

// ------------------------------------------------------------------ Product design: lamp concept + forms
function buildProduct(doc: CadDocument): void {
  const prim = (name: string, params: NonNullable<NewNode<'primitive'>['params']>, p: Vec3, material: string, color: string | null = null): NewNode<'primitive'> => ({
    type: 'primitive',
    name,
    params,
    t: at(p),
    material,
    color,
  })
  const lamp = doc.addNodes([
    prim('Base', { shape: 'box', width: 0.3, depth: 0.3, height: 0.02, cornerRadius: 0.008 }, [0, 0, 0], 'mat-walnut'),
    prim('Body', { shape: 'cylinder', radius: 0.07, height: 0.16, sides: 64 }, [0, 0, 0.02], 'mat-plastic-soft', '#7c5cff'),
    prim('Ring', { shape: 'torus', radius: 0.075, radius2: 0.008 }, [0, 0, 0.1], 'mat-chrome'),
    prim('Knob', { shape: 'sphere', radius: 0.03 }, [0, 0, 0.18], 'mat-gold'),
  ])
  doc.groupNodes(lamp, 'Lamp Concept')
  doc.addNodes([
    {
      type: 'shape',
      name: 'Star Badge',
      t: at([0.26, 0.02, 0], 12),
      material: 'mat-plastic-glossy',
      color: '#ff9500',
      params: { profile: 'star', width: 0.12, height: 0.12, sides: 5, innerRatio: 0.45, depth: 0.018, bevel: 0.003, bevelSegments: 3, direction: 'up' },
    },
    prim('Cone', { shape: 'cone', radius: 0.05, height: 0.11 }, [-0.24, 0.06, 0], 'mat-clay'),
    prim('Capsule', { shape: 'capsule', radius: 0.025, height: 0.12 }, [-0.2, -0.16, 0], 'mat-plastic-glossy', '#0fb5ff'),
    prim('Tube', { shape: 'tube', radius: 0.045, radius2: 0.03, height: 0.05 }, [0.2, -0.2, 0], 'mat-steel-brushed'),
    {
      type: 'text',
      name: 'Label',
      t: at([-0.14, -0.3, 0]),
      material: 'mat-black-matte',
      params: { text: 'CadSandbox', size: 0.028, font: 'display', align: 'left', depth: 0.004 },
    },
  ])
}

// ------------------------------------------------------------------ 2D drawing: flange plate on layers
function buildDrawing(doc: CadDocument): void {
  const outline = doc.addLayer({ name: 'Outline', color: '#f5f5f5', lineWeight: 0.5 })
  const center = doc.addLayer({ name: 'Center Lines', color: '#fca5a5', lineWeight: 0.18, lineType: 'center' })
  const hidden = doc.addLayer({ name: 'Hidden', color: '#94a3b8', lineWeight: 0.18, lineType: 'hidden' })
  const dims = 'layer-dims'
  const anno = 'layer-anno'
  const hatch = 'layer-hatch'
  const n = <T extends NewNode>(node: T): T => node
  const bolt = (x: number, y: number) => n({ type: 'circle', name: 'Bolt Hole Ø12', layer: outline, t: at([x, y, 0]), params: { radius: 0.006 } })
  doc.addNodes([
    n({ type: 'rect', name: 'Plate 200×120', layer: outline, t: at([0, 0, 0]), params: { width: 0.2, height: 0.12, cornerRadius: 0.01 } }),
    n({ type: 'circle', name: 'Bore Ø60', layer: outline, t: at([0, 0, 0]), params: { radius: 0.03 } }),
    bolt(-0.08, -0.04),
    bolt(0.08, -0.04),
    bolt(-0.08, 0.04),
    bolt(0.08, 0.04),
    n({ type: 'arc', name: 'Slot', layer: outline, t: at([0, 0, 0]), params: { radius: 0.045, start: (20 * Math.PI) / 180, end: (160 * Math.PI) / 180 } }),
    n({ type: 'circle', name: 'Counterbore Ø76', layer: hidden, t: at([0, 0, 0]), params: { radius: 0.038 } }),
    n({ type: 'line', name: 'Center Line X', layer: center, params: { a: [-0.12, 0], b: [0.12, 0] } }),
    n({ type: 'line', name: 'Center Line Y', layer: center, params: { a: [0, -0.08], b: [0, 0.08] } }),
    n({
      type: 'polyline',
      name: 'Keyway',
      layer: outline,
      params: { points: [[-0.006, 0.029], [-0.006, 0.036], [0.006, 0.036], [0.006, 0.029]], closed: false },
    }),
    n({
      type: 'hatch',
      name: 'Section A–A',
      layer: hatch,
      params: { boundary: [[0.14, -0.06], [0.16, -0.06], [0.16, 0.06], [0.14, 0.06]], pattern: 'ansi31', scale: 0.4, angle: 0 },
    }),
    n({ type: 'rect', name: 'Section Outline', layer: outline, t: at([0.15, 0, 0]), params: { width: 0.02, height: 0.12 } }),
    n({ type: 'dimension', name: 'Width', layer: dims, params: { kind: 'linear', axis: 'x', points: [[-0.1, -0.06, 0], [0.1, -0.06, 0]], offset: 0.025 } }),
    n({ type: 'dimension', name: 'Height', layer: dims, params: { kind: 'linear', axis: 'y', points: [[-0.1, -0.06, 0], [-0.1, 0.06, 0]], offset: 0.025 } }),
    n({ type: 'dimension', name: 'Bore', layer: dims, params: { kind: 'diameter', points: [[0, 0, 0], [0.03, 0, 0]], offset: 0.01 } }),
    n({ type: 'leader', name: 'Note', layer: anno, params: { points: [[0.021, 0.021], [0.06, 0.075]], text: '4× Ø12 through' } }),
    n({ type: 'text', name: 'Title', layer: anno, t: at([-0.1, -0.11, 0]), params: { text: 'Flange plate — scale 1:1', size: 0.007, font: 'sans', align: 'left', depth: 0, annotative: true } }),
  ])
}

export const TEMPLATES: readonly TemplateInfo[] = [
  {
    id: 'empty',
    name: ['templates.empty.name', 'Empty 3D'],
    description: ['templates.empty.desc', 'A blank canvas with a ground grid — start from scratch.'],
    units: 'mm',
    seed: () => ({ designs: [{ name: 'Main' }] }),
  },
  {
    id: 'floorplan',
    name: ['templates.floorplan.name', 'Floor plan'],
    description: ['templates.floorplan.desc', 'A furnished two-room house with walls, doors, windows, slab, gable roof and rooms.'],
    units: 'm',
    seed: () => ({ units: 'm', designs: [{ name: 'Ground Floor Plan', init: buildFloorPlan }] }),
  },
  {
    id: 'product',
    name: ['templates.product.name', 'Product design'],
    description: ['templates.product.desc', 'Parametric primitives, an extruded shape and materials — a lamp concept.'],
    units: 'mm',
    seed: () => ({ units: 'mm', designs: [{ name: 'Lamp Concept', init: buildProduct }] }),
  },
  {
    id: 'drawing',
    name: ['templates.drawing.name', '2D drawing'],
    description: ['templates.drawing.desc', 'A dimensioned flange plate on layers: outlines, center lines, hatch and notes.'],
    units: 'mm',
    seed: () => ({ units: 'mm', designs: [{ name: 'Flange Plate', init: buildDrawing }] }),
  },
]

export function getTemplate(id: string | null | undefined): TemplateInfo {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0]!
}
