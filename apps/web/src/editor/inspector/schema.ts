// Per-node-type field schema driving the Inspector's parameter forms (labels, units, ranges, enums).
import type { FurnitureKind, HatchPattern, NodeType, PrimitiveShape, ProfileKind } from '@cadsandbox/doc'
import { FURNITURE_LABELS } from '../library/catalog'
import { DIN277_LABELS } from '../panels/schedules'

export type FieldKind =
  | 'length' // meters ⇄ doc units
  | 'number'
  | 'angle' // radians ⇄ degrees
  | 'angleDeg' // stored in degrees
  | 'boolean'
  | 'select'
  | 'text'
  | 'textarea'
  | 'color' // nullable hex
  | 'material' // nullable material id
  | 'vec2' // [x,y] lengths
  | 'vec3'
  | 'points' // read-only summary (edit on canvas)
  | 'path'
  | 'wallLayers'
  | 'readonly'

export interface FieldDef {
  key: string
  label: string
  kind: FieldKind
  min?: number
  max?: number
  step?: number
  precision?: number
  unit?: string
  options?: { value: string; label: string }[] | ((params: Record<string, unknown>) => { value: string; label: string }[])
  when?(params: Record<string, unknown>): boolean
  hint?: string
}

const opt = (values: readonly string[], labels?: Record<string, string>) => values.map((v) => ({ value: v, label: labels?.[v] ?? v.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) }))
const len = (key: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, kind: 'length', min: 0, ...extra })
const num = (key: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, kind: 'number', ...extra })
const ang = (key: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, kind: 'angle', ...extra })
const deg = (key: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, kind: 'angleDeg', unit: '°', ...extra })
const bool = (key: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, kind: 'boolean', ...extra })
const sel = (key: string, label: string, options: FieldDef['options'], extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, kind: 'select', options, ...extra })
const text = (key: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, kind: 'text', ...extra })
const color = (key: string, label: string): FieldDef => ({ key, label, kind: 'color' })
const mat = (key: string, label: string): FieldDef => ({ key, label, kind: 'material' })
const pts = (key: string, label: string): FieldDef => ({ key, label, kind: 'points' })
const path = (key: string, label: string): FieldDef => ({ key, label, kind: 'path' })

const PRIMITIVES: PrimitiveShape[] = ['box', 'sphere', 'cylinder', 'cone', 'torus', 'capsule', 'pyramid', 'wedge', 'tube', 'plane', 'disc', 'icosphere', 'prism']
const PROFILES: ProfileKind[] = ['rect', 'circle', 'ellipse', 'triangle', 'polygon', 'star', 'heart', 'arrow', 'cross', 'ring', 'path']
const HATCHES: HatchPattern[] = ['none', 'solid', 'ansi31', 'ansi32', 'ansi37', 'concrete', 'reinforced-concrete', 'brick', 'masonry', 'insulation', 'earth', 'gravel', 'sand', 'wood', 'timber', 'steel', 'glass', 'tiles', 'grass', 'water', 'dots', 'grid']
const DOOR_STYLES = ['single', 'double', 'sliding', 'double-sliding', 'folding', 'pocket', 'garage', 'revolving']
const WINDOW_STYLES = ['casement', 'double-casement', 'fixed', 'sliding', 'tilt-turn', 'awning', 'hung', 'bay', 'skylight']
const shapeIs = (...s: PrimitiveShape[]) => (p: Record<string, unknown>) => s.includes(p.shape as PrimitiveShape)
const profileIs = (...s: ProfileKind[]) => (p: Record<string, unknown>) => s.includes(p.profile as ProfileKind)

export const NODE_SCHEMAS: Record<NodeType, FieldDef[]> = {
  group: [],
  level: [len('height', 'Floor-to-floor', { min: 0.5 }), len('cutHeight', 'Plan cut height'), num('number', 'Storey number', { precision: 0, step: 1 })],
  primitive: [
    sel('shape', 'Shape', opt(PRIMITIVES)),
    len('width', 'Width', { when: shapeIs('box', 'wedge', 'pyramid', 'plane') }),
    len('depth', 'Depth', { when: shapeIs('box', 'wedge', 'pyramid', 'plane') }),
    len('height', 'Height', { when: shapeIs('box', 'cylinder', 'cone', 'capsule', 'pyramid', 'tube', 'prism', 'wedge') }),
    len('radius', 'Radius', { when: shapeIs('sphere', 'icosphere', 'cylinder', 'cone', 'torus', 'disc', 'tube', 'capsule', 'prism') }),
    len('radius2', 'Radius 2', { when: shapeIs('cone', 'torus', 'tube'), hint: 'Cone top · torus tube · tube inner' }),
    num('sides', 'Sides', { min: 3, max: 64, precision: 0, step: 1, when: shapeIs('prism', 'pyramid', 'cylinder') }),
    num('segments', 'Segments (0 = auto)', { min: 0, max: 256, precision: 0, step: 1 }),
    len('cornerRadius', 'Corner radius', { when: shapeIs('box') }),
    ang('sweep', 'Sweep', { min: 0, max: Math.PI * 2, when: shapeIs('cylinder', 'cone', 'torus', 'disc', 'tube') }),
  ],
  shape: [
    sel('profile', 'Profile', opt(PROFILES)),
    len('width', 'Width'),
    len('height', 'Height'),
    num('sides', 'Points / sides', { min: 3, max: 64, precision: 0, step: 1, when: profileIs('polygon', 'star') }),
    num('innerRatio', 'Inner ratio', { min: 0.05, max: 0.95, step: 0.05, when: profileIs('star', 'ring') }),
    len('cornerRadius', 'Corner radius'),
    len('depth', 'Extrusion depth', { hint: '0 = flat face' }),
    len('bevel', 'Bevel'),
    num('bevelSegments', 'Bevel segments', { min: 1, max: 10, precision: 0, step: 1 }),
    sel('direction', 'Direction', opt(['up', 'down', 'symmetric'])),
    path('path', 'Profile path'),
  ],
  revolve: [ang('angle', 'Angle', { min: 0, max: Math.PI * 2 }), num('segments', 'Segments', { min: 3, max: 256, precision: 0, step: 1 }), path('path', 'Profile')],
  loft: [bool('capStart', 'Cap start'), bool('capEnd', 'Cap end'), bool('smooth', 'Smooth'), pts('sections', 'Sections')],
  sweep: [bool('closedPath', 'Closed path'), ang('twist', 'Twist'), bool('smooth', 'Smooth'), pts('path', 'Path'), path('profile', 'Profile')],
  boolean: [sel('op', 'Operation', opt(['union', 'subtract', 'intersect']))],
  mesh: [ang('creaseAngle', 'Crease angle', { min: 0, max: Math.PI }), { key: 'asset', label: 'Mesh blob', kind: 'readonly' }],
  instance: [{ key: 'component', label: 'Component', kind: 'readonly' }],
  text: [
    { key: 'text', label: 'Text', kind: 'textarea' },
    len('size', 'Size (cap height)', { min: 0.001 }),
    sel('font', 'Font', opt(['sans', 'serif', 'mono', 'display'])),
    sel('align', 'Align', opt(['left', 'center', 'right'])),
    len('depth', 'Extrusion'),
    len('bevel', 'Bevel'),
    bool('annotative', 'Annotative (paper size)'),
  ],
  light: [
    sel('kind', 'Type', opt(['point', 'spot', 'directional', 'area'])),
    color('color', 'Color'),
    num('intensity', 'Intensity', { min: 0, step: 10 }),
    len('distance', 'Range (0 = ∞)', { when: (p) => p.kind === 'point' || p.kind === 'spot' }),
    ang('angle', 'Cone angle', { min: 0, max: Math.PI / 2, when: (p) => p.kind === 'spot' }),
    num('penumbra', 'Penumbra', { min: 0, max: 1, step: 0.05, when: (p) => p.kind === 'spot' }),
    len('width', 'Width', { when: (p) => p.kind === 'area' }),
    len('height', 'Height', { when: (p) => p.kind === 'area' }),
    bool('castShadow', 'Cast shadows'),
  ],
  image: [len('width', 'Width'), len('height', 'Height'), num('opacity', 'Opacity', { min: 0, max: 1, step: 0.05 }), bool('planOnly', 'Plan views only'), { key: 'asset', label: 'Image', kind: 'readonly' }],
  section: [bool('enabled', 'Cutting'), bool('showCaps', 'Show caps'), text('label', 'Label'), len('depth', 'View depth (0 = ∞)')],
  line: [{ key: 'a', label: 'Start', kind: 'vec2' }, { key: 'b', label: 'End', kind: 'vec2' }],
  polyline: [bool('closed', 'Closed'), color('fill', 'Fill'), pts('points', 'Vertices')],
  rect: [len('width', 'Width'), len('height', 'Height'), len('cornerRadius', 'Corner radius'), color('fill', 'Fill')],
  circle: [len('radius', 'Radius'), color('fill', 'Fill')],
  arc: [len('radius', 'Radius'), ang('start', 'Start angle'), ang('end', 'End angle')],
  ellipse: [len('rx', 'Radius X'), len('ry', 'Radius Y'), color('fill', 'Fill')],
  spline: [path('path', 'Curve')],
  hatch: [sel('pattern', 'Pattern', opt(HATCHES)), num('scale', 'Scale', { min: 0.05, step: 0.1 }), ang('angle', 'Angle'), color('color', 'Line color'), color('background', 'Background'), pts('boundary', 'Boundary')],
  dimension: [
    sel('kind', 'Type', opt(['linear', 'aligned', 'angular', 'radius', 'diameter', 'arc-length', 'chain'], { chain: 'Chain (Maßkette)' })),
    len('offset', 'Offset', { min: -100 }),
    sel('axis', 'Axis', opt(['auto', 'x', 'y']), { when: (p) => p.kind === 'linear' || p.kind === 'chain' }),
    text('text', 'Text override', { hint: '<> inserts the measured value', when: (p) => p.kind !== 'chain' }),
    pts('points', 'Points'),
  ],
  leader: [text('text', 'Text'), pts('points', 'Points')],
  gridline: [
    text('label', 'Label'),
    sel('bubble', 'Bubbles', opt(['start', 'end', 'both', 'none'])),
    len('extension', 'Bubble distance', { hint: 'From the line end to the bubble' }),
    len('radius', 'Bubble radius', { min: 0.01 }),
    { key: 'a', label: 'Start', kind: 'vec2' },
    { key: 'b', label: 'End', kind: 'vec2' },
  ],
  levelmark: [
    sel('variant', 'Variant', opt(['plan', 'section'], { plan: 'Plan symbol', section: 'Section / elevation flag' })),
    text('prefix', 'Prefix', { hint: 'e.g. OKFF, OKRF, UK' }),
    bool('flip', 'Triangle points up', { when: (p) => p.variant === 'section' }),
  ],
  northarrow: [len('size', 'Size', { min: 0.05 }), sel('style', 'Style', opt(['simple', 'compass'])), ang('angle', 'Rotation to north')],
  scalebar: [num('scale', 'Scale 1:n', { min: 1, step: 1, precision: 0 }), len('length', 'Real length', { min: 0.01 }), num('segments', 'Blocks', { min: 1, max: 50, step: 1, precision: 0 })],
  wall: [
    len('thickness', 'Thickness', { min: 0.01 }),
    len('height', 'Height', { min: 0.05 }),
    len('baseOffset', 'Base offset', { min: -50 }),
    sel('justification', 'Justification', opt(['center', 'left', 'right'])),
    bool('exterior', 'Exterior wall'),
    bool('structural', 'Structural'),
    num('bulge', 'Curve (bulge)', { min: -2, max: 2, step: 0.05 }),
    { key: 'a', label: 'Start', kind: 'vec2' },
    { key: 'b', label: 'End', kind: 'vec2' },
    { key: 'layers', label: 'Layers', kind: 'wallLayers' },
  ],
  opening: [
    sel('kind', 'Kind', opt(['door', 'window', 'opening'])),
    sel('style', 'Style', (p) => (p.kind === 'door' ? opt(DOOR_STYLES) : p.kind === 'window' ? opt(WINDOW_STYLES) : opt(['none']))),
    len('offset', 'Position along wall'),
    len('width', 'Width', { min: 0.1 }),
    len('height', 'Height', { min: 0.1 }),
    len('sill', 'Sill height'),
    len('frameWidth', 'Frame width'),
    len('frameDepth', 'Frame depth'),
    sel('hinge', 'Hinge side', opt(['left', 'right']), { when: (p) => p.kind === 'door' }),
    sel('opensTo', 'Opens to', opt(['left', 'right']), { when: (p) => p.kind !== 'opening' }),
    mat('frameMaterial', 'Frame material'),
    mat('panelMaterial', 'Panel material'),
    mat('glassMaterial', 'Glass material'),
  ],
  slab: [sel('kind', 'Kind', opt(['floor', 'ceiling', 'foundation', 'roof', 'balcony'])), len('thickness', 'Thickness', { min: 0.01 }), len('offset', 'Top offset', { min: -50 }), pts('outline', 'Outline')],
  roof: [
    sel('kind', 'Kind', opt(['flat', 'shed', 'gable', 'hip', 'mansard', 'gambrel', 'pyramid'])),
    deg('pitchDeg', 'Pitch', { min: 0, max: 89 }),
    len('overhang', 'Overhang'),
    len('thickness', 'Thickness', { min: 0.01 }),
    len('baseOffset', 'Eave height', { min: -50 }),
    sel('ridgeAxis', 'Ridge axis', opt(['auto', 'x', 'y'])),
    pts('outline', 'Eave outline'),
  ],
  stair: [
    sel('kind', 'Kind', opt(['straight', 'l-shape', 'u-shape', 'spiral'])),
    len('width', 'Width', { min: 0.5 }),
    len('rise', 'Total rise', { min: 0.1 }),
    num('riserCount', 'Risers (0 = auto, DIN 18065)', { min: 0, max: 60, precision: 0, step: 1 }),
    len('treadDepth', 'Tread depth', { min: 0.15 }),
    len('landingDepth', 'Landing depth', { when: (p) => p.kind !== 'straight' && p.kind !== 'spiral' }),
    sel('turn', 'Turn', opt(['left', 'right']), { when: (p) => p.kind !== 'straight' }),
    sel('structure', 'Structure', opt(['solid', 'stringer', 'floating'])),
    sel('railing', 'Railing', opt(['none', 'left', 'right', 'both'])),
    len('railingHeight', 'Railing height', { when: (p) => p.railing !== 'none' }),
    len('nosing', 'Nosing'),
    len('innerRadius', 'Inner radius', { when: (p) => p.kind === 'spiral' }),
    deg('sweepDeg', 'Sweep', { min: 30, max: 720, when: (p) => p.kind === 'spiral' }),
  ],
  column: [sel('shape', 'Shape', opt(['rect', 'round', 'h-beam'])), len('width', 'Width', { min: 0.02 }), len('depth', 'Depth', { min: 0.02, when: (p) => p.shape !== 'round' }), len('height', 'Height', { min: 0.05 }), len('baseOffset', 'Base offset', { min: -50 })],
  beam: [sel('shape', 'Profile', opt(['rect', 'i-beam', 'round'])), len('width', 'Width', { min: 0.02 }), len('height', 'Height', { min: 0.02 }), { key: 'a', label: 'Start', kind: 'vec3' }, { key: 'b', label: 'End', kind: 'vec3' }],
  railing: [sel('style', 'Style', opt(['bars', 'glass', 'solid', 'cable'])), len('height', 'Height', { min: 0.1 }), len('postSpacing', 'Post spacing', { min: 0.1 }), len('baseOffset', 'Base offset', { min: -50 }), pts('path', 'Path')],
  room: [
    text('number', 'Room number'),
    sel('usage', 'Usage (DIN 277)', opt(Object.keys(DIN277_LABELS), Object.fromEntries(Object.entries(DIN277_LABELS).map(([k, v]) => [k, `${k} · ${v}`])))),
    len('ceilingHeight', 'Ceiling height'),
    mat('floorFinish', 'Floor finish'),
    bool('showLabel', 'Show room stamp'),
    color('fill', 'Plan fill'),
    bool('auto', 'Follow surrounding walls'),
    pts('outline', 'Outline'),
  ],
  furniture: [
    sel('kind', 'Kind', opt(Object.keys(FURNITURE_LABELS), FURNITURE_LABELS as Record<string, string>)),
    len('width', 'Width', { min: 0.05 }),
    len('depth', 'Depth', { min: 0.05 }),
    len('height', 'Height', { min: 0.01 }),
    num('variant', 'Variant', { min: 0, max: 9, precision: 0, step: 1 }),
    mat('primaryMaterial', 'Primary material'),
    mat('secondaryMaterial', 'Secondary material'),
  ],
  terrain: [len('width', 'Width', { min: 1 }), len('depth', 'Depth', { min: 1 }), num('resolution', 'Resolution', { min: 0, max: 512, precision: 0, step: 1 }), pts('heights', 'Height samples')],
}

export type { FurnitureKind }

export type QuantityKind = 'length' | 'area' | 'volume' | 'count' | 'angle' | 'deg' | 'scale' | 'number' | 'hidden'

/** Quantities keys (GeometryResult.quantities, see packages/geometry evaluators) shown in the
 *  inspector. `agg: 'same'` marks intensive values (heights, thicknesses, …): a multi-selection shows
 *  the common value or a min – max range instead of adding them up. */
export const QUANTITY_LABELS: Record<string, { label: string; kind: QuantityKind; agg?: 'sum' | 'same' }> = {
  length: { label: 'Length', kind: 'length' },
  perimeter: { label: 'Perimeter', kind: 'length' },
  height: { label: 'Height', kind: 'length', agg: 'same' },
  width: { label: 'Width', kind: 'length', agg: 'same' },
  depth: { label: 'Depth', kind: 'length', agg: 'same' },
  thickness: { label: 'Thickness', kind: 'length', agg: 'same' },
  area: { label: 'Area', kind: 'area' },
  netArea: { label: 'Net area', kind: 'area' },
  grossArea: { label: 'Gross area', kind: 'area' },
  openingArea: { label: 'Opening area', kind: 'area' },
  surfaceArea: { label: 'Surface area', kind: 'area' },
  surface: { label: 'Surface area', kind: 'area' },
  footprint: { label: 'Footprint', kind: 'area' },
  volume: { label: 'Volume', kind: 'volume' },
  count: { label: 'Count', kind: 'count' },
  openings: { label: 'Openings', kind: 'count' },
  posts: { label: 'Posts', kind: 'count' },
  operands: { label: 'Operands', kind: 'count' },
  segments: { label: 'Segments', kind: 'count' },
  riserCount: { label: 'Risers', kind: 'count' },
  risers: { label: 'Risers', kind: 'count' },
  treads: { label: 'Treads', kind: 'count' },
  riserHeight: { label: 'Riser height', kind: 'length', agg: 'same' },
  treadDepth: { label: 'Tread depth', kind: 'length', agg: 'same' },
  rise: { label: 'Total rise', kind: 'length', agg: 'same' },
  run: { label: 'Run', kind: 'length', agg: 'same' },
  comfort: { label: 'Step length (2R + G)', kind: 'length', agg: 'same' },
  sill: { label: 'Sill height', kind: 'length', agg: 'same' },
  ridgeHeight: { label: 'Ridge height', kind: 'length', agg: 'same' },
  minHeight: { label: 'Lowest point', kind: 'length', agg: 'same' },
  maxHeight: { label: 'Highest point', kind: 'length', agg: 'same' },
  elevation: { label: 'Elevation', kind: 'length', agg: 'same' },
  value: { label: 'Measured value', kind: 'length', agg: 'same' },
  slope: { label: 'Slope', kind: 'angle', agg: 'same' },
  pitch: { label: 'Pitch', kind: 'angle', agg: 'same' },
  angle: { label: 'Angle', kind: 'angle', agg: 'same' },
  angleDeg: { label: 'Rotation to north', kind: 'deg', agg: 'same' },
  scale: { label: 'Scale', kind: 'scale', agg: 'same' },
  triangles: { label: 'Triangles', kind: 'count' },
  vertices: { label: 'Vertices', kind: 'count' },
  auto: { label: 'Auto', kind: 'hidden' },
}

/** Chain dimensions report each interval as `segment1…n`. */
export function quantityInfo(key: string): { label: string; kind: QuantityKind; agg: 'sum' | 'same'; vars?: Record<string, number> } {
  const known = QUANTITY_LABELS[key]
  if (known) return { ...known, agg: known.agg ?? 'sum' }
  const seg = /^segment(\d+)$/.exec(key)
  if (seg) return { label: 'Segment {n}', kind: 'length', agg: 'same', vars: { n: Number(seg[1]) } }
  return { label: key, kind: 'number', agg: 'same' }
}
