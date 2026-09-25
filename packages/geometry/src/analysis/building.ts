// Building model for the architecture analyses (DIN 277, WoFlV, zoning, DIN 276, GEG, checks).
// One pass over the document + GeometryService results; everything in WORLD space (m, Z-up).
// Callers should `await service.idle()` first so quantities/meshes are current; missing results
// fall back to node params where sensible.
import {
  BUILTIN_THERMAL,
  CATEGORY_THERMAL,
  TYPE_DEFAULT_MATERIAL,
  type AnyNode,
  type BuildingType,
  type CadDocument,
  type Mat4,
  type MaterialDef,
  type RoomOutdoorKind,
  type RoomUsage,
  type SiteInfo,
  type SlabKind,
  type Vec2,
  type WallLayerFunction,
} from '@cadsandbox/doc'
import type { GeometryResult, GeometryService } from '../api'
import { affineFromMat4, applyAffine, pointInPolygon, polygonArea, polygonPerimeter, type Affine2 } from '../core/math2d'
import { nestRings, pointInPolys, polygonsArea, unionPolygons, type PolyWithHoles, type Ring } from '../core/polygon'
import { defaultContext } from '../evaluators/context'
import { WallFrame } from '../evaluators/wall/frame'
import { neighborFrames } from '../evaluators/wall/index'
import { solveJoins } from '../evaluators/wall/joins'
import { buildWallIndex, nearbyWalls, type WallIndex } from '../service/context'

/** Outcome of a rule check: pass, warn (borderline / advisory), fail, info (not evaluable). */
export type Status = 'pass' | 'warn' | 'fail' | 'info'

export type RoomKind = 'bath' | 'kitchen' | 'hall' | 'stair' | 'living' | 'bedroom' | 'work' | 'storage' | 'accessory' | 'technical' | 'outdoor' | 'other'

export interface LevelInfo {
  id: string
  name: string
  /** Floor elevation (world Z) */
  elevation: number
  /** Floor-to-floor height */
  height: number
  /** 0 = lowest level */
  index: number
  /** Outer boundary of the joined wall footprints (holes dropped), world XY — the BGF(R) outline. */
  outline: PolyWithHoles[]
  bgf: number
  /** Storey top at most 1.40 m above ground level (basement, Kellergeschoss). */
  belowGround: boolean
  fullStoreyOverride?: boolean
}

export interface RoomInfo {
  id: string
  name: string
  number: string
  levelId: string
  usage: RoomUsage
  kind: RoomKind
  /** All functions named in the room name (kind = first) */
  tags: RoomKind[]
  polys: PolyWithHoles[]
  area: number
  perimeter: number
  /** Floor elevation (world Z) */
  z: number
  /** Ceiling height (params.ceilingHeight or level height − slab) — caps sampled clear heights */
  height: number
  livingSpace: boolean
  livingSpaceAuto: boolean
  habitable: boolean
  habitableAuto: boolean
  outdoor: RoomOutdoorKind | null
  outdoorFactor: number
}

export interface LayerInfo {
  material: string | null
  name: string
  thickness: number
  function: WallLayerFunction
  lambda: number
  /** λ taken from a category fallback (material without thermal data) */
  lambdaAssumed: boolean
}

export type WallSide = 'exterior' | 'interior' | 'freestanding'

export interface WallInfo {
  id: string
  levelId: string
  length: number
  height: number
  thickness: number
  grossArea: number
  openingArea: number
  netArea: number
  volume: number
  /** exterior = exactly one face on the outside of the level outline (thermal envelope) */
  side: WallSide
  structural: boolean
  /** Wall of a storey below ground level (earth contact) */
  groundContact: boolean
  layers: LayerInfo[]
  /** node.meta.uValue override, W/(m²K) */
  uOverride?: number
}

export interface OpeningInfo {
  id: string
  wallId: string
  levelId: string
  kind: 'door' | 'window' | 'opening'
  style: string
  width: number
  height: number
  sill: number
  frameWidth: number
  area: number
  /** Center on the wall axis (world XY) */
  center: Vec2
  /** Probe points 10 cm beyond the left / right wall face (world XY) */
  sides: [Vec2, Vec2]
  /** Host side facing outside (one probe outside the level outline, the other inside) */
  exterior: boolean
  /** World Z of the opening bottom (sill) */
  z: number
  uOverride?: number
}

export interface SlabInfo {
  id: string
  levelId: string | null
  kind: SlabKind
  area: number
  thickness: number
  /** Top face (world Z) */
  top: number
  polys: PolyWithHoles[]
  uOverride?: number
}

export interface RoofInfo {
  id: string
  levelId: string | null
  kind: string
  /** Sloped surface area */
  area: number
  footprint: number
  pitchDeg: number
  eaveZ: number
  ridgeZ: number
  uOverride?: number
}

export interface StairInfo {
  id: string
  levelId: string | null
  risers: number
  riserHeight: number
  treadDepth: number
  width: number
  rise: number
  run: number
  railing: string
  railingHeight: number
  /** Plan footprint (oriented box, world XY) */
  ring: Vec2[]
  z: number
}

export interface RailingInfo {
  id: string
  levelId: string | null
  length: number
  height: number
  path: Vec2[]
  z: number
}

export interface ColumnInfo {
  id: string
  levelId: string | null
  ring: Vec2[]
  area: number
  height: number
  z: number
}

export interface ObstacleInfo {
  id: string
  levelId: string | null
  ring: Vec2[]
}

export interface ClearHeightSamples {
  /** Sample points [x0,y0, x1,y1, …] (cell centers, world XY) */
  points: Float64Array
  /** Clear height per sample (m) */
  heights: Float64Array
  spacing: number
  /** Samples that hit modelled geometry above (rest use the room/storey height) */
  hits: number
}

export interface BuildingModel {
  site: SiteInfo
  buildingType: BuildingType
  groundLevel: number
  levels: LevelInfo[]
  rooms: RoomInfo[]
  walls: WallInfo[]
  openings: OpeningInfo[]
  slabs: SlabInfo[]
  roofs: RoofInfo[]
  stairs: StairInfo[]
  railings: RailingInfo[]
  columns: ColumnInfo[]
  obstacles: ObstacleInfo[]
  /** Highest point of the building (world Z); ground level when empty */
  top: number
  cover: CoverIndex
  /** Clear heights sampled over a room (memoized). */
  roomClearHeights(roomId: string, spacing?: number): ClearHeightSamples
  /** Clear heights sampled over a level outline (memoized). */
  levelClearHeights(levelId: string, spacing?: number): ClearHeightSamples
}

// ------------------------------------------------------------------ cover index (vertical rays)
interface CoverOwner {
  id: string
  type: 'slab' | 'roof'
  kind: string
  levelId: string | null
}

/** Uniform-grid index of world-space triangles (slabs, roofs) answering "what is above/at (x, y)". */
export class CoverIndex {
  readonly owners: CoverOwner[] = []
  private tris: number[] = []
  private triOwner: number[] = []
  private cells = new Map<number, number[]>()

  constructor(readonly cell = 0.5) {}

  private key(ix: number, iy: number): number {
    return (ix + 1_000_000) * 2_000_003 + (iy + 1_000_000)
  }

  add(owner: CoverOwner, positions: ArrayLike<number>, indices: ArrayLike<number> | undefined, m: Mat4): void {
    const o = this.owners.push(owner) - 1
    const n = indices ? indices.length : positions.length / 3
    const w = (i: number): [number, number, number] => {
      const x = positions[i * 3]!, y = positions[i * 3 + 1]!, z = positions[i * 3 + 2]!
      return [m[0]! * x + m[4]! * y + m[8]! * z + m[12]!, m[1]! * x + m[5]! * y + m[9]! * z + m[13]!, m[2]! * x + m[6]! * y + m[10]! * z + m[14]!]
    }
    for (let t = 0; t + 2 < n; t += 3) {
      const a = w(indices ? indices[t]! : t), b = w(indices ? indices[t + 1]! : t + 1), c = w(indices ? indices[t + 2]! : t + 2)
      const area2 = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])
      if (Math.abs(area2) < 1e-9) continue // vertical faces never answer a vertical ray
      const ti = this.triOwner.length
      this.tris.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2])
      this.triOwner.push(o)
      const x0 = Math.floor(Math.min(a[0], b[0], c[0]) / this.cell), x1 = Math.floor(Math.max(a[0], b[0], c[0]) / this.cell)
      const y0 = Math.floor(Math.min(a[1], b[1], c[1]) / this.cell), y1 = Math.floor(Math.max(a[1], b[1], c[1]) / this.cell)
      for (let ix = x0; ix <= x1; ix++)
        for (let iy = y0; iy <= y1; iy++) {
          const k = this.key(ix, iy)
          const list = this.cells.get(k)
          if (list) list.push(ti)
          else this.cells.set(k, [ti])
        }
    }
  }

  get size(): number {
    return this.triOwner.length
  }

  /** Visit the Z of every triangle covering (x, y). */
  private visit(x: number, y: number, accept: ((owner: CoverOwner) => boolean) | undefined, fn: (z: number) => void): void {
    const list = this.cells.get(this.key(Math.floor(x / this.cell), Math.floor(y / this.cell)))
    if (!list) return
    const T = this.tris
    for (const ti of list) {
      if (accept && !accept(this.owners[this.triOwner[ti]!]!)) continue
      const i = ti * 9
      const x0 = T[i]!, y0 = T[i + 1]!, x1 = T[i + 3]!, y1 = T[i + 4]!, x2 = T[i + 6]!, y2 = T[i + 7]!
      const d = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
      const l0 = ((y1 - y2) * (x - x2) + (x2 - x1) * (y - y2)) / d
      const l1 = ((y2 - y0) * (x - x2) + (x0 - x2) * (y - y2)) / d
      const l2 = 1 - l0 - l1
      if (l0 < -1e-9 || l1 < -1e-9 || l2 < -1e-9) continue
      fn(l0 * T[i + 2]! + l1 * T[i + 5]! + l2 * T[i + 8]!)
    }
  }

  /** Lowest surface strictly above `z` at (x, y); Infinity when none. */
  lowestAbove(x: number, y: number, z: number, accept?: (owner: CoverOwner) => boolean): number {
    let best = Infinity
    this.visit(x, y, accept, (zz) => {
      if (zz > z && zz < best) best = zz
    })
    return best
  }

  /** Highest surface at (x, y); -Infinity when none. */
  highestAt(x: number, y: number, accept?: (owner: CoverOwner) => boolean): number {
    let best = -Infinity
    this.visit(x, y, accept, (zz) => {
      if (zz > best) best = zz
    })
    return best
  }
}

// ------------------------------------------------------------------ helpers
const worldXf = (doc: CadDocument, id: string): { xf: Affine2; z: number; m: Mat4 } => {
  const m = doc.getWorldMatrix(id)
  return { xf: affineFromMat4(m), z: m[14]!, m }
}

const xfRing = (xf: Affine2, ring: readonly Vec2[]): Vec2[] => {
  const out = ring.map((p) => applyAffine(xf, p))
  // mirrored transforms flip orientation — keep outers CCW
  return polygonArea(out) < 0 ? out.reverse() : out
}

const xfPolys = (xf: Affine2, polys: readonly PolyWithHoles[]): PolyWithHoles[] =>
  polys.map((p) => ({ outer: xfRing(xf, p.outer), holes: p.holes.map((h) => xfRing(xf, h).reverse()) }))

/** Local bounds (XY) of a result as a world ring (oriented box). */
function boundsRing(res: GeometryResult | undefined, xf: Affine2): Vec2[] | null {
  if (!res) return null
  const { min, max } = res.bounds
  if (!(max[0] > min[0]) || !(max[1] > min[1])) return null
  return xfRing(xf, [
    [min[0], min[1]],
    [max[0], min[1]],
    [max[0], max[1]],
    [min[0], max[1]],
  ])
}

const metaNum = (n: AnyNode, key: string): number | undefined => {
  const v = n.meta?.[key]
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined
}

/** Point inside any outer ring (holes ignored — BGF outlines have none). */
export const insideOutline = (p: Vec2, outline: readonly PolyWithHoles[]): boolean => outline.some((o) => pointInPolygon(p, o.outer))

/** Cell-center sample points inside `polys` (spacing grows for huge regions: ≤ maxSamples). */
export function samplePolys(polys: readonly PolyWithHoles[], spacing: number, maxSamples = 40_000): { points: Float64Array; spacing: number } {
  const area = polygonsArea(polys as PolyWithHoles[])
  let s = Math.max(spacing, Math.sqrt(Math.max(area, 1e-9) / maxSamples))
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of polys)
    for (const q of p.outer) {
      if (q[0] < minX) minX = q[0]
      if (q[1] < minY) minY = q[1]
      if (q[0] > maxX) maxX = q[0]
      if (q[1] > maxY) maxY = q[1]
    }
  const out: number[] = []
  if (Number.isFinite(minX)) {
    for (let y = minY + s / 2; y < maxY; y += s) for (let x = minX + s / 2; x < maxX; x += s) if (pointInPolys([x, y], polys)) out.push(x, y)
    if (!out.length) {
      // tiny / thin region: fall back to a label-ish point (first vertex average)
      const ring = polys[0]!.outer
      const c = ring.reduce<Vec2>((a, q) => [a[0] + q[0] / ring.length, a[1] + q[1] / ring.length], [0, 0])
      out.push(c[0], c[1])
      s = Math.sqrt(Math.max(area, 1e-9))
    }
  }
  return { points: Float64Array.from(out), spacing: s }
}

// ------------------------------------------------------------------ room heuristics
const KIND_RULES: [RoomKind, RegExp][] = [
  ['outdoor', /balkon|balcony|terrass|terrace|loggia|dachgarten|roof ?garden|veranda/i],
  ['stair', /treppe|stair/i],
  ['bath', /\bbad|bath|\bwc\b|toilet|dusch|shower|sanit|washroom|restroom|lavator/i],
  ['kitchen', /küche|kueche|kitchen|kochnische|kitchenette/i],
  ['accessory', /keller|cellar|basement|dachboden|spitzboden|bodenraum|trockenraum|waschküche|garage|carport/i],
  ['technical', /technik|heizung|boiler|hausanschluss|plant room|server|elektro|mechanical/i],
  ['storage', /abstell|lager|storage|store ?room|vorrat|hwr|hauswirtschaft|utility|laundry|wasch|garderobe|closet|ankleide|wardrobe/i],
  ['hall', /flur|diele|korridor|corridor|hall(?!e)|gang|eingang|entrance|foyer|vorraum|windfang|lobby|galerie|gallery|landing/i],
  ['bedroom', /schlaf|\bbed|\bkind|child|nursery|gäste|guest/i],
  ['work', /büro|buero|office|arbeit|study|atelier|studio/i],
  ['living', /wohn|living|lounge|\bess|dining|salon|aufenthalt|family/i],
]

const byUsage = (usage: RoomUsage): RoomKind =>
  usage === 'VF' ? 'hall' : usage === 'TF' ? 'technical' : usage === 'NUF4' ? 'storage' : usage === 'NUF1' ? 'living' : usage === 'NUF2' ? 'work' : 'other'

/** All room functions named in a room name (German + English keywords), most specific first; usage
 *  decides when the name is silent ("Wohnküche" → kitchen + living, "Gäste-WC" → bath + bedroom). */
export function roomTags(name: string, usage: RoomUsage): RoomKind[] {
  const tags = KIND_RULES.filter(([, rx]) => rx.test(name)).map(([k]) => k)
  if (!tags.length) tags.push(/zimmer|room/i.test(name) ? 'living' : byUsage(usage))
  return tags
}

/** Primary room function from its name (first of roomTags). */
export function roomKindOf(name: string, usage: RoomUsage): RoomKind {
  return roomTags(name, usage)[0]!
}

const HABITABLE_KINDS: ReadonlySet<RoomKind> = new Set(['living', 'bedroom', 'work'])
/** Functions that make a room non-habitable even when living words appear ("Gäste-WC"). */
const SERVICE_KINDS: ReadonlySet<RoomKind> = new Set(['bath', 'stair', 'accessory', 'technical', 'storage', 'hall', 'outdoor'])

// ------------------------------------------------------------------ materials
/** λ of a material (W/(m·K)); category fallback for materials without thermal data. */
export function materialLambda(mat: MaterialDef | undefined): { lambda: number; assumed: boolean } {
  if (!mat) return { lambda: CATEGORY_THERMAL.generic.lambda, assumed: true }
  const th = mat.thermal
  const inheritedDefault = !mat.builtin && th && mat.category !== 'generic' && th.lambda === BUILTIN_THERMAL.default!.lambda
  if (th && th.lambda > 0 && !inheritedDefault) return { lambda: th.lambda, assumed: false }
  return { lambda: (CATEGORY_THERMAL[mat.category] ?? CATEGORY_THERMAL.generic).lambda, assumed: true }
}

// ------------------------------------------------------------------ collection
function levelOutline(doc: CadDocument, levelId: string, index: WallIndex): PolyWithHoles[] {
  const rings: Ring[] = []
  for (const w of doc.nodesOfType('wall')) {
    if (doc.getLevelOf(w.id) !== levelId || doc.isDefinitionNode(w.id)) continue
    const frame = new WallFrame(w.params, null)
    if (frame.L < 1e-4) continue
    const solve = solveJoins(w.id, frame, neighborFrames(defaultContext({ walls: nearbyWalls(doc, w, index) }), frame))
    rings.push(xfRing(worldXf(doc, w.id).xf, solve.footprint))
  }
  if (!rings.length) return []
  return unionPolygons(rings).map((u) => ({ outer: u.outer, holes: [] }))
}

export interface CollectOptions {
  /** Default grid spacing for clear-height sampling (m), default 0.1 */
  spacing?: number
}

/** Extract the building model (world space) from the document and evaluated geometry. */
export function collectBuilding(doc: CadDocument, service: GeometryService, opts: CollectOptions = {}): BuildingModel {
  const site: SiteInfo = doc.meta.site ?? {}
  const buildingType: BuildingType = site.buildingType ?? 'residential'
  const groundLevel = site.groundLevel ?? 0
  const index = buildWallIndex(doc)
  const live = (n: AnyNode) => !doc.isDefinitionNode(n.id)
  const cover = new CoverIndex()
  let top = -Infinity

  // levels
  const levelNodes = doc.levels()
  const levels: LevelInfo[] = levelNodes.map((l, i) => {
    let outline = levelOutline(doc, l.id, index)
    const elevation = worldXf(doc, l.id).z
    const height = Math.max(0.1, l.params.height)
    return {
      id: l.id,
      name: l.name || `Level ${i}`,
      elevation,
      height,
      index: i,
      outline,
      bgf: 0,
      belowGround: elevation + height <= groundLevel + 1.4 + 1e-6,
      fullStoreyOverride: typeof l.params.fullStorey === 'boolean' ? l.params.fullStorey : undefined,
    }
  })
  const levelById = new Map(levels.map((l) => [l.id, l]))
  const levelIdOf = (id: string): string | null => doc.getLevelOf(id)

  // slabs (also feed the cover index + level outlines without walls)
  const slabs: SlabInfo[] = []
  for (const s of doc.nodesOfType('slab')) {
    if (!live(s)) continue
    const { xf, z, m } = worldXf(doc, s.id)
    const res = service.get(s.id)
    const outline = s.params.outline ?? []
    if (outline.length < 3) continue
    const polys = xfPolys(xf, nestRings([outline, ...(s.params.holes ?? [])]))
    const lv = levelIdOf(s.id)
    slabs.push({
      id: s.id,
      levelId: lv,
      kind: s.params.kind,
      area: res?.quantities?.area ?? polygonsArea(polys),
      thickness: s.params.thickness,
      top: z + (s.params.offset ?? 0),
      polys,
      uOverride: metaNum(s as AnyNode, 'uValue'),
    })
    for (const part of res?.parts ?? []) cover.add({ id: s.id, type: 'slab', kind: s.params.kind, levelId: lv }, part.mesh.positions, part.mesh.indices, m)
    top = Math.max(top, z + (s.params.offset ?? 0))
  }
  for (const l of levels) {
    if (!l.outline.length) {
      const own = slabs.filter((s) => s.levelId === l.id && (s.kind === 'floor' || s.kind === 'foundation'))
      if (own.length) l.outline = unionPolygons(own.flatMap((s) => s.polys)).map((u) => ({ outer: u.outer, holes: [] }))
    }
    l.bgf = l.outline.reduce((a, o) => a + Math.abs(polygonArea(o.outer)), 0)
  }

  // roofs
  const roofs: RoofInfo[] = []
  for (const r of doc.nodesOfType('roof')) {
    if (!live(r)) continue
    const { z, m } = worldXf(doc, r.id)
    const res = service.get(r.id)
    const q = res?.quantities ?? {}
    const lv = levelIdOf(r.id)
    roofs.push({
      id: r.id,
      levelId: lv,
      kind: r.params.kind,
      area: q.area ?? 0,
      footprint: q.footprint ?? Math.abs(polygonArea(r.params.outline ?? [])),
      pitchDeg: r.params.pitchDeg,
      eaveZ: z + r.params.baseOffset,
      ridgeZ: z + (q.ridgeHeight ?? r.params.baseOffset),
      uOverride: metaNum(r as AnyNode, 'uValue'),
    })
    for (const part of res?.parts ?? []) cover.add({ id: r.id, type: 'roof', kind: r.params.kind, levelId: lv }, part.mesh.positions, part.mesh.indices, m)
    if (res) top = Math.max(top, z + res.bounds.max[2])
  }

  // walls
  const walls: WallInfo[] = []
  const wallFrames = new Map<string, { frame: WallFrame; xf: Affine2; baseZ: number; levelId: string }>()
  for (const w of doc.nodesOfType('wall')) {
    if (!live(w)) continue
    const lv = levelIdOf(w.id)
    if (!lv) continue
    const level = levelById.get(lv)
    const { xf, z } = worldXf(doc, w.id)
    const frame = new WallFrame(w.params, w.material)
    const res = service.get(w.id)
    const q = res?.quantities ?? {}
    const height = q.height ?? frame.z1 - frame.z0
    const gross = q.grossArea ?? frame.L * height
    const openingArea = q.openingArea ?? 0
    // exterior detection: probes beyond both faces vs. the level outline
    let outL = 0, outR = 0
    const probes = [0.2, 0.5, 0.8]
    const off = frame.t / 2 + 0.05
    for (const f of probes) {
      if (level && level.outline.length) {
        if (!insideOutline(applyAffine(xf, frame.point(frame.L * f, off)), level.outline)) outL++
        if (!insideOutline(applyAffine(xf, frame.point(frame.L * f, -off)), level.outline)) outR++
      }
    }
    const side: WallSide = w.params.exterior ? 'exterior' : outL && outR ? 'freestanding' : outL || outR ? 'exterior' : 'interior'
    const nodeMat = w.material ?? TYPE_DEFAULT_MATERIAL.wall ?? null
    const layers: LayerInfo[] = (w.params.layers?.length ? w.params.layers : [{ material: nodeMat, thickness: frame.t, function: 'structure' as const }])
      .filter((l) => l.thickness > 1e-6)
      .map((l) => {
        const mat = doc.getMaterial(l.material ?? nodeMat)
        const { lambda, assumed } = materialLambda(mat)
        return { material: l.material ?? nodeMat, name: mat?.name ?? l.material ?? '—', thickness: l.thickness, function: l.function, lambda, lambdaAssumed: assumed }
      })
    walls.push({
      id: w.id,
      levelId: lv,
      length: q.length ?? frame.L,
      height,
      thickness: q.thickness ?? frame.t,
      grossArea: gross,
      openingArea,
      netArea: q.netArea ?? Math.max(0, gross - openingArea),
      volume: q.volume ?? frame.L * frame.t * height,
      side,
      structural: w.params.structural !== false,
      groundContact: !!level?.belowGround,
      layers,
      uOverride: metaNum(w as AnyNode, 'uValue'),
    })
    wallFrames.set(w.id, { frame, xf, baseZ: z + frame.z0, levelId: lv })
    top = Math.max(top, z + frame.z1)
  }

  // openings (hosted by walls)
  const openings: OpeningInfo[] = []
  for (const o of doc.nodesOfType('opening')) {
    if (!live(o) || !o.parent) continue
    const host = wallFrames.get(o.parent)
    if (!host) continue
    const { frame, xf, baseZ, levelId } = host
    const level = levelById.get(levelId)
    const s = Math.max(0, Math.min(frame.L, frame.Lref > 1e-9 ? (o.params.offset * frame.L) / frame.Lref : o.params.offset))
    const off = frame.t / 2 + 0.1
    const left = applyAffine(xf, frame.point(s, off)), right = applyAffine(xf, frame.point(s, -off))
    const outside = level && level.outline.length ? [!insideOutline(left, level.outline), !insideOutline(right, level.outline)] : [false, false]
    openings.push({
      id: o.id,
      wallId: o.parent,
      levelId,
      kind: o.params.kind,
      style: o.params.style,
      width: o.params.width,
      height: o.params.height,
      sill: o.params.sill,
      frameWidth: o.params.frameWidth ?? 0,
      area: o.params.width * o.params.height,
      center: applyAffine(xf, frame.point(s, 0)),
      sides: [left, right],
      exterior: outside[0] !== outside[1],
      z: baseZ + o.params.sill,
      uOverride: metaNum(o as AnyNode, 'uValue'),
    })
  }

  // rooms
  const rooms: RoomInfo[] = []
  for (const r of doc.nodesOfType('room')) {
    if (!live(r)) continue
    const lv = levelIdOf(r.id)
    if (!lv) continue
    const level = levelById.get(lv)
    const { xf, z } = worldXf(doc, r.id)
    const res = service.get(r.id)
    let local: PolyWithHoles[] = (res?.plan?.fills ?? []).flatMap((f) => f.polygons.map((p) => ({ outer: p.outer, holes: p.holes })))
    if (!local.length && (r.params.outline?.length ?? 0) >= 3) local = nestRings([r.params.outline])
    if (!local.length) continue
    const polys = xfPolys(xf, local)
    const area = res?.quantities?.area ?? polygonsArea(polys)
    const tags: RoomKind[] = r.params.outdoor ? ['outdoor'] : roomTags(r.name ?? '', r.params.usage)
    const kind = tags[0]!
    const outdoor: RoomOutdoorKind | null = r.params.outdoor ?? (kind === 'outdoor' ? (/terrass|terrace/i.test(r.name) ? 'terrace' : /loggia/i.test(r.name) ? 'loggia' : /garten|garden/i.test(r.name) ? 'roof-garden' : 'balcony') : null)
    const residential = buildingType === 'residential'
    const autoLiving = !outdoor
      ? residential && !level?.belowGround && r.params.usage !== 'TF' && kind !== 'accessory' && kind !== 'technical' && ['NUF1', 'NUF2', 'NUF3', 'NUF4', 'NUF7', 'VF'].includes(r.params.usage)
      : residential
    const autoHabitable =
      !outdoor && !tags.some((k) => SERVICE_KINDS.has(k)) && (tags.some((k) => HABITABLE_KINDS.has(k)) || (kind === 'other' && ['NUF1', 'NUF2', 'NUF5', 'NUF6'].includes(r.params.usage)))
    rooms.push({
      id: r.id,
      name: r.name ?? '',
      number: r.params.number ?? '',
      levelId: lv,
      usage: r.params.usage,
      kind,
      tags,
      polys,
      area,
      perimeter: res?.quantities?.perimeter ?? polys.reduce((a, p) => a + polygonPerimeter(p.outer), 0),
      z,
      height: res?.quantities?.height ?? (r.params.ceilingHeight && r.params.ceilingHeight > 0 ? r.params.ceilingHeight : Math.max(0.1, (level?.height ?? 2.75) - 0.2)),
      livingSpace: r.params.livingSpace ?? autoLiving,
      livingSpaceAuto: r.params.livingSpace === undefined,
      habitable: r.params.habitable ?? autoHabitable,
      habitableAuto: r.params.habitable === undefined,
      outdoor,
      outdoorFactor: Math.max(0, Math.min(0.5, r.params.outdoorFactor ?? 0.25)),
    })
  }

  // stairs, railings, columns, obstacles
  const stairs: StairInfo[] = []
  for (const s of doc.nodesOfType('stair')) {
    if (!live(s)) continue
    const { xf, z } = worldXf(doc, s.id)
    const res = service.get(s.id)
    const q = res?.quantities ?? {}
    const lv = levelIdOf(s.id)
    const rise = q.rise ?? (s.params.rise > 0 ? s.params.rise : (lv ? levelById.get(lv)?.height : undefined) ?? 2.75)
    const risers = q.risers ?? Math.max(1, s.params.riserCount || Math.round(rise / 0.175))
    const ring = boundsRing(res, xf) ?? xfRing(xf, [[-s.params.width / 2, 0], [s.params.width / 2, 0], [s.params.width / 2, risers * s.params.treadDepth], [-s.params.width / 2, risers * s.params.treadDepth]])
    stairs.push({
      id: s.id,
      levelId: lv,
      risers,
      riserHeight: q.riserHeight ?? rise / risers,
      treadDepth: q.treadDepth ?? s.params.treadDepth,
      width: q.width ?? s.params.width,
      rise,
      run: q.run ?? 0,
      railing: s.params.railing,
      railingHeight: s.params.railingHeight,
      ring,
      z,
    })
  }
  const railings: RailingInfo[] = []
  for (const r of doc.nodesOfType('railing')) {
    if (!live(r) || (r.params.path?.length ?? 0) < 2) continue
    const { xf, z } = worldXf(doc, r.id)
    const path = r.params.path.map((p) => applyAffine(xf, p))
    let length = 0
    for (let i = 1; i < path.length; i++) length += Math.hypot(path[i]![0] - path[i - 1]![0], path[i]![1] - path[i - 1]![1])
    railings.push({ id: r.id, levelId: levelIdOf(r.id), length: service.get(r.id)?.quantities?.length ?? length, height: r.params.height, path, z: z + (r.params.baseOffset ?? 0) })
  }
  const columns: ColumnInfo[] = []
  for (const c of doc.nodesOfType('column')) {
    if (!live(c)) continue
    const { xf, z } = worldXf(doc, c.id)
    const p = c.params
    const ring: Vec2[] =
      p.shape === 'round'
        ? Array.from({ length: 16 }, (_, i) => applyAffine(xf, [(Math.cos((i / 16) * Math.PI * 2) * p.width) / 2, (Math.sin((i / 16) * Math.PI * 2) * p.width) / 2]))
        : xfRing(xf, [[-p.width / 2, -p.depth / 2], [p.width / 2, -p.depth / 2], [p.width / 2, p.depth / 2], [-p.width / 2, p.depth / 2]])
    columns.push({ id: c.id, levelId: levelIdOf(c.id), ring, area: Math.abs(polygonArea(ring)), height: p.height, z: z + (p.baseOffset ?? 0) })
    top = Math.max(top, z + (p.baseOffset ?? 0) + p.height)
  }
  const obstacles: ObstacleInfo[] = []
  for (const n of doc.allNodes()) {
    if ((n.type !== 'furniture' && n.type !== 'instance') || !live(n)) continue
    const res = service.get(n.id)
    if (!res || res.bounds.max[2] - res.bounds.min[2] < 0.15) continue // rugs / flat items do not obstruct
    const ring = boundsRing(res, worldXf(doc, n.id).xf)
    if (ring) obstacles.push({ id: n.id, levelId: levelIdOf(n.id), ring })
  }

  if (!Number.isFinite(top)) top = groundLevel

  const roomMemo = new Map<string, ClearHeightSamples>()
  const levelMemo = new Map<string, ClearHeightSamples>()
  const defaultSpacing = opts.spacing ?? 0.1

  /** Heights above floor z0 at the given points; ignores the floor slabs of `levelId`. */
  const sample = (points: Float64Array, spacing: number, z0: number, levelId: string, cap: number): ClearHeightSamples => {
    const heights = new Float64Array(points.length / 2)
    let hits = 0
    const accept = (o: CoverOwner) => !(o.type === 'slab' && o.levelId === levelId && (o.kind === 'floor' || o.kind === 'foundation' || o.kind === 'balcony'))
    for (let i = 0; i < heights.length; i++) {
      const zHit = cover.lowestAbove(points[i * 2]!, points[i * 2 + 1]!, z0 + 0.02, accept)
      if (Number.isFinite(zHit)) {
        hits++
        heights[i] = Math.min(cap, zHit - z0)
      } else heights[i] = cap
    }
    return { points, heights, spacing, hits }
  }

  return {
    site,
    buildingType,
    groundLevel,
    levels,
    rooms,
    walls,
    openings,
    slabs,
    roofs,
    stairs,
    railings,
    columns,
    obstacles,
    top,
    cover,
    roomClearHeights(roomId, spacing = defaultSpacing) {
      const key = `${roomId}@${spacing}`
      let s = roomMemo.get(key)
      if (!s) {
        const room = rooms.find((r) => r.id === roomId)
        if (!room) return { points: new Float64Array(0), heights: new Float64Array(0), spacing, hits: 0 }
        const pts = samplePolys(room.polys, spacing)
        s = sample(pts.points, pts.spacing, room.z, room.levelId, room.height)
        roomMemo.set(key, s)
      }
      return s
    },
    levelClearHeights(levelId, spacing = 0.25) {
      const key = `${levelId}@${spacing}`
      let s = levelMemo.get(key)
      if (!s) {
        const level = levelById.get(levelId)
        if (!level || !level.outline.length) return { points: new Float64Array(0), heights: new Float64Array(0), spacing, hits: 0 }
        const pts = samplePolys(level.outline, spacing, 20_000)
        s = sample(pts.points, pts.spacing, level.elevation, levelId, Math.max(0.1, level.height - 0.2))
        levelMemo.set(key, s)
      }
      return s
    },
  }
}
