// Wall geometry helpers (wall-local = parent/level-local XY; a→b axis).
// Justification convention: the drawn line a→b is the wall's CENTER line, its LEFT face
// ('left': body extends to the right of a→b) or its RIGHT face ('right': body extends to the left).
import type { AnyNode, CadDocument, NodeBase, Vec2, WallParams } from '@cadsandbox/doc'
import { arcFromBulge, sampleArc } from './arcs'
import { lineParam, type Seg2 } from './polygon'
import { v2 } from './vec'

export interface WallAxis {
  a: Vec2
  b: Vec2
  dir: Vec2
  /** Left normal of a→b */
  normal: Vec2
  length: number
}

export function wallAxis(w: Pick<WallParams, 'a' | 'b'>): WallAxis {
  const d = v2.sub(w.b, w.a)
  const length = v2.len(d)
  const dir: Vec2 = length > 1e-12 ? v2.scale(d, 1 / length) : [1, 0]
  return { a: w.a, b: w.b, dir, normal: v2.perp(dir), length }
}

/** Distances from the axis to the left and right faces. */
export function wallSideOffsets(w: Pick<WallParams, 'thickness' | 'justification'>): { left: number; right: number } {
  const t = w.thickness
  switch (w.justification) {
    case 'left':
      return { left: 0, right: t }
    case 'right':
      return { left: t, right: 0 }
    default:
      return { left: t / 2, right: t / 2 }
  }
}

/** Signed offset of the wall's center line from the axis (positive = toward the left). */
export function wallCenterOffset(w: Pick<WallParams, 'thickness' | 'justification'>): number {
  const { left, right } = wallSideOffsets(w)
  return (left - right) / 2
}

/** Footprint polygon (CCW-ish quad) of a straight wall in parent space; arced walls are sampled. */
export function wallOutline(w: WallParams): Vec2[] {
  const { left, right } = wallSideOffsets(w)
  const arc = w.bulge ? arcFromBulge(w.a, w.b, w.bulge) : null
  if (!arc) {
    const ax = wallAxis(w)
    const l = v2.scale(ax.normal, left)
    const r = v2.scale(ax.normal, -right)
    return [v2.add(w.a, r), v2.add(w.b, r), v2.add(w.b, l), v2.add(w.a, l)]
  }
  // Arc wall: left side is the side toward the center for a CCW (positive bulge) arc.
  const pts = sampleArc(arc)
  if (w.bulge! < 0) pts.reverse()
  const inner: Vec2[] = []
  const outer: Vec2[] = []
  for (const p of pts) {
    const rad = v2.norm(v2.sub(p, arc.center))
    const towardCenter = v2.scale(rad, -1)
    const leftDir = w.bulge! > 0 ? towardCenter : rad
    inner.push(v2.add(p, v2.scale(leftDir, left)))
    outer.push(v2.add(p, v2.scale(leftDir, -right)))
  }
  return [...outer, ...inner.reverse()]
}

/** Both face lines of a straight wall as segments (left, right). */
export function wallFaces(w: WallParams): { left: Seg2; right: Seg2 } {
  const ax = wallAxis(w)
  const { left, right } = wallSideOffsets(w)
  return {
    left: { a: v2.add(w.a, v2.scale(ax.normal, left)), b: v2.add(w.b, v2.scale(ax.normal, left)) },
    right: { a: v2.sub(w.a, v2.scale(ax.normal, right)), b: v2.sub(w.b, v2.scale(ax.normal, right)) },
  }
}

/** Distance along the axis from a (clamped to the wall) and which side the point is on. */
export function wallOffsetOf(w: WallParams, p: Vec2): { offset: number; side: 'left' | 'right'; distance: number } {
  const ax = wallAxis(w)
  const t = lineParam(p, w.a, w.b)
  const offset = Math.max(0, Math.min(ax.length, t * ax.length))
  const rel = v2.sub(p, w.a)
  const lateral = v2.cross(ax.dir, rel)
  return { offset, side: lateral >= 0 ? 'left' : 'right', distance: Math.abs(lateral) }
}

export function pointOnWall(w: Pick<WallParams, 'a' | 'b'>, offset: number, lateral = 0): Vec2 {
  const ax = wallAxis(w)
  return v2.add(v2.add(w.a, v2.scale(ax.dir, offset)), v2.scale(ax.normal, lateral))
}

/** Is p inside the wall footprint (with tolerance)? */
export function pointInWall(w: WallParams, p: Vec2, tol = 0): boolean {
  const ax = wallAxis(w)
  const rel = v2.sub(p, w.a)
  const along = v2.dot(rel, ax.dir)
  if (along < -tol || along > ax.length + tol) return false
  const lateral = v2.cross(ax.dir, rel)
  const { left, right } = wallSideOffsets(w)
  return lateral <= left + tol && lateral >= -right - tol
}

/** For a face edge running along this wall, the inset from the axis to the face on the given side. */
export function wallFaceInset(w: WallParams, edgeDir: Vec2, faceSide: 'left' | 'right'): number {
  const ax = wallAxis(w)
  const same = v2.dot(edgeDir, ax.dir) >= 0
  const { left, right } = wallSideOffsets(w)
  // faceSide is relative to the edge direction; map to the wall's own left/right.
  const wallSide = same ? faceSide : faceSide === 'left' ? 'right' : 'left'
  return wallSide === 'left' ? left : right
}

export type WallNode = NodeBase<'wall'>

/** All wall nodes that are descendants of `levelId` (or root when null). */
export function wallsUnder(doc: CadDocument, levelId: string | null): WallNode[] {
  if (!levelId) return doc.nodesOfType('wall')
  const out: WallNode[] = []
  for (const id of doc.getDescendants(levelId)) {
    const n = doc.getNode(id) as AnyNode | undefined
    if (n && n.type === 'wall') out.push(n)
  }
  return out
}
