// IFC import (web-ifc, lazy WASM): storeys → 'level' nodes, walls → parametric 'wall' nodes when they
// are plain rectangle extrusions (their doors/windows → 'opening' children), spaces → 'room' nodes,
// everything else → mesh nodes grouped per storey (aggregates as groups). IFC identity (GlobalId,
// type, names, materials, property sets) is kept in node.meta.ifc.
import type { FlatMesh, IfcAPI } from 'web-ifc'
import type { AnyNode, DoorStyle, OpeningParams, RoomUsage, WindowStyle } from '@cadsandbox/doc'
import type { ImportOptions, ImportResult } from '../api'
import { SnapshotBuilder, materialDef } from '../builder'
import { stem, throwIfAborted, tick } from '../util/bytes'
import { loadWebIfc } from '../wasm'
import { fitOpening, fitWall, footprintFromMesh, spaceFromProfile, type OpeningFit, type WallFit } from './ifc-arch'
import { IfcModel, str } from './ifc-model'
import { addRawMesh, rgbHex } from './raw-mesh'

interface Part {
  color: [number, number, number, number]
  positions: Float64Array
  normals: Float32Array
  indices: Uint32Array
}

/** web-ifc outputs Y-up meters; convert to our Z-up world: (x, y, z) → (x, −z, y). */
function collect(api: IfcAPI, modelID: number, fm: FlatMesh): Part[] {
  const parts: Part[] = []
  const n = fm.geometries.size()
  for (let i = 0; i < n; i++) {
    const pg = fm.geometries.get(i)
    const geom = api.GetGeometry(modelID, pg.geometryExpressID) as unknown as {
      GetVertexData(): number
      GetVertexDataSize(): number
      GetIndexData(): number
      GetIndexDataSize(): number
      delete(): void
    }
    try {
      const v = api.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize())
      const ix = api.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize())
      const T = pg.flatTransformation
      const count = v.length / 6
      const positions = new Float64Array(count * 3)
      const normals = new Float32Array(count * 3)
      for (let k = 0; k < count; k++) {
        const x = v[k * 6]!,
          y = v[k * 6 + 1]!,
          z = v[k * 6 + 2]!
        const wx = T[0]! * x + T[4]! * y + T[8]! * z + T[12]!
        const wy = T[1]! * x + T[5]! * y + T[9]! * z + T[13]!
        const wz = T[2]! * x + T[6]! * y + T[10]! * z + T[14]!
        positions[k * 3] = wx
        positions[k * 3 + 1] = -wz
        positions[k * 3 + 2] = wy
        const nx = v[k * 6 + 3]!,
          ny = v[k * 6 + 4]!,
          nz = v[k * 6 + 5]!
        let ax = T[0]! * nx + T[4]! * ny + T[8]! * nz,
          ay = T[1]! * nx + T[5]! * ny + T[9]! * nz,
          az = T[2]! * nx + T[6]! * ny + T[10]! * nz
        const l = Math.hypot(ax, ay, az) || 1
        ax /= l
        ay /= l
        az /= l
        normals[k * 3] = ax
        normals[k * 3 + 1] = -az
        normals[k * 3 + 2] = ay
      }
      const indices = Uint32Array.from(ix)
      const det = T[0]! * (T[5]! * T[10]! - T[9]! * T[6]!) - T[4]! * (T[1]! * T[10]! - T[9]! * T[2]!) + T[8]! * (T[1]! * T[6]! - T[5]! * T[2]!)
      if (det < 0) for (let t = 0; t + 2 < indices.length; t += 3) [indices[t + 1], indices[t + 2]] = [indices[t + 2]!, indices[t + 1]!]
      parts.push({ color: [pg.color.x, pg.color.y, pg.color.z, pg.color.w], positions, normals, indices })
    } finally {
      geom.delete()
    }
  }
  return parts
}

function merged(parts: Part[]): { positions: Float64Array; indices: Uint32Array } {
  let nv = 0,
    ni = 0
  for (const p of parts) {
    nv += p.positions.length
    ni += p.indices.length
  }
  const positions = new Float64Array(nv),
    indices = new Uint32Array(ni)
  let ov = 0,
    oi = 0
  for (const p of parts) {
    positions.set(p.positions, ov)
    for (let i = 0; i < p.indices.length; i++) indices[oi + i] = p.indices[i]! + ov / 3
    ov += p.positions.length
    oi += p.indices.length
  }
  return { positions, indices }
}

function bounds(parts: Part[]): { min: number[]; max: number[] } | null {
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity]
  for (const p of parts)
    for (let i = 0; i < p.positions.length; i += 3)
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k]!, p.positions[i + k]!)
        max[k] = Math.max(max[k]!, p.positions[i + k]!)
      }
  return min[0] === Infinity ? null : { min, max }
}

/** The web-ifc mesh must agree with the fitted wall box (guards against misread placements). */
function wallMatchesMesh(w: WallFit, parts: Part[]): boolean {
  const mb = bounds(parts)
  if (!mb) return false
  const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1])
  const ux = (w.b[0] - w.a[0]) / L,
    uy = (w.b[1] - w.a[1]) / L
  const h = w.thickness / 2
  const cs = [
    [w.a[0] - uy * h, w.a[1] + ux * h],
    [w.a[0] + uy * h, w.a[1] - ux * h],
    [w.b[0] - uy * h, w.b[1] + ux * h],
    [w.b[0] + uy * h, w.b[1] - ux * h],
  ]
  const bx0 = Math.min(...cs.map((c) => c[0]!)),
    bx1 = Math.max(...cs.map((c) => c[0]!)),
    by0 = Math.min(...cs.map((c) => c[1]!)),
    by1 = Math.max(...cs.map((c) => c[1]!))
  const tol = 0.02
  const inside = mb.min[0]! >= bx0 - tol && mb.max[0]! <= bx1 + tol && mb.min[1]! >= by0 - tol && mb.max[1]! <= by1 + tol && mb.min[2]! >= w.baseZ - tol && mb.max[2]! <= w.baseZ + w.height + tol
  const covers = mb.max[0]! - mb.min[0]! >= 0.5 * (bx1 - bx0) - tol && mb.max[1]! - mb.min[1]! >= 0.5 * (by1 - by0) - tol && mb.max[2]! - mb.min[2]! >= 0.5 * w.height
  return inside && covers
}

const DOOR_OPS: [RegExp, DoorStyle][] = [
  [/DOUBLE_DOOR_SLIDING/, 'double-sliding'],
  [/SLIDING/, 'sliding'],
  [/FOLDING/, 'folding'],
  [/REVOLVING/, 'revolving'],
  [/ROLLING|LIFTING/, 'garage'],
  [/DOUBLE_DOOR|DOUBLE_SWING/, 'double'],
]
function openingStyle(model: IfcModel, filler: number | undefined): Partial<OpeningParams> {
  if (!filler) return { kind: 'opening', style: 'none' }
  const W = model.W
  const t = model.api.GetLineType(model.id, filler)
  const l = model.line(filler)
  if (t === W.IFCDOOR || t === W.IFCDOORSTANDARDCASE) {
    const op = str(l?.OperationType) ?? ''
    const style = DOOR_OPS.find(([re]) => re.test(op))?.[1] ?? 'single'
    return { kind: 'door', style, hinge: /RIGHT/.test(op) ? 'right' : 'left', sill: 0 }
  }
  if (t === W.IFCWINDOW || t === W.IFCWINDOWSTANDARDCASE) {
    const part = str(l?.PartitioningType) ?? ''
    const pt = str(l?.PredefinedType) ?? ''
    const style: WindowStyle = pt === 'SKYLIGHT' ? 'skylight' : /DOUBLE_PANEL_VERTICAL|TRIPLE_PANEL_VERTICAL/.test(part) ? 'double-casement' : 'casement'
    return { kind: 'window', style }
  }
  return { kind: 'opening', style: 'none' }
}

function roomUsage(name: string): RoomUsage {
  const n = name.toLowerCase()
  if (/flur|diele|treppe|korridor|corridor|hall|stair|lobby|aufzug|elevator|entrance|eingang/.test(n)) return 'VF'
  if (/technik|heizung|hausanschluss|server|mechanical|plant|boiler|elektro/.test(n)) return 'TF'
  if (/wc|bad|dusch|toilet|bath|sanit/.test(n)) return 'NUF7'
  if (/abstell|lager|keller|storage|garage|store/.test(n)) return 'NUF4'
  if (/büro|buero|office|arbeits/.test(n)) return 'NUF2'
  return 'NUF1'
}

export async function importIfc(name: string, bytes: Uint8Array, opts: ImportOptions): Promise<ImportResult> {
  opts.onProgress?.(0.02, 'Loading IFC engine')
  const { api, mod: W } = await loadWebIfc()
  const modelID = api.OpenModel(bytes.slice(), { COORDINATE_TO_ORIGIN: false, CIRCLE_SEGMENTS: 24 })
  if (modelID < 0) throw new Error('The IFC file could not be opened.')
  const b = new SnapshotBuilder()
  try {
    const model = new IfcModel(api, W, modelID)
    if (!/^IFC(2X3|4|4X1|4X2|4X3)/i.test(model.schema)) b.warn(`IFC schema ${model.schema} is only partially supported.`)
    opts.onProgress?.(0.08, 'Reading storeys')

    // ------------------------------------------------ storeys → levels
    const storeyIds = model.ids(W.IFCBUILDINGSTOREY)
    let storeys = storeyIds.map((id) => {
      const l = model.line(id)
      return { id, name: str(l?.LongName) || str(l?.Name) || 'Storey', z: model.productMatrix(id)[14]!, elev: (Number(str(l?.Elevation)) || 0) * model.scale }
    })
    if (storeys.length > 1 && storeys.every((s) => Math.abs(s.z - storeys[0]!.z) < 1e-6)) storeys = storeys.map((s) => ({ ...s, z: s.elev }))
    storeys.sort((a, c) => a.z - c.z)
    const ground = storeys.reduce((best, s, i) => (Math.abs(s.z) < Math.abs(storeys[best]!.z) ? i : best), 0)
    const levels = new Map<number, { node: AnyNode; z: number }>()
    storeys.forEach((s, i) => {
      const next = storeys[i + 1]
      const height = next ? Math.max(0.5, next.z - s.z) : i > 0 ? Math.max(0.5, s.z - storeys[i - 1]!.z) : 3
      const node = b.add('level', { name: s.name, parent: null, t: { p: [0, 0, s.z], r: [0, 0, 0, 1], s: [1, 1, 1] }, params: { height, cutHeight: 1.1, number: i - ground }, meta: model.meta(s.id) })
      levels.set(s.id, { node, z: s.z })
    })
    let unassigned: AnyNode | null = null
    const project = model.line(model.ids(W.IFCPROJECT)[0])
    const holder = (id: number): { parent: string; z: number } => {
      const st = model.storeyOf(id)
      const lv = st ? levels.get(st) : undefined
      if (lv) return { parent: lv.node.id, z: lv.z }
      unassigned ??= b.add('group', { name: str(project?.Name) || stem(name), parent: null, meta: { ifc: { type: 'IfcProject' } } })
      return { parent: unassigned.id, z: 0 }
    }

    // ------------------------------------------------ geometry
    opts.onProgress?.(0.12, 'Tessellating elements')
    const meshes = new Map<number, Part[]>()
    let aborted = false
    api.StreamAllMeshes(modelID, (fm, index, total) => {
      if (aborted || opts.signal?.aborted) {
        aborted = true
        return
      }
      meshes.set(fm.expressID, collect(api, modelID, fm))
      if (index % 200 === 0) opts.onProgress?.(0.12 + (0.55 * index) / Math.max(1, total), 'Tessellating elements')
    })
    throwIfAborted(opts.signal)
    const flat = (id: number): Part[] | null => {
      if (meshes.has(id)) return meshes.get(id)!
      try {
        const fm = api.GetFlatMesh(modelID, id)
        const parts = collect(api, modelID, fm)
        try {
          ;(fm as unknown as { delete?: () => void }).delete?.()
        } catch {
          /* value object */
        }
        return parts.length ? parts : null
      } catch {
        return null
      }
    }

    // ------------------------------------------------ materials by color
    const mats = new Map<string, string>()
    const materialFor = (c: Part['color'], label: string | null): string => {
      const key = c.map((v) => Math.round(v * 255)).join(',')
      let id = mats.get(key)
      if (!id) {
        const alpha = Math.min(1, Math.max(0, c[3]))
        const glass = alpha < 0.6
        id = b.material(
          materialDef({
            name: label ?? `IFC ${rgbHex(c[0], c[1], c[2])}`,
            color: rgbHex(c[0], c[1], c[2]),
            roughness: glass ? 0.05 : 0.7,
            opacity: glass ? 1 : alpha,
            transmission: glass ? 0.9 : 0,
            category: glass ? 'glass' : 'generic',
          }),
        )
        mats.set(key, id)
      }
      return id
    }

    // ------------------------------------------------ parametric walls
    opts.onProgress?.(0.7, 'Recognizing walls and openings')
    const consumed = new Set<number>()
    const walls = new Map<number, { fit: WallFit; openings: { op: number; filler?: number; fit: OpeningFit }[] }>()
    const wallIds = [...new Set([...model.ids(W.IFCWALL), ...model.ids(W.IFCWALLSTANDARDCASE)])]
    for (const id of wallIds) {
      const parts = meshes.get(id)
      if (!parts?.length) continue
      const fit = fitWall(model, id)
      if (!fit || !wallMatchesMesh(fit, parts)) continue
      const openings: { op: number; filler?: number; fit: OpeningFit }[] = []
      let ok = true
      for (const op of model.voids.get(id) ?? []) {
        const filler = model.fills.get(op)
        const verts = flat(op) ?? (filler ? flat(filler) : null)
        const f = verts ? fitOpening(fit, merged(verts).positions) : null
        if (!f) {
          ok = false
          break
        }
        openings.push({ op, ...(filler ? { filler } : {}), fit: f })
      }
      if (!ok) continue
      walls.set(id, { fit, openings })
      for (const o of openings) if (o.filler) consumed.add(o.filler)
    }

    // ------------------------------------------------ emit
    opts.onProgress?.(0.8, 'Building model')
    const aggGroups = new Map<number, string>()
    const parentFor = (id: number): { parent: string; z: number } => {
      const h = holder(id)
      const agg = model.aggregate.get(id)
      if (!agg) return h
      const at = api.GetLineType(modelID, agg)
      if (at === W.IFCBUILDINGSTOREY || at === W.IFCBUILDING || at === W.IFCSITE || at === W.IFCPROJECT || at === W.IFCSPACE) return h
      let g = aggGroups.get(agg)
      if (!g) {
        const ah = holder(agg)
        const meta = model.meta(agg)
        g = b.add('group', { name: str(model.line(agg)?.Name) || model.typeName(agg).replace(/^Ifc/, ''), parent: ah.parent, meta }).id
        aggGroups.set(agg, g)
      }
      return { parent: g, z: h.z }
    }

    const spaceIds = new Set(model.ids(W.IFCSPACE))
    const openingIds = new Set(model.ids(W.IFCOPENINGELEMENT, true))
    let done = 0
    for (const [id, parts] of meshes) {
      if (consumed.has(id) || spaceIds.has(id) || openingIds.has(id) || !parts.length) continue
      if (++done % 100 === 0) {
        throwIfAborted(opts.signal)
        opts.onProgress?.(0.8 + (0.15 * done) / meshes.size, 'Building model')
        await tick()
      }
      const meta = model.meta(id)
      const info = meta.ifc as { name?: string; type: string; material?: string }
      const label = info.name || info.type.replace(/^Ifc/, '')
      const { parent, z } = parentFor(id)
      const wall = walls.get(id)
      if (wall) {
        const psets = Object.values(model.psets(id))
        const node = b.add('wall', {
          name: label,
          parent,
          material: materialFor(parts[0]!.color, info.material ?? null),
          meta,
          params: {
            a: wall.fit.a,
            b: wall.fit.b,
            thickness: wall.fit.thickness,
            height: wall.fit.height,
            baseOffset: wall.fit.baseZ - z,
            justification: 'center',
            exterior: psets.some((p) => p.IsExternal === true),
            structural: psets.some((p) => p.LoadBearing === true),
          },
        })
        b.expand([
          [wall.fit.a[0], wall.fit.a[1], wall.fit.baseZ],
          [wall.fit.b[0], wall.fit.b[1], wall.fit.baseZ + wall.fit.height],
        ])
        for (const o of wall.openings) {
          const style = openingStyle(model, o.filler)
          const om = o.filler ? model.meta(o.filler) : model.meta(o.op)
          ;(om.ifc as Record<string, unknown>).openingGlobalId = str(model.line(o.op)?.GlobalId)
          b.add('opening', {
            name: (om.ifc as { name?: string }).name || (style.kind === 'window' ? 'Window' : style.kind === 'door' ? 'Door' : 'Opening'),
            parent: node.id,
            meta: om,
            params: { ...style, offset: o.fit.offset, width: o.fit.width, height: o.fit.height, sill: o.fit.sill },
          })
        }
        continue
      }
      // generic element → mesh node(s), grouped by color
      const byColor = new Map<string, Part[]>()
      for (const p of parts) {
        const k = p.color.map((v) => Math.round(v * 255)).join(',')
        byColor.set(k, [...(byColor.get(k) ?? []), p])
      }
      const target = byColor.size > 1 ? b.add('group', { name: label, parent, meta }).id : parent
      for (const group of byColor.values()) {
        const m = merged(group)
        const bb = bounds(group)!
        const pivot: [number, number, number] = [(bb.min[0]! + bb.max[0]!) / 2, (bb.min[1]! + bb.max[1]!) / 2, (bb.min[2]! + bb.max[2]!) / 2]
        const normals = new Float32Array(m.positions.length)
        let o = 0
        for (const p of group) {
          normals.set(p.normals, o)
          o += p.normals.length
        }
        await addRawMesh(
          b,
          { positions: m.positions, normals, indices: m.indices },
          {
            name: byColor.size > 1 ? `${label} · ${rgbHex(group[0]!.color[0], group[0]!.color[1], group[0]!.color[2])}` : label,
            parent: target,
            material: materialFor(group[0]!.color, info.material ?? null),
            meta: byColor.size > 1 ? {} : meta,
            pivot,
            transform: { p: [pivot[0], pivot[1], pivot[2] - z], r: [0, 0, 0, 1], s: [1, 1, 1] },
          },
        )
      }
    }

    // ------------------------------------------------ spaces → rooms
    let roomsFallback = 0
    for (const id of spaceIds) {
      const meta = model.meta(id)
      const info = meta.ifc as { name?: string; longName?: string }
      const { parent, z } = holder(id)
      const prof = spaceFromProfile(model, id)
      const parts = prof ? null : flat(id)
      const whole = parts ? merged(parts) : null
      const fp = prof ? { outline: prof.outline, z: prof.baseZ, height: prof.height } : whole ? footprintFromMesh(whole.positions, whole.indices) : null
      const label = info.longName || info.name || 'Room'
      if (fp) {
        b.add('room', {
          name: label,
          parent,
          t: { p: [0, 0, fp.z - z], r: [0, 0, 0, 1], s: [1, 1, 1] },
          meta,
          params: { outline: fp.outline, number: info.name && info.name !== label ? info.name : '', usage: roomUsage(label), ceilingHeight: fp.height, showLabel: true, auto: false },
        })
        b.expand(fp.outline.map((p) => [p[0], p[1], fp.z]))
      } else if (parts?.length && whole) {
        roomsFallback++
        const bb = bounds(parts)!
        const pivot: [number, number, number] = [(bb.min[0]! + bb.max[0]!) / 2, (bb.min[1]! + bb.max[1]!) / 2, (bb.min[2]! + bb.max[2]!) / 2]
        await addRawMesh(b, { positions: whole.positions, indices: whole.indices }, { name: label, parent, meta, visible: false, material: materialFor(parts[0]!.color, null), pivot, transform: { p: [pivot[0], pivot[1], pivot[2] - z], r: [0, 0, 0, 1], s: [1, 1, 1] } })
      }
    }
    if (roomsFallback) b.warn(`${roomsFallback} space(s) have no derivable footprint and were imported as hidden meshes.`)
    const wallTotal = wallIds.length
    if (wallTotal) b.warn(`${walls.size} of ${wallTotal} walls were converted to editable walls; the others were imported as meshes.`)
    opts.onProgress?.(1, 'Done')
    return b.result()
  } finally {
    api.CloseModel(modelID)
  }
}
