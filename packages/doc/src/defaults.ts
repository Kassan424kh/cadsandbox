// Defaults: node params, document meta, layers and the built-in material library.
// Architectural defaults follow common German/EU practice (DIN 18065 stairs, DIN 18101 doors).
import type {
  DocMeta,
  FurnitureKind,
  LayerDef,
  MaterialDef,
  NodeParamsMap,
  NodeType,
  OpeningParams,
  PathData,
  RenderSettings,
} from './types'

const TAU = Math.PI * 2

export const SCHEMA_VERSION = 1

const circlePath = (r: number, n = 32): PathData => ({
  contours: [
    {
      closed: true,
      points: Array.from({ length: n }, (_, i) => ({
        p: [Math.cos((i / n) * TAU) * r, Math.sin((i / n) * TAU) * r] as [number, number],
      })),
    },
  ],
})

export const DEFAULT_PARAMS: { [K in NodeType]: NodeParamsMap[K] } = {
  group: {},
  level: { height: 3.0, cutHeight: 1.1, number: 0 },
  primitive: {
    shape: 'box',
    width: 1,
    depth: 1,
    height: 1,
    radius: 0.5,
    radius2: 0.15,
    sides: 6,
    segments: 0,
    cornerRadius: 0,
    sweep: TAU,
  },
  shape: {
    profile: 'star',
    width: 1,
    height: 1,
    sides: 5,
    innerRatio: 0.5,
    cornerRadius: 0,
    depth: 0.2,
    bevel: 0.02,
    bevelSegments: 3,
    direction: 'up',
  },
  revolve: {
    path: {
      contours: [
        {
          closed: false,
          points: [{ p: [0, 0] }, { p: [0.25, 0] }, { p: [0.3, 0.2], hi: [0.32, 0.08], ho: [0.28, 0.3] }, { p: [0.15, 0.6] }, { p: [0.18, 0.7] }, { p: [0, 0.7] }],
        },
      ],
    },
    angle: TAU,
    segments: 48,
  },
  loft: {
    sections: [
      { path: { contours: [{ closed: true, points: [{ p: [-0.5, -0.5] }, { p: [0.5, -0.5] }, { p: [0.5, 0.5] }, { p: [-0.5, 0.5] }] }] }, z: 0 },
      { path: circlePath(0.35), z: 1 },
    ],
    capStart: true,
    capEnd: true,
    smooth: true,
  },
  sweep: {
    profile: circlePath(0.05, 16),
    path: [
      [0, 0, 0],
      [1, 0, 0.5],
      [2, 0, 0],
    ],
    smooth: true,
  },
  boolean: { op: 'union' },
  mesh: {},
  instance: { component: '' },
  text: { text: 'Text', size: 0.25, font: 'sans', align: 'left', depth: 0, bevel: 0 },
  light: { kind: 'point', color: '#ffffff', intensity: 60, distance: 0, angle: Math.PI / 5, penumbra: 0.4, width: 1, height: 1, castShadow: true },
  image: { asset: '', width: 1, height: 1, opacity: 1 },
  section: { enabled: true, showCaps: true, label: 'A', depth: 0 },
  line: { a: [0, 0], b: [1, 0] },
  polyline: { points: [], closed: false },
  rect: { width: 1, height: 1, cornerRadius: 0 },
  circle: { radius: 0.5 },
  arc: { radius: 0.5, start: 0, end: Math.PI / 2 },
  ellipse: { rx: 0.6, ry: 0.4 },
  spline: { path: { contours: [] } },
  hatch: { boundary: [], pattern: 'ansi31', scale: 1, angle: 0 },
  dimension: { kind: 'aligned', points: [[0, 0, 0], [1, 0, 0]], offset: 0.5, axis: 'auto' },
  leader: { points: [[0, 0], [0.6, 0.4]], text: 'Note' },
  wall: { a: [0, 0], b: [4, 0], thickness: 0.24, height: 2.75, baseOffset: 0, justification: 'center', exterior: false, structural: true },
  opening: {
    kind: 'door',
    style: 'single',
    offset: 1,
    width: 0.885,
    height: 2.01,
    sill: 0,
    frameWidth: 0.06,
    frameDepth: 0,
    hinge: 'left',
    opensTo: 'left',
  },
  slab: { kind: 'floor', outline: [], thickness: 0.2, offset: 0 },
  roof: { kind: 'gable', outline: [], pitchDeg: 35, overhang: 0.5, thickness: 0.25, baseOffset: 2.75, ridgeAxis: 'auto' },
  stair: {
    kind: 'straight',
    width: 1.0,
    rise: 2.75,
    riserCount: 0,
    treadDepth: 0.27,
    landingDepth: 1.0,
    turn: 'left',
    structure: 'solid',
    railing: 'right',
    railingHeight: 0.9,
    nosing: 0.03,
    innerRadius: 0.15,
    sweepDeg: 270,
  },
  column: { shape: 'rect', width: 0.3, depth: 0.3, height: 2.75, baseOffset: 0 },
  beam: { a: [0, 0, 2.75], b: [4, 0, 2.75], shape: 'rect', width: 0.2, height: 0.4 },
  railing: { path: [], height: 1.0, style: 'bars', postSpacing: 1.2, baseOffset: 0 },
  room: { outline: [], number: '', usage: 'NUF1', showLabel: true, auto: false },
  furniture: { kind: 'sofa', width: 2.2, depth: 0.9, height: 0.8 },
  terrain: { width: 50, depth: 50, heights: [], resolution: 0 },
}

export const WINDOW_DEFAULTS: Partial<OpeningParams> = {
  kind: 'window',
  style: 'casement',
  width: 1.01,
  height: 1.26,
  sill: 0.9,
  frameWidth: 0.07,
  frameDepth: 0.08,
}

export const OPENING_DEFAULTS: Partial<OpeningParams> = {
  kind: 'opening',
  style: 'none',
  width: 1.0,
  height: 2.1,
  sill: 0,
  frameWidth: 0,
  frameDepth: 0,
}

/** Typical real-world sizes (w × d × h, meters) for parametric furniture. */
export const FURNITURE_SIZES: Record<FurnitureKind, [number, number, number]> = {
  sofa: [2.2, 0.9, 0.8],
  armchair: [0.85, 0.85, 0.8],
  chair: [0.45, 0.52, 0.85],
  stool: [0.4, 0.4, 0.65],
  'dining-table': [1.8, 0.9, 0.75],
  'coffee-table': [1.1, 0.6, 0.42],
  desk: [1.4, 0.7, 0.75],
  'bed-single': [0.9, 2.0, 0.5],
  'bed-double': [1.8, 2.0, 0.5],
  nightstand: [0.45, 0.4, 0.5],
  wardrobe: [2.0, 0.6, 2.2],
  shelf: [0.8, 0.35, 1.9],
  dresser: [1.2, 0.5, 0.85],
  'tv-unit': [1.8, 0.45, 0.5],
  'kitchen-base': [0.6, 0.6, 0.9],
  'kitchen-wall': [0.6, 0.35, 0.7],
  'kitchen-island': [1.8, 0.9, 0.92],
  fridge: [0.6, 0.65, 1.85],
  stove: [0.6, 0.6, 0.9],
  oven: [0.6, 0.6, 0.6],
  dishwasher: [0.6, 0.6, 0.82],
  sink: [0.8, 0.6, 0.9],
  toilet: [0.38, 0.62, 0.8],
  washbasin: [0.6, 0.45, 0.85],
  bathtub: [1.7, 0.75, 0.6],
  shower: [0.9, 0.9, 2.0],
  'washing-machine': [0.6, 0.6, 0.85],
  plant: [0.5, 0.5, 1.2],
  tree: [4, 4, 7],
  'lamp-floor': [0.4, 0.4, 1.6],
  'lamp-pendant': [0.45, 0.45, 0.6],
  rug: [2.0, 1.4, 0.01],
  piano: [1.5, 0.6, 1.25],
  car: [4.6, 1.85, 1.45],
  person: [0.5, 0.3, 1.75],
  bicycle: [1.75, 0.55, 1.05],
}

export const DEFAULT_RENDER: RenderSettings = {
  environment: 'studio',
  envIntensity: 1,
  envRotation: 0,
  background: 'color',
  backgroundColor: '#101012',
  exposure: 1,
  toneMapping: 'agx',
  sun: { enabled: false, date: '2026-06-21', hour: 14, intensity: 3 },
  shadows: true,
  ambientOcclusion: true,
}

export function defaultMeta(name = 'Untitled'): DocMeta {
  return {
    schema: SCHEMA_VERSION,
    name,
    units: { length: 'mm', precision: 0, angle: 'deg', area: 'm2' },
    grid: { size: 1, subdivisions: 10, visible: true, snap: true },
    render: structuredClone(DEFAULT_RENDER),
    geo: null,
    activeLevel: null,
    createdAt: Date.now(),
  }
}

export const DEFAULT_LAYER_ID = 'layer-0'

export function defaultLayers(): LayerDef[] {
  const l = (id: string, name: string, color: string, order: number, lineWeight = 0.25, extra: Partial<LayerDef> = {}): LayerDef => ({
    id,
    name,
    color,
    visible: true,
    locked: false,
    printable: true,
    lineWeight,
    lineType: 'continuous',
    order,
    ...extra,
  })
  return [
    l(DEFAULT_LAYER_ID, '0', '#e6e6e6', 0),
    l('layer-walls', 'Walls', '#f5f5f5', 1, 0.5),
    l('layer-openings', 'Doors & Windows', '#7dd3fc', 2, 0.35),
    l('layer-structure', 'Structure', '#fca5a5', 3, 0.5),
    l('layer-furniture', 'Furniture', '#c4b5fd', 4, 0.18),
    l('layer-dims', 'Dimensions', '#fde047', 5, 0.18),
    l('layer-anno', 'Annotations', '#86efac', 6, 0.18),
    l('layer-hatch', 'Hatches', '#a8a29e', 7, 0.13),
    l('layer-construction', 'Construction', '#94a3b8', 8, 0.13, { printable: false, lineType: 'dashed' }),
  ]
}

// ------------------------------------------------------------------ Built-in material library
// Procedural textures are generated at runtime by @cadsandbox/render (no downloads, tiny bundle).
const m = (id: string, name: string, category: MaterialDef['category'], color: string, extra: Partial<MaterialDef> = {}): MaterialDef => ({
  id: `mat-${id}`,
  name,
  category,
  color,
  roughness: 0.6,
  metalness: 0,
  opacity: 1,
  transmission: 0,
  ior: 1.5,
  builtin: true,
  ...extra,
})

const tile = (w: number, h = w) => ({ size: [w, h] as [number, number], rotation: 0, offset: [0, 0] as [number, number] })

export const BUILTIN_MATERIALS: MaterialDef[] = [
  m('default', 'Default', 'generic', '#d4d4d8', { roughness: 0.55 }),
  m('white-matte', 'White Matte', 'paint', '#f4f4f5', { roughness: 0.8 }),
  m('black-matte', 'Black Matte', 'paint', '#18181b', { roughness: 0.75 }),
  m('clay', 'Clay', 'generic', '#e7ded3', { roughness: 0.9 }),
  m('plastic-glossy', 'Glossy Plastic', 'plastic', '#ef4444', { roughness: 0.18, clearcoat: 0.6 }),
  m('plastic-soft', 'Soft Plastic', 'plastic', '#3b82f6', { roughness: 0.45 }),
  m('rubber', 'Rubber', 'plastic', '#27272a', { roughness: 0.95 }),
  m('plaster', 'Plaster', 'paint', '#efece6', { roughness: 0.92, maps: { color: { procedural: { kind: 'plaster' } } }, uv: tile(2), hatch: 'none' }),
  m('concrete', 'Concrete', 'concrete', '#a8a29e', { roughness: 0.85, maps: { color: { procedural: { kind: 'concrete' } } }, uv: tile(2), hatch: 'concrete' }),
  m('concrete-rc', 'Reinforced Concrete', 'concrete', '#9ca3af', { roughness: 0.8, maps: { color: { procedural: { kind: 'concrete', seed: 7 } } }, uv: tile(2), hatch: 'reinforced-concrete' }),
  m('screed', 'Screed', 'concrete', '#b8b3ab', { roughness: 0.7, hatch: 'dots' }),
  m('brick-red', 'Red Brick', 'brick', '#9a4a36', { roughness: 0.88, maps: { color: { procedural: { kind: 'brick' } } }, uv: tile(1.2, 0.6), hatch: 'brick' }),
  m('brick-white', 'White Brick', 'brick', '#e8e4dc', { roughness: 0.88, maps: { color: { procedural: { kind: 'brick', params: { mortar: '#bdb6aa' } } } }, uv: tile(1.2, 0.6), hatch: 'brick' }),
  m('masonry-ks', 'Sand-Lime Masonry', 'brick', '#e9e6df', { roughness: 0.9, hatch: 'masonry' }),
  m('insulation', 'Insulation', 'generic', '#f2d16b', { roughness: 1, hatch: 'insulation' }),
  m('oak', 'Oak', 'wood', '#b58a5a', { roughness: 0.55, maps: { color: { procedural: { kind: 'wood' } } }, uv: tile(1), hatch: 'wood' }),
  m('walnut', 'Walnut', 'wood', '#6b4a32', { roughness: 0.5, maps: { color: { procedural: { kind: 'wood', seed: 3, params: { dark: 1 } } } }, uv: tile(1), hatch: 'wood' }),
  m('parquet-oak', 'Oak Parquet', 'wood', '#c09466', { roughness: 0.4, maps: { color: { procedural: { kind: 'parquet' } } }, uv: tile(1.2), hatch: 'wood' }),
  m('timber', 'Structural Timber', 'wood', '#c8a878', { roughness: 0.7, maps: { color: { procedural: { kind: 'wood', seed: 11 } } }, uv: tile(1.5), hatch: 'timber' }),
  m('marble', 'White Marble', 'stone', '#eeece8', { roughness: 0.15, maps: { color: { procedural: { kind: 'marble' } } }, uv: tile(1.5), hatch: 'none' }),
  m('granite', 'Dark Granite', 'stone', '#3f3f46', { roughness: 0.3, maps: { color: { procedural: { kind: 'stone', params: { dark: 1 } } } }, uv: tile(1) }),
  m('stone', 'Natural Stone', 'stone', '#a39e93', { roughness: 0.8, maps: { color: { procedural: { kind: 'stone' } } }, uv: tile(1.5) }),
  m('tiles-white', 'White Tiles', 'ceramic', '#f8fafc', { roughness: 0.2, maps: { color: { procedural: { kind: 'tiles' } } }, uv: tile(0.6), hatch: 'tiles' }),
  m('tiles-terracotta', 'Terracotta Tiles', 'ceramic', '#b4643c', { roughness: 0.6, maps: { color: { procedural: { kind: 'tiles', params: { color: '#b4643c' } } } }, uv: tile(0.6), hatch: 'tiles' }),
  m('glass', 'Clear Glass', 'glass', '#ffffff', { roughness: 0.02, transmission: 1, ior: 1.5, thickness: 0.01, opacity: 1, hatch: 'glass' }),
  m('glass-frosted', 'Frosted Glass', 'glass', '#f1f5f9', { roughness: 0.35, transmission: 1, ior: 1.5, thickness: 0.01, hatch: 'glass' }),
  m('glass-tinted', 'Tinted Glass', 'glass', '#64748b', { roughness: 0.03, transmission: 0.85, ior: 1.52, thickness: 0.01, hatch: 'glass' }),
  m('chrome', 'Chrome', 'metal', '#f4f4f5', { roughness: 0.05, metalness: 1 }),
  m('steel-brushed', 'Brushed Steel', 'metal', '#b4b4bc', { roughness: 0.35, metalness: 1, maps: { color: { procedural: { kind: 'metal-brushed' } } }, uv: tile(0.5), hatch: 'steel' }),
  m('aluminium', 'Aluminium', 'metal', '#d4d4d8', { roughness: 0.3, metalness: 1, hatch: 'steel' }),
  m('steel-dark', 'Anthracite Metal', 'metal', '#3a3d42', { roughness: 0.45, metalness: 0.9, hatch: 'steel' }),
  m('gold', 'Gold', 'metal', '#f5c46b', { roughness: 0.2, metalness: 1 }),
  m('copper', 'Copper', 'metal', '#d98b5f', { roughness: 0.25, metalness: 1 }),
  m('fabric-grey', 'Grey Fabric', 'fabric', '#8b8f96', { roughness: 0.95, sheen: 0.6, sheenColor: '#d4d4d8', maps: { color: { procedural: { kind: 'fabric' } } }, uv: tile(0.3) }),
  m('fabric-beige', 'Beige Linen', 'fabric', '#d6c7ae', { roughness: 0.95, sheen: 0.5, sheenColor: '#f5efe3', maps: { color: { procedural: { kind: 'fabric', seed: 2 } } }, uv: tile(0.3) }),
  m('leather', 'Leather', 'fabric', '#7a4b2a', { roughness: 0.5, clearcoat: 0.2 }),
  m('grass', 'Grass', 'ground', '#4d7c32', { roughness: 1, maps: { color: { procedural: { kind: 'grass' } } }, uv: tile(2), hatch: 'grass' }),
  m('gravel', 'Gravel', 'ground', '#9b958b', { roughness: 1, maps: { color: { procedural: { kind: 'gravel' } } }, uv: tile(1), hatch: 'gravel' }),
  m('earth', 'Soil', 'ground', '#6b5540', { roughness: 1, hatch: 'earth' }),
  m('water', 'Water', 'ground', '#2b6f8f', { roughness: 0.05, transmission: 0.7, ior: 1.33, hatch: 'water' }),
  m('emissive-white', 'Light Emitter', 'light', '#ffffff', { emissive: '#ffffff', emissiveIntensity: 4, roughness: 1 }),
]

export const BUILTIN_MATERIAL_MAP: ReadonlyMap<string, MaterialDef> = new Map(BUILTIN_MATERIALS.map((x) => [x.id, x]))

/** Default material per node type (used when node.material is null). */
export const TYPE_DEFAULT_MATERIAL: Partial<Record<NodeType, string>> = {
  wall: 'mat-plaster',
  slab: 'mat-concrete',
  roof: 'mat-steel-dark',
  stair: 'mat-concrete',
  column: 'mat-concrete-rc',
  beam: 'mat-concrete-rc',
  railing: 'mat-steel-dark',
  opening: 'mat-white-matte',
  terrain: 'mat-grass',
  furniture: 'mat-white-matte',
}

/** Swatches shown in the quick color bar (first five match the product design). */
export const QUICK_COLORS = ['#ff3b30', '#ff9500', '#fff35c', '#1ed760', '#0fb5ff', '#a855f7', '#f4f4f5', '#18181b']
