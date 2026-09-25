// IFC4 export (ISO 10303-21 text, Reference View flavored). Spatial structure from levels, walls as
// swept solids with openings/doors/windows, slabs and spaces as extrusions, everything else as
// triangulated face sets; materials, colors, property sets and base quantities.
import type { AnyNode, CadDocument, MaterialDef, NodeType } from '@cadsandbox/doc'
import { TYPE_DEFAULT_MATERIAL, invertMatrix, multiplyMatrices, translationMatrix } from '@cadsandbox/doc'
import type { GeometryService } from '@cadsandbox/geometry'
import type { ExportContext, ExportOptions, ExportResult } from '../api'
import { blobOf, safeFileName } from '../util/bytes'
import { hash128 } from '../util/hash'
import { $, E, I, L, R, S, STAR, StepWriter, T, ifcGuid, ifcValue, isIfcGuid, randomIfcGuid } from './ifc-step'
import { writeOpeningless, writeSlab, writeSpace, writeTessellated, writeWall } from './ifc-elements'

export interface Storey {
  ref: string
  placement: string
  /** storey placement as a world matrix (translation to its elevation) */
  world: Float64Array
  inv: Float64Array
  elevation: number
  height: number
  contained: string[]
  spaces: string[]
}

export type PropValue = string | number | boolean | null

/** Shared state for element writers. */
export class IfcExport {
  readonly w = new StepWriter()
  readonly doc: CadDocument
  readonly geometry: GeometryService
  readonly oh: string
  readonly bodyCtx: string
  readonly axisCtx: string
  readonly storeys = new Map<string | null, Storey>()
  private readonly seed: string
  private readonly project: string
  private readonly site: string
  private readonly building: string
  private readonly buildingPl: string
  private readonly materials = new Map<string, { ref: string; style: string; elements: string[] }>()
  private readonly layerSets: { usage: string; elements: string[] }[] = []
  private readonly psetRels: { pset: string; elements: string[] }[] = []

  constructor(
    readonly ctx: ExportContext,
    readonly opts: ExportOptions,
  ) {
    this.doc = ctx.doc
    this.geometry = ctx.geometry
    const w = this.w
    const meta = this.doc.meta
    this.seed = `${meta.createdAt}:${meta.name}`
    const person = w.add('IFCPERSON', [$, $, S(''), $, $, $, $, $])
    const org = w.add('IFCORGANIZATION', [$, S('CadSandbox'), $, $, $])
    const po = w.add('IFCPERSONANDORGANIZATION', [person, org, $])
    const app = w.add('IFCAPPLICATION', [org, S('0.1'), S('CadSandbox'), S('CadSandbox')])
    this.oh = w.add('IFCOWNERHISTORY', [po, app, $, E('ADDED'), $, $, $, I(Math.floor(Date.now() / 1000))])
    const units = w.add('IFCUNITASSIGNMENT', [
      L([
        w.add('IFCSIUNIT', [STAR, E('LENGTHUNIT'), $, E('METRE')]),
        w.add('IFCSIUNIT', [STAR, E('AREAUNIT'), $, E('SQUARE_METRE')]),
        w.add('IFCSIUNIT', [STAR, E('VOLUMEUNIT'), $, E('CUBIC_METRE')]),
        w.add('IFCSIUNIT', [STAR, E('PLANEANGLEUNIT'), $, E('RADIAN')]),
      ]),
    ])
    const wcs = w.axis3([0, 0, 0])
    const north = meta.geo ? [-Math.sin(meta.geo.northAngle), Math.cos(meta.geo.northAngle)] : [0, 1]
    const model = w.add('IFCGEOMETRICREPRESENTATIONCONTEXT', [$, S('Model'), I(3), R(1e-5), wcs, w.dir(north)])
    this.bodyCtx = w.add('IFCGEOMETRICREPRESENTATIONSUBCONTEXT', [S('Body'), S('Model'), STAR, STAR, STAR, STAR, model, $, E('MODEL_VIEW'), $])
    this.axisCtx = w.add('IFCGEOMETRICREPRESENTATIONSUBCONTEXT', [S('Axis'), S('Model'), STAR, STAR, STAR, STAR, model, $, E('GRAPH_VIEW'), $])
    this.project = w.add('IFCPROJECT', [S(this.guid('project')), this.oh, S(meta.name || 'Project'), $, $, $, $, L([model]), units])
    const sitePl = w.add('IFCLOCALPLACEMENT', [$, wcs])
    const geo = meta.geo
    const dms = (deg: number) => {
      const sign = deg < 0 ? -1 : 1
      let a = Math.abs(deg)
      const d = Math.floor(a)
      a = (a - d) * 60
      const m = Math.floor(a)
      a = (a - m) * 60
      const s = Math.floor(a)
      const us = Math.round((a - s) * 1e6)
      return L([I(sign * d), I(sign * m), I(sign * s), I(sign * us)])
    }
    this.site = w.add('IFCSITE', [S(this.guid('site')), this.oh, S('Site'), $, $, sitePl, $, $, E('ELEMENT'), geo ? dms(geo.latitude) : $, geo ? dms(geo.longitude) : $, geo ? R(0) : $, $, $])
    this.buildingPl = w.add('IFCLOCALPLACEMENT', [sitePl, wcs])
    this.building = w.add('IFCBUILDING', [S(this.guid('building')), this.oh, S(meta.name || 'Building'), $, $, this.buildingPl, $, $, E('ELEMENT'), $, $, $])
    const levels = this.doc.levels()
    for (const lv of levels) {
      const elevation = this.doc.getWorldPosition(lv.id)[2]
      this.storeys.set(lv.id, this.makeStorey(lv.name, elevation, lv.params.height, this.guidFor(lv, 'storey')))
    }
    if (!levels.length) this.storeys.set(null, this.makeStorey('Level 0', 0, 3, this.guid('storey:default')))
  }

  private makeStorey(name: string, elevation: number, height: number, guid: string): Storey {
    const placement = this.w.add('IFCLOCALPLACEMENT', [this.buildingPl, this.w.axis3([0, 0, elevation])])
    const ref = this.w.add('IFCBUILDINGSTOREY', [S(guid), this.oh, S(name), $, $, placement, $, $, E('ELEMENT'), R(elevation)])
    const world = translationMatrix([0, 0, elevation])
    return { ref, placement, world, inv: invertMatrix(world), elevation, height, contained: [], spaces: [] }
  }

  /** Storey of a node; elements outside any level go to the building (placement at elevation 0). */
  storeyOf(nodeId: string): Storey {
    const lv = this.doc.getLevelOf(nodeId)
    const s = this.storeys.get(lv) ?? this.storeys.get(null)
    if (s) return s
    const world = translationMatrix([0, 0, 0])
    const orphan: Storey = { ref: this.building, placement: this.buildingPl, world, inv: world, elevation: 0, height: 3, contained: [], spaces: [] }
    this.storeys.set(null, orphan)
    return orphan
  }

  guid(role: string): string {
    return ifcGuid(hash128(`${this.seed}|${role}`))
  }
  /** Stable GlobalId per node (reuses an imported IFC GlobalId). */
  guidFor(node: AnyNode, role = 'element'): string {
    const imported = (node.meta?.ifc as { globalId?: unknown } | undefined)?.globalId
    if (role === 'element' && isIfcGuid(imported)) return imported
    return this.guid(`${node.id}|${role}`)
  }
  fresh(): string {
    return randomIfcGuid()
  }

  // ---------------------------------------------------------------- materials & styles
  materialDefOf(node: AnyNode, fallback?: string | null): MaterialDef | undefined {
    const id = fallback ?? node.material ?? TYPE_DEFAULT_MATERIAL[node.type] ?? 'mat-default'
    return this.doc.getMaterial(id) ?? this.doc.getMaterial('mat-default')
  }

  material(def: MaterialDef | undefined): { ref: string; style: string; elements: string[] } {
    const key = def?.id ?? 'mat-default'
    let m = this.materials.get(key)
    if (!m) {
      const name = def?.name ?? 'Default'
      const ref = this.w.add('IFCMATERIAL', [S(name), $, S(def?.category ?? 'generic')])
      const hex = (def?.color ?? '#cccccc').replace('#', '')
      const rgb = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      const colour = this.w.add('IFCCOLOURRGB', [$, R(rgb[0]!), R(rgb[1]!), R(rgb[2]!)])
      const transparency = def ? Math.max(1 - def.opacity, def.transmission > 0.5 ? 0.6 : 0) : 0
      const shading = this.w.add('IFCSURFACESTYLESHADING', [colour, R(transparency)])
      const style = this.w.add('IFCSURFACESTYLE', [S(name), E('BOTH'), L([shading])])
      m = { ref, style, elements: [] }
      this.materials.set(key, m)
    }
    return m
  }

  styled(item: string, def: MaterialDef | undefined): void {
    this.w.add('IFCSTYLEDITEM', [item, L([this.material(def).style]), $])
  }

  associate(element: string, def: MaterialDef | undefined): void {
    this.material(def).elements.push(element)
  }

  layerSet(element: string, layers: { def: MaterialDef | undefined; thickness: number; name: string }[], offset: number): void {
    const refs = layers.map((l) => this.w.add('IFCMATERIALLAYER', [this.material(l.def).ref, R(l.thickness), $, S(l.name), $, $, $]))
    const set = this.w.add('IFCMATERIALLAYERSET', [L(refs), S('Wall layers'), $])
    const usage = this.w.add('IFCMATERIALLAYERSETUSAGE', [set, E('AXIS2'), E('POSITIVE'), R(offset), $])
    this.layerSets.push({ usage, elements: [element] })
  }

  // ---------------------------------------------------------------- properties & quantities
  pset(element: string, name: string, props: Record<string, PropValue>, types: Record<string, string> = {}): void {
    const items: string[] = []
    for (const [k, v] of Object.entries(props)) {
      const val = types[k] && typeof v === 'number' ? T(types[k]!, R(v)) : ifcValue(v)
      if (val) items.push(this.w.add('IFCPROPERTYSINGLEVALUE', [S(k), $, val, $]))
    }
    if (!items.length) return
    const ps = this.w.add('IFCPROPERTYSET', [S(this.fresh()), this.oh, S(name), $, L(items)])
    this.psetRels.push({ pset: ps, elements: [element] })
  }

  quantities(element: string, name: string, q: { length?: Record<string, number>; area?: Record<string, number>; volume?: Record<string, number> }): void {
    const items: string[] = []
    for (const [k, v] of Object.entries(q.length ?? {})) if (Number.isFinite(v)) items.push(this.w.add('IFCQUANTITYLENGTH', [S(k), $, $, R(v), $]))
    for (const [k, v] of Object.entries(q.area ?? {})) if (Number.isFinite(v)) items.push(this.w.add('IFCQUANTITYAREA', [S(k), $, $, R(v), $]))
    for (const [k, v] of Object.entries(q.volume ?? {})) if (Number.isFinite(v)) items.push(this.w.add('IFCQUANTITYVOLUME', [S(k), $, $, R(v), $]))
    if (!items.length) return
    const eq = this.w.add('IFCELEMENTQUANTITY', [S(this.fresh()), this.oh, S(name), $, $, L(items)])
    this.psetRels.push({ pset: eq, elements: [element] })
  }

  /** Round-trip property sets that came from an IFC import (except the ones we regenerate). */
  importedPsets(element: string, node: AnyNode, skip: string[]): void {
    const psets = (node.meta?.ifc as { psets?: Record<string, Record<string, PropValue>> } | undefined)?.psets
    if (!psets) return
    for (const [name, props] of Object.entries(psets)) if (!skip.includes(name) && !name.startsWith('Qto_')) this.pset(element, name, props)
  }

  // ---------------------------------------------------------------- traversal
  private visit(id: string, depth: number): void {
    if (depth > 64) return
    const node = this.doc.getNode(id) as AnyNode | undefined
    if (!node || !node.visible) return
    if (!this.doc.isEffectivelyVisible(id)) return
    if (this.geometry.isConsumed(id)) return
    this.element(node)
    for (const c of this.doc.getChildren(id)) this.visit(c, depth + 1)
  }

  private element(node: AnyNode): unknown {
    const t: NodeType = node.type
    switch (t) {
      case 'wall':
        return writeWall(this, node as AnyNode & { type: 'wall' })
      case 'slab':
        return writeSlab(this, node as AnyNode & { type: 'slab' })
      case 'room':
        return writeSpace(this, node as AnyNode & { type: 'room' })
      case 'roof':
        return writeTessellated(this, node, 'IFCROOF', [E(ROOF[(node as AnyNode & { type: 'roof' }).params.kind] ?? 'NOTDEFINED')], 'Pset_RoofCommon', { IsExternal: true })
      case 'stair': {
        const p = (node as AnyNode & { type: 'stair' }).params
        return writeTessellated(this, node, 'IFCSTAIR', [E(STAIR[p.kind] ?? 'NOTDEFINED')], 'Pset_StairCommon', { NumberOfRiser: p.riserCount || null, TreadLength: p.treadDepth })
      }
      case 'column':
        return writeTessellated(this, node, 'IFCCOLUMN', [E('COLUMN')], 'Pset_ColumnCommon', { LoadBearing: true })
      case 'beam':
        return writeTessellated(this, node, 'IFCBEAM', [E('BEAM')], 'Pset_BeamCommon', { LoadBearing: true })
      case 'railing':
        return writeTessellated(this, node, 'IFCRAILING', [E('GUARDRAIL')], 'Pset_RailingCommon', { Height: (node as AnyNode & { type: 'railing' }).params.height })
      case 'furniture':
        return writeTessellated(this, node, 'IFCFURNISHINGELEMENT', [], null, {})
      case 'opening':
        // hosted by a wall: written with the wall; orphans become proxies
        if (this.doc.getNode(node.parent)?.type !== 'wall') writeOpeningless(this, node)
        return
      case 'mesh': {
        // meshes that came from an IFC import keep their entity type
        const kept = keptIfcType(node)
        if (kept) return writeTessellated(this, node, kept.entity, kept.tail, null, {})
        return writeTessellated(this, node, 'IFCBUILDINGELEMENTPROXY', [E('ELEMENT')], null, {})
      }
      case 'primitive':
      case 'shape':
      case 'revolve':
      case 'loft':
      case 'sweep':
      case 'boolean':
      case 'terrain':
      case 'instance':
        return writeTessellated(this, node, 'IFCBUILDINGELEMENTPROXY', [E('ELEMENT')], null, {})
      case 'text':
        if ((node as AnyNode & { type: 'text' }).params.depth > 0) writeTessellated(this, node, 'IFCBUILDINGELEMENTPROXY', [E('ELEMENT')], null, {})
        return
      default:
        return // levels, groups, lights, images, sections, 2D drafting
    }
  }

  run(): string {
    const roots = this.opts.selection?.length ? this.doc.topLevel(this.opts.selection) : [...this.doc.getChildren(null)]
    for (const r of roots) this.visit(r, 0)
    const w = this.w
    const storeyRefs = [...this.storeys.values()].filter((s) => s.ref !== this.building)
    w.add('IFCRELAGGREGATES', [S(this.guid('rel:project')), this.oh, $, $, this.project, L([this.site])])
    w.add('IFCRELAGGREGATES', [S(this.guid('rel:site')), this.oh, $, $, this.site, L([this.building])])
    if (storeyRefs.length) w.add('IFCRELAGGREGATES', [S(this.guid('rel:building')), this.oh, $, $, this.building, L(storeyRefs.map((s) => s.ref))])
    for (const s of this.storeys.values()) {
      if (s.contained.length) w.add('IFCRELCONTAINEDINSPATIALSTRUCTURE', [S(this.fresh()), this.oh, $, $, L(s.contained), s.ref])
      if (s.spaces.length) w.add('IFCRELAGGREGATES', [S(this.fresh()), this.oh, $, $, s.ref, L(s.spaces)])
    }
    for (const m of this.materials.values()) if (m.elements.length) w.add('IFCRELASSOCIATESMATERIAL', [S(this.fresh()), this.oh, $, $, L(m.elements), m.ref])
    for (const l of this.layerSets) w.add('IFCRELASSOCIATESMATERIAL', [S(this.fresh()), this.oh, $, $, L(l.elements), l.usage])
    for (const p of this.psetRels) w.add('IFCRELDEFINESBYPROPERTIES', [S(this.fresh()), this.oh, $, $, L(p.elements), p.pset])
    const now = new Date().toISOString().slice(0, 19)
    return w.toString({ fileName: `${safeFileName(this.doc.meta.name, 'design')}.ifc`, author: '', organization: '', description: 'ViewDefinition [ReferenceView_V1.2]', timestamp: now })
  }

  /** Transform from node world matrix into storey-local coordinates. */
  local(storey: Storey, world: Float64Array): Float64Array {
    return multiplyMatrices(storey.inv, world)
  }
}

/** IFC4 element types (attribute layout: …, Tag, PredefinedType) safe to write for imported meshes. */
const KEEP_TYPES = new Set([
  'IfcWall', 'IfcWallStandardCase', 'IfcSlab', 'IfcRoof', 'IfcStair', 'IfcStairFlight', 'IfcRamp', 'IfcRampFlight', 'IfcColumn', 'IfcBeam',
  'IfcMember', 'IfcPlate', 'IfcRailing', 'IfcCovering', 'IfcCurtainWall', 'IfcFooting', 'IfcPile', 'IfcChimney', 'IfcShadingDevice',
  'IfcFurniture', 'IfcSanitaryTerminal', 'IfcLightFixture', 'IfcBuildingElementProxy',
])

function keptIfcType(node: AnyNode): { entity: string; tail: string[] } | null {
  const ifc = node.meta?.ifc as { type?: string; predefinedType?: string } | undefined
  const type = ifc?.type
  if (!type) return null
  const pre = ifc.predefinedType && /^[A-Z_]+$/.test(ifc.predefinedType) ? ifc.predefinedType : 'NOTDEFINED'
  if (type === 'IfcDoor' || type === 'IfcWindow') return { entity: type.toUpperCase(), tail: [$, $, E(pre), E('NOTDEFINED'), $] }
  if (type === 'IfcFurnishingElement') return { entity: 'IFCFURNISHINGELEMENT', tail: [] }
  return KEEP_TYPES.has(type) ? { entity: type.toUpperCase(), tail: [E(pre)] } : null
}

const ROOF: Record<string, string> = { flat: 'FLAT_ROOF', shed: 'SHED_ROOF', gable: 'GABLE_ROOF', hip: 'HIP_ROOF', mansard: 'MANSARD_ROOF', gambrel: 'GAMBREL_ROOF', pyramid: 'PAVILION_ROOF' }
const STAIR: Record<string, string> = { straight: 'STRAIGHT_RUN_STAIR', 'l-shape': 'QUARTER_TURN_STAIR', 'u-shape': 'HALF_TURN_STAIR', spiral: 'SPIRAL_STAIR' }

export async function exportIfc(ctx: ExportContext, opts: ExportOptions): Promise<ExportResult> {
  await ctx.geometry.idle()
  const text = new IfcExport(ctx, opts).run()
  return { blob: blobOf([text], 'application/x-step'), fileName: `${safeFileName(ctx.doc.meta.name, 'design')}.ifc` }
}
