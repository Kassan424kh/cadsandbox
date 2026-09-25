// 2D profile → flat face (depth 0) or beveled extrusion along local Z.
import type { NodeBase, ShapeParams } from '@cadsandbox/doc'
import type { GeometryResult, SnapPoint } from '../api'
import { extrudePolygons } from '../core/extrude'
import { polygonCentroid } from '../core/math2d'
import { meshSurfaceArea, meshVolume } from '../core/mesh'
import { profilePolygons } from '../core/path'
import { polygonsArea } from '../core/polygon'
import { errorResult, finish, snap } from './result'

export function extrusionRange(depth: number, direction: ShapeParams['direction']): [number, number] {
  const d = Math.max(0, depth)
  if (direction === 'down') return [-d, 0]
  if (direction === 'symmetric') return [-d / 2, d / 2]
  return [0, d]
}

export function evaluateShape(node: NodeBase<'shape'>): GeometryResult {
  const p = node.params
  const polys = profilePolygons(p)
  if (!polys.length) return errorResult('Shape profile is empty')
  const [z0, z1] = extrusionRange(p.depth, p.direction)
  const bevel = p.depth > 0 ? Math.min(p.bevel ?? 0, (z1 - z0) / 2 - 1e-6) : 0
  const mesh = extrudePolygons(polys, { z0, z1, bevel: bevel > 0 ? bevel : 0, bevelSegments: p.bevelSegments ?? 3 })
  const snaps: SnapPoint[] = [snap('insertion', 0, 0, z0)]
  const c = polygonCentroid(polys[0]!.outer)
  snaps.push(snap('center', c[0], c[1], z0))
  if (z1 > z0) snaps.push(snap('center', c[0], c[1], z1), snap('midpoint', c[0], c[1], (z0 + z1) / 2))
  const area = polygonsArea(polys)
  const quantities: Record<string, number> = { area }
  if (z1 > z0) {
    quantities.volume = Math.abs(meshVolume(mesh))
    quantities.surface = meshSurfaceArea(mesh)
  }
  return finish([{ mesh, material: 'node', castShadow: true, receiveShadow: true }], { edges: 'auto', snaps, quantities })
}
