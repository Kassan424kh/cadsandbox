// Schedules (rooms, doors, windows, walls) and DIN 277 area summary.
import { TYPE_DEFAULT_MATERIAL, invertMatrix, multiplyMatrices, type CadDocument, type NodeBase, type RoomUsage } from '@cadsandbox/doc'
import type { GeometryService, OpeningRow, RoomRow, Schedules, WallRow } from '../api'
import { affineFromMat4, applyAffine, polygonArea } from '../core/math2d'
import { unionPolygons, type Ring } from '../core/polygon'
import { WallFrame, transformWallParams } from '../evaluators/wall/frame'
import { neighborFrames } from '../evaluators/wall/index'
import { rawFootprint, solveJoins } from '../evaluators/wall/joins'
import { defaultContext } from '../evaluators/context'
import { buildWallIndex, nearbyWalls } from '../service/context'
import { levelWalls } from './rooms'

const USAGES: RoomUsage[] = ['NUF1', 'NUF2', 'NUF3', 'NUF4', 'NUF5', 'NUF6', 'NUF7', 'TF', 'VF']

const levelName = (doc: CadDocument, id: string): string => {
  const lvl = doc.getLevelOf(id)
  return lvl ? (doc.getNode(lvl)?.name ?? lvl) : ''
}

/**
 * Gross floor area (BGF estimate) of a level: area inside the outer boundary of the joined wall
 * footprints (mitered corners, no opening gaps).
 */
export function grossFloorArea(doc: CadDocument, levelId: string): number {
  const walls = levelWalls(doc, levelId)
  if (!walls.length) return 0
  const toLevel = invertMatrix(doc.getWorldMatrix(levelId))
  const rings: Ring[] = []
  const index = buildWallIndex(doc)
  for (const w of walls) {
    const node = doc.getNode<'wall'>(w.id)
    if (!node) {
      rings.push(rawFootprint(new WallFrame(transformWallParams(w.params, w.xf), null)))
      continue
    }
    const frame = new WallFrame(node.params, null)
    const solve = solveJoins(node.id, frame, neighborFrames(defaultContext({ walls: nearbyWalls(doc, node, index) }), frame))
    const xf = affineFromMat4(multiplyMatrices(toLevel, doc.getWorldMatrix(node.id)))
    rings.push(solve.footprint.map((q) => applyAffine(xf, q)))
  }
  const union = unionPolygons(rings)
  // outer rings only (holes = rooms are part of the gross area)
  let area = 0
  for (const u of union) area += Math.abs(polygonArea(u.outer))
  return area
}

export function computeSchedules(doc: CadDocument, service: GeometryService): Schedules {
  const rooms: RoomRow[] = []
  const doors = new Map<string, OpeningRow>()
  const windows = new Map<string, OpeningRow>()
  const walls: WallRow[] = []
  const byUsage = new Map<string, number>()
  for (const n of doc.allNodes()) {
    if (doc.isDefinitionNode(n.id)) continue
    const q = service.get(n.id)?.quantities
    if (n.type === 'room') {
      const r = n as NodeBase<'room'>
      const area = q?.area ?? 0
      rooms.push({
        id: r.id,
        number: r.params.number,
        name: r.name,
        level: levelName(doc, r.id),
        usage: r.params.usage,
        area,
        perimeter: q?.perimeter ?? 0,
        height: q?.height ?? 0,
        volume: q?.volume ?? 0,
      })
      byUsage.set(r.params.usage, (byUsage.get(r.params.usage) ?? 0) + area)
    } else if (n.type === 'opening') {
      const o = n as NodeBase<'opening'>
      if (o.params.kind === 'opening') continue
      const lvl = levelName(doc, o.id)
      const key = `${o.params.kind}|${o.params.style}|${o.params.width.toFixed(3)}|${o.params.height.toFixed(3)}|${o.params.sill.toFixed(3)}|${lvl}`
      const target = o.params.kind === 'door' ? doors : windows
      const row = target.get(key)
      if (row) row.count++
      else
        target.set(key, {
          id: o.id,
          kind: o.params.kind,
          style: o.params.style,
          level: lvl,
          wall: o.parent ?? '',
          width: o.params.width,
          height: o.params.height,
          sill: o.params.sill,
          count: 1,
        })
    } else if (n.type === 'wall') {
      const w = n as NodeBase<'wall'>
      const matId = w.material ?? TYPE_DEFAULT_MATERIAL.wall ?? ''
      walls.push({
        id: w.id,
        level: levelName(doc, w.id),
        length: q?.length ?? 0,
        height: q?.height ?? w.params.height,
        thickness: q?.thickness ?? w.params.thickness,
        grossArea: q?.grossArea ?? 0,
        openingArea: q?.openingArea ?? 0,
        netArea: q?.netArea ?? 0,
        surfaceArea: q?.surfaceArea ?? 0,
        volume: q?.volume ?? 0,
        material: doc.getMaterial(matId)?.name ?? matId,
      })
    }
  }
  const areas: { usage: string; area: number }[] = []
  let nuf = 0, tf = 0, vf = 0
  for (const u of USAGES) {
    const a = byUsage.get(u) ?? 0
    if (a > 0) areas.push({ usage: u, area: a })
    if (u.startsWith('NUF')) nuf += a
    else if (u === 'TF') tf += a
    else vf += a
  }
  const nrf = nuf + tf + vf
  let bgf = 0
  let volume = 0
  for (const lvl of doc.levels()) {
    const a = grossFloorArea(doc, lvl.id)
    bgf += a
    volume += a * lvl.params.height
  }
  areas.push({ usage: 'NUF', area: nuf }, { usage: 'NRF', area: nrf }, { usage: 'BGF', area: bgf })
  rooms.sort((a, b) => a.level.localeCompare(b.level) || a.number.localeCompare(b.number, undefined, { numeric: true }))
  return {
    rooms,
    doors: [...doors.values()],
    windows: [...windows.values()],
    walls,
    areas,
    totals: { netFloorArea: nrf, grossFloorArea: bgf, grossVolume: volume },
  }
}
