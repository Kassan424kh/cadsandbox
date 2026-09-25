// Evaluation context: everything an evaluator may need besides the node itself. Plain data only
// (structured-clone friendly) so the same evaluators run in workers and on the calling thread.
import type { HatchPattern, MaterialCategory, OpeningParams, UnitsSettings, Vec3, WallParams } from '@cadsandbox/doc'
import type { Bounds3, MeshBuffers } from '../api'
import type { Affine2 } from '../core/math2d'

export interface MaterialInfo {
  color: string
  category: MaterialCategory
  hatch?: HatchPattern
}

/** A wall on the same level, expressed in the evaluated node's local frame. */
export interface NeighborWall {
  id: string
  params: WallParams
  /** neighbour-local → node-local (XY part) */
  xf: Affine2
  /** neighbour base elevation relative to the node's local frame */
  dz: number
}

export interface OpeningRef {
  id: string
  params: OpeningParams
}

export interface OperandSolid {
  /** already transformed into the boolean node's local space */
  mesh: MeshBuffers
  /** material of the contributing node (null = inherit the boolean node's material) */
  material: string | null
}

/** One boolean operand = one child subtree (child order = operand order). */
export interface OperandGeometry {
  nodeId: string
  /** content key of the operand results (used for hashing, not for geometry) */
  key: string
  solids: OperandSolid[]
}

export interface EvalContext {
  units: UnitsSettings
  /** Level settings in effect (defaults when the node is not under a level). */
  level: { height: number; cutHeight: number }
  /** Materials referenced by the node (node.material, layers, slots …). */
  materials: Record<string, MaterialInfo>
  /** wall: walls on the same level that may join (already filtered by proximity). */
  walls?: NeighborWall[]
  /** wall: hosted openings. */
  openings?: OpeningRef[]
  /** opening: host wall params + wall-local → opening-local transform (column-major 4×4). */
  host?: { wall: WallParams; toLocal: number[]; openingIndex: number }
  /** boolean: operand subtrees in child order. */
  operands?: OperandGeometry[]
  /** instance: bounds of the component definition in definition-root space (null = empty/unknown). */
  definitionBounds?: Bounds3 | null
  /** room(auto): every wall on the level (node-local frame). */
  levelWalls?: NeighborWall[]
  /** dimension: anchor points resolved from `refs`, node-local (null when unresolved). */
  anchors?: (Vec3 | null)[]
  /** mesh / image: blob bytes (null = unavailable). */
  asset?: ArrayBuffer | null
  /** levelmark: world elevation (m) of the node origin — height markers show it against project zero. */
  elevation?: number
  /** Detached evaluation (tool preview): dependencies are intentionally absent. */
  preview?: boolean
}

export function defaultContext(partial: Partial<EvalContext> = {}): EvalContext {
  return {
    units: { length: 'mm', precision: 0, angle: 'deg', area: 'm2' },
    level: { height: 3, cutHeight: 1.1 },
    materials: {},
    ...partial,
  }
}
