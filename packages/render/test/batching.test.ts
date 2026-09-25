// MeshBatcher line batches (feature edges + wireframe lines): every segment the GPU draws must be a
// source segment of a live node — through growth, compaction, re-evaluation churn, visibility and
// instance-count overflow. The GPU side is emulated the way WebGLAttributes uploads (full buffer on
// creation, then the attribute's update ranges).
import { CadDocument } from '@cadsandbox/doc'
import { createGeometryService, type GeometryResult } from '@cadsandbox/geometry'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { MeshBatcher, type BatchHandle } from '../src/scene/batching'
import type { MaterialCache } from '../src/materials/materials'

/** The floor-plan template's shell: joined walls with doors/windows, slab and gable roof. */
function buildHouse(doc: CadDocument): void {
  const W = 10, D = 7, T = 0.3, h = T / 2
  const level = doc.addNode({ type: 'level', name: 'Ground Floor', params: { height: 3, cutHeight: 1.1, number: 0 } })
  const wall = (name: string, a: [number, number], b: [number, number], thickness = T, exterior = true) =>
    doc.addNode({ type: 'wall', name, parent: level, params: { a, b, thickness, height: 2.75, baseOffset: 0, justification: 'center', exterior, structural: exterior } })
  const south = wall('South', [0, 0], [W, 0])
  const east = wall('East', [W, 0], [W, D])
  const north = wall('North', [W, D], [0, D])
  const west = wall('West', [0, D], [0, 0])
  const inner = wall('Partition', [6, 0], [6, D], 0.115, false)
  const door = (host: string, offset: number, width: number) => ({ type: 'opening' as const, parent: host, params: { kind: 'door' as const, style: 'single', offset, width, height: 2.135, sill: 0, hinge: 'left' as const, opensTo: 'left' as const } })
  const win = (host: string, offset: number, width: number, style = 'tilt-turn') => ({ type: 'opening' as const, parent: host, params: { kind: 'window' as const, style, offset, width, height: 1.35, sill: 0.9 } })
  doc.addNodes([door(south, 1.6, 1.01), win(south, 3.9, 1.6), win(south, 8.0, 1.2), win(east, 3.5, 1.2), win(north, 1.2, 1.0), win(north, 6.0, 2.0, 'fixed'), win(west, 3.5, 1.4), door(inner, 5.2, 0.885)])
  const outer: [number, number][] = [[-h, -h], [W + h, -h], [W + h, D + h], [-h, D + h]]
  doc.addNode({ type: 'slab', name: 'Slab', parent: level, params: { kind: 'floor', outline: outer, thickness: 0.2, offset: 0 } })
  doc.addNode({ type: 'roof', name: 'Roof', parent: level, params: { kind: 'gable', outline: outer, pitchDeg: 35, overhang: 0.5, thickness: 0.25, baseOffset: 2.75, ridgeAxis: 'x' } })
}

async function evaluateHouse(): Promise<{ type: string; result: GeometryResult }[]> {
  const doc = new CadDocument()
  buildHouse(doc)
  const service = createGeometryService({ doc, assets: { get: async () => null }, workers: 0 })
  await service.idle()
  const out: { type: string; result: GeometryResult }[] = []
  for (const n of doc.allNodes()) {
    const r = service.get(n.id)
    if (r) out.push({ type: n.type, result: r })
  }
  service.dispose()
  return out
}

const lineMat = new THREE.LineBasicMaterial()
const materials = {
  edges: () => lineMat,
  wire: () => ({ front: lineMat, back: lineMat }),
  edgeShaded: lineMat,
  fallback: {},
  get: () => new THREE.MeshBasicMaterial(),
} as unknown as MaterialCache

/** GPU-side copy of a position attribute, refreshed like WebGLAttributes.update does. */
class GpuMirror {
  private buffers = new WeakMap<THREE.BufferAttribute, { version: number; data: Float32Array }>()
  read(mesh: THREE.BatchedMesh): Float32Array {
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute
    let g = this.buffers.get(pos)
    if (!g) {
      g = { version: pos.version, data: Float32Array.from(pos.array as Float32Array) }
      this.buffers.set(pos, g)
    } else if (g.version < pos.version) {
      if (pos.updateRanges.length === 0) g.data.set(pos.array as Float32Array)
      else {
        for (const r of pos.updateRanges) g.data.set((pos.array as Float32Array).subarray(r.start, r.start + r.count), r.start)
        pos.clearUpdateRanges()
      }
      g.version = pos.version
    }
    return g.data
  }
}

interface Internals {
  _instanceInfo: { visible: boolean; active: boolean; geometryIndex: number }[]
  _geometryInfo: { start: number; count: number; active: boolean }[]
}

class Harness {
  readonly batcher = new MeshBatcher(materials)
  readonly gpu = new GpuMirror()
  readonly live = new Map<BatchHandle, { src: Float32Array; visible: boolean }>()

  add(kind: 'edges' | 'wire', src: Float32Array): BatchHandle {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(src, 3))
    geo.computeBoundingSphere()
    const h = kind === 'edges' ? this.batcher.addEdges(geo) : this.batcher.addWire(geo)
    expect(h).not.toBeNull()
    this.live.set(h!, { src, visible: true })
    return h!
  }

  remove(h: BatchHandle): void {
    this.batcher.remove(h)
    this.live.delete(h)
  }

  setVisible(h: BatchHandle, visible: boolean): void {
    this.batcher.setVisible(h, visible)
    this.live.get(h)!.visible = visible
  }

  /** Every drawn range equals its source segments; every visible live handle is drawn exactly once. */
  verify(): void {
    const meshes = new Set<THREE.BatchedMesh>()
    for (const h of this.live.keys()) meshes.add(h.group.mesh)
    const byInstance = new Map<THREE.BatchedMesh, Map<number, BatchHandle>>()
    for (const [h, info] of this.live) {
      if (!info.visible) continue
      let m = byInstance.get(h.group.mesh)
      if (!m) byInstance.set(h.group.mesh, (m = new Map()))
      m.set(h.instanceId, h)
    }
    for (const mesh of meshes) {
      const data = this.gpu.read(mesh)
      const m = mesh as unknown as Internals
      const expected = byInstance.get(mesh) ?? new Map<number, BatchHandle>()
      let drawn = 0
      for (let i = 0; i < m._instanceInfo.length; i++) {
        const inst = m._instanceInfo[i]!
        if (!inst.active || !inst.visible) continue
        const gi = m._geometryInfo[inst.geometryIndex]!
        const h = expected.get(i)
        expect(h, `instance ${i} drawn without a live visible handle`).toBeDefined()
        expect(h!.geometryId).toBe(inst.geometryIndex)
        const src = this.live.get(h!)!.src
        expect(gi.count % 2).toBe(0)
        expect(gi.count).toBe(src.length / 3)
        expect(data.subarray(gi.start * 3, gi.start * 3 + src.length)).toEqual(src)
        drawn++
      }
      expect(drawn).toBe(expected.size)
    }
  }
}

describe('MeshBatcher line batches', () => {
  it('draws exactly the source segments of the floor-plan house through churn, growth and visibility changes', async () => {
    const nodes = await evaluateHouse()
    const withLines = nodes.filter((n) => n.result.edges || n.result.wire)
    expect(withLines.length).toBeGreaterThanOrEqual(15) // 5 walls, 8 openings, slab, roof
    expect(nodes.filter((n) => n.type === 'slab' || n.type === 'roof').every((n) => n.result.wire && n.result.wire.length >= 6 * 12)).toBe(true)
    const hs = new Harness()
    const handles = new Map<GeometryResult, BatchHandle[]>()
    const addNode = (r: GeometryResult) => {
      const list: BatchHandle[] = []
      if (r.edges && r.edges.length >= 6) list.push(hs.add('edges', r.edges))
      if (r.wire && r.wire.length >= 6) list.push(hs.add('wire', r.wire))
      handles.set(r, list)
    }
    for (const n of withLines) addNode(n.result)
    hs.verify()
    expect(hs.batcher.drawGroups).toBe(2) // one edges batch + one wire batch
    // walls re-evaluate while their openings move: remove + re-add fragments the buffers
    for (let round = 0; round < 4; round++) {
      for (const n of withLines) {
        if (n.type !== 'wall') continue
        for (const h of handles.get(n.result)!) hs.remove(h)
        addNode(n.result)
      }
      hs.verify()
    }
    // a large import forces setGeometrySize (compaction first, then growth)
    const big = new Float32Array(50_000 * 3)
    for (let i = 0; i < big.length; i++) big[i] = Math.sin(i * 0.37)
    const bigEdges = hs.add('edges', big)
    const bigWire = hs.add('wire', big)
    hs.verify()
    for (let round = 0; round < 2; round++) {
      for (const n of withLines) {
        for (const h of handles.get(n.result)!) hs.remove(h)
        addNode(n.result)
      }
      hs.verify()
    }
    // per-viewport visibility flips (hidden layers, isolation, plan levels)
    let k = 0
    for (const h of [...hs.live.keys()]) if (k++ % 3 === 0) hs.setVisible(h, false)
    hs.verify()
    for (const h of [...hs.live.keys()]) hs.setVisible(h, true)
    hs.verify()
    hs.remove(bigEdges)
    hs.remove(bigWire)
    hs.verify()
    // more instances than the initial capacity (matrices/indirect textures grow)
    for (let i = 0; i < 300; i++) hs.add(i % 2 ? 'edges' : 'wire', new Float32Array([i, 0, 0, i, 1, 0, i, 1, 0, i, 1, 1]))
    hs.verify()
    // render modes toggle the line batches as a whole, never their ranges
    const edgesMesh = [...hs.live.keys()].find((h) => h.group.key === 'edges')!.group.mesh
    const wireMesh = [...hs.live.keys()].find((h) => h.group.key === 'wire')!.group.mesh
    hs.batcher.applyMode('wireframe')
    expect(wireMesh.visible).toBe(true)
    hs.batcher.applyMode('shaded')
    expect(edgesMesh.visible).toBe(true)
    expect(wireMesh.visible).toBe(false)
    hs.verify()
  }, 60_000)
})
