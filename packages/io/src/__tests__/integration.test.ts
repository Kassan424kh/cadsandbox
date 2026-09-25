// End-to-end with the real geometry engine (evaluated on the main thread).
import { afterEach, describe, expect, it } from 'vitest'
import type { AnyNode } from '@cadsandbox/doc'
import type { ExportContext } from '../api'
import { exportFile } from '../export/index'
import { importFile } from '../import/index'
import { loadWebIfc } from '../wasm'
import { HatchHandler } from '../import/dxf-parse'
import { buildingDoc, realContext } from './helpers'

let ctx: ExportContext | null = null
afterEach(() => {
  ctx?.geometry.dispose()
  ctx = null
})

describe('with the real geometry engine', () => {
  it('IFC: exports and re-imports the building', async () => {
    ctx = realContext(buildingDoc())
    const res = await exportFile(ctx, 'ifc')
    const bytes = new Uint8Array(await res.blob.arrayBuffer())
    const { api, mod: W } = await loadWebIfc()
    const id = api.OpenModel(bytes)
    try {
      const count = (t: number) => api.GetLineIDsWithType(id, t).size()
      expect([count(W.IFCWALL), count(W.IFCSPACE), count(W.IFCBUILDINGSTOREY), count(W.IFCDOOR), count(W.IFCWINDOW)]).toEqual([4, 1, 2, 1, 1])
    } finally {
      api.CloseModel(id)
    }
    const back = await importFile({ name: 'house.ifc', data: bytes })
    expect(back.snapshot.nodes.filter((n) => n.type === 'wall')).toHaveLength(4)
    expect(back.snapshot.nodes.filter((n) => n.type === 'opening')).toHaveLength(2)
  }, 60_000)

  it('DXF: engine plan symbology (poché hatches, door swings) survives a parse', async () => {
    const doc = buildingDoc()
    ctx = realContext(doc)
    const res = await exportFile(ctx, 'dxf', { levelId: doc.levels()[0]!.id })
    const mod = (await import('dxf-parser')) as unknown as Record<string, unknown> & { default?: unknown }
    const Ctor = (mod.DxfParser ?? (typeof mod.default === 'function' ? mod.default : (mod.default as Record<string, unknown>).DxfParser)) as new () => {
      registerEntityHandler(h: unknown): void
      parseSync(s: string): { entities: { type: string }[] } | null
    }
    const parser = new Ctor()
    parser.registerEntityHandler(HatchHandler)
    const dxf = parser.parseSync(await res.blob.text())!
    expect(dxf.entities.filter((e) => e.type === 'HATCH').length).toBeGreaterThanOrEqual(1)
    expect(dxf.entities.length).toBeGreaterThan(8)
  }, 60_000)

  it('CSV + STL use engine quantities and meshes', async () => {
    ctx = realContext(buildingDoc())
    const csv = await exportFile(ctx, 'csv', { schedule: 'rooms', csvSeparator: ';' })
    expect(new TextDecoder().decode(new Uint8Array(await csv.blob.arrayBuffer())).trim().split('\r\n')[1]).toBe('0.01;Wohnen;EG;NUF1;21,09;18,80;2,50;52,73')
    const stl = await exportFile(ctx, 'stl')
    const back = await importFile({ name: 'x.stl', data: stl.blob })
    const b = back.snapshot.bounds!
    expect(b.max[2]).toBeCloseTo(4, 3) // box on the upper storey
    expect((back.snapshot.nodes as AnyNode[]).some((n) => n.type === 'mesh')).toBe(true)
  }, 60_000)
})
