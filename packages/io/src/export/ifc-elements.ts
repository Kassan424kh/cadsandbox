// IFC element writers: walls (swept solid + openings + doors/windows), slabs, spaces and generic
// triangulated elements. Coordinates are storey-local meters.
import type { AnyNode, DoorStyle, MaterialDef, NodeBase, Vec2 } from '@cadsandbox/doc'
import { TYPE_DEFAULT_MATERIAL, invertMatrix, multiplyMatrices, polygonArea, polygonPerimeter, transformPoint } from '@cadsandbox/doc'
import type { GeometryResult } from '@cadsandbox/geometry'
import { exportEntries, materialIdOf } from './scene'
import { $, E, L, R, S } from './ifc-step'
import type { IfcExport, PropValue, Storey } from './ifc'

type Mat = Float64Array
const R6 = (v: number) => R(Math.round(v * 1e6) / 1e6)

/** Plan-preserving transform: no tilt, uniform XY scale, no XY shear. */
function planar(m: Mat): boolean {
  const ax = Math.hypot(m[0]!, m[1]!),
    ay = Math.hypot(m[4]!, m[5]!)
  return Math.abs(m[2]!) < 1e-6 && Math.abs(m[6]!) < 1e-6 && Math.abs(m[8]!) < 1e-6 && Math.abs(m[9]!) < 1e-6 && m[10]! > 0 && Math.abs(ax - ay) < 1e-6 * Math.max(1, ax) && Math.abs(m[0]! * m[4]! + m[1]! * m[5]!) < 1e-6
}
const det2 = (m: Mat) => m[0]! * m[5]! - m[1]! * m[4]!

function cleanRing(pts: Vec2[]): Vec2[] {
  const out: Vec2[] = []
  for (const p of pts) {
    const l = out[out.length - 1]
    if (!l || Math.hypot(l[0] - p[0], l[1] - p[1]) > 1e-7) out.push(p)
  }
  if (out.length > 2 && Math.hypot(out[0]![0] - out[out.length - 1]![0], out[0]![1] - out[out.length - 1]![1]) < 1e-7) out.pop()
  return out
}

function polyline2(x: IfcExport, pts: Vec2[]): string {
  const refs = pts.map((p) => x.w.point([Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6]))
  return x.w.add('IFCPOLYLINE', [L([...refs, refs[0]!])])
}

function profile(x: IfcExport, outer: Vec2[], holes: Vec2[][] = []): string {
  const o = polyline2(x, outer)
  const inner = holes.map((h) => cleanRing(h)).filter((h) => h.length >= 3)
  if (!inner.length) return x.w.add('IFCARBITRARYCLOSEDPROFILEDEF', [E('AREA'), $, o])
  return x.w.add('IFCARBITRARYPROFILEDEFWITHVOIDS', [E('AREA'), $, o, L(inner.map((h) => polyline2(x, h)))])
}

function body(x: IfcExport, item: string, type: 'SweptSolid' | 'Tessellation', extra: string[] = []): string {
  const rep = x.w.add('IFCSHAPEREPRESENTATION', [x.bodyCtx, S('Body'), S(type), L([item])])
  return x.w.add('IFCPRODUCTDEFINITIONSHAPE', [$, $, L([...extra, rep])])
}

function extrusion(x: IfcExport, prof: string, depth: number): string {
  return x.w.add('IFCEXTRUDEDAREASOLID', [prof, x.w.axis3([0, 0, 0]), x.w.dir([0, 0, 1]), R(depth)])
}

interface Entry {
  node: AnyNode
  world: Mat
  result: GeometryResult
}

function entriesOf(x: IfcExport, node: AnyNode): Entry[] {
  if (node.type === 'instance') return exportEntries(x.doc, x.geometry, [node.id])
  const r = x.geometry.get(node.id)
  return r && !r.error && r.parts.length ? [{ node, world: x.doc.getWorldMatrix(node.id), result: r }] : []
}

/** Triangulated face sets (one per material) in coordinates of `frame` (storey-local matrix of the placement). */
function faceSets(x: IfcExport, storey: Storey, entries: Entry[], frame: Mat): string[] {
  const inv = invertMatrix(frame)
  const byMat = new Map<string, { def: MaterialDef | undefined; coords: string[]; faces: string[]; n: number }>()
  for (const { node, world, result } of entries) {
    const M = multiplyMatrices(inv, x.local(storey, world))
    const flip = det2(M) * M[10]! < 0
    for (const part of result.parts) {
      const id = materialIdOf(node, part) ?? 'mat-default'
      let g = byMat.get(id)
      if (!g) byMat.set(id, (g = { def: x.doc.getMaterial(id), coords: [], faces: [], n: 0 }))
      const p = part.mesh.positions
      const count = p.length / 3
      for (let i = 0; i < count; i++) {
        const q = transformPoint(M, [p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!])
        g.coords.push(`(${R6(q[0])},${R6(q[1])},${R6(q[2])})`)
      }
      const idx = part.mesh.indices
      const tri = idx ? idx.length / 3 : count / 3
      for (let t = 0; t < tri; t++) {
        let a = idx ? idx[t * 3]! : t * 3,
          b = idx ? idx[t * 3 + 1]! : t * 3 + 1,
          c = idx ? idx[t * 3 + 2]! : t * 3 + 2
        if (a === b || b === c || a === c) continue
        if (flip) [b, c] = [c, b]
        g.faces.push(`(${a + g.n + 1},${b + g.n + 1},${c + g.n + 1})`)
      }
      g.n += count
    }
  }
  const items: string[] = []
  for (const g of byMat.values()) {
    if (!g.faces.length) continue
    const pl = x.w.add('IFCCARTESIANPOINTLIST3D', [`(${g.coords.join(',')})`])
    const fs = x.w.add('IFCTRIANGULATEDFACESET', [pl, $, $, `(${g.faces.join(',')})`, $])
    x.styled(fs, g.def)
    items.push(fs)
  }
  return items
}

/** Generic element as IfcTriangulatedFaceSet(s). Returns the element ref (or null if no geometry). */
export function writeTessellated(x: IfcExport, node: AnyNode, entity: string, tail: string[], psetName: string | null, props: Record<string, PropValue>): string | null {
  const entries = entriesOf(x, node)
  if (!entries.length) return null
  const storey = x.storeyOf(node.id)
  const nodeLocal = x.local(storey, x.doc.getWorldMatrix(node.id))
  const origin = [nodeLocal[12]!, nodeLocal[13]!, nodeLocal[14]!]
  const frame = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, origin[0]!, origin[1]!, origin[2]!, 1])
  const items = faceSets(x, storey, entries, frame)
  if (!items.length) return null
  const rep = x.w.add('IFCSHAPEREPRESENTATION', [x.bodyCtx, S('Body'), S('Tessellation'), L(items)])
  const pds = x.w.add('IFCPRODUCTDEFINITIONSHAPE', [$, $, L([rep])])
  const pl = x.w.add('IFCLOCALPLACEMENT', [storey.placement, x.w.axis3(origin)])
  const el = x.w.add(entity, [S(x.guidFor(node)), x.oh, S(node.name), $, $, pl, pds, $, ...tail])
  storey.contained.push(el)
  x.associate(el, x.materialDefOf(node))
  if (psetName) x.pset(el, psetName, props)
  x.importedPsets(el, node, psetName ? [psetName] : [])
  return el
}

const DOOR_OP: Record<DoorStyle, string> = {
  single: 'SINGLE_SWING_LEFT',
  double: 'DOUBLE_DOOR_SINGLE_SWING',
  sliding: 'SLIDING_TO_LEFT',
  'double-sliding': 'DOUBLE_DOOR_SLIDING',
  folding: 'FOLDING_TO_LEFT',
  pocket: 'SLIDING_TO_LEFT',
  garage: 'ROLLINGUP',
  revolving: 'REVOLVING',
}

function fillerTail(o: NodeBase<'opening'>['params'], sxy: number, sz: number): { entity: string; tail: string[]; pset: string } | null {
  if (o.kind === 'door') {
    let op = DOOR_OP[o.style as DoorStyle] ?? 'SINGLE_SWING_LEFT'
    if (o.hinge === 'right') op = op.replace('_LEFT', '_RIGHT')
    return { entity: 'IFCDOOR', tail: [R(o.height * sz), R(o.width * sxy), E('DOOR'), E(op), $], pset: 'Pset_DoorCommon' }
  }
  if (o.kind === 'window') {
    const part = o.style === 'double-casement' ? 'DOUBLE_PANEL_VERTICAL' : 'SINGLE_PANEL'
    return { entity: 'IFCWINDOW', tail: [R(o.height * sz), R(o.width * sxy), E(o.style === 'skylight' ? 'SKYLIGHT' : 'WINDOW'), E(part), $], pset: 'Pset_WindowCommon' }
  }
  return null
}

/** Door/window whose host is not a straight wall: triangulated, no void relationship. */
export function writeOpeningless(x: IfcExport, node: AnyNode): void {
  const o = (node as NodeBase<'opening'>).params
  const f = fillerTail(o, 1, 1)
  if (!f) return
  writeTessellated(x, node, f.entity, f.tail, f.pset, { IsExternal: !!(x.doc.getNode(node.parent) as NodeBase<'wall'> | undefined)?.params?.exterior })
}

/** Wall offset of the body center from the reference line, as a fraction of the thickness.
 *  Convention: 'left' = the line is the wall's left face (body to the right of a→b). */
export const wallCenterOffset = (j: 'center' | 'left' | 'right'): number => (j === 'left' ? -0.5 : j === 'right' ? 0.5 : 0)

export function writeWall(x: IfcExport, node: NodeBase<'wall'>): void {
  const p = node.params
  const storey = x.storeyOf(node.id)
  const M = x.local(storey, x.doc.getWorldMatrix(node.id))
  const openings = x.doc
    .getChildren(node.id)
    .map((id) => x.doc.getNode(id) as AnyNode)
    .filter((n) => n?.type === 'opening' && n.visible) as NodeBase<'opening'>[]
  const exterior = !!p.exterior
  if ((p.bulge && Math.abs(p.bulge) > 1e-9) || !planar(M)) {
    const el = writeTessellated(x, node, 'IFCWALL', [E('NOTDEFINED')], 'Pset_WallCommon', { IsExternal: exterior, LoadBearing: !!p.structural })
    if (el) for (const o of openings) writeOpeningless(x, o)
    return
  }
  const w = x.w
  const base = transformPoint(M, [p.a[0], p.a[1], p.baseOffset])
  const end = transformPoint(M, [p.b[0], p.b[1], p.baseOffset])
  const len = Math.hypot(end[0] - base[0], end[1] - base[1])
  if (len < 1e-6) return
  const dir = [(end[0] - base[0]) / len, (end[1] - base[1]) / len]
  const sxy = Math.hypot(M[0]!, M[1]!),
    sz = M[10]!
  // like the geometry engine: layered walls are as thick as their layers
  const layers = (p.layers ?? []).filter((l) => l.thickness > 1e-6)
  const T = (layers.length ? layers.reduce((s, l) => s + l.thickness, 0) : p.thickness) * sxy,
    H = p.height * sz
  const yc = wallCenterOffset(p.justification) * T * (det2(M) < 0 ? -1 : 1)
  const pl = w.add('IFCLOCALPLACEMENT', [storey.placement, w.axis3(base, [0, 0, 1], [dir[0]!, dir[1]!, 0])])
  const axis = w.add('IFCPOLYLINE', [L([w.point([0, 0]), w.point([len, 0])])])
  const axisRep = w.add('IFCSHAPEREPRESENTATION', [x.axisCtx, S('Axis'), S('Curve2D'), L([axis])])
  const prof = w.add('IFCRECTANGLEPROFILEDEF', [E('AREA'), $, w.axis2([len / 2, yc]), R(len), R(T)])
  const solid = extrusion(x, prof, H)
  const def = x.materialDefOf(node)
  x.styled(solid, def)
  const wall = w.add('IFCWALL', [S(x.guidFor(node)), x.oh, S(node.name), $, $, pl, body(x, solid, 'SweptSolid', [axisRep]), $, E('STANDARD')])
  storey.contained.push(wall)
  if (layers.length) {
    x.layerSet(
      wall,
      layers.map((l) => ({ def: x.doc.getMaterial(l.material ?? TYPE_DEFAULT_MATERIAL.wall ?? 'mat-default'), thickness: l.thickness * sxy, name: l.function })),
      yc - T / 2,
    )
  } else x.associate(wall, def)
  x.pset(wall, 'Pset_WallCommon', { IsExternal: exterior, LoadBearing: !!p.structural })
  let openArea = 0
  for (const o of openings) openArea += o.params.width * sxy * o.params.height * sz
  x.quantities(wall, 'Qto_WallBaseQuantities', {
    length: { Length: len, Width: T, Height: H },
    area: { GrossSideArea: len * H, NetSideArea: Math.max(0, len * H - openArea) },
    volume: { GrossVolume: len * H * T, NetVolume: Math.max(0, (len * H - openArea) * T) },
  })
  x.importedPsets(wall, node, ['Pset_WallCommon'])

  // placement frame of the wall in storey coordinates
  const wallFrame = new Float64Array([dir[0]!, dir[1]!, 0, 0, -dir[1]!, dir[0]!, 0, 0, 0, 0, 1, 0, base[0], base[1], base[2], 1])
  for (const o of openings) {
    const op = o.params
    const at = [op.offset * sxy, 0, op.sill * sz]
    const oPl = w.add('IFCLOCALPLACEMENT', [pl, w.axis3(at)])
    const oProf = w.add('IFCRECTANGLEPROFILEDEF', [E('AREA'), $, w.axis2([0, yc]), R(op.width * sxy), R(T + 0.1)])
    const oSolid = extrusion(x, oProf, op.height * sz)
    const opening = w.add('IFCOPENINGELEMENT', [S(x.guidFor(o, 'opening')), x.oh, S('Opening'), $, $, oPl, body(x, oSolid, 'SweptSolid'), $, E('OPENING')])
    w.add('IFCRELVOIDSELEMENT', [S(x.fresh()), x.oh, $, $, wall, opening])
    const f = fillerTail(op, sxy, sz)
    if (!f) continue
    const frame = multiplyMatrices(wallFrame, new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, at[0]!, at[1]!, at[2]!, 1]))
    let items = faceSets(x, storey, entriesOf(x, o), frame)
    const odef = x.doc.getMaterial(op.frameMaterial ?? o.material ?? TYPE_DEFAULT_MATERIAL.opening ?? 'mat-default')
    if (!items.length) {
      const depth = Math.max(op.frameDepth, 0.05)
      const box = extrusion(x, w.add('IFCRECTANGLEPROFILEDEF', [E('AREA'), $, w.axis2([0, yc]), R(op.width * sxy), R(depth)]), op.height * sz)
      x.styled(box, odef)
      items = [box]
    }
    const rep = w.add('IFCSHAPEREPRESENTATION', [x.bodyCtx, S('Body'), S(items.length === 1 && !entriesOf(x, o).length ? 'SweptSolid' : 'Tessellation'), L(items)])
    const pds = w.add('IFCPRODUCTDEFINITIONSHAPE', [$, $, L([rep])])
    const fPl = w.add('IFCLOCALPLACEMENT', [oPl, w.axis3([0, 0, 0])])
    const filler = w.add(f.entity, [S(x.guidFor(o)), x.oh, S(o.name), $, $, fPl, pds, $, ...f.tail])
    w.add('IFCRELFILLSELEMENT', [S(x.fresh()), x.oh, $, $, opening, filler])
    storey.contained.push(filler)
    x.associate(filler, odef)
    x.pset(filler, f.pset, { IsExternal: exterior })
    x.importedPsets(filler, o, [f.pset])
  }
}

export function writeSlab(x: IfcExport, node: NodeBase<'slab'>): void {
  const p = node.params
  const storey = x.storeyOf(node.id)
  const M = x.local(storey, x.doc.getWorldMatrix(node.id))
  const outline = cleanRing(p.outline)
  const kind = p.kind === 'roof' ? 'ROOF' : p.kind === 'foundation' ? 'BASESLAB' : 'FLOOR'
  const props = { IsExternal: p.kind === 'roof' || p.kind === 'balcony', LoadBearing: true }
  if (outline.length < 3 || !planar(M)) {
    writeTessellated(x, node, 'IFCSLAB', [E(kind)], 'Pset_SlabCommon', props)
    return
  }
  const to2 = (q: Vec2): Vec2 => {
    const r = transformPoint(M, [q[0], q[1], 0])
    return [r[0], r[1]]
  }
  const outer = outline.map(to2)
  const holes = (p.holes ?? []).map((h) => h.map(to2))
  const T = p.thickness * M[10]!
  const top = transformPoint(M, [0, 0, p.offset])[2]
  const pl = x.w.add('IFCLOCALPLACEMENT', [storey.placement, x.w.axis3([0, 0, top - T])])
  const solid = extrusion(x, profile(x, outer, holes), T)
  const def = x.materialDefOf(node)
  x.styled(solid, def)
  const slab = x.w.add('IFCSLAB', [S(x.guidFor(node)), x.oh, S(node.name), $, $, pl, body(x, solid, 'SweptSolid'), $, E(kind)])
  storey.contained.push(slab)
  x.associate(slab, def)
  x.pset(slab, 'Pset_SlabCommon', props)
  const area = Math.abs(polygonArea(outer)) - holes.reduce((s, h) => s + Math.abs(polygonArea(h)), 0)
  x.quantities(slab, 'Qto_SlabBaseQuantities', { length: { Width: T, Perimeter: polygonPerimeter(outer) }, area: { GrossArea: area }, volume: { GrossVolume: area * T } })
  x.importedPsets(slab, node, ['Pset_SlabCommon'])
}

export function writeSpace(x: IfcExport, node: NodeBase<'room'>): void {
  const p = node.params
  const outline = cleanRing(p.outline)
  if (outline.length < 3) return
  const storey = x.storeyOf(node.id)
  const M = x.local(storey, x.doc.getWorldMatrix(node.id))
  if (!planar(M)) return
  const pts = outline.map((q): Vec2 => {
    const r = transformPoint(M, [q[0], q[1], 0])
    return [r[0], r[1]]
  })
  const floor = transformPoint(M, [0, 0, 0])[2]
  const height = (p.ceilingHeight ?? storey.height) * M[10]!
  const pl = x.w.add('IFCLOCALPLACEMENT', [storey.placement, x.w.axis3([0, 0, floor])])
  const solid = extrusion(x, profile(x, pts), height)
  const space = x.w.add('IFCSPACE', [S(x.guidFor(node)), x.oh, S(p.number || node.name), $, $, pl, body(x, solid, 'SweptSolid'), S(node.name), E('ELEMENT'), E('INTERNAL'), $])
  storey.spaces.push(space)
  if (p.floorFinish) x.associate(space, x.doc.getMaterial(p.floorFinish))
  const q = x.geometry.get(node.id)?.quantities
  const area = q?.area ?? Math.abs(polygonArea(pts))
  const perimeter = q?.perimeter ?? polygonPerimeter(pts)
  x.quantities(space, 'Qto_SpaceBaseQuantities', {
    length: { Height: height, GrossPerimeter: perimeter },
    area: { NetFloorArea: area, GrossFloorArea: area },
    volume: { NetVolume: area * height, GrossVolume: area * height },
  })
  x.pset(space, 'Pset_SpaceCommon', { Reference: p.number || null, IsExternal: false })
  x.pset(space, 'CadSandbox_Room', { Usage: p.usage })
  x.importedPsets(space, node, ['Pset_SpaceCommon', 'CadSandbox_Room'])
}
