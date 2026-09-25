// Dev-only stand-in GeometryService: tessellates a handful of node types with three.js geometries so
// the viewport engine can be exercised before the real engine lands. Not part of the package build.
import * as THREE from 'three'
import type { AnyNode, CadDocument, NodeBase, Vec2 } from '@cadsandbox/doc'
import type { Bounds3, Drawing2D, GeometryResult, GeometryService, MeshBuffers, SnapPoint } from '@cadsandbox/geometry'

function buffers(geo: THREE.BufferGeometry): MeshBuffers {
  const g = geo.index ? geo : geo
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  const nor = g.getAttribute('normal') as THREE.BufferAttribute | undefined
  const uv = g.getAttribute('uv') as THREE.BufferAttribute | undefined
  return {
    positions: new Float32Array(pos.array as ArrayLike<number>),
    normals: nor ? new Float32Array(nor.array as ArrayLike<number>) : new Float32Array(pos.count * 3),
    uvs: uv ? new Float32Array(uv.array as ArrayLike<number>) : undefined,
    indices: g.index ? new Uint32Array(g.index.array as ArrayLike<number>) : undefined,
  }
}

function edgesOf(geo: THREE.BufferGeometry, angle = 30): Float32Array {
  const e = new THREE.EdgesGeometry(geo, angle)
  return new Float32Array(e.getAttribute('position').array as ArrayLike<number>)
}

function boundsOf(geo: THREE.BufferGeometry): Bounds3 {
  geo.computeBoundingBox()
  const b = geo.boundingBox!
  return { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] }
}

function snapsFromEdges(edges: Float32Array): SnapPoint[] {
  const out: SnapPoint[] = []
  const seen = new Set<string>()
  for (let i = 0; i + 5 < edges.length; i += 6) {
    for (const [x, y, z] of [[edges[i]!, edges[i + 1]!, edges[i + 2]!], [edges[i + 3]!, edges[i + 4]!, edges[i + 5]!]] as const) {
      const k = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`
      if (seen.has(k)) continue
      seen.add(k)
      out.push({ p: [x, y, z], kind: 'endpoint' })
    }
    out.push({ p: [(edges[i]! + edges[i + 3]!) / 2, (edges[i + 1]! + edges[i + 4]!) / 2, (edges[i + 2]! + edges[i + 5]!) / 2], kind: 'midpoint' })
  }
  return out.slice(0, 400)
}

function solid(geo: THREE.BufferGeometry, extra: Partial<GeometryResult> = {}): GeometryResult {
  const edges = edgesOf(geo)
  return { parts: [{ mesh: buffers(geo), material: 'node' }], edges, bounds: boundsOf(geo), snaps: snapsFromEdges(edges), ...extra }
}

function primitive(n: NodeBase<'primitive'>): GeometryResult {
  const p = n.params
  const w = p.width ?? 1
  const d = p.depth ?? 1
  const h = p.height ?? 1
  const r = p.radius ?? 0.5
  let geo: THREE.BufferGeometry
  switch (p.shape) {
    case 'sphere':
    case 'icosphere':
      geo = new THREE.SphereGeometry(r, 48, 32).translate(0, 0, r)
      break
    case 'cylinder':
      geo = new THREE.CylinderGeometry(r, r, h, 48).rotateX(Math.PI / 2).translate(0, 0, h / 2)
      break
    case 'cone':
      geo = new THREE.CylinderGeometry(p.radius2 ?? 0, r, h, 48).rotateX(Math.PI / 2).translate(0, 0, h / 2)
      break
    case 'torus':
      geo = new THREE.TorusGeometry(r, p.radius2 ?? 0.15, 24, 64).translate(0, 0, p.radius2 ?? 0.15)
      break
    case 'plane':
      geo = new THREE.PlaneGeometry(w, d)
      break
    default:
      geo = new THREE.BoxGeometry(w, d, h).translate(0, 0, h / 2)
  }
  // world-scale UVs: box uvs are 0..1 per face → scale by face size approx
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute | undefined
  if (uv) {
    const s = Math.max(w, d, h, r * 2)
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * s, uv.getY(i) * s)
  }
  return solid(geo)
}

function wall(n: NodeBase<'wall'>): GeometryResult {
  const { a, b, thickness, height, baseOffset } = n.params
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = Math.hypot(dx, dy) || 1e-6
  const ang = Math.atan2(dy, dx)
  const geo = new THREE.BoxGeometry(len, thickness, height).translate(len / 2, 0, height / 2 + baseOffset).rotateZ(ang).translate(a[0], a[1], 0)
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len, uv.getY(i) * height)
  const nx = -Math.sin(ang) * thickness / 2
  const ny = Math.cos(ang) * thickness / 2
  const l1: Vec2 = [a[0] + nx, a[1] + ny]
  const l2: Vec2 = [b[0] + nx, b[1] + ny]
  const r1: Vec2 = [a[0] - nx, a[1] - ny]
  const r2: Vec2 = [b[0] - nx, b[1] - ny]
  const plan: Drawing2D = {
    lines: [{ style: 'cut', segments: new Float32Array([...l1, ...l2, ...r1, ...r2, ...l1, ...r1, ...l2, ...r2]) }],
    fills: [{ triangles: new Float32Array([...l1, ...l2, ...r2, ...l1, ...r2, ...r1]), polygons: [{ outer: [l1, l2, r2, r1], holes: [] }], pattern: 'ansi31', scale: 1, angle: 0 }],
    texts: [],
  }
  return solid(geo, { plan, quantities: { length: len, height } })
}

function slab(n: NodeBase<'slab'>): GeometryResult | null {
  const { outline, thickness, offset } = n.params
  if (outline.length < 3) return null
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)))
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false }).translate(0, 0, offset - thickness)
  return solid(geo)
}

function column(n: NodeBase<'column'>): GeometryResult {
  const { shape, width, depth, height, baseOffset } = n.params
  const geo = shape === 'round' ? new THREE.CylinderGeometry(width / 2, width / 2, height, 32).rotateX(Math.PI / 2).translate(0, 0, height / 2 + baseOffset) : new THREE.BoxGeometry(width, depth, height).translate(0, 0, height / 2 + baseOffset)
  return solid(geo)
}

function furniture(n: NodeBase<'furniture'>): GeometryResult {
  const { width, depth, height } = n.params
  const geo = new THREE.BoxGeometry(width, depth, height).translate(0, -depth / 2, height / 2)
  const plan: Drawing2D = {
    lines: [{ style: 'thin', segments: new Float32Array([-width / 2, 0, width / 2, 0, width / 2, 0, width / 2, -depth, width / 2, -depth, -width / 2, -depth, -width / 2, -depth, -width / 2, 0]) }],
    fills: [],
    texts: [{ text: n.params.kind, position: [0, -depth / 2], size: 0.08, rotation: 0, align: 'center', baseline: 'middle', style: 'label' }],
  }
  return solid(geo, { plan })
}

function line2d(n: AnyNode): GeometryResult | null {
  let segments: number[] = []
  const texts: Drawing2D['texts'] = []
  switch (n.type) {
    case 'line':
      segments = [...n.params.a, ...n.params.b]
      break
    case 'rect': {
      const w = n.params.width / 2
      const h = n.params.height / 2
      segments = [-w, -h, w, -h, w, -h, w, h, w, h, -w, h, -w, h, -w, -h]
      break
    }
    case 'circle': {
      const r = n.params.radius
      for (let i = 0; i < 48; i++) {
        const a0 = (i / 48) * Math.PI * 2
        const a1 = ((i + 1) / 48) * Math.PI * 2
        segments.push(Math.cos(a0) * r, Math.sin(a0) * r, Math.cos(a1) * r, Math.sin(a1) * r)
      }
      break
    }
    case 'text':
      texts.push({ text: n.params.text, position: [0, 0], size: n.params.size, rotation: 0, align: n.params.align, baseline: 'bottom', style: 'label' })
      break
    default:
      return null
  }
  const xs = segments.filter((_, i) => i % 2 === 0)
  const ys = segments.filter((_, i) => i % 2 === 1)
  const bounds: Bounds3 = { min: [Math.min(0, ...xs), Math.min(0, ...ys), 0], max: [Math.max(0, ...xs), Math.max(0, ...ys), 0] }
  const snaps: SnapPoint[] = []
  for (let i = 0; i + 3 < segments.length; i += 4) snaps.push({ p: [segments[i]!, segments[i + 1]!, 0], kind: 'endpoint' }, { p: [(segments[i]! + segments[i + 2]!) / 2, (segments[i + 1]! + segments[i + 3]!) / 2, 0], kind: 'midpoint' })
  return { parts: [], drawing: { lines: segments.length ? [{ style: 'drafting', segments: new Float32Array(segments) }] : [], fills: [], texts }, bounds, snaps }
}

export function evaluateNode(n: AnyNode): GeometryResult | null {
  switch (n.type) {
    case 'primitive':
      return primitive(n)
    case 'wall':
      return wall(n)
    case 'slab':
      return slab(n)
    case 'column':
      return column(n)
    case 'furniture':
      return furniture(n)
    case 'line':
    case 'rect':
    case 'circle':
    case 'text':
      return line2d(n)
    default:
      return null
  }
}

export function createFakeGeometryService(doc: CadDocument): GeometryService {
  const cache = new Map<string, GeometryResult>()
  const listeners = new Set<(changed: ReadonlySet<string>) => void>()
  const stats = { pending: 0, evaluated: 0, cacheSize: 0, lastEvalMs: 0 }
  let dirty = new Set<string>()
  let scheduled = 0
  const flush = () => {
    scheduled = 0
    const t0 = performance.now()
    const changed = new Set<string>()
    for (const id of dirty) {
      const n = doc.getNode(id) as AnyNode | undefined
      if (!n) {
        if (cache.delete(id)) changed.add(id)
        continue
      }
      const r = evaluateNode(n)
      if (r) cache.set(id, r)
      else cache.delete(id)
      changed.add(id)
      stats.evaluated++
    }
    dirty = new Set()
    stats.pending = 0
    stats.cacheSize = cache.size
    stats.lastEvalMs = performance.now() - t0
    if (changed.size) for (const l of listeners) l(changed)
  }
  const schedule = () => {
    stats.pending = dirty.size
    if (!scheduled) scheduled = requestAnimationFrame(flush)
  }
  for (const id of doc.nodeIds()) dirty.add(id)
  schedule()
  const unsub = doc.onChange((e) => {
    for (const id of e.nodes.added) dirty.add(id)
    for (const id of e.nodes.removed) dirty.add(id)
    for (const [id, keys] of e.nodes.updated) if (keys.has('params')) dirty.add(id)
    if (dirty.size) schedule()
  })
  return {
    get: (id) => cache.get(id),
    onUpdate(l) {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    isConsumed: (id) => {
      const p = doc.getParent(id)
      return !!p && doc.getNode(p)?.type === 'boolean'
    },
    invalidate: (ids) => {
      for (const id of ids) dirty.add(id)
      schedule()
    },
    idle: () => new Promise((r) => (scheduled ? requestAnimationFrame(() => r()) : r())),
    preview: async (node) => evaluateNode(node) ?? { parts: [], bounds: { min: [0, 0, 0], max: [0, 0, 0] } },
    previewSync: (node) => evaluateNode(node),
    worldBounds: (ids) => {
      const box = new THREE.Box3()
      for (const id of ids) {
        const r = cache.get(id)
        if (!r) continue
        const m = doc.getWorldMatrix(id)
        const local = new THREE.Box3(new THREE.Vector3(...r.bounds.min), new THREE.Vector3(...r.bounds.max))
        local.applyMatrix4(new THREE.Matrix4().fromArray(Array.from(m)))
        box.union(local)
      }
      return box.isEmpty() ? null : { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] }
    },
    stats,
    getComponentGeometry: (componentId) => {
      const def = doc.getComponent(componentId)
      if (!def) return []
      return [def.root, ...doc.getDescendants(def.root)].flatMap((id) => {
        const result = cache.get(id)
        return result ? [{ nodeId: id, result, matrix: doc.getWorldMatrix(id) }] : []
      })
    },
    keyOf: (id) => (cache.has(id) ? `${id}:${JSON.stringify(doc.getNode(id)?.params ?? null)}` : undefined),
    dispose: () => {
      unsub()
      listeners.clear()
      cache.clear()
    },
  }
}
