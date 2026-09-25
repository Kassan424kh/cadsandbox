// DXF import (dxf-parser + HATCH handler): drafting entities → 2D document nodes in the XY plane,
// blocks → components + instances, layers → LayerDefs (ACI/true colors, linetypes, lineweights).
import type { IBlock, IDimensionEntity, IDxf, IEntity, IPoint } from 'dxf-parser'
import type { ComponentDef, HatchPattern, LineType, NodeParamsMap, NodeType, PathPoint, Quat, Transform, Vec2, Vec3 } from '@cadsandbox/doc'
import type { ImportOptions, ImportResult } from '../api'
import { SnapshotBuilder } from '../builder'
import { CSBM_MIME, encodeCSBM, positionBounds } from '../csbm'
import { decodeText, stem } from '../util/bytes'
import { bsplinePath, catmullRomPath, ellipseArcPath, flattenBulged, flattenPath, pointInPolygon, signedArea, TAU } from '../util/geom2d'
import { PATTERN_UNIT_M } from '../export/hatch-patterns'
import { HatchHandler, scanLayerTable, type HatchLoop, type IHatchEntity } from './dxf-parse'
import { insunitsScale, unitScale } from './units'

type E = IEntity & Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const quatZ = (a: number): Quat => [0, 0, Math.sin(a / 2), Math.cos(a / 2)]
const DEG = Math.PI / 180

/** DXF hatch pattern name → document HatchPattern. */
export function mapHatchPattern(name: string): HatchPattern | null {
  const n = name.toUpperCase()
  const table: [RegExp, HatchPattern][] = [
    [/^SOLID$/, 'solid'],
    [/^ANSI31$/, 'ansi31'],
    [/^ANSI32$/, 'ansi32'],
    [/^ANSI3[3-8]$|^STEEL$/, n === 'ANSI37' ? 'ansi37' : 'steel'],
    [/^AR-CONC$|^CONC/, 'concrete'],
    [/^AR-RCONC|^RCONC/, 'reinforced-concrete'],
    [/^AR-B8|^AR-BRSTD|^BRICK|^AR-BRELM/, 'brick'],
    [/^AR-SAND$|^SAND/, 'sand'],
    [/^EARTH/, 'earth'],
    [/^GRAVEL/, 'gravel'],
    [/^INSUL|^BATTING|^AR-INSUL/, 'insulation'],
    [/^AR-PARQ|^WOOD|^AR-HBONE/, 'wood'],
    [/^TIMBER/, 'timber'],
    [/^GLASS|^AR-GLASS/, 'glass'],
    [/^SQUARE|^NET$|^GRID|^AR-RSHKE/, n.startsWith('AR-RSHKE') ? 'tiles' : 'grid'],
    [/^TILE|^AR-TILE/, 'tiles'],
    [/^GRASS|^SWAMP/, 'grass'],
    [/^WATER|^AR-WATER/, 'water'],
    [/^DOTS?$/, 'dots'],
    [/^MASON|^AR-MASON|^KS|^HONEY/, 'masonry'],
  ]
  for (const [re, p] of table) if (re.test(n)) return p
  return null
}

export function mapLineType(name: string | undefined): LineType {
  const n = (name ?? '').toUpperCase()
  if (n.startsWith('HIDDEN')) return 'hidden'
  if (n.startsWith('CENTER')) return 'center'
  if (n.startsWith('DASHDOT') || n.startsWith('PHANTOM') || n.startsWith('BORDER') || n.startsWith('DIVIDE')) return 'dashdot'
  if (n.startsWith('DOT')) return 'dotted'
  if (n.startsWith('DASH') || n.includes('DASHED')) return 'dashed'
  return 'continuous'
}

/** Decode %%-codes and \U+XXXX escapes of TEXT; strip MTEXT formatting. */
export function dxfText(raw: string, mtext = false): string {
  let s = raw ?? ''
  s = s.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
  s = s.replace(/%%([cCdDpP%]|\d{3})/g, (_, c: string) => {
    const k = c.toLowerCase()
    return k === 'c' ? 'Ø' : k === 'd' ? '°' : k === 'p' ? '±' : k === '%' ? '%' : String.fromCharCode(parseInt(c, 10))
  })
  s = s.replace(/%%[uUoOkK]/g, '')
  if (mtext) {
    s = s
      .replace(/\\P/g, '\n')
      .replace(/\\~/g, ' ')
      .replace(/\\S([^;]*);/g, (_, f: string) => f.replace(/[#^]/, '/'))
      .replace(/\\[ACcFfHQTWp][^;\\]*;/g, '')
      .replace(/\\[LlOoKkX]/g, '')
      .replace(/(^|[^\\])[{}]/g, '$1')
      .replace(/\\([{}\\])/g, '$1')
  }
  return s.trim()
}

class DxfConverter {
  private readonly layerIds = new Map<string, string | null>()
  private readonly comps = new Map<string, ComponentDef | null>()
  private readonly faces = new Map<string, { parent: string; def: boolean; layer: string | null; color: string | null; tris: number[] }>()
  private readonly skipped = new Map<string, number>()
  private readonly layerColors = new Map<string, string>()

  constructor(
    private readonly b: SnapshotBuilder,
    private readonly dxf: IDxf,
    private readonly s: number,
    private readonly aci: (i: number) => string,
    private readonly layerExtras: ReturnType<typeof scanLayerTable>,
  ) {}

  // ---------------------------------------------------------------- helpers
  private hex(n: number): string {
    return `#${(n >>> 0).toString(16).padStart(6, '0').slice(-6)}`
  }
  color(e: E): string | null {
    if (e.colorIndex === 0 || e.colorIndex === 256) return null
    if (typeof e.color === 'number' && e.color >= 0) return this.hex(e.color)
    if (typeof e.colorIndex === 'number' && e.colorIndex > 0 && e.colorIndex < 256) return `#${this.aci(e.colorIndex).toLowerCase()}`
    return null
  }
  layer(name: string | undefined): string | null {
    if (!name || name === '0') return null
    if (this.layerIds.has(name)) return this.layerIds.get(name)!
    const t = this.dxf.tables?.layer?.layers?.[name]
    const x = this.layerExtras.get(name)
    let color = '#e6e6e6'
    if (x?.trueColor !== undefined) color = this.hex(x.trueColor)
    else if (t && typeof t.colorIndex === 'number' && Math.abs(t.colorIndex) > 0 && Math.abs(t.colorIndex) < 256) color = `#${this.aci(Math.abs(t.colorIndex)).toLowerCase()}`
    const id = this.b.layer({
      name,
      color,
      visible: t ? t.visible !== false && !t.frozen && (t.colorIndex ?? 1) >= 0 : true,
      locked: !!x?.locked,
      printable: x?.plot !== false,
      lineWeight: x?.lineWeight !== undefined && x.lineWeight > 0 ? x.lineWeight / 100 : 0.25,
      lineType: mapLineType(x?.lineType),
    })
    this.layerIds.set(name, id)
    this.layerColors.set(id, color)
    return id
  }
  /** OCS → WCS for the common mirrored case (extrusion 0,0,-1): x is negated. */
  private mirrored(e: E): boolean {
    const z = e.extrusionDirectionZ ?? e.extrusionDirection?.z ?? e.extrusionZ
    return typeof z === 'number' && z < 0
  }
  private P(p: IPoint | undefined, o: Vec3, mirror = false): Vec2 {
    const x = mirror ? -(p?.x ?? 0) : (p?.x ?? 0)
    return [(x - o[0]) * this.s, ((p?.y ?? 0) - o[1]) * this.s]
  }
  private Z(z: number | undefined, o: Vec3): number {
    return ((z ?? 0) - o[2]) * this.s
  }
  private add<T extends NodeType>(type: T, e: E, parent: string, def: boolean, params: Partial<NodeParamsMap[T]>, t?: Transform, name?: string) {
    const node = this.b.add(type, { name: name ?? `${type[0]!.toUpperCase()}${type.slice(1)}`, parent, t, layer: this.layer(e.layer), color: this.color(e), params } as never, def)
    if (!def) {
      const pts = collectPoints(type, params as Record<string, unknown>)
      if (pts.length) this.b.expand(pts.map((p) => [p[0], p[1], 0] as Vec3), t)
    }
    return node
  }
  private skip(type: string) {
    this.skipped.set(type, (this.skipped.get(type) ?? 0) + 1)
  }

  // ---------------------------------------------------------------- blocks
  component(name: string): ComponentDef | null {
    if (this.comps.has(name)) return this.comps.get(name)!
    const blk: IBlock | undefined = this.dxf.blocks?.[name]
    this.comps.set(name, null) // recursion guard
    if (!blk) {
      this.b.warn(`Block "${name}" is referenced but not defined.`)
      return null
    }
    const { def, root } = this.b.component(name, 'DXF block')
    const base: Vec3 = [blk.position?.x ?? 0, blk.position?.y ?? 0, blk.position?.z ?? 0]
    for (const e of blk.entities ?? []) this.entity(e as E, root.id, true, base)
    this.comps.set(name, def)
    return def
  }

  // ---------------------------------------------------------------- entities
  entity(e: E, parent: string, def: boolean, o: Vec3): void {
    if (e.inPaperSpace) return this.skip('paper space')
    const m = this.mirrored(e)
    switch (e.type) {
      case 'LINE': {
        const [a, b] = e.vertices as IPoint[]
        if (!a || !b) return
        const z = this.Z(a.z, o)
        this.add('line', e, parent, def, { a: this.P(a, o), b: this.P(b, o) }, z ? tz(z) : undefined, 'Line')
        return
      }
      case 'LWPOLYLINE': {
        const vs = (e.vertices ?? []) as { x: number; y: number; bulge?: number }[]
        if (vs.length < 2) return
        const points = vs.map((v) => this.P(v as IPoint, o, m))
        const bulges = vs.map((v) => (m ? -(v.bulge ?? 0) : (v.bulge ?? 0)))
        const z = this.Z((m ? -1 : 1) * (e.elevation ?? 0), o)
        this.add('polyline', e, parent, def, { points, ...(bulges.some((x) => x) ? { bulges } : {}), closed: !!e.shape }, z ? tz(z) : undefined, 'Polyline')
        return
      }
      case 'POLYLINE':
        return this.polyline(e, parent, def, o, m)
      case 'CIRCLE': {
        const c = this.P(e.center, o, m)
        this.add('circle', e, parent, def, { radius: e.radius * this.s }, tf(c, this.Z(e.center?.z, o)), 'Circle')
        return
      }
      case 'ARC': {
        const c = this.P(e.center, o, m)
        let start = e.startAngle as number,
          end = e.endAngle as number
        if (m) [start, end] = [Math.PI - end, Math.PI - start]
        this.add('arc', e, parent, def, { radius: e.radius * this.s, start: norm(start), end: norm(end) }, tf(c, this.Z(e.center?.z, o)), 'Arc')
        return
      }
      case 'ELLIPSE': {
        const c = this.P(e.center, o)
        const maj = e.majorAxisEndPoint as IPoint
        const rx = Math.hypot(maj.x, maj.y) * this.s
        const rot = Math.atan2(maj.y, maj.x)
        const ry = rx * (e.axisRatio ?? 1)
        const s0 = e.startAngle ?? 0,
          s1 = e.endAngle ?? TAU
        const full = Math.abs(Math.abs(s1 - s0) - TAU) < 1e-6 || (Math.abs(s0) < 1e-9 && Math.abs(s1 - TAU) < 1e-6)
        if (full) this.add('ellipse', e, parent, def, { rx, ry }, { p: [c[0], c[1], this.Z(e.center?.z, o)], r: quatZ(rot), s: [1, 1, 1] }, 'Ellipse')
        else this.add('spline', e, parent, def, { path: { contours: [{ closed: false, points: ellipseArcPath(c[0], c[1], rx, ry, rot, s0, s1) }] } }, undefined, 'Elliptical arc')
        return
      }
      case 'SPLINE': {
        const ctrl = ((e.controlPoints ?? []) as IPoint[]).map((p) => this.P(p, o))
        const fit = ((e.fitPoints ?? []) as IPoint[]).map((p) => this.P(p, o))
        let points: PathPoint[]
        if (ctrl.length >= 2) points = bsplinePath(e.degreeOfSplineCurve ?? 3, e.knotValues ?? [], ctrl, undefined, !!e.closed)
        else if (fit.length >= 2) points = catmullRomPath(fit, !!e.closed)
        else return
        this.add('spline', e, parent, def, { path: { contours: [{ closed: !!e.closed, points }] } }, undefined, 'Spline')
        return
      }
      case 'TEXT': {
        const aligned = (e.halign || e.valign) && e.endPoint
        const p = this.P(aligned ? e.endPoint : e.startPoint, o)
        const h = e.halign ?? 0
        const align = h === 1 || h === 4 ? 'center' : h === 2 ? 'right' : 'left'
        const text = dxfText(e.text)
        if (!text) return
        this.add('text', e, parent, def, { text, size: (e.textHeight ?? 1) * this.s, font: 'sans', align, depth: 0 }, { p: [p[0], p[1], this.Z(e.startPoint?.z, o)], r: quatZ((e.rotation ?? 0) * DEG), s: [1, 1, 1] }, 'Text')
        return
      }
      case 'MTEXT': {
        const p = this.P(e.position, o)
        const ap = e.attachmentPoint ?? 1
        const align = ap % 3 === 2 ? 'center' : ap % 3 === 0 ? 'right' : 'left'
        const rot = e.directionVector ? Math.atan2(e.directionVector.y, e.directionVector.x) : (e.rotation ?? 0) * DEG
        const text = dxfText(e.text, true)
        if (!text) return
        this.add('text', e, parent, def, { text, size: (e.height ?? 1) * this.s, font: 'sans', align, depth: 0 }, { p: [p[0], p[1], this.Z(e.position?.z, o)], r: quatZ(rot), s: [1, 1, 1] }, 'Text')
        return
      }
      case 'INSERT':
        return this.insert(e, parent, def, o, m)
      case 'DIMENSION':
        return this.dimension(e as E & IDimensionEntity, parent, def, o)
      case 'HATCH':
        return this.hatch(e as E & IHatchEntity, parent, def, o, m)
      case 'POINT': {
        const p = this.P(e.position, o)
        this.add('circle', e, parent, def, { radius: 0.005 }, tf(p, this.Z(e.position?.z, o)), 'Point').meta = { dxf: { type: 'POINT' } }
        return
      }
      case 'SOLID': {
        const pts = ((e.points ?? e.vertices ?? []) as IPoint[]).map((p) => this.P(p, o, m))
        if (pts.length < 3) return
        const ordered = pts.length === 4 ? [pts[0]!, pts[1]!, pts[3]!, pts[2]!] : pts
        this.add('polyline', e, parent, def, { points: ordered, closed: true, fill: this.color(e) ?? this.layerColor(e.layer) }, undefined, 'Solid')
        return
      }
      case '3DFACE': {
        const vs = ((e.vertices ?? []) as IPoint[]).map((p): Vec3 => [(p.x - o[0]) * this.s, (p.y - o[1]) * this.s, (p.z - o[2]) * this.s])
        if (vs.length < 3) return
        const acc = this.faceAcc(parent, def, e)
        const quad = vs.length === 4 && !(vs[3]![0] === vs[2]![0] && vs[3]![1] === vs[2]![1] && vs[3]![2] === vs[2]![2])
        acc.push(...vs[0]!, ...vs[1]!, ...vs[2]!)
        if (quad) acc.push(...vs[0]!, ...vs[2]!, ...vs[3]!)
        return
      }
      default:
        this.skip(e.type)
    }
  }

  private layerColor(name: string | undefined): string {
    const id = this.layer(name)
    return (id && this.layerColors.get(id)) || '#808080'
  }

  private faceAcc(parent: string, def: boolean, e: E): number[] {
    const key = `${parent}|${e.layer ?? ''}|${this.color(e) ?? ''}`
    let f = this.faces.get(key)
    if (!f) this.faces.set(key, (f = { parent, def, layer: this.layer(e.layer), color: this.color(e), tris: [] }))
    return f.tris
  }

  private polyline(e: E, parent: string, def: boolean, o: Vec3, m: boolean) {
    const vs = (e.vertices ?? []) as E[]
    if (e.isPolyfaceMesh) {
      // position records carry flags 64|128, face records only 128 (+ face indices)
      const verts = vs.filter((v) => v.threeDPolylineMesh)
      const faces = vs.filter((v) => !v.threeDPolylineMesh && (v.faceA || v.faceB || v.faceC))
      const P = (i: number): Vec3 | null => {
        const v = verts[Math.abs(i) - 1]
        return v ? [(v.x - o[0]) * this.s, (v.y - o[1]) * this.s, ((v.z ?? 0) - o[2]) * this.s] : null
      }
      const acc = this.faceAcc(parent, def, e)
      for (const f of faces) {
        const idx = [f.faceA, f.faceB, f.faceC, f.faceD].filter((i) => typeof i === 'number' && i !== 0) as number[]
        const pts = idx.map(P).filter(Boolean) as Vec3[]
        if (pts.length >= 3) acc.push(...pts[0]!, ...pts[1]!, ...pts[2]!)
        if (pts.length === 4) acc.push(...pts[0]!, ...pts[2]!, ...pts[3]!)
      }
      return
    }
    if (e.is3dPolygonMesh) return this.skip('POLYLINE mesh')
    const pts = vs.filter((v) => !v.splineControlPoint)
    if (pts.length < 2) return
    if (e.is3dPolyline && pts.some((v) => Math.abs((v.z ?? 0) - (pts[0]!.z ?? 0)) > 1e-9)) {
      this.b.warn('3D polylines were flattened onto the XY plane.')
    }
    const points = pts.map((v) => this.P(v as unknown as IPoint, o, m))
    const bulges = pts.map((v) => (m ? -(v.bulge ?? 0) : (v.bulge ?? 0)))
    const z = this.Z(pts[0]!.z, o)
    this.add('polyline', e, parent, def, { points, ...(bulges.some((x) => x) ? { bulges } : {}), closed: !!e.shape }, z ? tz(z) : undefined, 'Polyline')
  }

  private insert(e: E, parent: string, def: boolean, o: Vec3, m: boolean) {
    const comp = this.component(e.name)
    if (!comp) return
    const rows = Math.max(1, e.rowCount ?? 1),
      cols = Math.max(1, e.columnCount ?? 1)
    const rot = (m ? -1 : 1) * (e.rotation ?? 0) * DEG
    const sx = (e.xScale ?? 1) * (m ? -1 : 1),
      sy = e.yScale ?? 1,
      sz = e.zScale ?? 1
    const base = e.position as IPoint
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const dx = c * (e.columnSpacing ?? 0),
          dy = r * (e.rowSpacing ?? 0)
        const px = (m ? -base.x : base.x) + dx * Math.cos(rot) - dy * Math.sin(rot)
        const py = base.y + dx * Math.sin(rot) + dy * Math.cos(rot)
        const t: Transform = { p: [(px - o[0]) * this.s, (py - o[1]) * this.s, this.Z(base.z, o)], r: quatZ(rot), s: [sx, sy, sz] }
        this.b.add('instance', { name: e.name, parent, t, layer: this.layer(e.layer), color: this.color(e), params: { component: comp.id } }, def)
        if (!def) this.b.expand([[t.p[0], t.p[1], t.p[2]]])
      }
    }
  }

  private dimension(e: E & IDimensionEntity, parent: string, def: boolean, o: Vec3) {
    const type = (e.dimensionType ?? 0) & 7
    const p3 = (p: IPoint | undefined): Vec3 => {
      const q = this.P(p, o)
      return [q[0], q[1], 0]
    }
    const text = e.text && e.text !== '<>' && e.text.trim() !== '' ? dxfText(e.text, true) : undefined
    const put = (params: Partial<NodeParamsMap['dimension']>) => this.add('dimension', e, parent, def, { ...params, ...(text ? { text } : {}) }, undefined, 'Dimension')
    const leftOffset = (a: Vec3, b: Vec3, at: Vec3) => {
      const dx = b[0] - a[0],
        dy = b[1] - a[1]
      const l = Math.hypot(dx, dy) || 1
      return (at[0] - a[0]) * (-dy / l) + (at[1] - a[1]) * (dx / l)
    }
    const d1 = p3(e.linearOrAngularPoint1),
      d2 = p3(e.linearOrAngularPoint2),
      anchor = p3(e.anchorPoint)
    if (type === 1) return void put({ kind: 'aligned', points: [d1, d2], offset: leftOffset(d1, d2, anchor) })
    if (type === 0) {
      const ang = (((e.angle ?? 0) % 180) + 180) % 180
      if (ang < 1e-6 || Math.abs(ang - 180) < 1e-6) return void put({ kind: 'linear', axis: 'x', points: [d1, d2], offset: leftOffset(d1, [d1[0] + (d2[0] >= d1[0] ? 1 : -1), d1[1], 0], anchor) })
      if (Math.abs(ang - 90) < 1e-6) return void put({ kind: 'linear', axis: 'y', points: [d1, d2], offset: leftOffset(d1, [d1[0], d1[1] + (d2[1] >= d1[1] ? 1 : -1), 0], anchor) })
      const dir = Math.atan2(d2[1] - d1[1], d2[0] - d1[0]) / DEG
      if (Math.abs((((dir - ang) % 180) + 180) % 180) < 1e-4) return void put({ kind: 'aligned', points: [d1, d2], offset: leftOffset(d1, d2, anchor) })
    }
    if (type === 3) {
      const a = p3(e.diameterOrRadiusPoint)
      const c: Vec3 = [(a[0] + anchor[0]) / 2, (a[1] + anchor[1]) / 2, 0]
      return void put({ kind: 'diameter', points: [c, a], offset: 0 })
    }
    if (type === 4) return void put({ kind: 'radius', points: [anchor, p3(e.diameterOrRadiusPoint)], offset: 0 })
    if (type === 5) {
      const v = p3(e.diameterOrRadiusPoint)
      return void put({ kind: 'angular', points: [v, d1, d2], offset: Math.hypot(anchor[0] - v[0], anchor[1] - v[1]) })
    }
    if (type === 2) {
      // two lines: (13 → 14) and (10 → 15); vertex = their intersection
      const q = p3(e.diameterOrRadiusPoint)
      const v = intersect(d1, d2, anchor, q)
      const arc = p3(e.arcPoint)
      if (v) return void put({ kind: 'angular', points: [v, d2, q], offset: Math.hypot(arc[0] - v[0], arc[1] - v[1]) })
    }
    // Ordinate / rotated dimensions: fall back to the dimension's block graphics.
    const blk = e.block ? this.dxf.blocks?.[e.block] : undefined
    if (!blk?.entities?.length) return this.skip('DIMENSION')
    const g = this.b.add('group', { name: 'Dimension', parent, layer: this.layer(e.layer), meta: { dxf: { type: 'DIMENSION', block: e.block } } }, def)
    for (const x of blk.entities) this.entity(x as E, g.id, def, o)
  }

  private hatch(e: E & IHatchEntity, parent: string, def: boolean, o: Vec3, m: boolean) {
    const loops = e.loops.map((l) => this.flattenLoop(l, o, m)).filter((l) => l.length >= 3)
    if (!loops.length) return
    const pattern = e.solid ? 'solid' : (mapHatchPattern(e.patternName) ?? 'ansi31')
    if (!e.solid && !mapHatchPattern(e.patternName)) this.b.warn(`Unknown hatch pattern(s) (e.g. ${e.patternName}) were mapped to ANSI31.`)
    // even-odd nesting: loops at even depth are outer boundaries, odd depth are holes
    const depth = loops.map((l, i) => loops.reduce((d, other, j) => (j !== i && pointInPolygon(l[0]!, other) ? d + 1 : d), 0))
    const outers = loops.map((l, i) => ({ l, i })).filter(({ i }) => depth[i]! % 2 === 0)
    // keep the physical spacing: DXF scales .pat units in drawing units, the doc uses the engine's
    // model-space unit (see PATTERN_UNIT_M in export/hatch-patterns.ts)
    const scale = ((e.patternScale || 1) * this.s) / PATTERN_UNIT_M
    for (const { l, i } of outers) {
      const holes = loops.filter((h, j) => j !== i && depth[j] === depth[i]! + 1 && pointInPolygon(h[0]!, l))
      this.add(
        'hatch',
        e,
        parent,
        def,
        { boundary: l, ...(holes.length ? { holes } : {}), pattern, scale, angle: (e.patternAngle ?? 0) * DEG, color: this.color(e) },
        e.elevation ? tz(this.Z(e.elevation, o)) : undefined,
        'Hatch',
      )
    }
  }

  private flattenLoop(l: HatchLoop, o: Vec3, m: boolean): Vec2[] {
    const P = (p: Vec2): Vec2 => this.P({ x: p[0], y: p[1], z: 0 }, o, m)
    if (l.polyline) return flattenBulged(l.polyline.points.map(P), l.polyline.bulges.map((b) => (m ? -b : b)), true)
    const out: Vec2[] = []
    for (const edge of l.edges ?? []) {
      let pts: Vec2[] = []
      if (edge.type === 'line') pts = [P(edge.a), P(edge.b)]
      else if (edge.type === 'arc' || edge.type === 'ellipse') {
        const c = P(edge.c)
        const rx = edge.type === 'arc' ? edge.r * this.s : Math.hypot(edge.major[0], edge.major[1]) * this.s
        const ry = edge.type === 'arc' ? rx : rx * edge.ratio
        const rot = edge.type === 'arc' ? 0 : Math.atan2(edge.major[1], edge.major[0]) * (m ? -1 : 1) + (m ? Math.PI : 0)
        let s0 = edge.ccw ? edge.start : -edge.start,
          s1 = edge.ccw ? edge.end : -edge.end
        if (m) [s0, s1] = [Math.PI - s0, Math.PI - s1]
        let sweep = s1 - s0
        const ccw = edge.ccw !== m
        if (ccw && sweep <= 0) sweep += TAU
        if (!ccw && sweep >= 0) sweep -= TAU
        const n = Math.max(4, Math.ceil(Math.abs(sweep) / (Math.PI / 24)))
        for (let k = 0; k <= n; k++) {
          const t = s0 + (sweep * k) / n
          const x = Math.cos(t) * rx,
            y = Math.sin(t) * ry
          pts.push([c[0] + x * Math.cos(rot) - y * Math.sin(rot), c[1] + x * Math.sin(rot) + y * Math.cos(rot)])
        }
      } else if (edge.type === 'spline') {
        const ctrl = edge.ctrl.map(P)
        const path = ctrl.length >= 2 ? bsplinePath(edge.degree, edge.knots, ctrl, edge.weights) : catmullRomPath(edge.fit.map(P))
        pts = flattenPath(path, false, 8)
      }
      if (out.length && pts.length && Math.hypot(out[out.length - 1]![0] - pts[0]![0], out[out.length - 1]![1] - pts[0]![1]) < 1e-9) pts.shift()
      out.push(...pts)
    }
    if (out.length > 2 && Math.hypot(out[0]![0] - out[out.length - 1]![0], out[0]![1] - out[out.length - 1]![1]) < 1e-9) out.pop()
    return Math.abs(signedArea(out)) > 0 ? out : []
  }

  async finish(): Promise<void> {
    for (const f of this.faces.values()) {
      if (!f.tris.length) continue
      const positions = new Float32Array(f.tris)
      const normals = new Float32Array(positions.length)
      for (let i = 0; i < positions.length; i += 9) {
        const ax = positions[i + 3]! - positions[i]!,
          ay = positions[i + 4]! - positions[i + 1]!,
          az = positions[i + 5]! - positions[i + 2]!
        const bx = positions[i + 6]! - positions[i]!,
          by = positions[i + 7]! - positions[i + 1]!,
          bz = positions[i + 8]! - positions[i + 2]!
        let nx = ay * bz - az * by,
          ny = az * bx - ax * bz,
          nz = ax * by - ay * bx
        const l = Math.hypot(nx, ny, nz) || 1
        nx /= l
        ny /= l
        nz /= l
        for (let k = 0; k < 3; k++) normals.set([nx, ny, nz], i + k * 3)
      }
      const hash = await this.b.asset(encodeCSBM({ positions, normals }), CSBM_MIME)
      const bounds = positionBounds(positions)
      this.b.add('mesh', { name: '3D faces', parent: f.parent, layer: f.layer, color: f.color, params: { asset: hash, bounds } }, f.def)
      if (!f.def) this.b.expand([bounds.min, bounds.max])
    }
    for (const [type, n] of this.skipped) this.b.warn(`${n} ${type} entit${n === 1 ? 'y was' : 'ies were'} skipped (not supported).`)
  }
}

const tz = (z: number): Transform => ({ p: [0, 0, z], r: [0, 0, 0, 1], s: [1, 1, 1] })
const tf = (p: Vec2, z = 0): Transform => ({ p: [p[0], p[1], z], r: [0, 0, 0, 1], s: [1, 1, 1] })
const norm = (a: number) => ((a % TAU) + TAU) % TAU

function intersect(a1: Vec3, a2: Vec3, b1: Vec3, b2: Vec3): Vec3 | null {
  const d1x = a2[0] - a1[0],
    d1y = a2[1] - a1[1],
    d2x = b2[0] - b1[0],
    d2y = b2[1] - b1[1]
  const den = d1x * d2y - d1y * d2x
  if (Math.abs(den) < 1e-12) return null
  const t = ((b1[0] - a1[0]) * d2y - (b1[1] - a1[1]) * d2x) / den
  return [a1[0] + d1x * t, a1[1] + d1y * t, 0]
}

function collectPoints(type: NodeType, p: Record<string, unknown>): Vec2[] {
  if (type === 'line') return [p.a as Vec2, p.b as Vec2]
  if (type === 'polyline') return p.points as Vec2[]
  if (type === 'hatch') return p.boundary as Vec2[]
  if (type === 'circle' || type === 'arc') {
    const r = p.radius as number
    return [
      [-r, -r],
      [r, r],
    ]
  }
  if (type === 'spline') return ((p.path as { contours: { points: PathPoint[] }[] }).contours[0]?.points ?? []).map((x) => x.p)
  if (type === 'dimension') return (p.points as Vec3[]).map((x) => [x[0], x[1]])
  return [[0, 0]]
}

function resolveParser(mod: unknown): new () => { parseSync(s: string): IDxf | null; registerEntityHandler(h: unknown): void } {
  const m = mod as Record<string, unknown> & { default?: Record<string, unknown> | ((...a: unknown[]) => unknown) }
  const c = m.DxfParser ?? (typeof m.default === 'function' ? m.default : m.default?.DxfParser ?? m.default?.default)
  if (typeof c !== 'function') throw new Error('dxf-parser could not be loaded')
  return c as never
}

export async function importDxf(name: string, bytes: Uint8Array, opts: ImportOptions): Promise<ImportResult> {
  const head = new TextDecoder().decode(bytes.subarray(0, 22))
  if (head.startsWith('AutoCAD Binary DXF')) throw new Error('Binary DXF is not supported — please save the drawing as ASCII DXF.')
  const text = decodeText(bytes)
  const [mod, { aciHex }] = await Promise.all([import('dxf-parser'), import('@tarikjabiri/dxf')])
  const Parser = resolveParser(mod)
  const parser = new Parser()
  parser.registerEntityHandler(HatchHandler)
  opts.onProgress?.(0.1, 'Parsing DXF')
  let dxf: IDxf | null
  try {
    dxf = parser.parseSync(text)
  } catch (err) {
    throw new Error(`Invalid DXF file: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!dxf) throw new Error('Invalid DXF file.')
  const insunits = Number(dxf.header?.['$INSUNITS'] ?? 0)
  const scale = insunitsScale(insunits) ?? unitScale(opts.units ?? 'mm')
  const b = new SnapshotBuilder()
  if (!insunitsScale(insunits)) b.warn(`The drawing has no units ($INSUNITS); it was imported as ${opts.units ?? 'mm'}.`)
  const root = b.add('group', { name: stem(name), parent: null, meta: { source: { format: 'dxf', insunits } } })
  const conv = new DxfConverter(b, dxf, scale, aciHex, scanLayerTable(text))
  const entities = dxf.entities ?? []
  opts.onProgress?.(0.4, 'Converting entities')
  for (let i = 0; i < entities.length; i++) conv.entity(entities[i] as E, root.id, false, [0, 0, 0])
  await conv.finish()
  opts.onProgress?.(1, 'Done')
  return b.result()
}
