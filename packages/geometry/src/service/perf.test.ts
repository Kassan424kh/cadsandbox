import { CadDocument, type AnyNode } from '@cadsandbox/doc'
import { describe, expect, it } from 'vitest'
import type { AssetResolver } from '../api'
import { evaluateNodeSync } from '../evaluators/index'
import { buildContext, buildWallIndex } from './context'
import { createGeometryService } from './service'

const assets: AssetResolver = { get: async () => null }

/** Grid of rooms: 16 × 11 grid lines split into ~300 wall segments of 4 m with doors. */
function bigLevel() {
  const doc = CadDocument.create('perf', { withLevel: true })
  const level = doc.levels()[0]!.id
  const ids: string[] = []
  doc.transact(() => {
    for (let i = 0; i <= 10; i++) for (let j = 0; j < 15; j++) ids.push(doc.addNode({ type: 'wall', parent: level, params: { a: [j * 4, i * 4], b: [(j + 1) * 4, i * 4], thickness: 0.24, height: 2.75 } }))
    for (let j = 0; j <= 15; j++) for (let i = 0; i < 10; i++) ids.push(doc.addNode({ type: 'wall', parent: level, params: { a: [j * 4, i * 4], b: [j * 4, (i + 1) * 4], thickness: 0.24, height: 2.75 } }))
    for (let k = 0; k < ids.length; k += 3) doc.addNode({ type: 'opening', parent: ids[k]!, params: { kind: 'door', style: 'single', offset: 2, width: 0.885, height: 2.01 } })
  })
  return { doc, level, ids }
}

describe('performance', () => {
  it('re-evaluates a level with ~300 joined walls quickly', async () => {
    const { doc, ids } = bigLevel()
    expect(ids.length).toBe(325)
    // pure evaluation cost (context building + evaluator), single thread
    const t0 = performance.now()
    let n = 0
    const index = buildWallIndex(doc)
    for (const id of ids) {
      const node = doc.getNode(id) as AnyNode
      const { ctx } = buildContext(doc, node, () => undefined, () => undefined, index)
      const r = evaluateNodeSync(node, ctx)!
      expect(r.error).toBeUndefined()
      n++
    }
    const ms = performance.now() - t0
    // eslint-disable-next-line no-console
    console.log(`[perf] ${n} walls evaluated in ${ms.toFixed(1)} ms (${(ms / n).toFixed(2)} ms/wall)`)
    expect(ms).toBeLessThan(1500)
    // through the service (scheduling + cache + notifications), main thread
    const service = createGeometryService({ doc, assets, workers: 0 })
    const t1 = performance.now()
    await service.idle()
    const total = performance.now() - t1
    // eslint-disable-next-line no-console
    console.log(`[perf] service evaluated ${service.stats.evaluated} nodes in ${total.toFixed(1)} ms`)
    expect(service.get(ids[0]!)).toBeTruthy()
    service.dispose()
  }, 30000)
})
