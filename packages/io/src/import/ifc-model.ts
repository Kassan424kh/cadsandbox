// Read access to an open web-ifc model: typed value helpers, placements (own resolver, model units,
// Z-up), unit scale, relationship indexes and property sets — all computed in one pass each.
import type { IfcAPI } from 'web-ifc'
import type { WebIfcModule } from '../wasm'

export type Mat = Float64Array // column-major 4×4 (same layout as three.js / doc math)
type Line = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export const val = (x: unknown): unknown => (x && typeof x === 'object' && 'value' in (x as object) ? (x as { value: unknown }).value : x)
export const num = (x: unknown): number | null => {
  const v = val(x)
  return typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null
}
export const str = (x: unknown): string | null => {
  const v = val(x)
  return typeof v === 'string' ? v : v === null || v === undefined ? null : String(v)
}
export const ref = (x: unknown): number | null => {
  if (!x || typeof x !== 'object') return typeof x === 'number' ? x : null
  const o = x as { type?: number; value?: unknown; expressID?: number }
  if (o.type === 5 && typeof o.value === 'number') return o.value
  if (typeof o.expressID === 'number') return o.expressID
  return null
}
export const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : x === null || x === undefined ? [] : [x])

export function identity(): Mat {
  const m = new Float64Array(16)
  m[0] = m[5] = m[10] = m[15] = 1
  return m
}
export function mul(a: Mat, b: Mat): Mat {
  const o = new Float64Array(16)
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0
      for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!
      o[c * 4 + r] = s
    }
  return o
}
export function apply(m: Mat, x: number, y: number, z: number): [number, number, number] {
  return [m[0]! * x + m[4]! * y + m[8]! * z + m[12]!, m[1]! * x + m[5]! * y + m[9]! * z + m[13]!, m[2]! * x + m[6]! * y + m[10]! * z + m[14]!]
}
export function applyDir(m: Mat, x: number, y: number, z: number): [number, number, number] {
  return [m[0]! * x + m[4]! * y + m[8]! * z, m[1]! * x + m[5]! * y + m[9]! * z, m[2]! * x + m[6]! * y + m[10]! * z]
}
function norm3(v: number[]): [number, number, number] {
  const l = Math.hypot(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0) || 1
  return [(v[0] ?? 0) / l, (v[1] ?? 0) / l, (v[2] ?? 0) / l]
}

const PREFIX: Record<string, number> = { EXA: 1e18, PETA: 1e15, TERA: 1e12, GIGA: 1e9, MEGA: 1e6, KILO: 1e3, HECTO: 1e2, DECA: 1e1, DECI: 1e-1, CENTI: 1e-2, MILLI: 1e-3, MICRO: 1e-6, NANO: 1e-9 }

export interface PsetValues {
  [pset: string]: Record<string, string | number | boolean | null>
}

export class IfcModel {
  readonly scale: number
  readonly schema: string
  /** element → spatial structure (containment) */
  readonly container = new Map<number, number>()
  /** child → parent (aggregation / nesting) */
  readonly aggregate = new Map<number, number>()
  /** building element → opening elements */
  readonly voids = new Map<number, number[]>()
  /** opening → filling element (door/window) */
  readonly fills = new Map<number, number>()
  /** filling element → opening, opening → host element */
  private readonly filledBy = new Map<number, number>()
  private readonly hostOf = new Map<number, number>()
  private readonly psetRel = new Map<number, number[]>()
  private readonly typeRel = new Map<number, number>()
  private readonly matRel = new Map<number, number>()
  private readonly lines = new Map<number, Line | null>()
  private readonly placements = new Map<number, Mat>()
  private readonly psetCache = new Map<number, [string, Record<string, string | number | boolean | null>] | null>()

  constructor(
    readonly api: IfcAPI,
    readonly W: WebIfcModule,
    readonly id: number,
  ) {
    this.schema = String(api.GetModelSchema(id) ?? '')
    this.scale = this.lengthUnit()
    this.index()
  }

  line(id: number | null | undefined): Line | null {
    if (!id) return null
    if (!this.lines.has(id)) {
      let l: Line | null = null
      try {
        l = this.api.GetLine(this.id, id, false) as Line
      } catch {
        l = null
      }
      this.lines.set(id, l)
    }
    return this.lines.get(id)!
  }

  ids(type: number, inherited = false): number[] {
    const v = this.api.GetLineIDsWithType(this.id, type, inherited) as unknown as { size(): number; get(i: number): number }
    const out: number[] = []
    for (let i = 0; i < v.size(); i++) out.push(v.get(i))
    return out
  }

  typeName(id: number): string {
    const l = this.line(id)
    const ctor = l?.constructor?.name as string | undefined
    if (ctor && /^Ifc[A-Z]/.test(ctor)) return ctor
    try {
      const code = this.api.GetLineType(this.id, id) as number
      const n = String(this.api.GetNameFromTypeCode(code) ?? '')
      return n ? `Ifc${n.slice(3, 4)}${n.slice(4).toLowerCase()}` : 'IfcProduct'
    } catch {
      return 'IfcProduct'
    }
  }

  private lengthUnit(): number {
    const W = this.W
    for (const pid of this.ids(W.IFCPROJECT)) {
      const project = this.line(pid)
      const ua = this.line(ref(project?.UnitsInContext))
      for (const u of list(ua?.Units)) {
        const unit = this.line(ref(u))
        if (!unit || str(unit.UnitType) !== 'LENGTHUNIT') continue
        if (unit.Prefix !== undefined) {
          // IfcSIUnit: METRE with optional prefix (MILLI, CENTI…)
          const prefix = str(unit.Prefix)
          return prefix ? (PREFIX[prefix] ?? 1) : 1
        }
        // conversion based unit (inch / foot)
        const factor = this.line(ref(unit.ConversionFactor))
        const v = num(factor?.ValueComponent)
        const base = this.line(ref(factor?.UnitComponent))
        const basePrefix = str(base?.Prefix)
        if (v) return v * (basePrefix ? (PREFIX[basePrefix] ?? 1) : 1)
      }
    }
    return 1
  }

  private index(): void {
    const W = this.W
    const each = (type: number, fn: (l: Line) => void) => {
      for (const id of this.ids(type)) {
        const l = this.api.GetLine(this.id, id, false) as Line
        if (l) fn(l)
      }
    }
    each(W.IFCRELCONTAINEDINSPATIALSTRUCTURE, (l) => {
      const s = ref(l.RelatingStructure)
      if (s) for (const e of list(l.RelatedElements)) this.container.set(ref(e)!, s)
    })
    const agg = (l: Line) => {
      const p = ref(l.RelatingObject)
      if (p) for (const e of list(l.RelatedObjects)) this.aggregate.set(ref(e)!, p)
    }
    each(W.IFCRELAGGREGATES, agg)
    if (W.IFCRELNESTS) each(W.IFCRELNESTS, agg)
    each(W.IFCRELVOIDSELEMENT, (l) => {
      const host = ref(l.RelatingBuildingElement),
        op = ref(l.RelatedOpeningElement)
      if (host && op) {
        this.voids.set(host, [...(this.voids.get(host) ?? []), op])
        this.hostOf.set(op, host)
      }
    })
    each(W.IFCRELFILLSELEMENT, (l) => {
      const op = ref(l.RelatingOpeningElement),
        el = ref(l.RelatedBuildingElement)
      if (op && el) {
        this.fills.set(op, el)
        this.filledBy.set(el, op)
      }
    })
    each(W.IFCRELDEFINESBYPROPERTIES, (l) => {
      const p = ref(l.RelatingPropertyDefinition)
      if (p) for (const e of list(l.RelatedObjects)) this.psetRel.set(ref(e)!, [...(this.psetRel.get(ref(e)!) ?? []), p])
    })
    each(W.IFCRELDEFINESBYTYPE, (l) => {
      const t = ref(l.RelatingType)
      if (t) for (const e of list(l.RelatedObjects)) this.typeRel.set(ref(e)!, t)
    })
    each(W.IFCRELASSOCIATESMATERIAL, (l) => {
      const m = ref(l.RelatingMaterial)
      if (m) for (const e of list(l.RelatedObjects)) this.matRel.set(ref(e)!, m)
    })
  }

  // ---------------------------------------------------------------- placements (model units)
  point(id: unknown): number[] {
    const p = this.line(ref(id))
    return list(p?.Coordinates).map((c) => num(c) ?? 0)
  }
  direction(id: unknown, fallback: number[]): number[] {
    const d = this.line(ref(id))
    const r = list(d?.DirectionRatios).map((c) => num(c) ?? 0)
    return r.length ? r : fallback
  }
  /** IfcAxis2Placement3D / IfcAxis2Placement2D → matrix (model units). */
  axis3(id: unknown): Mat {
    const a = this.line(ref(id))
    const m = identity()
    if (!a) return m
    const loc = this.point(a.Location)
    if (loc.length === 2) {
      const x = norm3([...this.direction(a.RefDirection, [1, 0]).slice(0, 2), 0])
      m.set([x[0], x[1], 0, 0, -x[1], x[0], 0, 0, 0, 0, 1, 0, loc[0] ?? 0, loc[1] ?? 0, 0, 1])
      return m
    }
    const z = norm3(this.direction(a.Axis, [0, 0, 1]))
    let x = a.RefDirection ? this.direction(a.RefDirection, [1, 0, 0]) : Math.abs(z[0]) > 0.999 ? [0, 1, 0] : [1, 0, 0]
    if (x.length === 2) x = [x[0]!, x[1]!, 0]
    const d = x[0]! * z[0] + x[1]! * z[1] + x[2]! * z[2]
    const xo = norm3([x[0]! - d * z[0], x[1]! - d * z[1], x[2]! - d * z[2]])
    const y = [z[1] * xo[2] - z[2] * xo[1], z[2] * xo[0] - z[0] * xo[2], z[0] * xo[1] - z[1] * xo[0]]
    m.set([xo[0], xo[1], xo[2], 0, y[0]!, y[1]!, y[2]!, 0, z[0], z[1], z[2], 0, loc[0] ?? 0, loc[1] ?? 0, loc[2] ?? 0, 1])
    return m
  }
  /** World matrix of an IfcObjectPlacement (model units). */
  placement(id: number | null): Mat {
    if (!id) return identity()
    const cached = this.placements.get(id)
    if (cached) return cached
    this.placements.set(id, identity()) // cycle guard
    const p = this.line(id)
    let m = identity()
    if (p && p.RelativePlacement !== undefined) {
      const parent = ref(p.PlacementRelTo)
      m = mul(parent ? this.placement(parent) : identity(), this.axis3(p.RelativePlacement))
    }
    this.placements.set(id, m)
    return m
  }
  /** World matrix of a product's ObjectPlacement, translation scaled to meters. */
  productMatrix(id: number): Mat {
    const m = new Float64Array(this.placement(ref(this.line(id)?.ObjectPlacement)))
    m[12] = m[12]! * this.scale
    m[13] = m[13]! * this.scale
    m[14] = m[14]! * this.scale
    return m
  }

  // ---------------------------------------------------------------- semantics
  storeyOf(id: number, guard = 0): number | null {
    if (guard > 32) return null
    const W = this.W
    const c = this.container.get(id)
    if (c) {
      const t = this.api.GetLineType(this.id, c)
      if (t === W.IFCBUILDINGSTOREY) return c
      return this.storeyOf(c, guard + 1)
    }
    const a = this.aggregate.get(id)
    if (a) {
      const t = this.api.GetLineType(this.id, a)
      if (t === W.IFCBUILDINGSTOREY) return a
      return this.storeyOf(a, guard + 1)
    }
    // doors/windows: via the opening they fill → host element
    const op = this.filledBy.get(id)
    const host = op !== undefined ? this.hostOf.get(op) : undefined
    return host !== undefined ? this.storeyOf(host, guard + 1) : null
  }

  materialName(id: number): string | null {
    const m = this.line(this.matRel.get(id) ?? this.matRel.get(this.typeRel.get(id) ?? -1))
    if (!m) return null
    const direct = str(m.Name)
    if (direct && m.ForLayerSet === undefined && m.MaterialLayers === undefined) return direct
    const set = this.line(ref(m.ForLayerSet)) ?? m
    const layers = list(set.MaterialLayers)
      .map((l) => str(this.line(ref(this.line(ref(l))?.Material))?.Name))
      .filter(Boolean)
    if (layers.length) return layers.join(' / ')
    const mats = list(m.Materials)
      .map((x) => str(this.line(ref(x))?.Name))
      .filter(Boolean)
    return mats.length ? mats.join(' / ') : direct
  }

  typeObjectName(id: number): string | null {
    return str(this.line(this.typeRel.get(id))?.Name)
  }

  private parsePset(id: number): [string, Record<string, string | number | boolean | null>] | null {
    if (this.psetCache.has(id)) return this.psetCache.get(id)!
    const p = this.line(id)
    let out: [string, Record<string, string | number | boolean | null>] | null = null
    if (p) {
      const name = str(p.Name) ?? 'Properties'
      const props: Record<string, string | number | boolean | null> = {}
      for (const r of list(p.HasProperties)) {
        const prop = this.line(ref(r))
        const pn = str(prop?.Name)
        if (!prop || !pn) continue
        const nv = prop.NominalValue !== undefined ? val(prop.NominalValue) : list(prop.EnumerationValues).map(val).join(', ')
        props[pn] = typeof nv === 'number' || typeof nv === 'boolean' || typeof nv === 'string' ? nv : nv === undefined ? null : String(nv)
      }
      for (const q of list(p.Quantities)) {
        const qty = this.line(ref(q))
        const qn = str(qty?.Name)
        if (!qty || !qn) continue
        props[qn] = num(qty.LengthValue ?? qty.AreaValue ?? qty.VolumeValue ?? qty.CountValue ?? qty.WeightValue ?? qty.TimeValue)
      }
      if (Object.keys(props).length) out = [name, props]
    }
    this.psetCache.set(id, out)
    return out
  }

  psets(id: number): PsetValues {
    const out: PsetValues = {}
    const ids = [...(this.psetRel.get(id) ?? [])]
    const typeId = this.typeRel.get(id)
    if (typeId) for (const h of list(this.line(typeId)?.HasPropertySets)) ids.push(ref(h)!)
    for (const pid of ids) {
      const r = pid ? this.parsePset(pid) : null
      if (r && !out[r[0]]) out[r[0]] = r[1]
    }
    return out
  }

  /** meta.ifc for a product. */
  meta(id: number): Record<string, unknown> {
    const l = this.line(id)
    const out: Record<string, unknown> = { globalId: str(l?.GlobalId), type: this.typeName(id), expressId: id }
    const name = str(l?.Name),
      desc = str(l?.Description),
      ot = str(l?.ObjectType),
      tag = str(l?.Tag),
      ln = str(l?.LongName),
      pt = str(l?.PredefinedType)
    if (name) out.name = name
    if (ln) out.longName = ln
    if (desc) out.description = desc
    if (ot) out.objectType = ot
    if (tag) out.tag = tag
    if (pt && pt !== 'NOTDEFINED') out.predefinedType = pt
    const typeName = this.typeObjectName(id)
    if (typeName) out.typeName = typeName
    const mat = this.materialName(id)
    if (mat) out.material = mat
    const ps = this.psets(id)
    if (Object.keys(ps).length) out.psets = ps
    return { ifc: out }
  }
}
