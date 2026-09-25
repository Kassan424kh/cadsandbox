// Shared plumbing for vectorize: drawing accumulation with bounds, drawing transforms, node
// traversal (incl. component instances) and material → hatch lookup.
import type { AnyNode, CadDocument, HatchPattern, Mat4, Vec2, Vec3 } from '@cadsandbox/doc'
import { BUILTIN_MATERIAL_MAP, DEFS_ROOT, TYPE_DEFAULT_MATERIAL, multiplyMatrices, transformPoint } from '@cadsandbox/doc'
import type { Drawing2D, Fill2D, GeometryResult, GeometryService, LineStyle, MeshPart, Text2D } from '@cadsandbox/geometry'
import { triangulate } from '../util/polygon'

export interface Bounds2D {
  min: [number, number]
  max: [number, number]
}

export type VectorDrawing = Drawing2D & { bounds: Bounds2D }

export interface VectorizeDeps {
  doc: CadDocument
  geometry: GeometryService
}

export class DrawingBuilder {
  private lines = new Map<LineStyle, number[]>()
  private fills: Fill2D[] = []
  private texts: Text2D[] = []
  private minX = Infinity
  private minY = Infinity
  private maxX = -Infinity
  private maxY = -Infinity

  private extend(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    if (x < this.minX) this.minX = x
    if (y < this.minY) this.minY = y
    if (x > this.maxX) this.maxX = x
    if (y > this.maxY) this.maxY = y
  }

  segment(style: LineStyle, a: Vec2, b: Vec2): void {
    let arr = this.lines.get(style)
    if (!arr) this.lines.set(style, (arr = []))
    arr.push(a[0], a[1], b[0], b[1])
    this.extend(a[0], a[1])
    this.extend(b[0], b[1])
  }

  segments(style: LineStyle, flat: ArrayLike<number>): void {
    for (let i = 0; i + 3 < flat.length; i += 4) this.segment(style, [flat[i], flat[i + 1]], [flat[i + 2], flat[i + 3]])
  }

  polyline(style: LineStyle, pts: readonly Vec2[], closed = false): void {
    const n = pts.length
    for (let i = 0; i < (closed ? n : n - 1); i++) this.segment(style, pts[i], pts[(i + 1) % n])
  }

  fill(f: Fill2D): void {
    this.fills.push(f)
    for (const poly of f.polygons) for (const p of poly.outer) this.extend(p[0], p[1])
  }

  /** Fill from polygons (outer + holes); triangulates the outer ring (holes kept for exporters). */
  fillPolygon(outer: Vec2[], holes: Vec2[][], pattern: HatchPattern, extra: Partial<Fill2D> = {}): void {
    if (outer.length < 3) return
    this.fill({ triangles: new Float32Array(triangulate(outer)), polygons: [{ outer, holes }], pattern, ...extra })
  }

  text(t: Text2D): void {
    this.texts.push(t)
    this.extend(t.position[0], t.position[1])
  }

  /** Append a drawing, mapping every coordinate through `map` (and rotating text by `rotation`). */
  addDrawing(d: Drawing2D, map: (p: Vec2) => Vec2 = (p) => p, rotation = 0): void {
    for (const l of d.lines) {
      const s = l.segments
      for (let i = 0; i + 3 < s.length; i += 4) this.segment(l.style, map([s[i], s[i + 1]]), map([s[i + 2], s[i + 3]]))
    }
    for (const f of d.fills) {
      const tri = new Float32Array(f.triangles.length)
      for (let i = 0; i + 1 < f.triangles.length; i += 2) {
        const p = map([f.triangles[i], f.triangles[i + 1]])
        tri[i] = p[0]
        tri[i + 1] = p[1]
      }
      this.fill({ ...f, triangles: tri, polygons: f.polygons.map((pg) => ({ outer: pg.outer.map(map), holes: pg.holes.map((h) => h.map(map)) })) })
    }
    for (const t of d.texts) this.text({ ...t, position: map(t.position), rotation: t.rotation + rotation })
  }

  isEmpty(): boolean {
    return this.minX === Infinity
  }

  build(): VectorDrawing {
    const lines = [...this.lines.entries()].map(([style, segs]) => ({ style, segments: new Float32Array(segs) }))
    const bounds: Bounds2D = this.isEmpty() ? { min: [0, 0], max: [0, 0] } : { min: [this.minX, this.minY], max: [this.maxX, this.maxY] }
    return { lines, fills: this.fills, texts: this.texts, bounds }
  }
}

/** Mapper from a node's local XY (z = 0) through a matrix, dropping z. */
export function xyMapper(m: Mat4): (p: Vec2) => Vec2 {
  return (p) => {
    const w = transformPoint(m, [p[0], p[1], 0])
    return [w[0], w[1]]
  }
}

/** Yaw (rotation about Z) of a matrix's XY part. */
export function matrixYaw(m: Mat4): number {
  return Math.atan2(m[1], m[0])
}

/** Hatch pattern for a mesh part of a node (material → hatch, with type defaults). */
export function partHatch(doc: CadDocument, node: AnyNode, part: MeshPart): HatchPattern {
  const id = part.material === 'node' ? (node.material ?? TYPE_DEFAULT_MATERIAL[node.type] ?? null) : part.material.id
  const mat = id ? (doc.getMaterial(id) ?? BUILTIN_MATERIAL_MAP.get(id)) : undefined
  if (mat?.hatch) return mat.hatch
  switch (node.type) {
    case 'wall':
      return 'masonry'
    case 'slab':
    case 'column':
    case 'beam':
    case 'stair':
      return 'concrete'
    case 'roof':
      return 'timber'
    default:
      return 'solid'
  }
}

export interface Renderable {
  node: AnyNode
  /** Node whose geometry result to use (the definition node for instances) */
  resultId: string
  world: Mat4
  /** Instance node the renderable belongs to (for level filtering) */
  via: AnyNode | null
}

/** Visible, non-consumed renderable nodes (components expanded) below `root` (null = whole doc). */
export function collectRenderables(deps: VectorizeDeps, root: string | null): Renderable[] {
  const { doc, geometry } = deps
  const out: Renderable[] = []
  const ids = root ? doc.getDescendants(root) : doc.nodeIds()
  for (const id of ids) {
    const node = doc.getNode(id) as AnyNode | undefined
    if (!node || node.type === 'level' || node.type === 'group' || node.type === 'light' || node.type === 'section') continue
    if (doc.isDefinitionNode(id) || !doc.isEffectivelyVisible(id) || geometry.isConsumed(id)) continue
    if (node.type === 'instance') {
      expandInstance(deps, node, doc.getWorldMatrix(id), out, 0)
      continue
    }
    out.push({ node, resultId: id, world: doc.getWorldMatrix(id), via: null })
  }
  return out
}

function expandInstance(deps: VectorizeDeps, inst: AnyNode, instWorld: Mat4, out: Renderable[], depth: number): void {
  if (inst.type !== 'instance' || depth > 4) return
  const def = deps.doc.getComponent(inst.params.component)
  if (!def) return
  for (const id of deps.doc.getDescendants(def.root)) {
    const node = deps.doc.getNode(id) as AnyNode | undefined
    if (!node || node.type === 'group' || !node.visible) continue
    const rel = deps.doc.getWorldMatrix(id) // relative to DEFS_ROOT (identity)
    const world = multiplyMatrices(instWorld, rel)
    if (node.type === 'instance') expandInstance(deps, node, world, out, depth + 1)
    else out.push({ node, resultId: id, world, via: inst })
  }
}

export function resultOf(deps: VectorizeDeps, r: Renderable): GeometryResult | undefined {
  return deps.geometry.get(r.resultId)
}

/** World-space Z range of a renderable (from its result bounds), or null. */
export function worldZRange(r: Renderable, res: GeometryResult | undefined): [number, number] | null {
  if (!res) return null
  const b = res.bounds
  const corners: Vec3[] = []
  for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) corners.push(transformPoint(r.world, [x, y, z]))
  let lo = Infinity,
    hi = -Infinity
  for (const c of corners) {
    if (c[2] < lo) lo = c[2]
    if (c[2] > hi) hi = c[2]
  }
  return [lo, hi]
}

export const IS_DEFS = (doc: CadDocument, id: string): boolean => id === DEFS_ROOT || doc.isDefinitionNode(id)
