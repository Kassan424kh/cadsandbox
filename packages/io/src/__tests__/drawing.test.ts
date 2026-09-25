import { describe, expect, it } from 'vitest'
import type { AnyNode } from '@cadsandbox/doc'
import { CadDocument } from '@cadsandbox/doc'
import { exportFile } from '../export/index'
import { importFile } from '../import/index'
import { insertImportResult } from '../insert'
import { buildingDoc, exportContext } from './helpers'

const DXF = [
  ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC'],
  ['0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '0', 'LAYER', '2', 'A-WALL', '70', '0', '62', '1', '6', 'DASHED', '370', '50', '0', 'ENDTAB', '0', 'ENDSEC'],
  ['0', 'SECTION', '2', 'BLOCKS', '0', 'BLOCK', '8', '0', '2', 'CHAIR', '70', '0', '10', '100', '20', '100', '30', '0', '3', 'CHAIR'],
  ['0', 'CIRCLE', '8', '0', '10', '100', '20', '100', '30', '0', '40', '250', '0', 'ENDBLK', '0', 'ENDSEC'],
  ['0', 'SECTION', '2', 'ENTITIES'],
  ['0', 'LWPOLYLINE', '8', 'A-WALL', '90', '3', '70', '1', '10', '0', '20', '0', '42', '1', '10', '1000', '20', '0', '10', '1000', '20', '1000'],
  ['0', 'INSERT', '8', '0', '2', 'CHAIR', '10', '2000', '20', '0', '30', '0', '41', '2', '42', '2', '50', '90'],
  ['0', 'HATCH', '8', 'A-WALL', '10', '0', '20', '0', '30', '0', '210', '0', '220', '0', '230', '1', '2', 'ANSI31', '70', '0', '71', '0', '91', '1'],
  ['92', '1', '93', '2', '72', '1', '10', '0', '20', '0', '11', '1000', '21', '0', '72', '2', '10', '500', '20', '0', '40', '500', '50', '0', '51', '180', '73', '1', '97', '0'],
  ['75', '0', '76', '1', '52', '0', '41', '100', '77', '0', '78', '1', '53', '45', '43', '0', '44', '0', '45', '-2.245', '46', '2.245', '79', '0', '98', '0'],
  ['0', 'MTEXT', '8', '0', '10', '0', '20', '2000', '40', '250', '1', '{\\fArial|b1;Raum}\\PWohnen', '71', '1'],
  ['0', 'ENDSEC', '0', 'EOF'],
]
  .flat()
  .join('\n')

describe('DXF import', () => {
  it('maps layers, bulges, blocks, edge-boundary hatches and MTEXT', async () => {
    const res = await importFile({ name: 'plan.dxf', data: DXF })
    const layer = res.layers?.find((l) => l.name === 'A-WALL')
    expect(layer).toMatchObject({ color: '#ff0000', lineWeight: 0.5, lineType: 'dashed' })
    const nodes = res.snapshot.nodes as AnyNode[]
    const pl = nodes.find((n) => n.type === 'polyline') as Extract<AnyNode, { type: 'polyline' }>
    expect(pl.params).toMatchObject({ points: [[0, 0], [1, 0], [1, 1]], bulges: [1, 0, 0], closed: true })
    expect(pl.layer).toBe(layer!.id)
    // block → component + instance
    expect(res.snapshot.components).toHaveLength(1)
    const circle = res.snapshot.componentNodes.find((n) => n.type === 'circle') as Extract<AnyNode, { type: 'circle' }>
    expect(circle.params.radius).toBeCloseTo(0.25, 9)
    expect(circle.t.p).toEqual([0, 0, 0])
    const inst = nodes.find((n) => n.type === 'instance') as Extract<AnyNode, { type: 'instance' }>
    expect(inst.params.component).toBe(res.snapshot.components[0]!.id)
    expect(inst.t.p).toEqual([2, 0, 0])
    expect(inst.t.s).toEqual([2, 2, 1])
    expect(inst.t.r[2]).toBeCloseTo(Math.sin(Math.PI / 4), 9)
    // hatch with a line + arc boundary (half disc); ANSI31 × 100 in a mm drawing = 317.5 mm spacing,
    // i.e. 3.175 × the engine's 0.1 m base unit
    const hatch = nodes.find((n) => n.type === 'hatch') as Extract<AnyNode, { type: 'hatch' }>
    expect(hatch.params.pattern).toBe('ansi31')
    expect(hatch.params.scale).toBeCloseTo(3.175, 9)
    expect(Math.max(...hatch.params.boundary.map((p) => p[1]))).toBeCloseTo(0.5, 2)
    expect(hatch.params.boundary.length).toBeGreaterThan(10)
    const text = nodes.find((n) => n.type === 'text') as Extract<AnyNode, { type: 'text' }>
    expect(text.params.text).toBe('Raum\nWohnen')
    expect(text.params.size).toBeCloseTo(0.25, 9)
  })

  it('accepts a name-less Blob with an explicit format', async () => {
    const res = await importFile(new Blob([DXF]), 'dxf', { units: 'm' })
    expect(res.snapshot.nodes.some((n) => n.type === 'hatch')).toBe(true)
  })

  it('inserts onto a level: layers merged by name, lifted to the elevation', async () => {
    const res = await importFile({ name: 'plan.dxf', data: DXF })
    const doc = CadDocument.create('Target', { withLevel: true })
    const level = doc.levels()[0]!
    doc.updateNodes([{ id: level.id, patch: { t: { p: [0, 0, 3], r: [0, 0, 0, 1], s: [1, 1, 1] } } }])
    doc.addLayer({ name: 'a-wall', color: '#00ff00' })
    const roots = insertImportResult(doc, res, { levelId: level.id })
    expect(roots).toHaveLength(1)
    expect(doc.getNode(roots[0]!)?.parent).toBe(level.id)
    expect(doc.getWorldPosition(roots[0]!)[2]).toBeCloseTo(3, 9)
    const pl = doc.nodesOfType('polyline')[0]!
    expect(doc.getLayer(pl.layer!)?.name).toBe('a-wall') // reused, not duplicated
    expect(doc.listLayers().filter((l) => l.name.toLowerCase() === 'a-wall')).toHaveLength(1)
  })
})

describe('plan / sheet / schedule exports', () => {
  it('SVG: paper millimeters, hatch patterns, exact arcs', async () => {
    const doc = buildingDoc()
    const eg = doc.levels()[0]!.id
    doc.addNodes([{ type: 'polyline', parent: eg, params: { points: [[8, 0], [10, 0]], bulges: [1, 0], closed: false } }])
    const res = await exportFile(exportContext(doc), 'svg', { levelId: eg, scale: 50 })
    const svg = await res.blob.text()
    expect(svg).toMatch(/^<\?xml/)
    expect(svg).toMatch(/<svg [^>]*width="[\d.]+mm"/)
    expect(svg).toContain('<pattern id="hp0_0" patternUnits="userSpaceOnUse"')
    expect(svg).toMatch(/fill="url\(#hp0_0\)"/)
    expect(svg).toMatch(/A1 1 0 0 1 10 0/) // semicircle via bulge 1
    expect(svg).toContain('<g id="Walls"')
  })

  it('PDF: quick plan and a layout sheet with title block', async () => {
    const doc = buildingDoc()
    const eg = doc.levels()[0]!.id
    const plan = await exportFile(exportContext(doc), 'pdf', { levelId: eg })
    expect(plan.fileName).toBe('Test House - EG 1-100.pdf')
    expect(new TextDecoder().decode(new Uint8Array(await plan.blob.arrayBuffer()).subarray(0, 5))).toBe('%PDF-')
    const sheetId = doc.putSheet({
      name: 'Grundriss EG',
      number: 'A-101',
      paper: 'A3',
      orientation: 'landscape',
      titleBlock: { project: 'Villa', client: 'Familie Müller', address: 'Hauptstr. 1, Berlin', drawnBy: 'KK', checkedBy: '', date: '2026-09-25', revision: 'A', company: 'Studio', phase: 'LP 3 Entwurfsplanung' },
      viewports: [
        { id: 'v1', x: 30, y: 20, w: 200, h: 150, source: { kind: 'plan', levelId: eg }, scale: 100, style: 'lines' },
        { id: 'v2', x: 250, y: 20, w: 150, h: 80, source: { kind: 'schedule', schedule: 'rooms' }, scale: 100, style: 'lines' },
      ],
    })
    const sheet = await exportFile(exportContext(doc), 'pdf', { sheetId })
    expect(sheet.fileName).toBe('A-101 Grundriss EG.pdf')
    const bytes = new Uint8Array(await sheet.blob.arrayBuffer())
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-')
    expect(bytes.length).toBeGreaterThan(3000)
  })

  it('CSV: rooms schedule with BOM, German separator and decimal comma', async () => {
    const res = await exportFile(exportContext(buildingDoc()), 'csv', { schedule: 'rooms', csvSeparator: ';' })
    const bytes = new Uint8Array(await res.blob.arrayBuffer())
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]) // UTF-8 BOM for Excel
    const lines = new TextDecoder().decode(bytes).trim().split('\r\n')
    expect(lines[0]).toBe('Number;Name;Level;Usage (DIN 277);Area (m²);Perimeter (m);Height (m);Volume (m³)')
    expect(lines[1]).toBe('0.01;Wohnen;EG;NUF1;21,09;18,80;2,50;52,73')
    const walls = await exportFile(exportContext(buildingDoc()), 'csv', { schedule: 'walls' })
    expect((await walls.blob.text()).trim().split('\r\n')).toHaveLength(5)
  })

  it('.csb round trip', async () => {
    const doc = buildingDoc()
    const res = await exportFile(exportContext(doc), 'csb')
    const back = await importFile({ name: res.fileName, data: res.blob })
    expect(back.document).toEqual(doc.toJSON())
    expect(back.snapshot.nodes).toHaveLength(doc.allNodes().length)
  })
})
