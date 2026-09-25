// Parameter-based fallback drawings (node-local XY) for nodes whose geometry result is not
// available: drafting entities, dimensions, leaders, text and plan footprints of architecture.
import type { AnyNode, Vec2 } from '@cadsandbox/doc'
import { polygonArea } from '@cadsandbox/doc'
import type { Drawing2D, LineStyle } from '@cadsandbox/geometry'
import { flattenPolyline, sampleArc, sampleCircle, sampleEllipse } from '../util/arcs'
import { DEFAULT_DIM_STYLE, dimensionDrawing } from '../util/dimension'
import { rotatedRect, triangulate } from '../util/polygon'
import { sampleContour } from '../util/scene'
import { v2 } from '../util/vec'
import { wallOutline } from '../util/walls'

function lines(style: LineStyle, polylines: Vec2[][], closed: boolean): Drawing2D['lines'][number] {
  const segs: number[] = []
  for (const pts of polylines) {
    const n = pts.length
    for (let i = 0; i < (closed ? n : n - 1); i++) segs.push(pts[i][0], pts[i][1], pts[(i + 1) % n][0], pts[(i + 1) % n][1])
  }
  return { style, segments: new Float32Array(segs) }
}

function drawing(parts: Partial<Drawing2D>): Drawing2D {
  return { lines: parts.lines ?? [], fills: parts.fills ?? [], texts: parts.texts ?? [] }
}

/** Node-local drawing for plan views (fallback when no geometry result exists). */
export function fallbackDrawing(node: AnyNode, format: (m: number) => string): Drawing2D | null {
  switch (node.type) {
    case 'line':
      return drawing({ lines: [lines('drafting', [[node.params.a, node.params.b]], false)] })
    case 'polyline':
      return drawing({ lines: [lines('drafting', [flattenPolyline(node.params.points, node.params.bulges, node.params.closed)], node.params.closed)] })
    case 'rect':
      return drawing({ lines: [lines('drafting', [rotatedRect([0, 0], node.params.width, node.params.height, 0)], true)] })
    case 'circle':
      return drawing({ lines: [lines('drafting', [sampleCircle([0, 0], node.params.radius)], true)] })
    case 'arc':
      return drawing({ lines: [lines('drafting', [sampleArc({ center: [0, 0], radius: node.params.radius, start: node.params.start, end: node.params.end })], false)] })
    case 'ellipse':
      return drawing({ lines: [lines('drafting', [sampleEllipse([0, 0], node.params.rx, node.params.ry)], true)] })
    case 'spline':
      return drawing({ lines: node.params.path.contours.map((c) => lines('drafting', [sampleContour(c)], c.closed)) })
    case 'hatch': {
      const outer = node.params.boundary
      if (outer.length < 3) return null
      return drawing({
        lines: [lines('thin', [outer, ...(node.params.holes ?? [])], true)],
        fills: [{ triangles: new Float32Array(triangulate(outer)), polygons: [{ outer, holes: node.params.holes ?? [] }], pattern: node.params.pattern, scale: node.params.scale, angle: node.params.angle, ...(node.params.color ? { color: node.params.color } : {}) }],
      })
    }
    case 'dimension':
      return dimensionDrawing(node.params, { ...DEFAULT_DIM_STYLE, format })
    case 'leader': {
      const pts = node.params.points
      if (pts.length < 2) return null
      const a = pts[0],
        b = pts[1]
      const u = v2.norm(v2.sub(b, a))
      const n = v2.perp(u)
      const s = 0.15
      const base = v2.add(a, v2.scale(u, s))
      const last = pts[pts.length - 1]
      const prev = pts[pts.length - 2]
      const align = last[0] >= prev[0] ? 'left' : 'right'
      return drawing({
        lines: [lines('annotation', [pts, [v2.add(base, v2.scale(n, s * 0.3)), a, v2.sub(base, v2.scale(n, s * 0.3))]], false)],
        texts: [{ text: node.params.text, position: v2.add(last, [align === 'left' ? 0.1 : -0.1, 0]), size: 0.2, rotation: 0, align, baseline: 'middle', style: 'annotation' }],
      })
    }
    case 'text':
      return drawing({ texts: [{ text: node.params.text, position: [0, 0], size: node.params.size, rotation: 0, align: node.params.align, baseline: 'bottom', style: 'label' }] })
    // ---- architecture footprints (plan symbology fallback)
    case 'wall':
      return drawing({ lines: [lines('cut', [wallOutline(node.params)], true)] })
    case 'slab':
      return drawing({ lines: [lines('visible', [node.params.outline, ...(node.params.holes ?? [])], true)] })
    case 'roof':
      return drawing({ lines: [lines('overhead', [node.params.outline], true)] })
    case 'column': {
      const p = node.params
      const outline = p.shape === 'round' ? sampleCircle([0, 0], p.width / 2) : rotatedRect([0, 0], p.width, p.depth, 0)
      return drawing({ lines: [lines('cut', [outline], true)], fills: [{ triangles: new Float32Array(triangulate(outline)), polygons: [{ outer: outline, holes: [] }], pattern: 'solid' }] })
    }
    case 'beam':
      return drawing({ lines: [lines('overhead', [[[node.params.a[0], node.params.a[1]], [node.params.b[0], node.params.b[1]]]], false)] })
    case 'railing':
      return drawing({ lines: [lines('thin', [node.params.path], false)] })
    case 'room': {
      const o = node.params.outline
      if (o.length < 3) return null
      const area = Math.abs(polygonArea(o))
      const c = o.reduce((s, p) => v2.add(s, p), [0, 0] as Vec2)
      const center = v2.scale(c, 1 / o.length)
      return drawing({
        lines: [lines('thin', [o], true)],
        texts: node.params.showLabel
          ? [
              { text: `${node.params.number} ${node.name}`.trim(), position: [center[0], center[1] + 0.15], size: 0.2, rotation: 0, align: 'center', baseline: 'bottom', style: 'label' },
              { text: `${area.toFixed(2)} m²`, position: [center[0], center[1] - 0.15], size: 0.18, rotation: 0, align: 'center', baseline: 'top', style: 'label' },
            ]
          : [],
      })
    }
    case 'stair': {
      const p = node.params
      const risers = p.riserCount || Math.round(p.rise / 0.175)
      const run = (risers - 1) * p.treadDepth
      const hw = p.width / 2
      const outline: Vec2[] = [[-hw, 0], [hw, 0], [hw, run], [-hw, run]]
      const treads: Vec2[][] = []
      for (let i = 1; i < risers; i++) treads.push([[-hw, i * p.treadDepth], [hw, i * p.treadDepth]])
      return drawing({ lines: [lines('thin', [outline], true), lines('symbol', [...treads, [[0, 0], [0, run]]], false)] })
    }
    case 'furniture': {
      const p = node.params
      return drawing({ lines: [lines('thin', [[[-p.width / 2, -p.depth], [p.width / 2, -p.depth], [p.width / 2, 0], [-p.width / 2, 0]]], true)] })
    }
    case 'primitive': {
      const p = node.params
      const outline = p.shape === 'box' || p.shape === 'wedge' || p.shape === 'pyramid' || p.shape === 'plane' ? rotatedRect([0, 0], p.width ?? 1, p.depth ?? 1, 0) : sampleCircle([0, 0], p.radius ?? 0.5)
      return drawing({ lines: [lines('cut', [outline], true)] })
    }
    case 'shape': {
      const p = node.params
      if (p.profile === 'path' && p.path) return drawing({ lines: p.path.contours.map((c) => lines('cut', [sampleContour(c)], c.closed)) })
      const outline = p.profile === 'circle' || p.profile === 'ellipse' ? sampleEllipse([0, 0], p.width / 2, p.height / 2) : rotatedRect([0, 0], p.width, p.height, 0)
      return drawing({ lines: [lines('cut', [outline], true)] })
    }
    default:
      return null
  }
}
