// Region detection helpers built on the planar graph: collect segments of drafting entities and
// walls in the tool's parent frame, find the room/building outlines around a clicked point.
import type { AnyNode, Vec2, Vec3 } from '@cadsandbox/doc'
import type { ToolContext } from '../types'
import { buildPlanarGraph, outerBoundaryAt, regionAt, type PlanarFace, type PlanarGraph, type PlanarSegment, type Region } from './planar'
import { insetLoop, simplifyPolygon } from './polygon'
import { entitySegments, siblingsOfType } from './scene'
import { v2 } from './vec'
import { wallFaceInset, wallsUnder, type WallNode } from './walls'

const DRAFTING_REGION_TYPES: AnyNode['type'][] = ['line', 'polyline', 'rect', 'circle', 'arc', 'ellipse', 'spline']

export interface RegionSources {
  /** Include 2D drafting entities under the parent */
  drafting?: boolean
  /** Include walls of the active level: their faces ('outline') or center lines ('axis') */
  walls?: 'outline' | 'axis' | false
  exclude?: Iterable<string>
}

/** Map a point from a node's parent frame into the tool parent frame. */
function reframe(ctx: ToolContext, fromParent: string | null, toParent: string | null): (p: Vec2) => Vec2 {
  if (fromParent === toParent) return (p) => p
  return (p) => {
    const w = ctx.toWorld(fromParent, [p[0], p[1], 0])
    const l = ctx.toLocal(toParent, w)
    return [l[0], l[1]]
  }
}

export function levelWalls(ctx: ToolContext): WallNode[] {
  const level = ctx.activeLevel()?.id ?? null
  return wallsUnder(ctx.doc, level).filter((w) => ctx.doc.isEffectivelyVisible(w.id))
}

export function regionSegments(ctx: ToolContext, sources: RegionSources): PlanarSegment[] {
  const parent = ctx.defaultParent()
  const out: PlanarSegment[] = []
  const exclude = new Set(sources.exclude ?? [])
  if (sources.drafting) {
    for (const n of siblingsOfType(ctx.doc, parent, DRAFTING_REGION_TYPES, exclude)) {
      for (const s of entitySegments(n)) out.push({ a: s.a, b: s.b, ref: n.id })
    }
  }
  if (sources.walls) {
    for (const w of levelWalls(ctx)) {
      if (exclude.has(w.id)) continue
      const map = reframe(ctx, w.parent, parent)
      if (sources.walls === 'axis') out.push({ a: map(w.params.a), b: map(w.params.b), ref: w.id })
      else for (const s of entitySegments(w)) out.push({ a: map(s.a), b: map(s.b), ref: w.id })
    }
  }
  return out
}

export interface WallGraph {
  graph: PlanarGraph
  walls: Map<string, WallNode>
}

/** Planar graph of the wall center lines on the active level. */
export function wallGraph(ctx: ToolContext): WallGraph {
  const walls = new Map<string, WallNode>()
  for (const w of levelWalls(ctx)) walls.set(w.id, w)
  return { graph: buildPlanarGraph(regionSegments(ctx, { walls: 'axis' })), walls }
}

/** Wall graph cached until the document changes (tools rebuild lazily on hover). */
export class WallGraphCache {
  private wg: WallGraph | null = null
  private unsubscribe: (() => void) | null = null
  constructor(private ctx: ToolContext) {
    this.unsubscribe = ctx.doc.onChange(() => (this.wg = null))
  }
  get(): WallGraph {
    if (!this.wg) this.wg = wallGraph(this.ctx)
    return this.wg
  }
  invalidate(): void {
    this.wg = null
  }
  dispose(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.wg = null
  }
}

/** Inner face outline of the room around `point` (wall axes inset to the interior faces). */
export function roomOutlineAt(ctx: ToolContext, wg: WallGraph, point: Vec2): { region: Region; outline: Vec2[] } | null {
  const region = regionAt(wg.graph, point)
  if (!region) return null
  return { region, outline: insetFaceByWalls(region.face, wg.walls, 'left') }
}

/** Outer building outline of the wall loop component around `point` (axes offset to exterior faces). */
export function buildingOutlineAt(ctx: ToolContext, wg: WallGraph, point: Vec2): { face: PlanarFace; outline: Vec2[] } | null {
  const face = outerBoundaryAt(wg.graph, point)
  if (!face) return null
  return { face, outline: insetFaceByWalls(face, wg.walls, 'right') }
}

/**
 * Move each edge of a CCW face from the wall axis to the wall face on the interior ('left' of the
 * CCW edge) or exterior ('right') side. Edges without a wall (drafting lines) keep their position.
 */
export function insetFaceByWalls(face: PlanarFace, walls: Map<string, WallNode>, side: 'left' | 'right'): Vec2[] {
  const loop = face.outline
  const n = loop.length
  const insets: number[] = []
  for (let i = 0; i < n; i++) {
    const a = loop[i],
      b = loop[(i + 1) % n]
    const edge = face.edges.find((e) => v2.eq(e.a, a, 1e-6) && v2.eq(e.b, b, 1e-6)) ?? face.edges[i]
    const wall = edge?.ref ? walls.get(edge.ref) : undefined
    if (!wall) {
      insets.push(0)
      continue
    }
    const dir = v2.sub(b, a)
    const d = wallFaceInset(wall.params, dir, side)
    insets.push(side === 'left' ? d : -d)
  }
  return simplifyPolygon(insetLoop(loop, insets))
}

/** World polygon for preview from a parent-local outline. */
export function outlineToWorld(ctx: ToolContext, parent: string | null, outline: readonly Vec2[], z = 0): Vec3[] {
  return outline.map((p) => ctx.toWorld(parent, [p[0], p[1], z]))
}
