// Terrain heightfield (row-major resolution × resolution samples, centered on the origin).
import type { NodeBase, Vec3 } from '@cadsandbox/doc'
import type { GeometryResult } from '../api'
import { DrawingBuilder } from '../core/drawing'
import { MeshBuilder } from '../core/mesh'
import { gridInto } from '../core/surfaces'
import { latticeWire } from '../core/wire'
import { finish, snap } from './result'

export function evaluateTerrain(node: NodeBase<'terrain'>): GeometryResult {
  const p = node.params
  const w = Math.max(0.1, p.width), d = Math.max(0.1, p.depth)
  const res = p.resolution >= 2 && p.heights.length >= p.resolution * p.resolution ? Math.round(p.resolution) : 2
  const heights = res === 2 && p.heights.length < 4 ? [0, 0, 0, 0] : p.heights
  const hAt = (i: number, j: number): number => heights[Math.min(res - 1, Math.max(0, i)) * res + Math.min(res - 1, Math.max(0, j))] ?? 0
  const dx = w / (res - 1), dy = d / (res - 1)
  const mb = new MeshBuilder(res * res)
  let zMin = Infinity, zMax = -Infinity
  const rows: Vec3[][] = Array.from({ length: res }, () => [])
  gridInto(mb, res, res, (i, j, out) => {
    const x = -w / 2 + j * dx
    const y = -d / 2 + i * dy
    const z = hAt(i, j)
    if (z < zMin) zMin = z
    if (z > zMax) zMax = z
    rows[i]![j] = [x, y, z]
    // central differences for smooth normals
    const sx = (hAt(i, j + 1) - hAt(i, j - 1)) / (dx * (j === 0 || j === res - 1 ? 1 : 2))
    const sy = (hAt(i + 1, j) - hAt(i - 1, j)) / (dy * (i === 0 || i === res - 1 ? 1 : 2))
    const l = Math.hypot(sx, sy, 1)
    out.p = [x, y, z]
    out.n = [-sx / l, -sy / l, 1 / l]
    out.uv = [x, y]
  })
  const mesh = mb.build()
  const dr = new DrawingBuilder()
  dr.rect('thin', -w / 2, -d / 2, w / 2, d / 2)
  return finish([{ mesh, material: 'node', castShadow: true, receiveShadow: true }], {
    edges: 'none',
    wire: latticeWire(rows, false, false), // grid lines, not the triangle diagonals
    plan: dr.build(),
    snaps: [snap('center', 0, 0, hAt(Math.floor(res / 2), Math.floor(res / 2))), snap('endpoint', -w / 2, -d / 2, hAt(0, 0)), snap('endpoint', w / 2, -d / 2, hAt(0, res - 1)), snap('endpoint', w / 2, d / 2, hAt(res - 1, res - 1)), snap('endpoint', -w / 2, d / 2, hAt(res - 1, 0))],
    quantities: { area: w * d, minHeight: zMin, maxHeight: zMax },
  })
}
