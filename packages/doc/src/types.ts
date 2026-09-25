// CadSandbox document schema (schema version 1).
//
// Conventions — every package relies on these:
//   • Lengths in METERS (float64). Angles in RADIANS unless a field says `Deg`.
//   • Z-up, right-handed. The ground/plan plane is XY. glTF export converts to Y-up.
//   • Scene tree = flat map of nodes with `parent` ids + fractional `order` keys (CRDT friendly).
//   • A node's world matrix = parentWorld × compose(node.t). Levels are ordinary nodes whose
//     t.p[2] is the storey elevation, so everything on a storey is a descendant of its level.
//   • 2D drafting entities live in their node's local XY plane (plan = XY of a level).
//   • Params hold the *recipe*, never tessellated meshes (large meshes live in blobs by hash).
//   • Document data is plain JSON (no class instances), so it round-trips through Yjs,
//     clipboard, collections, templates and workers unchanged.
import type { LengthUnit } from '@cadsandbox/shared'

export type Vec2 = [number, number]
export type Vec3 = [number, number, number]
/** Quaternion x, y, z, w */
export type Quat = [number, number, number, number]

export interface Transform {
  /** position */
  p: Vec3
  /** rotation quaternion */
  r: Quat
  /** scale */
  s: Vec3
}

// ------------------------------------------------------------------ 2D paths
/** A path vertex. Optional absolute cubic-Bézier handles (hi = in, ho = out). No handles = sharp corner. */
export interface PathPoint {
  p: Vec2
  hi?: Vec2
  ho?: Vec2
}
export interface Contour {
  points: PathPoint[]
  closed: boolean
}
/** SVG-compatible path. For solids: closed contours, even-odd fill (inner contours are holes). */
export interface PathData {
  contours: Contour[]
}

// ------------------------------------------------------------------ Materials & textures
export type ProceduralTextureKind =
  | 'wood'
  | 'parquet'
  | 'brick'
  | 'concrete'
  | 'tiles'
  | 'marble'
  | 'stone'
  | 'plaster'
  | 'fabric'
  | 'metal-brushed'
  | 'grass'
  | 'gravel'
  | 'noise'
  | 'checker'

export type TextureRef =
  | { asset: string } // sha256 of an uploaded image blob
  | { procedural: { kind: ProceduralTextureKind; seed?: number; params?: Record<string, number | string> } }

export type HatchPattern =
  | 'none'
  | 'solid'
  | 'ansi31'
  | 'ansi32'
  | 'ansi37'
  | 'concrete'
  | 'reinforced-concrete'
  | 'brick'
  | 'masonry'
  | 'insulation'
  | 'earth'
  | 'gravel'
  | 'sand'
  | 'wood'
  | 'timber'
  | 'steel'
  | 'glass'
  | 'tiles'
  | 'grass'
  | 'water'
  | 'dots'
  | 'grid'

export type MaterialCategory =
  | 'generic'
  | 'paint'
  | 'plastic'
  | 'wood'
  | 'stone'
  | 'concrete'
  | 'brick'
  | 'metal'
  | 'glass'
  | 'fabric'
  | 'ceramic'
  | 'ground'
  | 'light'
  | 'custom'

export interface MaterialDef {
  id: string
  name: string
  category: MaterialCategory
  /** Base color, #rrggbb */
  color: string
  roughness: number
  metalness: number
  opacity: number
  /** 0..1 — glass/transmissive */
  transmission: number
  ior: number
  thickness?: number
  emissive?: string
  emissiveIntensity?: number
  clearcoat?: number
  clearcoatRoughness?: number
  sheen?: number
  sheenColor?: string
  doubleSided?: boolean
  maps?: {
    color?: TextureRef
    normal?: TextureRef
    roughness?: TextureRef
    metalness?: TextureRef
    ao?: TextureRef
    bump?: TextureRef
  }
  /** World-space texture mapping: size of one texture tile in meters, rotation (rad), offset (m). */
  uv?: { size: Vec2; rotation: number; offset: Vec2 }
  normalScale?: number
  /** Hatch used where this material is cut in plans/sections. */
  hatch?: HatchPattern
  /** Built-in library materials are read-only in the UI (duplicate to edit). */
  builtin?: boolean
  /** Building-physics values for U-value estimates (DIN 4108-4 / DIN EN ISO 10456 design values). */
  thermal?: MaterialThermal
}

/** Building-physics properties of a material. */
export interface MaterialThermal {
  /** Thermal conductivity λ, W/(m·K) */
  lambda: number
  /** Bulk density ρ, kg/m³ */
  density?: number
  /** Water-vapour diffusion resistance factor μ (dry value) */
  mu?: number
}

// ------------------------------------------------------------------ Node params
export type PrimitiveShape =
  | 'box'
  | 'sphere'
  | 'cylinder'
  | 'cone'
  | 'torus'
  | 'capsule'
  | 'pyramid'
  | 'wedge'
  | 'tube'
  | 'plane'
  | 'disc'
  | 'icosphere'
  | 'prism'

/** Parametric solids. Local origin = center of the base (bottom face) on Z=0, except sphere-like
 *  shapes (sphere/icosphere/torus/capsule) which also sit on Z=0 (bottom touching the ground). */
export interface PrimitiveParams {
  shape: PrimitiveShape
  width?: number // X size (box, wedge, pyramid, plane)
  depth?: number // Y size
  height?: number // Z size (box, cylinder, cone, capsule, pyramid, tube, prism, wedge)
  radius?: number // sphere/cylinder/cone base/torus major/disc/tube outer/capsule/prism circumradius
  radius2?: number // cone top radius / torus tube radius / tube inner radius
  sides?: number // prism/pyramid/cylinder facet count (≥3)
  segments?: number // tessellation hint (0 = auto)
  cornerRadius?: number // rounded box edges
  /** Partial sweep for cylinder/cone/torus/disc/tube (radians, default 2π) */
  sweep?: number
}

export type ProfileKind =
  | 'rect'
  | 'circle'
  | 'ellipse'
  | 'triangle'
  | 'polygon'
  | 'star'
  | 'heart'
  | 'arrow'
  | 'cross'
  | 'ring'
  | 'path'

/** A 2D profile (preset or free path) optionally extruded along local +Z. depth 0 = flat face.
 *  This covers Spline-style "simple forms" and push/pull of any closed sketch. */
export interface ShapeParams {
  profile: ProfileKind
  width: number
  height: number
  sides?: number // polygon/star points
  innerRatio?: number // star inner radius ratio / ring inner ratio (0..1)
  cornerRadius?: number
  path?: PathData // profile === 'path'
  depth: number
  bevel?: number // bevel size (m)
  bevelSegments?: number
  /** Extrusion direction relative to the profile plane. */
  direction?: 'up' | 'down' | 'symmetric'
}

/** Revolve a profile drawn in local (r, z) coordinates around local Z. */
export interface RevolveParams {
  path: PathData
  angle: number // radians, default 2π
  segments?: number
}

export interface LoftSection {
  path: PathData
  z: number
  scale?: number
  rotation?: number
}
export interface LoftParams {
  sections: LoftSection[]
  capStart: boolean
  capEnd: boolean
  smooth: boolean
}

export interface SweepParams {
  profile: PathData // in the plane perpendicular to the path, profile XY
  path: Vec3[]
  closedPath?: boolean
  twist?: number
  smooth: boolean
}

/** Non-destructive boolean. Operands = children in order; `subtract` removes children[1..] from children[0]. */
export interface BooleanParams {
  op: 'union' | 'subtract' | 'intersect'
}

/** Imported or baked mesh. Geometry lives in a blob (CSBM binary, see @cadsandbox/geometry)
 *  or, for tiny meshes only, inline arrays. */
export interface MeshParams {
  asset?: string
  inline?: { positions: number[]; indices?: number[]; normals?: number[]; uvs?: number[] }
  /** Cached local bounds, for culling before the blob loads. */
  bounds?: { min: Vec3; max: Vec3 }
  /** Smooth-shading crease angle (radians) when normals must be generated. */
  creaseAngle?: number
}

export interface InstanceParams {
  component: string // ComponentDef id
}

export interface GroupParams {
  /** Collapsed in the scene tree UI */
  collapsed?: boolean
}

/** Storey. Elevation = t.p[2] (levels must only be translated along Z). */
export interface LevelParams {
  height: number // floor-to-floor height
  cutHeight: number // plan cut plane above the level (default 1.1 m)
  number?: number // storey number (0 = ground floor)
  /** Full storey (Vollgeschoss) override for GFZ/BMZ/storey counts; undefined = derived (LBO heuristics). */
  fullStorey?: boolean
}

export type TextFont = 'sans' | 'serif' | 'mono' | 'display'

/** Text in local XY. depth 0 = flat annotation text; depth > 0 = extruded 3D text. */
export interface TextParams {
  text: string
  size: number // cap height in meters
  font: TextFont
  align: 'left' | 'center' | 'right'
  depth: number
  bevel?: number
  /** Annotation text keeps constant size on paper (size = mm at print scale) */
  annotative?: boolean
}

export type LightKind = 'point' | 'spot' | 'directional' | 'area'
export interface LightParams {
  kind: LightKind
  color: string
  /** candela for point/spot, lux for directional, nits for area */
  intensity: number
  distance?: number // 0 = infinite
  angle?: number // spot cone angle
  penumbra?: number
  width?: number // area light
  height?: number
  castShadow: boolean
}

/** Reference image / underlay (scanned plan, photo) drawn in local XY. */
export interface ImageParams {
  asset: string
  width: number
  height: number
  opacity: number
  /** Show in plan views only */
  planOnly?: boolean
}

/** Section/clipping plane. Plane passes through t.p; normal = node local +Z. Clips everything on
 *  the +normal side when enabled. */
export interface SectionParams {
  enabled: boolean
  showCaps: boolean
  label: string // e.g. "A"
  /** Far clip for section views (m, 0 = unlimited) */
  depth: number
}

// ---- 2D drafting (local XY plane) ----
export interface LineParams {
  a: Vec2
  b: Vec2
}
/** Polyline with optional DXF-style bulges (tan(θ/4) of the arc to the next vertex). */
export interface PolylineParams {
  points: Vec2[]
  bulges?: number[]
  closed: boolean
  /** Filled closed polyline (region) */
  fill?: string | null
}
export interface RectParams {
  width: number
  height: number
  cornerRadius?: number
  fill?: string | null
}
export interface CircleParams {
  radius: number
  fill?: string | null
}
export interface ArcParams {
  radius: number
  start: number // radians from +X, CCW
  end: number
}
export interface EllipseParams {
  rx: number
  ry: number
  fill?: string | null
}
export interface SplineParams {
  path: PathData
}
export interface HatchParams {
  boundary: Vec2[]
  holes?: Vec2[][]
  pattern: HatchPattern
  scale: number
  angle: number
  color?: string | null
  background?: string | null
}
export type DimensionKind = 'linear' | 'aligned' | 'angular' | 'radius' | 'diameter' | 'arc-length' | 'chain'
/** points (local 3D so dimensions can live on elevations too):
 *    linear/aligned: [p1, p2]    angular: [vertex, p1, p2]    radius/diameter: [center, pointOnCircle]
 *    chain (Maßkette): [p1 … pn] — N points projected onto ONE dimension line at `offset`; every
 *    interval gets its own text. `axis` 'x'/'y' forces the line direction, otherwise first → last. */
export interface DimensionParams {
  kind: DimensionKind
  points: Vec3[]
  offset: number // distance of dimension line from the measured points
  axis?: 'x' | 'y' | 'auto' // linear only
  text?: string // override; "<>" is replaced by the measured value
  /** Associative: follow these node anchors when they move */
  refs?: { node: string; anchor: string }[]
}
export interface LeaderParams {
  points: Vec2[]
  text: string
}

// ---- Drafting symbols (local XY plane) ----
/** Structural grid axis (Achsraster): a → b in local XY with label bubbles at the chosen ends. */
export interface GridlineParams {
  a: Vec2
  b: Vec2
  /** Bubble text, e.g. "A" or "1" */
  label: string
  bubble: 'start' | 'end' | 'both' | 'none'
  /** Distance from the line end to the bubble center (m). Default 0.6. */
  extension?: number
  /** Bubble radius (m). Default 0.35. */
  radius?: number
}
/** Height marker (Höhenkote) at the node origin. The displayed value is the node's WORLD elevation
 *  relative to project zero (or absolute NN when `meta.units.elevationDisplay` = 'absolute'). */
export interface LevelmarkParams {
  /** plan: level symbol (±0.00 with triangle on a line); section: elevation flag drawn in sections/elevations too */
  variant: 'plan' | 'section'
  /** Text prefix, e.g. "OKFF" (finished floor) or "OKRF" (structural floor) */
  prefix?: string
  /** Section variant: triangle points down (default) or up */
  flip?: boolean
}
/** North arrow symbol. `angle` = rotation from local +Y to true north (radians CCW, see GeoLocation.northAngle). */
export interface NorthArrowParams {
  size: number
  style: 'simple' | 'compass'
  angle: number
}
/** Graphic scale bar in model meters (prints at the correct paper length for `scale`). */
export interface ScaleBarParams {
  /** Scale denominator for the "1:n" label (100 → 1:100) */
  scale: number
  /** Total real length of the bar (m) */
  length: number
  /** Number of alternating blocks */
  segments: number
}

// ---- Architecture / BIM (coordinates are in the node's local space, typically level space) ----
export type WallJustification = 'center' | 'left' | 'right'
export type WallLayerFunction = 'structure' | 'insulation' | 'finish' | 'membrane' | 'air'
export interface WallLayer {
  material: string | null
  thickness: number
  function: WallLayerFunction
}
/** Straight (or arced via bulge) wall from a to b. Joins with neighbours are computed automatically
 *  from endpoint proximity on the same level. */
export interface WallParams {
  a: Vec2
  b: Vec2
  bulge?: number
  thickness: number
  height: number
  baseOffset: number // above the level
  justification: WallJustification
  layers?: WallLayer[]
  exterior?: boolean
  structural?: boolean
}

export type DoorStyle = 'single' | 'double' | 'sliding' | 'double-sliding' | 'folding' | 'pocket' | 'garage' | 'revolving'
export type WindowStyle =
  | 'casement'
  | 'double-casement'
  | 'fixed'
  | 'sliding'
  | 'tilt-turn'
  | 'awning'
  | 'hung'
  | 'bay'
  | 'skylight'

/** Door/window/opening hosted by its PARENT wall. Placement is derived from the wall:
 *  `offset` = distance along the wall axis from wall.a to the opening center. The node's t is ignored. */
export interface OpeningParams {
  kind: 'door' | 'window' | 'opening'
  style: DoorStyle | WindowStyle | 'none'
  offset: number
  width: number
  height: number
  sill: number // bottom above wall base (doors: 0)
  frameWidth: number
  frameDepth: number
  /** Hinge side seen from the wall's left side (left of a→b) */
  hinge: 'left' | 'right'
  /** Opens toward the wall's left or right side */
  opensTo: 'left' | 'right'
  /** Material slot overrides */
  frameMaterial?: string | null
  panelMaterial?: string | null
  glassMaterial?: string | null
}

export type SlabKind = 'floor' | 'ceiling' | 'foundation' | 'roof' | 'balcony'
export interface SlabParams {
  kind: SlabKind
  outline: Vec2[]
  holes?: Vec2[][]
  thickness: number
  /** Top face elevation relative to the level (0 = flush with the level) */
  offset: number
}

export type RoofKind = 'flat' | 'shed' | 'gable' | 'hip' | 'mansard' | 'gambrel' | 'pyramid'
export interface RoofParams {
  kind: RoofKind
  outline: Vec2[] // eave outline (usually the wall outline)
  pitchDeg: number
  overhang: number
  thickness: number
  /** Eave elevation above the level (default: level height) */
  baseOffset: number
  /** Ridge direction for gable/shed/gambrel */
  ridgeAxis: 'x' | 'y' | 'auto'
}

export type StairKind = 'straight' | 'l-shape' | 'u-shape' | 'spiral'
/** Starts at the local origin climbing along +Y (first flight). */
export interface StairParams {
  kind: StairKind
  width: number
  rise: number // total height (default: level height)
  riserCount: number // 0 = auto from DIN 18065 comfort rule 2R + G ≈ 0.63 m
  treadDepth: number
  landingDepth: number
  turn: 'left' | 'right'
  structure: 'solid' | 'stringer' | 'floating'
  railing: 'none' | 'left' | 'right' | 'both'
  railingHeight: number
  nosing: number
  innerRadius?: number // spiral
  sweepDeg?: number // spiral
}

export interface ColumnParams {
  shape: 'rect' | 'round' | 'h-beam'
  width: number
  depth: number
  height: number // default: level height
  baseOffset: number
}

export interface BeamParams {
  a: Vec3
  b: Vec3
  shape: 'rect' | 'i-beam' | 'round'
  width: number
  height: number
}

export interface RailingParams {
  path: Vec2[]
  height: number
  style: 'bars' | 'glass' | 'solid' | 'cable'
  postSpacing: number
  baseOffset: number
}

/** DIN 277 usage groups: NUF1 Wohnen/Aufenthalt … NUF7 Sonstige, TF Technik, VF Verkehr. */
export type RoomUsage = 'NUF1' | 'NUF2' | 'NUF3' | 'NUF4' | 'NUF5' | 'NUF6' | 'NUF7' | 'TF' | 'VF'
export interface RoomParams {
  outline: Vec2[]
  number: string
  usage: RoomUsage
  ceilingHeight?: number // default: level height minus slab
  floorFinish?: string | null // material id
  showLabel: boolean
  fill?: string | null
  /** true = outline auto-follows the surrounding walls (re-detected when walls change) */
  auto?: boolean
  /** WoFlV: counts toward the living area (Wohnfläche). undefined = derived from usage + name. */
  livingSpace?: boolean
  /** Habitable room (Aufenthaltsraum) for LBO height/daylight/escape checks. undefined = derived. */
  habitable?: boolean
  /** Outdoor area: DIN 277 "S" area, WoFlV share `outdoorFactor`. */
  outdoor?: RoomOutdoorKind
  /** WoFlV share of an outdoor area (default 0.25, at most 0.5). */
  outdoorFactor?: number
}
export type RoomOutdoorKind = 'balcony' | 'terrace' | 'loggia' | 'roof-garden'

export type FurnitureKind =
  | 'sofa'
  | 'armchair'
  | 'chair'
  | 'stool'
  | 'dining-table'
  | 'coffee-table'
  | 'desk'
  | 'bed-single'
  | 'bed-double'
  | 'nightstand'
  | 'wardrobe'
  | 'shelf'
  | 'dresser'
  | 'tv-unit'
  | 'kitchen-base'
  | 'kitchen-wall'
  | 'kitchen-island'
  | 'fridge'
  | 'stove'
  | 'oven'
  | 'dishwasher'
  | 'sink'
  | 'toilet'
  | 'washbasin'
  | 'bathtub'
  | 'shower'
  | 'washing-machine'
  | 'plant'
  | 'tree'
  | 'lamp-floor'
  | 'lamp-pendant'
  | 'rug'
  | 'piano'
  | 'car'
  | 'person'
  | 'bicycle'

/** Parametric furniture/fixture (procedural geometry + plan symbol). Origin = back-left-bottom
 *  corner projected to center of the back edge; front faces -Y. */
export interface FurnitureParams {
  kind: FurnitureKind
  width: number
  depth: number
  height: number
  variant?: number
  primaryMaterial?: string | null
  secondaryMaterial?: string | null
}

export interface TerrainParams {
  width: number
  depth: number
  /** Row-major height samples (resolution × resolution), meters. Empty = flat. */
  heights: number[]
  resolution: number
}

// ------------------------------------------------------------------ Node type map
export interface NodeParamsMap {
  group: GroupParams
  level: LevelParams
  primitive: PrimitiveParams
  shape: ShapeParams
  revolve: RevolveParams
  loft: LoftParams
  sweep: SweepParams
  boolean: BooleanParams
  mesh: MeshParams
  instance: InstanceParams
  text: TextParams
  light: LightParams
  image: ImageParams
  section: SectionParams
  // 2D drafting
  line: LineParams
  polyline: PolylineParams
  rect: RectParams
  circle: CircleParams
  arc: ArcParams
  ellipse: EllipseParams
  spline: SplineParams
  hatch: HatchParams
  dimension: DimensionParams
  leader: LeaderParams
  gridline: GridlineParams
  levelmark: LevelmarkParams
  northarrow: NorthArrowParams
  scalebar: ScaleBarParams
  // architecture
  wall: WallParams
  opening: OpeningParams
  slab: SlabParams
  roof: RoofParams
  stair: StairParams
  column: ColumnParams
  beam: BeamParams
  railing: RailingParams
  room: RoomParams
  furniture: FurnitureParams
  terrain: TerrainParams
}

export type NodeType = keyof NodeParamsMap

export const DRAFTING_TYPES = [
  'line',
  'polyline',
  'rect',
  'circle',
  'arc',
  'ellipse',
  'spline',
  'hatch',
  'dimension',
  'leader',
  'gridline',
  'levelmark',
  'northarrow',
  'scalebar',
] as const satisfies readonly NodeType[]

export const ARCH_TYPES = [
  'wall',
  'opening',
  'slab',
  'roof',
  'stair',
  'column',
  'beam',
  'railing',
  'room',
  'furniture',
] as const satisfies readonly NodeType[]

export const SOLID_TYPES = [
  'primitive',
  'shape',
  'revolve',
  'loft',
  'sweep',
  'boolean',
  'mesh',
  'text',
] as const satisfies readonly NodeType[]

export interface NodeBase<T extends NodeType = NodeType> {
  id: string
  type: T
  name: string
  /** Parent node id; null = scene root; DEFS_ROOT = component definition storage (not rendered). */
  parent: string | null
  /** Fractional index among siblings (see `fractional-indexing`). */
  order: string
  visible: boolean
  locked: boolean
  t: Transform
  /** Material id (doc.materials or built-in library id). null = type default. */
  material: string | null
  /** Quick color override (#rrggbb) tinting the material's base color. */
  color: string | null
  /** Drafting layer id. null = default layer "0". */
  layer: string | null
  /** Free-form properties (tags, IFC GUID, description, custom props). */
  meta: Record<string, unknown>
  params: NodeParamsMap[T]
}

export type AnyNode = { [K in NodeType]: NodeBase<K> }[NodeType]
export type NodeOf<T extends NodeType> = NodeBase<T>

/** Input for creating a node — everything except type/params is optional. */
export type NewNode<T extends NodeType = NodeType> = { type: T; params?: Partial<NodeParamsMap[T]> } & Partial<
  Omit<NodeBase<T>, 'type' | 'params'>
> & {
    /** Insert before this sibling (default: append at end) */
    before?: string | null
  }

/** Parent id under which component definitions are stored. */
export const DEFS_ROOT = '__defs__'

// ------------------------------------------------------------------ Doc-level records
export interface UnitsSettings {
  length: LengthUnit
  precision: number
  angle: 'deg' | 'rad'
  area: 'm2' | 'ft2'
  /** Height markers: NN/absolute height of project zero (±0.00) in meters. Default 0. */
  elevationDatum?: number
  /** Height markers show elevations relative to project zero (default) or as absolute NN heights. */
  elevationDisplay?: 'relative' | 'absolute'
}

export interface GridSettings {
  size: number // major cell size (m)
  subdivisions: number
  visible: boolean
  snap: boolean
}

export type EnvironmentPreset = 'studio' | 'daylight' | 'sunset' | 'overcast' | 'night' | 'city' | 'custom'

export interface RenderSettings {
  environment: EnvironmentPreset
  envAsset?: string
  envIntensity: number
  envRotation: number
  background: 'environment' | 'color' | 'gradient' | 'transparent'
  backgroundColor: string
  exposure: number
  toneMapping: 'agx' | 'aces' | 'neutral'
  sun: { enabled: boolean; date: string; hour: number; intensity: number }
  shadows: boolean
  ambientOcclusion: boolean
}

export interface GeoLocation {
  latitude: number
  longitude: number
  /** Angle from +Y (plan up) to true north, radians CCW */
  northAngle: number
  timezone?: string
}

export interface DocMeta {
  schema: number
  name: string
  units: UnitsSettings
  grid: GridSettings
  render: RenderSettings
  geo: GeoLocation | null
  /** Active/default level for new elements */
  activeLevel: string | null
  createdAt: number
  /** Plot + development-plan data for zoning checks (GRZ/GFZ/BMZ, storeys, height) and LBO specifics. */
  site?: SiteInfo
  /** DIN 276 cost-estimate settings: unit-price overrides of the built-in catalog + ratios. */
  costCatalog?: CostCatalog
}

export type BuildingType = 'residential' | 'office' | 'public' | 'other'

/** Development-plan limits (Bebauungsplan / BauNVO §§ 16–21). */
export interface ZoningLimits {
  /** Grundflächenzahl (site coverage ratio) */
  grz?: number
  /** Geschossflächenzahl (floor area ratio, full storeys) */
  gfz?: number
  /** Baumassenzahl (building mass ratio, m³ per m² plot) */
  bmz?: number
  /** Maximum number of full storeys (Vollgeschosse) */
  maxStoreys?: number
  /** Maximum building height above ground level (m) */
  maxHeight?: number
}

export interface SiteInfo {
  /** Plot area in m²; when absent the area of `plotOutline` is used. */
  plotArea?: number
  /** Plot boundary in world XY (m). */
  plotOutline?: Vec2[]
  zoning?: ZoningLimits
  buildingType?: BuildingType
  /** Bundesland code for LBO specifics (e.g. 'BY', 'NW', 'BE'). */
  state?: string
  /** Ground level (Geländeoberfläche) as world Z in m (default 0). */
  groundLevel?: number
  /** The project must be barrier-free (DIN 18040-2): accessibility findings become failures. */
  barrierFree?: boolean
}

/** Override of one built-in DIN 276 catalog entry (keyed by element id). */
export interface CostItemOverride {
  /** Unit price in `currency` per unit of the element's quantity */
  price?: number
  /** DIN 276 cost group code, e.g. '331' */
  kg?: string
  label?: string
}

export interface CostCatalog {
  /** Overrides per element id (see DEFAULT_COST_ITEMS in @cadsandbox/geometry). */
  items?: Record<string, CostItemOverride>
  /** KG 400 (building services) as a fraction of KG 300; default depends on the building type. */
  servicesRatio?: number
  /** Regional / price-index factor applied to every unit price (default 1). */
  regionFactor?: number
  /** Unit prices include VAT (default true, BKI convention). */
  vatIncluded?: boolean
  /** VAT rate (default 0.19). */
  vatRate?: number
  /** Currency code (default 'EUR'). */
  currency?: string
}

export type LineType = 'continuous' | 'dashed' | 'dotted' | 'dashdot' | 'hidden' | 'center'

export interface LayerDef {
  id: string
  name: string
  color: string
  visible: boolean
  locked: boolean
  printable: boolean
  lineWeight: number // mm on paper
  lineType: LineType
  order: number
}

export interface CameraState {
  position: Vec3
  target: Vec3
  up: Vec3
  fov: number
  projection: 'perspective' | 'orthographic'
  /** Ortho: world meters visible vertically */
  orthoHeight?: number
}

export type RenderMode = 'shaded' | 'realistic' | 'clay' | 'wireframe' | 'xray' | 'hidden-line' | 'technical'

export interface ViewDef {
  id: string
  name: string
  camera: CameraState
  renderMode?: RenderMode
  levelId?: string | null
  sectionId?: string | null
  hiddenLayers?: string[]
  createdAt: number
}

export type PaperSize = 'A4' | 'A3' | 'A2' | 'A1' | 'A0' | 'Letter' | 'Tabloid'

export type SheetViewSource =
  | { kind: 'plan'; levelId: string }
  | { kind: 'ceiling-plan'; levelId: string }
  | { kind: 'section'; sectionId: string }
  | { kind: 'elevation'; direction: 'north' | 'south' | 'east' | 'west' }
  | { kind: 'view'; viewId: string }
  | { kind: 'schedule'; schedule: 'rooms' | 'doors' | 'windows' | 'areas' | 'materials' }

export interface SheetViewport {
  id: string
  /** Paper millimeters from the sheet's top-left */
  x: number
  y: number
  w: number
  h: number
  source: SheetViewSource
  /** Scale denominator: 100 → 1:100 */
  scale: number
  style: 'lines' | 'hidden-line' | 'shaded' | 'realistic'
  title?: string
}

export interface TitleBlock {
  project: string
  client: string
  address: string
  drawnBy: string
  checkedBy: string
  date: string
  revision: string
  company: string
  phase: string // e.g. "Entwurfsplanung", "Genehmigungsplanung", "Ausführungsplanung"
}

export interface SheetDef {
  id: string
  name: string
  number: string
  paper: PaperSize
  orientation: 'landscape' | 'portrait'
  titleBlock: TitleBlock
  viewports: SheetViewport[]
  order: number
}

export interface ComponentDef {
  id: string
  name: string
  /** Group node (parent = DEFS_ROOT) holding the definition geometry. */
  root: string
  category?: string
  createdAt: number
}

export interface CommentAuthor {
  id: string
  name: string
  color: string
}
export interface CommentReply {
  id: string
  author: CommentAuthor
  text: string
  createdAt: number
}
export interface CommentDef {
  id: string
  author: CommentAuthor
  text: string
  createdAt: number
  anchor: { nodeId?: string; point?: Vec3; viewId?: string }
  resolved: boolean
  replies: CommentReply[]
}

// ------------------------------------------------------------------ Snapshots (clipboard / library / templates)
export interface DocSnapshot {
  format: 'cadsandbox/nodes@1'
  /** Root nodes have parent === null; ids are only unique within the snapshot. */
  nodes: AnyNode[]
  materials: MaterialDef[]
  components: ComponentDef[]
  /** Nodes of component definitions (parent chains end at DEFS_ROOT). */
  componentNodes: AnyNode[]
  /** Blob hashes the snapshot references (textures, meshes, images). */
  assets: string[]
  /** World-space bounds of the roots at capture time, if known. */
  bounds?: { min: Vec3; max: Vec3 }
}

// ------------------------------------------------------------------ Project manifest (file tree)
export type FileKind = 'folder' | 'design' | 'asset'
export interface FileEntry {
  id: string
  name: string
  kind: FileKind
  parent: string | null
  order: string
  /** asset files */
  mime?: string
  size?: number
  blob?: string
  createdAt: number
  updatedAt: number
  createdBy?: string | null
}

export interface ProjectInfo {
  name: string
  description: string
  createdAt: number
  /** File opened by default */
  mainFile: string | null
}
