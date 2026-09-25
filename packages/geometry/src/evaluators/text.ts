// Text: flat glyph faces (depth 0, plus Text2D for crisp SDF rendering) or beveled extrusions.
import type { NodeBase } from '@cadsandbox/doc'
import type { GeometryResult, SnapPoint } from '../api'
import { DrawingBuilder } from '../core/drawing'
import { extrudePolygons } from '../core/extrude'
import { MeshBuilder, meshVolume } from '../core/mesh'
import { polygonsArea } from '../core/polygon'
import { layoutText, loadFont } from '../text/font'
import { errorResult, finish, snap } from './result'

export async function evaluateText(node: NodeBase<'text'>): Promise<GeometryResult> {
  const p = node.params
  const size = Math.max(1e-4, p.size)
  const font = await loadFont(p.font)
  const layout = layoutText(font, p.text ?? '', size, p.align)
  const x0 = p.align === 'left' ? 0 : p.align === 'center' ? -layout.width / 2 : -layout.width
  const snaps: SnapPoint[] = [snap('insertion', 0, 0, 0), snap('endpoint', x0, 0, 0), snap('endpoint', x0 + layout.width, 0, 0), snap('midpoint', x0 + layout.width / 2, 0, 0)]
  if (!layout.polys.length) {
    if (!p.text) return errorResult('Text is empty')
    return finish([], { snaps })
  }
  const depth = Math.max(0, p.depth)
  const quantities: Record<string, number> = { width: layout.width, height: layout.height, area: polygonsArea(layout.polys) }
  if (depth <= 1e-9) {
    const mb = new MeshBuilder(1024)
    for (const poly of layout.polys) mb.face(poly.outer.map((q) => [q[0], q[1], 0]), poly.holes.map((h) => h.map((q) => [q[0], q[1], 0])), [0, 0, 1])
    const d = new DrawingBuilder()
    d.text(p.text, [0, 0], size, { align: p.align, baseline: 'bottom', style: p.annotative ? 'annotation' : 'label' })
    return finish([{ mesh: mb.build(), material: 'node', castShadow: false, receiveShadow: false }], { drawing: d.build(), snaps, quantities, edges: 'none' })
  }
  const bevel = Math.min(p.bevel ?? 0, depth / 2 - 1e-6, size * 0.15)
  const mesh = extrudePolygons(layout.polys, { z0: 0, z1: depth, bevel: bevel > 0 ? bevel : 0, bevelSegments: 3 })
  quantities.volume = Math.abs(meshVolume(mesh))
  return finish([{ mesh, material: 'node', castShadow: true, receiveShadow: true }], { edges: 'auto', snaps, quantities })
}
