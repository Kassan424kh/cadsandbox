// Plan / ceiling-plan vectorization: architecture `plan` symbology + drafting drawings + plane
// cuts of generic solids at the level's cut height. Only the level's own content is drawn (no
// lower-level underlay). Output coordinates = level-local XY (meters).
import type { Mat4, Vec2 } from '@cadsandbox/doc'
import { invertMatrix, multiplyMatrices } from '@cadsandbox/doc'
import type { LineStyle } from '@cadsandbox/geometry'
import { formatLength } from '@cadsandbox/shared'
import { DrawingBuilder, collectRenderables, matrixYaw, resultOf, worldZRange, xyMapper, type Renderable, type VectorDrawing, type VectorizeDeps } from './common'
import { fallbackDrawing } from './drafting'
import { featureEdges, sliceMesh, toWorldMesh, transformEdges, type ViewFrame } from './mesh'

export function vectorizePlan(deps: VectorizeDeps, levelId: string, ceiling = false): VectorDrawing {
  const { doc } = deps
  const level = doc.getNode<'level'>(levelId)
  const b = new DrawingBuilder()
  if (!level || level.type !== 'level') return b.build()
  const levelWorld = doc.getWorldMatrix(levelId)
  const levelInv = invertMatrix(levelWorld)
  const z0 = levelWorld[14]
  const cutZ = z0 + (ceiling ? Math.max(level.params.cutHeight, level.params.height - 0.3) : level.params.cutHeight)
  const top = z0 + level.params.height
  const units = doc.meta.units
  const fmt = (m: number) => formatLength(m, units.length, units.precision)
  // Looking down at the cut plane: depth grows downward.
  const frame: ViewFrame = { origin: [0, 0, cutZ], u: [1, 0, 0], v: [0, 1, 0], dir: [0, 0, -1] }
  const worldToLevel = xyMapper(levelInv)

  const renderables = collectRenderables(deps, levelId)
  // Root-level solids that cross this storey (not parented to any level).
  for (const r of collectRenderables(deps, null)) {
    if (doc.getLevelOf(r.node.id) !== null || (r.via && doc.getLevelOf(r.via.id) !== null)) continue
    const zr = worldZRange(r, resultOf(deps, r))
    if (zr && zr[0] <= top && zr[1] >= z0) renderables.push(r)
  }

  for (const r of renderables) {
    const node = r.node
    const res = resultOf(deps, r)
    const nodeToLevel: Mat4 = multiplyMatrices(levelInv, r.world)
    const map = xyMapper(nodeToLevel)
    const yaw = matrixYaw(nodeToLevel)
    if (res?.plan) {
      // Openings are placed by their host wall: their symbology is expressed in the wall's frame.
      if (node.type === 'opening' && node.parent && !r.via) {
        const wallMap = xyMapper(multiplyMatrices(levelInv, doc.getWorldMatrix(node.parent)))
        b.addDrawing(res.plan, wallMap, matrixYaw(multiplyMatrices(levelInv, doc.getWorldMatrix(node.parent))))
      } else b.addDrawing(res.plan, map, yaw)
      continue
    }
    if (res?.drawing) {
      b.addDrawing(res.drawing, map, yaw)
      continue
    }
    if (res && res.parts.length) {
      cutSolid(b, r, res.parts.map((p) => p.mesh), res.edges, frame, worldToLevel, cutZ, ceiling)
      continue
    }
    const fb = fallbackDrawing(node, fmt)
    if (fb) b.addDrawing(fb, map, yaw)
  }
  return b.build()
}

function cutSolid(
  b: DrawingBuilder,
  r: Renderable,
  meshes: Parameters<typeof toWorldMesh>[0][],
  edges: Float32Array | undefined,
  frame: ViewFrame,
  toLevel: (p: Vec2) => Vec2,
  cutZ: number,
  ceiling: boolean,
): void {
  const worldMeshes = meshes.map((m) => toWorldMesh(m, r.world))
  let crosses = false
  let allAbove = true
  for (const wm of worldMeshes) {
    let lo = Infinity,
      hi = -Infinity
    for (let i = 2; i < wm.positions.length; i += 3) {
      const z = wm.positions[i]
      if (z < lo) lo = z
      if (z > hi) hi = z
    }
    if (lo <= cutZ && hi >= cutZ) crosses = true
    if (lo < cutZ) allAbove = false
  }
  for (const wm of worldMeshes) {
    if (crosses) for (const s of sliceMesh(wm, frame)) b.segment('cut', toLevel(s.a), toLevel(s.b))
    const e = edges ? transformEdges(edges, r.world) : featureEdges(wm, 30)
    if (edges) {
      // edges were given per node (not per part): emit once
      emitEdges(b, e, toLevel, cutZ, ceiling, allAbove)
      break
    }
    emitEdges(b, e, toLevel, cutZ, ceiling, allAbove)
  }
}

function emitEdges(b: DrawingBuilder, e: Float64Array, toLevel: (p: Vec2) => Vec2, cutZ: number, ceiling: boolean, allAbove: boolean): void {
  for (let i = 0; i + 5 < e.length; i += 6) {
    const a = [e[i], e[i + 1], e[i + 2]],
      c = [e[i + 3], e[i + 4], e[i + 5]]
    const belowA = a[2] <= cutZ + 1e-9,
      belowC = c[2] <= cutZ + 1e-9
    let style: LineStyle | null = null
    let pa: Vec2 = [a[0], a[1]],
      pc: Vec2 = [c[0], c[1]]
    if (belowA && belowC) style = ceiling ? null : 'visible'
    else if (!belowA && !belowC) style = ceiling ? 'visible' : allAbove ? 'overhead' : null
    else {
      // crossing edge: keep the part on the drawn side of the cut
      const t = (cutZ - a[2]) / (c[2] - a[2])
      const m: Vec2 = [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t]
      if (ceiling) {
        if (belowA) pa = m
        else pc = m
      } else {
        if (belowA) pc = m
        else pa = m
      }
      style = 'visible'
    }
    if (style) b.segment(style, toLevel(pa), toLevel(pc))
  }
}
