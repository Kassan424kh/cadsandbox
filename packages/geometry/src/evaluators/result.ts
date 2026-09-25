// Helpers to assemble GeometryResults consistently (bounds, feature edges, quantities).
import type { Vec3 } from '@cadsandbox/doc'
import type { Bounds3, Drawing2D, GeometryResult, MeshBuffers, MeshPart, SnapKind, SnapPoint } from '../api'
import { DEFAULT_CREASE, boundsOfMeshes, computeFeatureEdges, emptyBounds, mergeMeshes, unionBounds } from '../core/mesh'
import { computeCleanWireframe } from '../core/wire'

export function meshPart(mesh: MeshBuffers, material?: string | null, extra: Partial<MeshPart> = {}): MeshPart {
  return { mesh, material: material ? { id: material } : 'node', castShadow: true, receiveShadow: true, ...extra }
}

export const snap = (kind: SnapKind, x: number, y: number, z = 0): SnapPoint => ({ p: [x, y, z], kind })
export const snapAt = (kind: SnapKind, p: Vec3): SnapPoint => ({ p: [p[0], p[1], p[2]], kind })

export const emptyDrawing = (): Drawing2D => ({ lines: [], fills: [], texts: [] })

export interface FinishOptions {
  /** 'auto' derives feature edges from the merged parts; a Float32Array is used as-is. */
  edges?: Float32Array | 'auto' | 'none'
  edgeAngle?: number
  /** Wireframe-mode lines. Default 'auto': clean (diagonal-free) wireframe of the merged parts;
   *  generators that know their topology (lofts, sweeps, terrain grids) pass explicit segments. */
  wire?: Float32Array | 'auto' | 'none'
  drawing?: Drawing2D
  plan?: Drawing2D
  snaps?: SnapPoint[]
  quantities?: Record<string, number>
  /** Extra bounds to union with the mesh bounds (2D content, symbols). */
  extraBounds?: Bounds3 | null
  error?: string
}

export function finish(parts: MeshPart[], opts: FinishOptions = {}): GeometryResult {
  const meshes = parts.map((p) => p.mesh).filter((m) => m.positions.length > 0)
  let bounds: Bounds3 | null = meshes.length ? boundsOfMeshes(meshes) : null
  if (opts.extraBounds) bounds = unionBounds(bounds, opts.extraBounds)
  const res: GeometryResult = { parts, bounds: bounds ?? emptyBounds() }
  const wire = opts.wire ?? 'auto'
  const merged = meshes.length && (opts.edges === 'auto' || wire === 'auto') ? (meshes.length === 1 ? meshes[0]! : mergeMeshes(meshes)) : null
  if (opts.edges === 'auto' && merged) {
    const e = computeFeatureEdges(merged, opts.edgeAngle ?? DEFAULT_CREASE)
    if (e.length) res.edges = e
  } else if (opts.edges instanceof Float32Array && opts.edges.length) res.edges = opts.edges
  if (wire === 'auto' && merged) {
    const w = computeCleanWireframe(merged)
    if (w.length) res.wire = w
  } else if (wire instanceof Float32Array && wire.length) res.wire = wire
  if (opts.drawing && (opts.drawing.lines.length || opts.drawing.fills.length || opts.drawing.texts.length)) res.drawing = opts.drawing
  if (opts.plan && (opts.plan.lines.length || opts.plan.fills.length || opts.plan.texts.length)) res.plan = opts.plan
  if (opts.snaps?.length) res.snaps = opts.snaps
  if (opts.quantities) res.quantities = opts.quantities
  if (opts.error) res.error = opts.error
  return res
}

export function emptyResult(extra: Partial<GeometryResult> = {}): GeometryResult {
  return { parts: [], bounds: emptyBounds(), ...extra }
}

export function errorResult(message: string, base?: GeometryResult): GeometryResult {
  return { ...(base ?? emptyResult()), error: message }
}

/** Bounds of a set of 2D points at a z range (for pure 2D entities). */
export function bounds2D(points: readonly (readonly [number, number])[], z0 = 0, z1 = 0): Bounds3 | null {
  if (!points.length) return null
  const b: Bounds3 = { min: [Infinity, Infinity, z0], max: [-Infinity, -Infinity, z1] }
  for (const p of points) {
    if (p[0] < b.min[0]) b.min[0] = p[0]
    if (p[1] < b.min[1]) b.min[1] = p[1]
    if (p[0] > b.max[0]) b.max[0] = p[0]
    if (p[1] > b.max[1]) b.max[1] = p[1]
  }
  return b
}

/** Bounds of a 2D segment buffer [x0,y0,x1,y1,…]. */
export function boundsOfSegments(segs: ArrayLike<number>, z = 0): Bounds3 | null {
  if (segs.length < 4) return null
  const b: Bounds3 = { min: [Infinity, Infinity, z], max: [-Infinity, -Infinity, z] }
  for (let i = 0; i < segs.length; i += 2) {
    const x = segs[i]!, y = segs[i + 1]!
    if (x < b.min[0]) b.min[0] = x
    if (y < b.min[1]) b.min[1] = y
    if (x > b.max[0]) b.max[0] = x
    if (y > b.max[1]) b.max[1] = y
  }
  return b
}

export function drawingBounds(d: Drawing2D | undefined, z = 0): Bounds3 | null {
  if (!d) return null
  let b: Bounds3 | null = null
  for (const l of d.lines) b = unionBounds(b, boundsOfSegments(l.segments, z))
  for (const f of d.fills) b = unionBounds(b, boundsOfSegments(f.triangles, z))
  for (const t of d.texts) b = unionBounds(b, { min: [t.position[0], t.position[1], z], max: [t.position[0], t.position[1], z] })
  return b
}
