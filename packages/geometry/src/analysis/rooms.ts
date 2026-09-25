// Room detection: enclosed regions bounded by wall faces = holes of the union of wall footprints.
import type { CadDocument, Vec2 } from '@cadsandbox/doc'
import { invertMatrix, multiplyMatrices } from '@cadsandbox/doc'
import { affineFromMat4, pointInPolygon, polygonArea } from '../core/math2d'
import { offsetPolygons, unionPolygons, type PolyWithHoles, type Ring } from '../core/polygon'
import type { NeighborWall } from '../evaluators/context'
import { WallFrame, transformWallParams } from '../evaluators/wall/frame'
import { rawFootprint } from '../evaluators/wall/joins'

/** Closing tolerance for small gaps between walls (meters). */
export const ROOM_GAP_TOLERANCE = 0.01

/**
 * Enclosed regions from wall frames (all in one coordinate frame). Gaps up to the tolerance are
 * closed by inflating footprints before the union and deflating the result. Returns each region
 * as a polygon with holes (islands such as free-standing columns become holes), CCW outer rings.
 */
export function roomRegionsFromFrames(frames: readonly WallFrame[], gapTolerance = ROOM_GAP_TOLERANCE): PolyWithHoles[] {
  if (!frames.length) return []
  const footprints: Ring[] = frames.map((f) => rawFootprint(f))
  const merged = unionPolygons(footprints)
  const inflated = gapTolerance > 0 ? offsetPolygons(merged, gapTolerance, 'miter') : merged
  const union = gapTolerance > 0 ? offsetPolygons(inflated, -gapTolerance, 'miter') : inflated
  // every hole of the union is an enclosed region; islands inside a hole are the region's holes
  const regions: PolyWithHoles[] = []
  const outers = union.map((u) => u.outer)
  for (const u of union) {
    for (const hole of u.holes) {
      const outer = polygonArea(hole) < 0 ? hole.slice().reverse() : hole.slice()
      const holes: Ring[] = []
      for (const o of outers) {
        if (o === u.outer) continue
        if (o.length && pointInPolygon(o[0]!, outer)) holes.push(polygonArea(o) > 0 ? o.slice().reverse() : o.slice())
      }
      regions.push({ outer, holes })
    }
  }
  return regions
}

/** Region containing `p` (smallest by area when nested). */
export function regionContaining(regions: readonly PolyWithHoles[], p: Vec2): PolyWithHoles | null {
  let best: PolyWithHoles | null = null
  let bestArea = Infinity
  for (const r of regions) {
    if (!pointInPolygon(p, r.outer)) continue
    if (r.holes.some((h) => pointInPolygon(p, h))) continue
    const a = Math.abs(polygonArea(r.outer))
    if (a < bestArea) {
      bestArea = a
      best = r
    }
  }
  return best
}

export function framesFromNeighbors(walls: readonly NeighborWall[]): WallFrame[] {
  return walls.map((w) => new WallFrame(transformWallParams(w.params, w.xf), null))
}

/** Walls of a level expressed in the frame of `targetId` (or level space when omitted). */
export function levelWalls(doc: CadDocument, levelId: string, targetId?: string, excludeId?: string): NeighborWall[] {
  const target = invertMatrix(doc.getWorldMatrix(targetId ?? levelId))
  const out: NeighborWall[] = []
  for (const w of doc.nodesOfType('wall')) {
    if (w.id === excludeId) continue
    if (doc.getLevelOf(w.id) !== levelId) continue
    if (doc.isDefinitionNode(w.id)) continue
    const m = multiplyMatrices(target, doc.getWorldMatrix(w.id))
    out.push({ id: w.id, params: w.params, xf: affineFromMat4(m), dz: m[14]! })
  }
  return out
}

/** Closed room outlines (outer rings only, CCW) bounded by the walls of a level, in level space. */
export function detectRooms(doc: CadDocument, levelId: string): Vec2[][] {
  return detectRoomRegions(doc, levelId).map((r) => r.outer)
}

/** Full room regions (with island holes) bounded by the walls of a level, in level space. */
export function detectRoomRegions(doc: CadDocument, levelId: string): PolyWithHoles[] {
  return roomRegionsFromFrames(framesFromNeighbors(levelWalls(doc, levelId)))
}
