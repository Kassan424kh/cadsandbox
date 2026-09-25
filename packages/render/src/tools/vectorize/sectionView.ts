// Section / elevation / saved-view vectorization: cut polygons (material hatches) at the plane
// plus projected feature edges beyond it with sampled hidden-line removal. Output = frame (u, v).
import type { AnyNode, CadDocument, CameraState, Vec2, Vec3 } from '@cadsandbox/doc'
import { decomposeMatrix, polygonArea, rotateVec3 } from '@cadsandbox/doc'
import { chainSegments, pointInPolygon, type Seg2 } from '../util/polygon'
import { addSectionAnnotations } from './annotations'
import { DrawingBuilder, collectRenderables, partHatch, resultOf, type VectorDrawing, type VectorizeDeps } from './common'
import { OcclusionGrid, frameFromView, visibleEdges } from './hidden'
import { featureEdges, sliceMesh, toWorldMesh, transformEdges, type ViewFrame, type WorldMesh } from './mesh'

export interface SectionSetup {
  frame: ViewFrame
  maxDepth: number
  uRange?: [number, number]
  /** Draw cut polygons (false for elevations/views: nothing is cut) */
  cut: boolean
  /** Ground line at world z = 0 (elevations) */
  groundLine?: boolean
}

/** Frame of a 'section' node: local +Z = plane normal (clipped side), view looks along −Z. */
export function sectionSetup(doc: CadDocument, node: AnyNode): SectionSetup | null {
  if (node.type !== 'section') return null
  const world = doc.getWorldMatrix(node.id)
  const t = decomposeMatrix(world)
  const x = rotateVec3(t.r, [1, 0, 0])
  const y = rotateVec3(t.r, [0, 1, 0])
  const z = rotateVec3(t.r, [0, 0, 1])
  const frame: ViewFrame = { origin: t.p, u: x, v: y, dir: [-z[0], -z[1], -z[2]] }
  const extent = (node.meta as { extent?: { length?: number } }).extent
  const uRange: [number, number] | undefined = extent?.length ? [-extent.length / 2 - 0.5, extent.length / 2 + 0.5] : undefined
  return { frame, maxDepth: node.params.depth > 0 ? node.params.depth : Infinity, uRange, cut: true }
}

/** Frame for a cardinal elevation placed just outside the model bounds. */
export function elevationSetup(deps: VectorizeDeps, direction: 'north' | 'south' | 'east' | 'west'): SectionSetup {
  const bounds = modelBounds(deps)
  const pad = 1
  let dir: Vec3
  let origin: Vec3
  const cx = (bounds.min[0] + bounds.max[0]) / 2,
    cy = (bounds.min[1] + bounds.max[1]) / 2
  switch (direction) {
    case 'north': // viewer stands north, looks south
      dir = [0, -1, 0]
      origin = [cx, bounds.max[1] + pad, 0]
      break
    case 'south':
      dir = [0, 1, 0]
      origin = [cx, bounds.min[1] - pad, 0]
      break
    case 'east':
      dir = [-1, 0, 0]
      origin = [bounds.max[0] + pad, cy, 0]
      break
    default:
      dir = [1, 0, 0]
      origin = [bounds.min[0] - pad, cy, 0]
  }
  return { frame: frameFromView(origin, dir), maxDepth: Infinity, cut: false, groundLine: bounds.min[2] <= 0.05 }
}

/** Orthographic frame along a saved view's camera. */
export function viewSetup(camera: CameraState): SectionSetup {
  const dir: Vec3 = [camera.target[0] - camera.position[0], camera.target[1] - camera.position[1], camera.target[2] - camera.position[2]]
  return { frame: frameFromView(camera.position, dir, camera.up), maxDepth: Infinity, cut: false }
}

export function modelBounds(deps: VectorizeDeps): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const r of collectRenderables(deps, null)) {
    const res = resultOf(deps, r)
    if (!res) continue
    const bb = res.bounds
    for (const x of [bb.min[0], bb.max[0]])
      for (const y of [bb.min[1], bb.max[1]])
        for (const z of [bb.min[2], bb.max[2]]) {
          const m = r.world
          const w: Vec3 = [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]]
          for (let i = 0; i < 3; i++) {
            if (w[i] < min[i]) min[i] = w[i]
            if (w[i] > max[i]) max[i] = w[i]
          }
        }
  }
  if (min[0] === Infinity) return { min: [-5, -5, 0], max: [5, 5, 3] }
  return { min, max }
}

interface MeshEntry {
  mesh: WorldMesh
  node: AnyNode
  hatch: ReturnType<typeof partHatch>
}

export function vectorizeSectionFrame(deps: VectorizeDeps, setup: SectionSetup): VectorDrawing {
  const b = new DrawingBuilder()
  const { frame, maxDepth } = setup
  const renderables = collectRenderables(deps, null)
  const grid = new OcclusionGrid(0.5, 0)
  const entries: { meshes: MeshEntry[]; edges: Float64Array | null; node: AnyNode }[] = []
  for (const r of renderables) {
    const res = resultOf(deps, r)
    if (!res || !res.parts.length) continue
    const meshes: MeshEntry[] = []
    for (const part of res.parts) {
      const wm = toWorldMesh(part.mesh, r.world)
      grid.addMesh(wm, frame, maxDepth)
      meshes.push({ mesh: wm, node: r.node, hatch: partHatch(deps.doc, r.node, part) })
    }
    entries.push({ meshes, edges: res.edges ? transformEdges(res.edges, r.world) : null, node: r.node })
  }
  const vis = { minDepth: 0, maxDepth, step: 0.05, uRange: setup.uRange }
  for (const e of entries) {
    for (const m of e.meshes) {
      if (setup.cut) {
        const segs = sliceMesh(m.mesh, frame).filter((s) => inRange(s, setup.uRange))
        emitCut(b, segs, m.hatch)
      }
      if (!e.edges) for (const s of visibleEdges(featureEdges(m.mesh, 30), frame, grid, vis)) b.segment('visible', s.a, s.b)
    }
    if (e.edges) for (const s of visibleEdges(e.edges, frame, grid, vis)) b.segment('visible', s.a, s.b)
  }
  if (setup.groundLine && !b.isEmpty() && Math.abs(frame.v[2]) > 0.99) {
    // v coordinate of world z = 0 for a vertical up axis
    const d = b.build()
    const y = -frame.origin[2] * frame.v[2]
    b.segment('cut', [d.bounds.min[0] - 0.5, y], [d.bounds.max[0] + 0.5, y])
  }
  // grid axis bubbles + section height markers (levelmark nodes)
  addSectionAnnotations(b, deps, frame, setup.uRange, maxDepth)
  return b.build()
}

function inRange(s: Seg2, range?: [number, number]): boolean {
  if (!range) return true
  return Math.max(s.a[0], s.b[0]) >= range[0] && Math.min(s.a[0], s.b[0]) <= range[1]
}

/** Chain cut segments into loops; loops become hatched fills (nested loops = holes), open chains lines. */
function emitCut(b: DrawingBuilder, segs: Seg2[], hatch: MeshEntry['hatch']): void {
  if (!segs.length) return
  const { loops, open } = chainSegments(segs, 1e-4)
  for (const s of segs) b.segment('cut', s.a, s.b)
  const sorted = loops
    .filter((l) => l.length >= 3 && Math.abs(polygonArea(l)) > 1e-8)
    .map((l) => (polygonArea(l) < 0 ? l.slice().reverse() : l))
    .sort((x, y) => Math.abs(polygonArea(y)) - Math.abs(polygonArea(x)))
  const used = new Set<number>()
  for (let i = 0; i < sorted.length; i++) {
    if (used.has(i)) continue
    const outer = sorted[i]
    const holes: Vec2[][] = []
    for (let j = i + 1; j < sorted.length; j++) {
      if (used.has(j)) continue
      const inner = sorted[j]
      if (pointInPolygon(inner[0], outer) && !holes.some((h) => pointInPolygon(inner[0], h))) {
        holes.push(inner)
        used.add(j)
      }
    }
    b.fillPolygon(outer, holes, hatch)
  }
  void open // open chains are already emitted as cut lines above
}
