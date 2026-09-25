// Test fixtures: a small building document and a minimal GeometryService producing box meshes,
// so exporters can run in Node without the (concurrently developed) geometry engine.
import { CadDocument } from '@cadsandbox/doc'
import type { AnyNode, NodeBase } from '@cadsandbox/doc'
import { createGeometryService } from '@cadsandbox/geometry'
import type { AssetResolver, Bounds3, GeometryResult, GeometryService, MeshBuffers } from '@cadsandbox/geometry'
import type { ExportContext } from '../api'

/** Axis-aligned box mesh (24 vertices, flat normals) from min to max. */
export function boxMesh(min: [number, number, number], max: [number, number, number]): MeshBuffers {
  const [x0, y0, z0] = min,
    [x1, y1, z1] = max
  const faces: [number[], number[][]][] = [
    [[0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]],
    [[0, 0, -1], [[x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x0, y0, z0]]],
    [[1, 0, 0], [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]]],
    [[-1, 0, 0], [[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]]],
    [[0, 1, 0], [[x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]]],
    [[0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]],
  ]
  const positions: number[] = [],
    normals: number[] = [],
    indices: number[] = []
  faces.forEach(([n, quad], f) => {
    for (const v of quad) {
      positions.push(...v)
      normals.push(...n)
    }
    const b = f * 4
    indices.push(b, b + 1, b + 2, b, b + 2, b + 3)
  })
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint32Array(indices) }
}

function result(mesh: MeshBuffers | null, extra: Partial<GeometryResult> = {}): GeometryResult {
  const p = mesh?.positions ?? new Float32Array()
  const min: [number, number, number] = [Infinity, Infinity, Infinity],
    max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < p.length; i += 3)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k]!, p[i + k]!)
      max[k] = Math.max(max[k]!, p[i + k]!)
    }
  const bounds: Bounds3 = p.length ? { min, max } : { min: [0, 0, 0], max: [0, 0, 0] }
  return { parts: mesh ? [{ mesh, material: 'node' }] : [], bounds, ...extra }
}

/** Box geometry for walls (straight, center justification), primitives (box) and openings. */
export function evaluate(doc: CadDocument, node: AnyNode): GeometryResult | undefined {
  switch (node.type) {
    case 'primitive': {
      const p = node.params
      const w = (p.width ?? 1) / 2,
        d = (p.depth ?? 1) / 2
      return result(boxMesh([-w, -d, 0], [w, d, p.height ?? 1]))
    }
    case 'wall': {
      const p = node.params
      // wall-local frame: box along a→b
      const dx = p.b[0] - p.a[0],
        dy = p.b[1] - p.a[1]
      const L = Math.hypot(dx, dy)
      const box = boxMesh([0, -p.thickness / 2, p.baseOffset], [L, p.thickness / 2, p.baseOffset + p.height])
      const c = dx / L,
        s = dy / L
      const pos = box.positions
      for (let i = 0; i < pos.length; i += 3) {
        const x = pos[i]!,
          y = pos[i + 1]!
        pos[i] = p.a[0] + x * c - y * s
        pos[i + 1] = p.a[1] + x * s + y * c
      }
      const n = box.normals
      for (let i = 0; i < n.length; i += 3) {
        const x = n[i]!,
          y = n[i + 1]!
        n[i] = x * c - y * s
        n[i + 1] = x * s + y * c
      }
      const h = p.thickness / 2
      const rect: [number, number][] = [
        [p.a[0] + s * h, p.a[1] - c * h],
        [p.b[0] + s * h, p.b[1] - c * h],
        [p.b[0] - s * h, p.b[1] + c * h],
        [p.a[0] - s * h, p.a[1] + c * h],
      ]
      const seg: number[] = []
      for (let i = 0; i < 4; i++) seg.push(...rect[i]!, ...rect[(i + 1) % 4]!)
      const plan = {
        lines: [{ style: 'cut' as const, segments: new Float32Array(seg) }],
        fills: [{ triangles: new Float32Array(), polygons: [{ outer: rect, holes: [] }], pattern: 'ansi31' as const, scale: 1, angle: 0 }],
        texts: [],
      }
      return result(box, { quantities: { length: L }, plan })
    }
    case 'opening': {
      const wall = doc.getNode(node.parent) as NodeBase<'wall'> | undefined
      if (!wall) return undefined
      const p = node.params,
        w = wall.params
      const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1])
      const c = (w.b[0] - w.a[0]) / L,
        s = (w.b[1] - w.a[1]) / L
      const box = boxMesh([p.offset - p.width / 2, -0.03, w.baseOffset + p.sill], [p.offset + p.width / 2, 0.03, w.baseOffset + p.sill + p.height])
      const pos = box.positions
      for (let i = 0; i < pos.length; i += 3) {
        const x = pos[i]!,
          y = pos[i + 1]!
        pos[i] = w.a[0] + x * c - y * s
        pos[i + 1] = w.a[1] + x * s + y * c
      }
      return result(box)
    }
    case 'room': {
      const pts = node.params.outline
      let a = 0,
        per = 0
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        a += pts[j]![0] * pts[i]![1] - pts[i]![0] * pts[j]![1]
        per += Math.hypot(pts[i]![0] - pts[j]![0], pts[i]![1] - pts[j]![1])
      }
      const area = Math.abs(a / 2)
      const height = node.params.ceilingHeight ?? 2.5
      return result(null, { quantities: { area, perimeter: per, height, volume: area * height } })
    }
    default:
      return result(null)
  }
}

export function mockGeometry(doc: CadDocument): GeometryService {
  const cache = new Map<string, GeometryResult | undefined>()
  const get = (id: string) => {
    if (!cache.has(id)) {
      const n = doc.getNode(id) as AnyNode | undefined
      cache.set(id, n ? evaluate(doc, n) : undefined)
    }
    return cache.get(id)
  }
  return {
    get,
    onUpdate: () => () => {},
    isConsumed: () => false,
    getComponentGeometry: () => [],
    keyOf: () => undefined,
    invalidate: (ids) => {
      for (const id of ids) cache.delete(id)
    },
    idle: async () => {},
    preview: async (n) => evaluate(doc, n) ?? result(null),
    previewSync: (n) => evaluate(doc, n) ?? null,
    worldBounds: () => null,
    stats: { pending: 0, evaluated: 0, cacheSize: 0, lastEvalMs: 0 },
    dispose: () => {},
  }
}

export class MemoryAssets implements AssetResolver {
  readonly map = new Map<string, Uint8Array>()
  async get(hash: string): Promise<ArrayBuffer | null> {
    const b = this.map.get(hash)
    return b ? (b.slice().buffer as ArrayBuffer) : null
  }
}

/** Two storeys; ground floor: 4 exterior walls (one with a door and a window), a room, a slab, a box. */
export function buildingDoc(): CadDocument {
  const doc = CadDocument.create('Test House')
  const [g, o] = doc.addNodes([
    { type: 'level', name: 'EG', params: { height: 3, cutHeight: 1.1, number: 0 } },
    { type: 'level', name: 'OG', t: { p: [0, 0, 3], r: [0, 0, 0, 1], s: [1, 1, 1] }, params: { height: 3, cutHeight: 1.1, number: 1 } },
  ])
  const walls = doc.addNodes([
    { type: 'wall', name: 'Wall S', parent: g, layer: 'layer-walls', params: { a: [0, 0], b: [6, 0], thickness: 0.3, height: 2.75, baseOffset: 0, justification: 'center', exterior: true, structural: true } },
    { type: 'wall', name: 'Wall E', parent: g, layer: 'layer-walls', params: { a: [6, 0], b: [6, 4], thickness: 0.3, height: 2.75, baseOffset: 0, justification: 'center', exterior: true } },
    { type: 'wall', name: 'Wall N', parent: g, layer: 'layer-walls', params: { a: [6, 4], b: [0, 4], thickness: 0.3, height: 2.75, baseOffset: 0, justification: 'center', exterior: true } },
    { type: 'wall', name: 'Wall W', parent: g, layer: 'layer-walls', params: { a: [0, 4], b: [0, 0], thickness: 0.3, height: 2.75, baseOffset: 0, justification: 'center', exterior: true } },
  ])
  doc.addNodes([
    { type: 'opening', name: 'Front door', parent: walls[0], layer: 'layer-openings', params: { kind: 'door', style: 'single', offset: 1.5, width: 1, height: 2.1, sill: 0 } },
    { type: 'opening', name: 'Window', parent: walls[0], layer: 'layer-openings', params: { kind: 'window', style: 'casement', offset: 4.2, width: 1.2, height: 1.3, sill: 0.9 } },
    {
      type: 'room',
      name: 'Wohnen',
      parent: g,
      params: {
        outline: [
          [0.15, 0.15],
          [5.85, 0.15],
          [5.85, 3.85],
          [0.15, 3.85],
        ],
        number: '0.01',
        usage: 'NUF1',
        ceilingHeight: 2.5,
        showLabel: true,
      },
    },
    {
      type: 'slab',
      name: 'Floor slab',
      parent: g,
      params: {
        kind: 'floor',
        outline: [
          [0, 0],
          [6, 0],
          [6, 4],
          [0, 4],
        ],
        holes: [
          [
            [1, 1],
            [2, 1],
            [2, 2],
            [1, 2],
          ],
        ],
        thickness: 0.2,
        offset: 0,
      },
    },
    { type: 'primitive', name: 'Box', parent: o, t: { p: [2, 2, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }, params: { shape: 'box', width: 1, depth: 1, height: 1 } },
  ])
  return doc
}

export function exportContext(doc: CadDocument): ExportContext {
  return { doc, geometry: mockGeometry(doc), assets: new MemoryAssets() }
}

/** Context backed by the real geometry engine (main-thread evaluation). */
export function realContext(doc: CadDocument): ExportContext {
  const assets = new MemoryAssets()
  return { doc, geometry: createGeometryService({ doc, assets, workers: 0 }), assets }
}
