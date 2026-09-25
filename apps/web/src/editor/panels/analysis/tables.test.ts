import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { CadDocument } from '@cadsandbox/doc'
import { analyzeBuilding, computeThermal, createGeometryService } from '@cadsandbox/geometry'
import { buildProject } from '../../../data/seed'
import { getTemplate } from '../../../app/templates'
import { buildReport, tabTables, tablesToCsv, type AnalysisTab } from './tables'

async function floorplan() {
  const built = buildProject('House', getTemplate('floorplan').seed())
  const ydoc = new Y.Doc()
  Y.applyUpdate(ydoc, built.designs.get(built.mainFile)!)
  const doc = new CadDocument(ydoc)
  const service = createGeometryService({ doc, assets: { get: async () => null }, workers: 0 })
  await service.idle()
  return { doc, service }
}

describe('analysis tables', () => {
  it('analyses the floor-plan template and exports every tab', async () => {
    const { doc, service } = await floorplan()
    const report = analyzeBuilding(doc, service)
    expect(report.din277.total.bgf).toBeGreaterThan(50)
    expect(report.din277.total.nrf).toBeGreaterThan(40)
    expect(report.woflv.total).toBeCloseTo(report.din277.total.nrf, 1) // flat ceilings ≥ 2 m, no stairs
    expect(report.costs.total).toBeGreaterThan(0)
    const thermal = computeThermal(report.model)
    for (const tab of ['areas', 'zoning', 'costs', 'energy', 'checks'] as AnalysisTab[]) {
      const tables = tabTables(tab, report, doc.meta.site ?? {}, thermal)
      expect(tables.length).toBeGreaterThan(0)
      for (const tb of tables) for (const row of tb.rows) expect(row.length).toBe(tb.cols.length)
      const csv = tablesToCsv(tables, ';')
      expect(csv.startsWith('﻿')).toBe(true)
      if (tab === 'areas') expect(csv).toMatch(/;\d+,\d{2}(;|\r\n)/)
    }
    const pdf = buildReport(report, 'House', {}, thermal)
    expect(pdf.sections.map((s) => s.tables.length).every((n) => n > 0)).toBe(true)
    service.dispose()
  })

  it('writes decimal points with the comma delimiter and quotes text', () => {
    const csv = tablesToCsv([{ title: 'T', cols: [{ label: 'a' }, { label: 'b', decimals: 2 }], rows: [['x, "y"', 1.5]] }], ',')
    expect(csv).toBe('﻿T\r\na,b\r\n"x, ""y""",1.50\r\n')
  })
})
