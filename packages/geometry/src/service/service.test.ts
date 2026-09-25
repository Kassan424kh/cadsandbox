import { CadDocument, DEFS_ROOT } from '@cadsandbox/doc'
import { describe, expect, it } from 'vitest'
import type { AssetResolver } from '../api'
import { createGeometryService } from './service'

const assets: AssetResolver = { get: async () => null }

function setup() {
  const doc = CadDocument.create('t', { withLevel: true })
  const level = doc.levels()[0]!.id
  const service = createGeometryService({ doc, assets, workers: 0 })
  return { doc, level, service }
}

describe('geometry service', () => {
  it('evaluates all nodes and re-evaluates joined neighbours when a wall moves', async () => {
    const { doc, level, service } = setup()
    const w1 = doc.addNode({ type: 'wall', parent: level, params: { a: [0, 0], b: [4, 0], thickness: 0.2, height: 2.75 } })
    const w2 = doc.addNode({ type: 'wall', parent: level, params: { a: [4, 0], b: [4, 3], thickness: 0.2, height: 2.75 } })
    const far = doc.addNode({ type: 'wall', parent: level, params: { a: [20, 0], b: [24, 0], thickness: 0.2, height: 2.75 } })
    await service.idle()
    expect(service.get(w1)).toBeTruthy()
    expect(service.get(w2)).toBeTruthy()
    const k1 = service.keyOf(w1), k2 = service.keyOf(w2), kFar = service.keyOf(far)
    const changed = new Set<string>()
    service.onUpdate((ids) => ids.forEach((id) => changed.add(id)))
    // move w2's far end: w1 keeps its geometry key? no — w1's join context includes w2's params → re-evaluated
    doc.setParams(w2, { b: [4, 5] })
    await service.idle()
    expect(service.keyOf(w2)).not.toBe(k2)
    expect(service.keyOf(w1)).not.toBe(k1)
    expect(service.keyOf(far)).toBe(kFar)
    expect(changed.has(w1)).toBe(true)
    expect(changed.has(w2)).toBe(true)
    expect(changed.has(far)).toBe(false)
    // moving the whole wall via its transform also refreshes the partner
    const k1b = service.keyOf(w1)
    doc.setTransform(w2, { p: [0, 0.5, 0], r: [0, 0, 0, 1], s: [1, 1, 1] })
    await service.idle()
    expect(service.keyOf(w1)).not.toBe(k1b)
    service.dispose()
  })

  it('booleans consume their operands and release them on error', async () => {
    const { doc, level, service } = setup()
    const b = doc.addNode({ type: 'boolean', parent: level, params: { op: 'subtract' } })
    const a = doc.addNode({ type: 'primitive', parent: b, params: { shape: 'box' } })
    const c = doc.addNode({ type: 'primitive', parent: b, params: { shape: 'sphere', radius: 0.4 }, t: { p: [0.5, 0, 0.5], r: [0, 0, 0, 1], s: [1, 1, 1] } })
    await service.idle()
    const r = service.get(b)!
    expect(r.error).toBeUndefined()
    expect(r.quantities!.volume).toBeLessThan(1)
    expect(service.isConsumed(a)).toBe(true)
    expect(service.isConsumed(c)).toBe(true)
    // editing an operand re-evaluates the boolean
    const key = service.keyOf(b)
    doc.setParams(c, { radius: 0.3 })
    await service.idle()
    expect(service.keyOf(b)).not.toBe(key)
    // a non-manifold operand → error, operands visible again
    doc.setParams(c, { shape: 'plane' })
    await service.idle()
    expect(service.get(b)!.error).toBeTruthy()
    expect(service.isConsumed(a)).toBe(false)
    service.dispose()
  })

  it('shares cached results for identical recipes and reports stats', async () => {
    const { doc, level, service } = setup()
    const a = doc.addNode({ type: 'primitive', parent: level, params: { shape: 'torus' } })
    const b = doc.addNode({ type: 'primitive', parent: level, params: { shape: 'torus' }, t: { p: [3, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] } })
    await service.idle()
    expect(service.keyOf(a)).toBe(service.keyOf(b))
    expect(service.get(a)).toBe(service.get(b))
    expect(service.stats.pending).toBe(0)
    expect(service.stats.cacheSize).toBeGreaterThan(0)
    const wb = service.worldBounds([a, b])!
    expect(wb.max[0]).toBeCloseTo(3 + 0.65, 3)
    service.dispose()
  })

  it('instances expose definition geometry and follow definition edits', async () => {
    const { doc, level, service } = setup()
    const box = doc.addNode({ type: 'primitive', parent: level, params: { shape: 'box', width: 2, depth: 1, height: 1 } })
    const made = doc.createComponent([box], 'Comp')!
    await service.idle()
    const inst = service.get(made.instanceId)!
    expect(inst.parts.length).toBe(0)
    expect(inst.bounds.max[0] - inst.bounds.min[0]).toBeCloseTo(2, 6)
    const geo = service.getComponentGeometry(made.componentId)
    expect(geo.length).toBe(1)
    expect(geo[0]!.result.parts.length).toBe(1)
    expect(doc.getNode(geo[0]!.nodeId)!.parent === made.componentId || doc.isDefinitionNode(geo[0]!.nodeId)).toBe(true)
    const key = service.keyOf(made.instanceId)
    doc.setParams(box, { width: 3 })
    await service.idle()
    expect(service.keyOf(made.instanceId)).not.toBe(key)
    expect(service.get(made.instanceId)!.bounds.max[0] - service.get(made.instanceId)!.bounds.min[0]).toBeCloseTo(3, 6)
    expect(doc.getParent(doc.getComponent(made.componentId)!.root)).toBe(DEFS_ROOT)
    service.dispose()
  })

  it('removes results of deleted nodes and supports previews', async () => {
    const { doc, level, service } = setup()
    const a = doc.addNode({ type: 'primitive', parent: level, params: { shape: 'box' } })
    await service.idle()
    const removed = new Set<string>()
    service.onUpdate((ids) => ids.forEach((id) => removed.add(id)))
    doc.deleteNodes([a])
    await service.idle()
    expect(service.get(a)).toBeUndefined()
    expect(removed.has(a)).toBe(true)
    const preview = service.previewSync({ ...doc.getNode(level)!, id: 'tmp', type: 'primitive', params: { shape: 'cylinder', radius: 0.5, height: 1 } } as never)
    expect(preview!.parts.length).toBe(1)
    const text = await service.preview({ ...doc.getNode(level)!, id: 'tmp2', type: 'text', params: { text: 'Hi', size: 0.3, font: 'sans', align: 'left', depth: 0 } } as never)
    expect(text.error).toBeUndefined()
    expect(service.previewSync({ ...doc.getNode(level)!, id: 'tmp3', type: 'boolean', params: { op: 'union' } } as never)).toBeNull()
    service.dispose()
  })

  it('openings re-evaluate their wall and units changes refresh dimensions', async () => {
    const { doc, level, service } = setup()
    const w = doc.addNode({ type: 'wall', parent: level, params: { a: [0, 0], b: [4, 0], thickness: 0.2, height: 2.75 } })
    const door = doc.addNode({ type: 'opening', parent: w, params: { kind: 'door', style: 'single', offset: 1, width: 0.885, height: 2.01 } })
    const dim = doc.addNode({ type: 'dimension', parent: level, params: { kind: 'aligned', points: [[0, 0, 0], [4, 0, 0]], offset: 1 } })
    await service.idle()
    expect(service.get(w)!.quantities!.openings).toBe(1)
    const kw = service.keyOf(w)
    doc.setParams(door, { width: 1.0 })
    await service.idle()
    expect(service.keyOf(w)).not.toBe(kw)
    expect(service.get(dim)!.drawing!.texts[0]!.text).toBe('4000 mm')
    doc.setMeta({ units: { length: 'm', precision: 2, angle: 'deg', area: 'm2' } })
    await service.idle()
    expect(service.get(dim)!.drawing!.texts[0]!.text).toBe('4 m')
    service.dispose()
  })
})
