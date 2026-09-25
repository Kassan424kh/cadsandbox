import { CadDocument, makeNode } from '@cadsandbox/doc'
import { describe, expect, it } from 'vitest'
import type { AssetResolver } from '../api'
import { hatchSegments, ALL_HATCH_PATTERNS } from '../core/hatch'
import { polygonArea } from '../core/math2d'
import { pointInPolys, type PolyWithHoles } from '../core/polygon'
import { evaluatePrimitive } from '../evaluators/primitive'
import { createGeometryService } from '../service/service'
import { detectRoomRegions, detectRooms } from './rooms'
import { computeSchedules } from './schedules'
import { sliceMesh, sliceMeshZ } from './slice'

const assets: AssetResolver = { get: async () => null }

function twoRoomPlan() {
  const doc = CadDocument.create('plan', { withLevel: true })
  const level = doc.levels()[0]!.id
  const wall = (a: [number, number], b: [number, number]) => doc.addNode({ type: 'wall', parent: level, params: { a, b, thickness: 0.2, height: 2.75 } })
  wall([0, 0], [6, 0])
  wall([6, 0], [6, 4])
  wall([6, 4], [0, 4])
  wall([0, 4], [0, 0])
  const partition = wall([3, 0], [3, 4])
  return { doc, level, partition }
}

describe('room detection', () => {
  it('finds two rooms in a partitioned rectangle (exterior ignored)', () => {
    const { doc, level } = twoRoomPlan()
    const rooms = detectRooms(doc, level)
    expect(rooms.length).toBe(2)
    const areas = rooms.map((r) => Math.abs(polygonArea(r))).sort()
    expect(areas[0]).toBeCloseTo(2.8 * 3.8, 3)
    expect(areas[1]).toBeCloseTo(2.8 * 3.8, 3)
    expect(detectRoomRegions(doc, level).every((r) => polygonArea(r.outer) > 0)).toBe(true)
  })
  it('auto rooms follow walls through the service', async () => {
    const { doc, level, partition } = twoRoomPlan()
    const room = doc.addNode({ type: 'room', parent: level, name: 'Left', params: { outline: [], number: '1', usage: 'NUF1', showLabel: true, auto: true }, t: { p: [1.5, 2, 0], r: [0, 0, 0, 1], s: [1, 1, 1] } })
    const service = createGeometryService({ doc, assets, workers: 0 })
    await service.idle()
    expect(service.get(room)!.quantities!.area).toBeCloseTo(2.8 * 3.8, 3)
    // moving the partition changes the room
    doc.setParams(partition, { a: [4, 0], b: [4, 4] })
    await service.idle()
    expect(service.get(room)!.quantities!.area).toBeCloseTo(3.8 * 3.8, 3)
    service.dispose()
  })
})

describe('hatch', () => {
  const L: PolyWithHoles = { outer: [[0, 0], [3, 0], [3, 1.2], [1.2, 1.2], [1.2, 2.5], [0, 2.5]], holes: [[[0.3, 0.3], [0.3, 0.8], [0.8, 0.8], [0.8, 0.3]]] }
  for (const pattern of ALL_HATCH_PATTERNS) {
    if (pattern === 'none' || pattern === 'solid') continue
    it(`${pattern} segments stay inside the boundary and outside holes`, () => {
      const segs = hatchSegments([L], pattern, 1, 0.3)
      expect(segs.length).toBeGreaterThan(0)
      expect(segs.length % 4).toBe(0)
      for (let i = 0; i < segs.length; i += 4) {
        const mx = (segs[i]! + segs[i + 2]!) / 2, my = (segs[i + 1]! + segs[i + 3]!) / 2
        expect(pointInPolys([mx, my], [L]) || onBoundary([mx, my], L)).toBe(true)
      }
    })
  }
  it('honours scale (denser at smaller scale)', () => {
    const a = hatchSegments([L], 'ansi31', 1).length
    const b = hatchSegments([L], 'ansi31', 0.5).length
    expect(b).toBeGreaterThan(a * 1.5)
  })
})

function onBoundary(p: [number, number], poly: PolyWithHoles): boolean {
  for (const ring of [poly.outer, ...poly.holes]) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!, b = ring[(i + 1) % ring.length]!
      const dx = b[0] - a[0], dy = b[1] - a[1]
      const l2 = dx * dx + dy * dy
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2))
      if (Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]) < 1e-6) return true
    }
  }
  return false
}

describe('schedules', () => {
  it('lists rooms, openings, walls and DIN 277 areas', async () => {
    const { doc, level } = twoRoomPlan()
    const walls = doc.nodesOfType('wall')
    doc.addNode({ type: 'opening', parent: walls[0]!.id, params: { kind: 'door', style: 'single', offset: 1.5, width: 0.885, height: 2.01 } })
    doc.addNode({ type: 'opening', parent: walls[2]!.id, params: { kind: 'window', style: 'casement', offset: 1.5, width: 1.01, height: 1.26, sill: 0.9 } })
    doc.addNode({ type: 'opening', parent: walls[2]!.id, params: { kind: 'window', style: 'casement', offset: 4.5, width: 1.01, height: 1.26, sill: 0.9 } })
    doc.addNode({ type: 'room', parent: level, name: 'Living', params: { outline: [[0.1, 0.1], [2.9, 0.1], [2.9, 3.9], [0.1, 3.9]], number: '1', usage: 'NUF1', showLabel: true } })
    doc.addNode({ type: 'room', parent: level, name: 'Hall', params: { outline: [[3.1, 0.1], [5.9, 0.1], [5.9, 3.9], [3.1, 3.9]], number: '2', usage: 'VF', showLabel: true } })
    const service = createGeometryService({ doc, assets, workers: 0 })
    await service.idle()
    const s = computeSchedules(doc, service)
    expect(s.rooms.length).toBe(2)
    expect(s.doors.length).toBe(1)
    expect(s.windows.length).toBe(1)
    expect(s.windows[0]!.count).toBe(2)
    expect(s.walls.length).toBe(5)
    expect(s.totals.netFloorArea).toBeCloseTo(2 * 2.8 * 3.8, 3)
    expect(s.totals.grossFloorArea).toBeCloseTo(6.2 * 4.2, 3)
    expect(s.areas.find((a) => a.usage === 'VF')!.area).toBeCloseTo(2.8 * 3.8, 3)
    expect(s.totals.grossVolume).toBeCloseTo(6.2 * 4.2 * 3, 3)
    service.dispose()
  })
})

describe('slice', () => {
  it('cuts a box into a closed square loop', () => {
    const box = evaluatePrimitive(makeNode({ type: 'primitive', params: { shape: 'box', width: 2, depth: 1, height: 1 } })).parts[0]!.mesh
    const loops = sliceMeshZ(box, 0.5)
    expect(loops.length).toBe(1)
    expect(Math.abs(polygonArea(loops[0]!))).toBeCloseTo(2, 6)
    const tilted = sliceMesh(box, { point: [0, 0, 0.5], normal: [0, 1, 1] })
    expect(tilted.length).toBe(1)
    expect(sliceMeshZ(box, 5).length).toBe(0)
  })
})
