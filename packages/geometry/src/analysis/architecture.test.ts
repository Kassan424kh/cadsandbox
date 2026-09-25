import { CadDocument, type Mat4, type Vec2 } from '@cadsandbox/doc'
import { describe, expect, it } from 'vitest'
import type { AssetResolver } from '../api'
import { createGeometryService } from '../service/service'
import { CoverIndex, collectBuilding, roomKindOf, roomTags } from './building'
import { runChecks } from './checks'
import { DEFAULT_COST_ITEMS, estimateCosts } from './din276'
import { computeDin277 } from './din277'
import { analyzeBuilding } from './report'
import { airLayerResistance, computeThermal, uValue } from './thermal'
import { computeWoflv } from './woflv'
import { computeZoning, limitStatus } from './zoning'

const assets: AssetResolver = { get: async () => null }
const I: Mat4 = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
const at = (x: number, y: number, z = 0) => ({ p: [x, y, z] as [number, number, number], r: [0, 0, 0, 1] as [number, number, number, number], s: [1, 1, 1] as [number, number, number] })
const RECT: Vec2[] = [[-5, -4], [5, -4], [5, 4], [-5, 4]]
const OUTER: Vec2[] = [[-5.15, -4.15], [5.15, -4.15], [5.15, 4.15], [-5.15, 4.15]]

function walls(doc: CadDocument, level: string, height: number, pts: Vec2[] = RECT, thickness = 0.3): string[] {
  return pts.map((a, i) => doc.addNode({ type: 'wall', parent: level, params: { a, b: pts[(i + 1) % pts.length]!, thickness, height } }))
}

/** 10 × 8 m house (centerline, 0.3 m walls): ground floor + attic with 1 m knee walls under a 45° gable roof. */
async function house(opts: { attic?: boolean } = {}) {
  const doc = CadDocument.create('house', { withLevel: true })
  const eg = doc.levels()[0]!.id
  const H = doc.getNode<'level'>(eg)!.params.height
  const egWalls = walls(doc, eg, H)
  const living = doc.addNode({ type: 'room', parent: eg, name: 'Wohnen', params: { outline: [], number: '0.01', usage: 'NUF1', showLabel: true, auto: true }, t: at(0, 0) })
  let dg = '', bedroom = '', roof = ''
  if (opts.attic) {
    dg = doc.addNode({ type: 'level', name: 'DG', params: { height: 3, cutHeight: 1.1, number: 1 }, t: at(0, 0, H) })
    walls(doc, dg, 1)
    bedroom = doc.addNode({ type: 'room', parent: dg, name: 'Schlafen', params: { outline: [], number: '1.01', usage: 'NUF1', showLabel: true, auto: true }, t: at(0, 0) })
    roof = doc.addNode({ type: 'roof', parent: dg, params: { kind: 'gable', outline: OUTER, pitchDeg: 45, overhang: 0, thickness: 0.25, baseOffset: 1, ridgeAxis: 'x' } })
  }
  const service = createGeometryService({ doc, assets, workers: 0 })
  await service.idle()
  return { doc, service, eg, dg, H, egWalls, living, bedroom, roof }
}

describe('thermal (DIN EN ISO 6946)', () => {
  it('computes a layered wall U-value', () => {
    const r = uValue([
      { thickness: 0.015, lambda: 0.7 },
      { thickness: 0.175, lambda: 0.99 },
      { thickness: 0.14, lambda: 0.035 },
      { thickness: 0.01, lambda: 0.7 },
    ])
    expect(r.rt).toBeCloseTo(0.13 + 0.04 + 0.015 / 0.7 + 0.175 / 0.99 + 4 + 0.01 / 0.7, 6)
    expect(r.u).toBeCloseTo(0.2282, 3)
    expect(uValue([{ thickness: 0.2, lambda: 2.3 }], 'up').rsi).toBe(0.1)
    expect(uValue([{ thickness: 0.2, lambda: 2.3 }], 'down', 0).rt).toBeCloseTo(0.17 + 0.2 / 2.3, 6)
  })
  it('uses ISO 6946 air-layer resistances', () => {
    expect(airLayerResistance(0.025)).toBeCloseTo(0.18, 6)
    expect(airLayerResistance(0.012)).toBeCloseTo(0.158, 6)
    expect(airLayerResistance(0.5, 'down')).toBeCloseTo(0.23, 6)
    expect(uValue([{ thickness: 0.04, lambda: 1, function: 'air' }]).rt).toBeCloseTo(0.17 + 0.18, 6)
  })
})

describe('cover index', () => {
  it('answers vertical rays against world triangles', () => {
    const c = new CoverIndex()
    c.add({ id: 's', type: 'slab', kind: 'floor', levelId: null }, [0, 0, 3, 4, 0, 3, 0, 4, 5], undefined, I)
    expect(c.lowestAbove(1, 1, 0)).toBeCloseTo(3.5, 6)
    expect(c.lowestAbove(1, 1, 4)).toBe(Infinity)
    expect(c.highestAt(5, 5)).toBe(-Infinity)
  })
})

describe('building analysis', () => {
  it('derives DIN 277 areas and volumes of a one-storey house', async () => {
    const { doc, service, H } = await house()
    const model = collectBuilding(doc, service)
    const din = computeDin277(model)
    expect(din.total.bgf).toBeCloseTo(10.3 * 8.3, 2)
    expect(din.total.nrf).toBeCloseTo(9.7 * 7.7, 2)
    expect(din.total.kgf).toBeCloseTo(10.3 * 8.3 - 9.7 * 7.7, 2)
    expect(din.total.bri).toBeCloseTo(10.3 * 8.3 * H, 1)
    expect(model.walls.every((w) => w.side === 'exterior')).toBe(true)
    service.dispose()
  })

  it('follows the roof for attic volume, WoFlV heights and full storeys', async () => {
    const { doc, service, H, bedroom, living } = await house({ attic: true })
    const model = collectBuilding(doc, service)
    const din = computeDin277(model)
    // ground floor block + attic column (knee wall 1 m + 45° slope over 4.15 m on each side)
    const attic = 2 * (4.15 + 4.15 ** 2 / 2) * 10.3
    expect(din.total.bri).toBeGreaterThan((10.3 * 8.3 * H + attic) * 0.98)
    expect(din.total.bri).toBeLessThan((10.3 * 8.3 * H + attic) * 1.02)
    const wf = computeWoflv(model)
    const eg = wf.rows.find((r) => r.id === living)!
    expect(eg.livingArea).toBeCloseTo(9.7 * 7.7, 1)
    const dg = wf.rows.find((r) => r.id === bedroom)!
    // clear height = 0.75 m + distance from the eave line: 1–2 m for 0.95 m on each side, ≥ 2 m beyond
    // grid sampling (0.1 m) places each band edge within ±0.05 m
    expect(Math.abs(dg.half - 2 * 0.95 * 9.7)).toBeLessThan(2 * 0.06 * 9.7)
    expect(dg.livingArea).toBeGreaterThan(65.475 * 0.985)
    expect(dg.livingArea).toBeLessThan(65.475 * 1.015)
    expect(dg.sampled).toBe(true)
    expect(wf.total).toBeCloseTo(eg.livingArea + dg.livingArea, 6)
    // the attic is not a full storey (≥ 2.30 m over only ~63 % of the storey below)
    doc.setMeta({ site: { plotArea: 400, zoning: { grz: 0.4, gfz: 0.5, maxStoreys: 1, maxHeight: 9 } } })
    const z = computeZoning(collectBuilding(doc, service), din)
    expect(z.storeys.map((s) => s.full)).toEqual([true, false])
    expect(z.storeys[1]!.reason).toBe('low')
    expect(z.rows.find((r) => r.key === 'grz')!.value).toBeCloseTo((10.3 * 8.3) / 400, 3)
    expect(z.rows.find((r) => r.key === 'storeys')!.status).toBe('pass')
    expect(z.height).toBeCloseTo(H + 1 + 4.15, 2)
    expect(z.rows.filter((r) => r.limit != null).every((r) => r.status === 'pass')).toBe(true)
    expect(z.rows.find((r) => r.key === 'bmz')!.status).toBe('info')
    service.dispose()
  })

  it('excludes stairs with more than three risers from the living area', async () => {
    const { doc, service, eg, living } = await house()
    doc.addNode({ type: 'stair', parent: eg, params: { width: 1 }, t: at(3, -3.5) })
    await service.idle()
    const wf = computeWoflv(collectBuilding(doc, service))
    const row = wf.rows.find((r) => r.id === living)!
    expect(row.excluded).toBeGreaterThan(3)
    expect(row.livingArea).toBeCloseTo(9.7 * 7.7 - row.excluded, 1)
    service.dispose()
  })

  it('estimates DIN 276 costs with catalog overrides and ratios', async () => {
    const { doc, service, egWalls } = await house()
    doc.addNode({ type: 'opening', parent: egWalls[0]!, params: { kind: 'window', style: 'casement', offset: 3, width: 1.25, height: 1.25, sill: 0.9 } })
    await service.idle()
    const model = collectBuilding(doc, service)
    const din = computeDin277(model)
    const base = estimateCosts(model, din, null)
    const win = base.lines.find((l) => l.id === 'windows')!
    expect(win.quantity).toBeCloseTo(1.5625, 6)
    expect(win.total).toBeCloseTo(1.5625 * DEFAULT_COST_ITEMS.find((d) => d.id === 'windows')!.price, 6)
    expect(base.kg400).toBeCloseTo(base.kg300 * 0.28, 6)
    expect(base.total).toBeCloseTo(base.kg300 + base.kg400, 6)
    expect(base.perBgf).toBeCloseTo(base.total / din.total.bgf, 6)
    expect(base.net).toBeCloseTo(base.gross / 1.19, 6)
    const custom = estimateCosts(model, din, null, { items: { windows: { price: 1000 } }, regionFactor: 1.2, servicesRatio: 0.2, vatIncluded: false })
    const w2 = custom.lines.find((l) => l.id === 'windows')!
    expect(w2.unitPrice).toBeCloseTo(1200, 6)
    expect(w2.overridden).toBe(true)
    expect(custom.kg400).toBeCloseTo(custom.kg300 * 0.2, 6)
    expect(custom.gross).toBeCloseTo(custom.total * 1.19, 6)
    service.dispose()
  })

  it('computes envelope U-values and HT′ against the GEG reference building', async () => {
    const { doc, service, egWalls } = await house()
    let t = computeThermal(collectBuilding(doc, service))
    expect(t.buildUps.length).toBe(1)
    expect(t.buildUps[0]!.u).toBeCloseTo(1 / (0.17 + 0.3 / 0.7), 3) // single-layer plaster wall
    expect(t.buildUps[0]!.status).toBe('warn')
    for (const id of egWalls)
      doc.setParams<'wall'>(id, {
        layers: [
          { material: 'mat-plaster', thickness: 0.015, function: 'finish' },
          { material: 'mat-masonry-ks', thickness: 0.175, function: 'structure' },
          { material: 'mat-insulation', thickness: 0.14, function: 'insulation' },
          { material: 'mat-plaster', thickness: 0.01, function: 'finish' },
        ],
      })
    await service.idle()
    t = computeThermal(collectBuilding(doc, service))
    expect(t.buildUps[0]!.u).toBeCloseTo(0.2282, 3)
    expect(t.buildUps[0]!.status).toBe('pass')
    const ground = t.elements.find((e) => e.kind === 'ground')!
    expect(ground.source).toBe('reference')
    expect(ground.fx).toBe(0.6)
    expect(t.ratio).toBeLessThan(1)
    expect(t.status).toBe('pass')
    expect(computeThermal(collectBuilding(doc, service), { deltaUwb: 0.1 }).ratio).toBeGreaterThan(t.ratio)
    service.dispose()
  })
})

describe('compliance checks', () => {
  it('flags doors, daylight, stairs and escape routes with rule citations', async () => {
    const { doc, service, eg, egWalls, living } = await house()
    const narrow = doc.addNode({ type: 'opening', parent: egWalls[0]!, params: { kind: 'door', style: 'single', offset: 2, width: 0.885, height: 2.01, sill: 0 } })
    const wide = doc.addNode({ type: 'opening', parent: egWalls[2]!, params: { kind: 'door', style: 'single', offset: 5, width: 1.135, height: 2.135, sill: 0 } })
    doc.addNode({ type: 'opening', parent: egWalls[1]!, params: { kind: 'window', style: 'casement', offset: 4, width: 1.25, height: 1.25, sill: 0.9 } })
    const stair = doc.addNode({ type: 'stair', parent: eg, params: { width: 1 }, t: at(3, -3.5) })
    await service.idle()
    const checks = runChecks(collectBuilding(doc, service))
    const by = (code: string, id?: string) => checks.find((c) => c.code === code && (!id || c.nodeIds.includes(id)))
    expect(by('door.width.low', narrow)!.status).toBe('warn') // advisory unless the project must be barrier-free
    expect(by('door.width.low', narrow)!.rule).toContain('DIN 18040-2')
    expect(by('door.width.ok', wide)!.status).toBe('pass')
    expect(by('door.height.low', narrow)).toBeDefined()
    expect(by('door.height.low', wide)).toBeUndefined()
    expect(by('daylight.low', living)!.status).toBe('fail')
    expect(by('stair.ok', stair)!.status).toBe('pass')
    expect(by('escape.ok', living)!.status).toBe('pass')
    expect(by('room.height.ok', living)!.status).toBe('pass')
    expect(by('door.width.low', narrow)!.message).toMatch(/0\.765 m < 0\.90 m/)
    doc.setMeta({ site: { barrierFree: true } })
    const strict = runChecks(collectBuilding(doc, service))
    expect(strict.find((c) => c.code === 'door.width.low')!.status).toBe('fail')
    service.dispose()
  })

  it('checks movement areas against furniture and corridor widths', async () => {
    const doc = CadDocument.create('bath', { withLevel: true })
    const lv = doc.levels()[0]!.id
    walls(doc, lv, 2.75, [[-1, -1.2], [1, -1.2], [1, 1.2], [-1, 1.2]], 0.2)
    const bath = doc.addNode({ type: 'room', parent: lv, name: 'Bad', params: { outline: [], number: '1', usage: 'NUF7', showLabel: true, auto: true }, t: at(0, 0) })
    walls(doc, lv, 2.75, [[3, -1], [9, -1], [9, 0.2], [3, 0.2]], 0.2)
    const hall = doc.addNode({ type: 'room', parent: lv, name: 'Flur', params: { outline: [], number: '2', usage: 'VF', showLabel: true, auto: true }, t: at(6, -0.4) })
    const service = createGeometryService({ doc, assets, workers: 0 })
    await service.idle()
    let checks = runChecks(collectBuilding(doc, service))
    expect(checks.find((c) => c.nodeIds[0] === bath && c.code.startsWith('turning'))!.code).toBe('turning.ok')
    const corridor = checks.find((c) => c.nodeIds[0] === hall && c.code.startsWith('corridor'))!
    expect(corridor.code).toBe('corridor.narrow')
    expect(Number(corridor.vars.width)).toBeCloseTo(1.0, 1)
    doc.addNode({ type: 'furniture', parent: lv, params: { kind: 'bathtub', width: 1.7, depth: 0.75, height: 0.6 }, t: at(0, 1.1) })
    await service.idle()
    checks = runChecks(collectBuilding(doc, service))
    expect(checks.find((c) => c.nodeIds[0] === bath && c.code.startsWith('turning'))!.code).toBe('turning.basic')
    service.dispose()
  })

  it('aggregates everything in one report', async () => {
    const { doc, service } = await house({ attic: true })
    const report = analyzeBuilding(doc, service)
    expect(report.din277.levels.length).toBe(2)
    expect(report.checks.length).toBeGreaterThan(3)
    expect(report.summary.pass + report.summary.warn + report.summary.fail + report.summary.info).toBe(report.checks.length)
    expect(report.checks.find((c) => c.code === 'zoning.noplot')).toBeDefined()
    expect(report.checks.find((c) => c.code === 'room.height.attic')).toBeDefined()
    service.dispose()
  })
})

describe('helpers', () => {
  it('classifies rooms by German and English names', () => {
    expect(roomKindOf('Bad', 'NUF7')).toBe('bath')
    expect(roomKindOf('Gäste-WC', 'NUF7')).toBe('bath')
    expect(roomKindOf('Wohnküche', 'NUF1')).toBe('kitchen')
    expect(roomKindOf('Diele', 'VF')).toBe('hall')
    expect(roomKindOf('Halle', 'NUF5')).toBe('other')
    expect(roomKindOf('Kinderzimmer', 'NUF1')).toBe('bedroom')
    expect(roomKindOf('Keller', 'NUF4')).toBe('accessory')
    expect(roomKindOf('Balkon', 'NUF1')).toBe('outdoor')
    expect(roomKindOf('', 'VF')).toBe('hall')
    expect(roomKindOf('Badezimmer', 'NUF7')).toBe('bath')
    expect(roomTags('Living / Kitchen', 'NUF1')).toEqual(['kitchen', 'living'])
    expect(roomTags('Gäste-WC', 'NUF7')).toEqual(['bath', 'bedroom'])
  })
  it('grades values against limits', () => {
    expect(limitStatus(0.3, 0.4)).toBe('pass')
    expect(limitStatus(0.395, 0.4)).toBe('warn')
    expect(limitStatus(0.41, 0.4)).toBe('fail')
    expect(limitStatus(null, 0.4)).toBe('info')
    expect(limitStatus(3, 2, true)).toBe('fail')
  })
})
