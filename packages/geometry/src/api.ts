// @cadsandbox/geometry — public contract.
//
// Turns document nodes (recipes) into renderable, exportable geometry. Pure TypeScript + WASM
// (manifold-3d for booleans), runs in Web Workers; no DOM, no three.js scene objects in results.
// All coordinates are NODE-LOCAL, meters, Z-up. The renderer applies world matrices.
import type { AnyNode, CadDocument, HatchPattern, NodeType, Vec2, Vec3 } from '@cadsandbox/doc'

// ------------------------------------------------------------------ results
export interface MeshBuffers {
  positions: Float32Array
  normals: Float32Array
  /** World-scale UVs: 1 unit = 1 meter along the surface (materials divide by their tile size). */
  uvs?: Float32Array
  indices?: Uint32Array
}

export interface MeshPart {
  mesh: MeshBuffers
  /** 'node' = node.material ?? type default (tinted by node.color); otherwise a fixed material id
   *  (e.g. 'mat-glass' for window panes, or a wall layer's material). */
  material: 'node' | { id: string }
  castShadow?: boolean
  receiveShadow?: boolean
}

/** 2D line styles, mapped to line weights/dash patterns by the renderer and exporters. */
export type LineStyle =
  | 'cut' // heavy: elements cut by the plan/section plane
  | 'visible' // medium: visible edges below the cut
  | 'overhead' // dashed: elements above the cut (upper cabinets, roof overhang)
  | 'hidden' // dashed: hidden edges
  | 'thin' // thin: furniture, fixtures, hatch boundaries
  | 'symbol' // door swings, window sashes, stair arrows
  | 'annotation' // dimensions, leaders, labels (layer colored)
  | 'drafting' // user-drawn 2D entities (layer lineweight/linetype)

export interface Lines2D {
  style: LineStyle
  /** Segment pairs [x0,y0,x1,y1, …] in local XY. */
  segments: Float32Array
}

export interface Fill2D {
  /** Triangulated fill [x,y, …] (3 vertices per triangle) in local XY. */
  triangles: Float32Array
  /** Source polygons (outer + holes) — kept for vector export (PDF/DXF/SVG hatches). */
  polygons: { outer: Vec2[]; holes: Vec2[][] }[]
  pattern: HatchPattern
  color?: string
  scale?: number
  angle?: number
}

export interface Text2D {
  text: string
  position: Vec2
  /** Cap height (m) */
  size: number
  rotation: number
  align: 'left' | 'center' | 'right'
  baseline: 'top' | 'middle' | 'bottom'
  style?: 'annotation' | 'label' | 'title'
}

export interface Drawing2D {
  lines: Lines2D[]
  fills: Fill2D[]
  texts: Text2D[]
}

export type SnapKind = 'endpoint' | 'midpoint' | 'center' | 'quadrant' | 'vertex' | 'insertion'

export interface SnapPoint {
  p: Vec3
  kind: SnapKind
}

export interface Bounds3 {
  min: Vec3
  max: Vec3
}

export interface GeometryResult {
  /** 3D surfaces (may be empty for pure 2D entities). */
  parts: MeshPart[]
  /** Feature edges (creases ≥ ~30°) for outline/hidden-line/technical rendering: segment pairs [x,y,z, x,y,z, …]. */
  edges?: Float32Array
  /** Blender-like wireframe: the facet topology (rings, segments, every face boundary) without the
   *  triangle diagonals of flat faces — drawn by the wireframe render mode. Segment pairs, node-local. */
  wire?: Float32Array
  /** 2D content drawn in the node's local XY plane in EVERY view (drafting entities, dimensions). */
  drawing?: Drawing2D
  /** Symbolic plan representation (architecture): shown in plan/technical views instead of the
   *  generic mesh cut (wall poché + hatch, door swings, window sashes, stair arrows, room stamps). */
  plan?: Drawing2D
  bounds: Bounds3
  /** Snap candidates in local space (endpoints, midpoints, centers…) in addition to mesh vertices. */
  snaps?: SnapPoint[]
  /** Quantities for schedules/BOQ: length, area, netArea, volume, perimeter, count, riserHeight… */
  quantities?: Record<string, number>
  /** Evaluation failed: renderer shows a warning badge; parts may be empty. */
  error?: string
}

// ------------------------------------------------------------------ assets
export interface AssetResolver {
  /** Raw bytes of a content-addressed blob (sha256 hex), or null if unavailable. */
  get(hash: string): Promise<ArrayBuffer | null>
}

// ------------------------------------------------------------------ service
export interface GeometryServiceOptions {
  doc: CadDocument
  assets: AssetResolver
  /** Worker count (default: clamp(hardwareConcurrency - 1, 1, 8)); 0 = evaluate on the main thread. */
  workers?: number
}

/**
 * Observes the document, evaluates dirty nodes (in dependency order) on a worker pool, caches
 * results by content hash and notifies listeners. Handles dependencies:
 *   • boolean  → its children (operands are consumed: not rendered separately)
 *   • wall     → other walls on the same level (joins) + its opening children (cut-outs)
 *   • opening  → its host wall
 *   • room(auto) → walls on its level
 *   • instance → component definition subtree (evaluated once, instanced by the renderer)
 *   • dimension(refs) → referenced nodes
 */
export interface GeometryService {
  get(nodeId: string): GeometryResult | undefined
  /** Batched (per animation frame) set of node ids whose results changed or were removed. */
  onUpdate(listener: (changed: ReadonlySet<string>) => void): () => void
  /** Nodes whose geometry is consumed by another node (boolean operands) — renderer hides them. */
  isConsumed(nodeId: string): boolean
  /** Force re-evaluation. */
  invalidate(nodeIds: Iterable<string>): void
  /** Resolves when no evaluation is pending (use before export/print/thumbnail). */
  idle(): Promise<void>
  /** Evaluate a detached node (tool previews, library thumbnails). Not cached in the doc graph. */
  preview(node: AnyNode): Promise<GeometryResult>
  /** Synchronous evaluation on the calling thread for cheap types (primitive/shape/2D). null if unsupported. */
  previewSync(node: AnyNode): GeometryResult | null
  /** World-space bounds of nodes (union), using evaluated results. */
  worldBounds(nodeIds: Iterable<string>): Bounds3 | null
  readonly stats: { pending: number; evaluated: number; cacheSize: number; lastEvalMs: number }
  /** Evaluated definition nodes of a component (renderer instances them per `instance` node). */
  getComponentGeometry(componentId: string): ComponentGeometry[]
  /** Content key of a node's current result (changes whenever its geometry changes). */
  keyOf(nodeId: string): string | undefined
  dispose(): void
}

export type CreateGeometryService = (opts: GeometryServiceOptions) => GeometryService

/** One evaluated node of a component definition, for GPU instancing. */
export interface ComponentGeometry {
  nodeId: string
  result: GeometryResult
  /** node-local → definition-root space, column-major 4×4 */
  matrix: Float64Array
}

// ------------------------------------------------------------------ analysis (architecture)
export interface RoomRow {
  id: string
  number: string
  name: string
  level: string
  usage: string
  area: number
  perimeter: number
  height: number
  volume: number
}
export interface OpeningRow {
  id: string
  kind: 'door' | 'window' | 'opening'
  style: string
  level: string
  wall: string
  width: number
  height: number
  sill: number
  count: number
}
export interface WallRow {
  id: string
  level: string
  length: number
  height: number
  thickness: number
  /** One reference face: length × height */
  grossArea: number
  openingArea?: number
  /** grossArea − openingArea (one face) */
  netArea: number
  /** Both faces, net */
  surfaceArea?: number
  volume: number
  material: string
}
export interface Schedules {
  rooms: RoomRow[]
  doors: OpeningRow[]
  windows: OpeningRow[]
  walls: WallRow[]
  /** DIN 277 summary: area per usage group + totals (NUF, TF, VF, NRF, BGF estimate) */
  areas: { usage: string; area: number }[]
  totals: { netFloorArea: number; grossFloorArea: number; grossVolume: number }
}

/** Node types whose geometry depends on other nodes (see GeometryService docs). */
export const DEPENDENT_TYPES: readonly NodeType[] = ['boolean', 'wall', 'opening', 'room', 'instance', 'dimension']

// ------------------------------------------------------------------ binary mesh blob (CSBM)
/** Content-addressed mesh blob format used by `mesh` nodes:
 *  header 'CSBM' u8[4] | version u32 | flags u32 (1=normals,2=uvs,4=indices) | vertexCount u32 | indexCount u32
 *  then positions f32[3n], normals f32[3n]?, uvs f32[2n]?, indices u32[m]? (little-endian, 4-byte aligned). */
export const CSBM_MAGIC = 0x4d425343 // 'CSBM' little-endian
