// @cadsandbox/geometry — geometry engine entry point.
//
// Conventions implemented here (beyond api.ts):
//   • Wall layers are listed from the LEFT face (left of a→b) to the right face; when `layers` is
//     present the wall thickness is their sum. `bulge` > 0 = CCW arc (DXF convention).
//   • Wall quantities (one reference face): grossArea = length × height, openingArea, netArea =
//     grossArea − openingArea, surfaceArea = 2 × netArea, volume = joined footprint × height − openings.
//   • Openings are placed from the host wall (node transform ignored); results are still expressed
//     in the opening node's local frame so the renderer applies the ordinary world matrix.
//     `hinge` is seen from the wall's left side; `opensTo` selects the swing side. Doors are drawn
//     closed in 3D and open (leaf + swing arc) in plan. Windows: interior = opensTo side.
//   • Plan symbology honours the level's `cutHeight` (relative to the node's frame): elements below the
//     cut use 'visible', above it 'overhead'; cut walls/columns get a 'solid' poché Fill2D plus the
//     material's hatch as segments ('thin') and a patterned Fill2D for vector export.
//   • Hatch base unit = 0.1 m × scale; patterns are pre-generated as segments clipped to the region.
//   • Dimension text uses the doc units (shared formatLength); node.meta.textSize (m) and
//     node.meta.terminator ('tick' | 'arrow') override defaults. Associative anchors:
//     'origin' | 'a' | 'b' | 'center' | '<snapKind>:<index>' | 'snap:<index>'.
//   • Image nodes emit one quad with material { id: 'image:<assetHash>' } (renderer maps it to an
//     unlit textured material with params.opacity).
//   • Rooms: plan fill (pattern 'solid' with params.fill, otherwise 'none' with polygons for picking)
//     and stamp texts [name, number, area]. `auto` rooms take the enclosed region around the node origin.
//   • Roof `baseOffset` is the eave height at the wall line; the overhang lowers the eave edge.
//   • Furniture: origin at the center of the back edge on the floor, front faces −Y.
//   • Bundled fonts: Droid Sans / Serif / Sans Mono / Sans Bold (Apache-2.0, src/text/fonts).
//   • Architecture analysis (analysis/report.ts analyzeBuilding) works in WORLD space from evaluated
//     results: node.meta.uValue (W/m²K) overrides U-values of walls/roofs/slabs/openings; RoomParams
//     livingSpace/habitable/outdoor and LevelParams.fullStorey override the name/usage heuristics.
export * from './api'

// service
export { createGeometryService } from './service/service'
export type { GeometryServiceExt } from './service/service'
export { buildContext, buildWallIndex, contextKey, nearbyWalls } from './service/context'
export type { BuiltContext, ContextInputs, WallIndex, WallIndexEntry } from './service/context'

// evaluation
export { evaluateNode, evaluateNodeSync, ASYNC_TYPES, costClass } from './evaluators/index'
export { defaultContext } from './evaluators/context'
export { formatElevation, levelmarkText, levelmarkValue, sectionLevelmarkDrawing } from './evaluators/annotation'
export { chainDirection, chainStations } from './evaluators/dimensionChain'
export type { EvalContext, MaterialInfo, NeighborWall, OpeningRef, OperandGeometry, OperandSolid } from './evaluators/context'
export { encodeCSBM, decodeCSBM, CSBM_VERSION } from './evaluators/mesh'
export { solveRisers } from './evaluators/stair'
export { WallFrame, solveJoins, openingCuts } from './evaluators/wall/index'
export { rawFootprint } from './evaluators/wall/joins'
export { roofSurface } from './evaluators/roof'

// analysis
export { detectRooms, detectRoomRegions, roomRegionsFromFrames, regionContaining, levelWalls } from './analysis/rooms'
export { computeSchedules, grossFloorArea } from './analysis/schedules'
export { sliceMesh, sliceMeshZ, chainSegments } from './analysis/slice'
export type { Plane } from './analysis/slice'

// architecture analysis & compliance (German/EU practice; planning estimates, not certificates)
export { analyzeBuilding } from './analysis/report'
export type { AnalysisReport } from './analysis/report'
export { collectBuilding, CoverIndex, roomKindOf, roomTags, materialLambda, samplePolys } from './analysis/building'
export type {
  BuildingModel,
  ClearHeightSamples,
  CollectOptions,
  LevelInfo,
  OpeningInfo,
  RoomInfo,
  RoomKind,
  Status as AnalysisStatus,
  WallInfo,
  WallSide,
} from './analysis/building'
export { computeDin277 } from './analysis/din277'
export type { Din277Level, Din277Result, Din277Values } from './analysis/din277'
export { computeWoflv } from './analysis/woflv'
export type { WoflvResult, WoflvRow } from './analysis/woflv'
export { computeZoning, limitStatus } from './analysis/zoning'
export type { StoreyInfo, StoreyReason, ZoningKey, ZoningResult, ZoningRow } from './analysis/zoning'
export { estimateCosts, costQuantities, DEFAULT_COST_ITEMS, DEFAULT_SERVICES_RATIO, KG_LABELS, SERVICES_SPLIT } from './analysis/din276'
export type { CostEstimate, CostGroupTotal, CostItemDef, CostLine, CostUnit } from './analysis/din276'
export { computeThermal, uValue, airLayerResistance, GEG_REFERENCE_U, DEFAULT_OPENING_U, RSI, RSE, FX, DELTA_UWB, DELTA_UWB_NO_PROOF, DELTA_UWB_REF } from './analysis/thermal'
export type { BuildUpRow, EnvelopeKind, EnvelopeRow, HeatFlow, ThermalResult, ULayer, USource, UValueResult } from './analysis/thermal'
export { runChecks, lboProfile, formatTemplate, CHECK_TEMPLATES, LBO_PROFILES, MBO_PROFILE } from './analysis/checks'
export type { CheckCategory, CheckOptions, CheckResult, LboProfile } from './analysis/checks'

// 2D geometry utilities
export {
  unionPolygons,
  differencePolygons,
  intersectPolygons,
  offsetPolygons,
  offsetPolyline,
  offsetRing,
  triangulatePolygon,
  trianglesOf,
  pointInPolys,
  nestRings,
  clipSegments,
  clipSegmentsAgainst,
  clipPolyline,
  labelPoint,
  polygonsArea,
  CLIPPER_SCALE,
} from './core/polygon'
export type { PolyWithHoles, Ring } from './core/polygon'
export { findRegion, planarFaces } from './core/planar'
export type { PlanarGraph } from './core/planar'
export { straightSkeleton } from './core/skeleton'
export type { StraightSkeleton, SkeletonArc, SkeletonFace } from './core/skeleton'
export { hatchSegments, ALL_HATCH_PATTERNS, HATCH_UNIT } from './core/hatch'
export { flattenPath, pathToPolygons, profilePolygons, roundCorners } from './core/path'
export { pointInPolygon, pointInPolygonWithHoles, polygonCentroid, convexHull, orientedBoundingBox, arcFromBulge, expandBulges, resamplePolyline, catmullRom } from './core/math2d'
export type { Affine2, Arc, OBB } from './core/math2d'
export { DrawingBuilder, transformDrawing, ANNO } from './core/drawing'

// 3D mesh utilities
export {
  MeshBuilder,
  mergeVertices,
  computeCreasedNormals,
  computeFeatureEdges,
  isClosedManifold,
  meshVolume,
  meshSurfaceArea,
  transformMesh,
  mergeMeshes,
  flipMesh,
  computeBounds,
  transformBounds,
  unionBounds,
  DEFAULT_CREASE,
} from './core/mesh'
export { computeCleanWireframe, latticeWire, WIRE_COPLANAR } from './core/wire'
export { extrudePolygons } from './core/extrude'
export { layoutText, loadFont } from './text/font'
export type { FontData, TextLayout } from './text/font'
