import { describe, expect, it } from 'vitest'
import type { AnyNode } from '@cadsandbox/doc'
import type { DxfParser } from 'dxf-parser'
import { exportDxf } from '../export/dxf'
import { HatchHandler } from '../import/dxf-parse'
import { importDxf } from '../import/dxf'
import { buildingDoc, exportContext } from './helpers'

function planDoc() {
  const doc = buildingDoc()
  const eg = doc.levels()[0]!.id
  doc.addNodes([
    { type: 'polyline', name: 'Arc path', parent: eg, layer: 'layer-anno', params: { points: [[8, 0], [10, 0], [10, 2]], bulges: [0.5, 0, 0], closed: false } },
    { type: 'circle', parent: eg, t: { p: [12, 1, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }, params: { radius: 0.5 } },
    { type: 'arc', parent: eg, t: { p: [14, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }, params: { radius: 1, start: 0, end: Math.PI / 2 } },
    { type: 'ellipse', parent: eg, t: { p: [16, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }, params: { rx: 1, ry: 0.5 } },
    { type: 'spline', parent: eg, params: { path: { contours: [{ closed: false, points: [{ p: [0, 6], ho: [1, 7] }, { p: [3, 6], hi: [2, 5] }] }] } } },
    { type: 'text', parent: eg, layer: 'layer-anno', t: { p: [2, 2, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }, params: { text: 'Wohnzimmer Ä', size: 0.25, font: 'sans', align: 'left', depth: 0 } },
    { type: 'hatch', parent: eg, layer: 'layer-hatch', params: { boundary: [[20, 0], [22, 0], [22, 2], [20, 2]], holes: [[[20.5, 0.5], [21, 0.5], [21, 1], [20.5, 1]]], pattern: 'concrete', scale: 1, angle: 0 } },
    { type: 'dimension', parent: eg, layer: 'layer-dims', params: { kind: 'aligned', points: [[0, -1, 0], [6, -1, 0]], offset: -0.5 } },
    { type: 'dimension', parent: eg, layer: 'layer-dims', params: { kind: 'linear', axis: 'y', points: [[7, 0, 0], [7, 4, 0]], offset: 0.8 } },
  ])
  return { doc, eg }
}

describe('DXF export', () => {
  it('re-reads with dxf-parser: units, layers, entity counts and bulges', async () => {
    const { doc, eg } = planDoc()
    const res = await exportDxf(exportContext(doc), { levelId: eg })
    expect(res.fileName).toBe('Test House - EG.dxf')
    const text = await res.blob.text()
    // dxf-parser ships CommonJS: resolve the constructor like the importer does
    const mod = (await import('dxf-parser')) as unknown as { DxfParser?: typeof DxfParser; default?: typeof DxfParser | { DxfParser: typeof DxfParser } }
    const Ctor = (mod.DxfParser ?? (typeof mod.default === 'function' ? mod.default : mod.default?.DxfParser))!
    const parser = new Ctor()
    parser.registerEntityHandler(HatchHandler as never)
    const dxf = parser.parseSync(text)!
    expect(dxf.header['$INSUNITS']).toBe(4)
    const layers = Object.keys(dxf.tables.layer.layers)
    for (const l of ['Walls', 'Annotations', 'Dimensions', 'Hatches']) expect(layers).toContain(l)
    const count = (t: string) => dxf.entities.filter((e) => e.type === t).length
    expect(count('LWPOLYLINE')).toBeGreaterThanOrEqual(5) // 4 wall outlines + bulged path
    expect(count('CIRCLE')).toBe(1)
    expect(count('ARC')).toBe(1)
    expect(count('ELLIPSE')).toBe(1)
    expect(count('SPLINE')).toBe(1)
    expect(count('TEXT')).toBe(1)
    expect(count('HATCH')).toBe(5) // 4 wall poché + 1 hatch node
    expect(count('DIMENSION')).toBe(2)
    const bulged = dxf.entities.find((e) => e.type === 'LWPOLYLINE' && (e as unknown as { vertices: { bulge?: number }[] }).vertices.some((v) => v.bulge))
    const v = (bulged as unknown as { vertices: { x: number; y: number; bulge?: number }[] }).vertices
    expect(v[0]).toMatchObject({ x: 8000, y: 0, bulge: 0.5 })
    // dimension blocks exist and are anonymous
    expect(Object.keys(dxf.blocks).filter((b) => b.startsWith('*D'))).toHaveLength(2)
    // text is UTF-8
    expect(text).toContain('Wohnzimmer Ä')
  })

  it('imports its own export back (units, bulges, hatches with holes, dimensions)', async () => {
    const { doc, eg } = planDoc()
    const res = await exportDxf(exportContext(doc), { levelId: eg })
    const bytes = new Uint8Array(await res.blob.arrayBuffer())
    const imp = await importDxf('plan.dxf', bytes, {})
    const nodes = imp.snapshot.nodes as AnyNode[]
    const of = <T extends AnyNode['type']>(t: T) => nodes.filter((n) => n.type === t) as Extract<AnyNode, { type: T }>[]
    const bulged = of('polyline').find((p) => p.params.bulges?.some((b) => b))
    expect(bulged?.params.points[0]).toEqual([8, 0])
    expect(bulged?.params.bulges?.[0]).toBeCloseTo(0.5, 9)
    expect(of('circle').find((c) => c.params.radius > 0.1)?.params.radius).toBeCloseTo(0.5, 9)
    expect(of('arc')[0]?.params.end).toBeCloseTo(Math.PI / 2, 9)
    expect(of('ellipse')).toHaveLength(1)
    expect(of('spline')).toHaveLength(1)
    const hatches = of('hatch')
    expect(hatches.map((h) => h.params.pattern).sort()).toEqual(['ansi31', 'ansi31', 'ansi31', 'ansi31', 'concrete'])
    expect(hatches.find((h) => h.params.pattern === 'concrete')?.params.holes).toHaveLength(1)
    expect(hatches[0]!.params.scale).toBeCloseTo(1, 9)
    const dims = of('dimension')
    expect(dims.map((d) => d.params.kind).sort()).toEqual(['aligned', 'linear'])
    const aligned = dims.find((d) => d.params.kind === 'aligned')!
    expect(aligned.params.offset).toBeCloseTo(-0.5, 6)
    const linear = dims.find((d) => d.params.kind === 'linear')!
    expect(linear.params.axis).toBe('y')
    expect(linear.params.offset).toBeCloseTo(0.8, 6)
    expect(of('text')[0]?.params.text).toBe('Wohnzimmer Ä')
    expect(imp.layers?.map((l) => l.name)).toContain('Walls')
  })
})
