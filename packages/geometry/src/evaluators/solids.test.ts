import { makeNode } from '@cadsandbox/doc'
import { describe, expect, it } from 'vitest'
import { isClosedManifold, mergeMeshes, mergeVertices } from '../core/mesh'
import { evaluateBoolean } from './boolean'
import { defaultContext } from './context'
import { decodeCSBM, encodeCSBM, evaluateMesh } from './mesh'
import { evaluatePrimitive } from './primitive'
import { evaluateLoft, evaluateRevolve, evaluateSweep } from './sweeps'
import { evaluateText } from './text'

import { transformMesh } from '../core/mesh'
import type { MeshBuffers } from '../api'
const translate = (x: number, y: number, z: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]
const solid = (mesh: MeshBuffers, material: string | null = null, m?: number[]) => ({ mesh: m ? transformMesh(mesh, m) : mesh, material })

describe('boolean (manifold-3d)', () => {
  it('subtract removes the intersecting volume', async () => {
    const a = evaluatePrimitive(makeNode({ type: 'primitive', params: { shape: 'box', width: 1, depth: 1, height: 1 } }))
    const b = evaluatePrimitive(makeNode({ type: 'primitive', params: { shape: 'box', width: 1, depth: 1, height: 1 } }))
    const node = makeNode({ type: 'boolean', params: { op: 'subtract' } })
    const ctx = defaultContext({
      operands: [
        { nodeId: 'a', key: 'a', solids: [solid(a.parts[0]!.mesh, 'mat-oak')] },
        { nodeId: 'b', key: 'b', solids: [solid(b.parts[0]!.mesh, null, translate(0.5, 0, 0))] },
      ],
    })
    const r = await evaluateBoolean(node, ctx)
    expect(r.error).toBeUndefined()
    expect(r.quantities!.volume).toBeCloseTo(0.5, 5)
    expect(r.parts.length).toBeGreaterThan(0)
    // parts are split per operand material; together they form the closed solid
    expect(r.parts.length).toBe(2)
    expect(isClosedManifold(mergeVertices(mergeMeshes(r.parts.map((p) => p.mesh))))).toBe(true)
    // operand material survives the boolean
    expect(r.parts.some((p) => p.material !== 'node' && (p.material as { id: string }).id === 'mat-oak')).toBe(true)
  })

  it('reports non-manifold operands as an error', async () => {
    const plane = evaluatePrimitive(makeNode({ type: 'primitive', params: { shape: 'plane', width: 1, depth: 1 } }))
    const node = makeNode({ type: 'boolean', params: { op: 'union' } })
    const r = await evaluateBoolean(node, defaultContext({ operands: [{ nodeId: 'p', key: 'p', solids: [solid(plane.parts[0]!.mesh)] }] }))
    expect(r.error).toMatch(/not a closed solid|no volume/)
  })

  it('union of two disjoint spheres keeps both', async () => {
    const s = evaluatePrimitive(makeNode({ type: 'primitive', params: { shape: 'sphere', radius: 0.3 } }))
    const node = makeNode({ type: 'boolean', params: { op: 'union' } })
    const r = await evaluateBoolean(
      node,
      defaultContext({
        operands: [
          { nodeId: 'a', key: 'a', solids: [solid(s.parts[0]!.mesh)] },
          { nodeId: 'b', key: 'b', solids: [solid(s.parts[0]!.mesh, null, translate(2, 0, 0))] },
        ],
      }),
    )
    expect(r.error).toBeUndefined()
    expect(r.quantities!.volume).toBeCloseTo(2 * (4 / 3) * Math.PI * 0.027, 1)
  })
})

describe('CSBM', () => {
  it('round-trips a mesh', () => {
    const box = evaluatePrimitive(makeNode({ type: 'primitive', params: { shape: 'box' } })).parts[0]!.mesh
    const bytes = encodeCSBM(box)
    expect(bytes.byteLength % 4).toBe(0)
    const back = decodeCSBM(bytes)
    expect(Array.from(back.positions)).toEqual(Array.from(box.positions))
    expect(Array.from(back.normals)).toEqual(Array.from(box.normals))
    expect(Array.from(back.uvs!)).toEqual(Array.from(box.uvs!))
    expect(Array.from(back.indices!)).toEqual(Array.from(box.indices!))
    // unaligned view still decodes
    const shifted = new Uint8Array(bytes.byteLength + 1)
    shifted.set(bytes, 1)
    const back2 = decodeCSBM(shifted.subarray(1))
    expect(back2.positions.length).toBe(box.positions.length)
  })
  it('mesh evaluator decodes an asset and computes normals + edges', () => {
    const box = evaluatePrimitive(makeNode({ type: 'primitive', params: { shape: 'box' } })).parts[0]!.mesh
    const bytes = encodeCSBM({ positions: box.positions, normals: new Float32Array(0), indices: box.indices })
    const node = makeNode({ type: 'mesh', params: { asset: 'abc' } })
    const r = evaluateMesh(node, defaultContext({ asset: bytes.buffer as ArrayBuffer }))
    expect(r.error).toBeUndefined()
    expect(r.parts[0]!.mesh.normals.length).toBe(r.parts[0]!.mesh.positions.length)
    expect(r.edges!.length / 6).toBe(12)
    const missing = evaluateMesh(node, defaultContext({ asset: null }))
    expect(missing.error).toBeTruthy()
  })
})

describe('revolve / loft / sweep', () => {
  it('default revolve is a closed vase', () => {
    const r = evaluateRevolve(makeNode({ type: 'revolve' }))
    expect(r.error).toBeUndefined()
    expect(r.quantities!.volume).toBeGreaterThan(0)
    expect(r.bounds.max[2]).toBeCloseTo(0.7, 3)
  })
  it('default loft square→circle is a closed manifold', () => {
    const r = evaluateLoft(makeNode({ type: 'loft' }))
    expect(r.error).toBeUndefined()
    expect(isClosedManifold(mergeVertices(r.parts[0]!.mesh))).toBe(true)
    expect(r.bounds.max[2]).toBeCloseTo(1, 6)
  })
  it('default sweep is closed and follows the path', () => {
    const r = evaluateSweep(makeNode({ type: 'sweep' }))
    expect(r.error).toBeUndefined()
    expect(isClosedManifold(mergeVertices(r.parts[0]!.mesh))).toBe(true)
    expect(r.bounds.max[0]).toBeGreaterThan(1.9)
  })
  it('closed sweep path has no caps and stays closed', () => {
    const node = makeNode({ type: 'sweep', params: { path: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], closedPath: true, smooth: true, twist: 0 } })
    const r = evaluateSweep(node)
    expect(r.error).toBeUndefined()
    expect(isClosedManifold(mergeVertices(r.parts[0]!.mesh))).toBe(true)
  })
})

describe('text', () => {
  it('lays out flat and extruded text from the bundled font', async () => {
    const flat = await evaluateText(makeNode({ type: 'text', params: { text: 'Ab 12', size: 0.5, depth: 0 } }))
    expect(flat.error).toBeUndefined()
    expect(flat.drawing!.texts[0]!.text).toBe('Ab 12')
    expect(flat.bounds.max[2]).toBe(0)
    expect(flat.quantities!.width).toBeGreaterThan(1)
    const solid = await evaluateText(makeNode({ type: 'text', params: { text: 'O', size: 0.5, depth: 0.1, bevel: 0.01, font: 'serif' } }))
    expect(solid.error).toBeUndefined()
    expect(isClosedManifold(mergeVertices(solid.parts[0]!.mesh))).toBe(true)
    expect(solid.bounds.max[2]).toBeCloseTo(0.1, 6)
  })
})
