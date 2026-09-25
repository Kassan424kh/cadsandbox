// Compliance checks (German/EU practice) with plain-language messages, short rule citations and node
// ids for zoom-to. Accessibility findings are failures only when DocMeta.site.barrierFree is set
// (advisory warnings otherwise). Straight-line and heuristic approximations are stated in messages.
//   DIN 18040-2: door clear width ≥ 0.90 m (width − 2 × frame), clear height ≥ 2.05 m, thresholds
//     ≤ 0.02 m, 1.50 × 1.50 m movement areas in baths/kitchens/halls (1.20 m basic), corridors ≥ 1.20 m
//   DIN 18065 Tab. 1: riser 0.14–0.20 (other buildings 0.14–0.19), tread 0.23–0.37 (0.26–0.37),
//     2R+G 0.59–0.65, clear width ≥ 0.80 m (1.00 m), railing ≥ 0.90 m / 1.10 m above 12 m fall height
//   MBO § 38: railings ≥ 0.90 m (fall 1–12 m) / 1.10 m (> 12 m); window sills ≥ 0.80 m / 0.90 m
//   MBO § 47: habitable rooms clear height ≥ 2.40 m (state profiles), windows ≥ 1/8 of the floor area
//   MBO § 35: exit or necessary stair within 35 m (straight-line approximation)
import type { Vec2 } from '@cadsandbox/doc'
import { pointInPolygon, pointSegmentDistance } from '../core/math2d'
import { differencePolygons, nestRings, offsetPolygons, pointInPolys, unionPolygons, type PolyWithHoles } from '../core/polygon'
import { samplePolys, type BuildingModel, type RoomInfo, type Status } from './building'
import { SquareClearance } from './clearance'
import type { ThermalResult } from './thermal'
import type { ZoningResult } from './zoning'

export type CheckCategory = 'accessibility' | 'stairs' | 'fall' | 'rooms' | 'daylight' | 'escape' | 'zoning' | 'energy'

export interface CheckResult {
  /** Unique id: `${code}:${nodeId}` */
  id: string
  /** Message key; the UI translates `analysis.check.<code>` */
  code: string
  category: CheckCategory
  status: Status
  nodeIds: string[]
  /** English message template with {var} placeholders */
  template: string
  vars: Record<string, string | number>
  /** English message with the vars filled in */
  message: string
  /** Short rule citation, e.g. 'DIN 18040-2, 4.3.3' */
  rule: string
}

/** Bundesland profiles (LBO): minimum clear height of habitable rooms. */
export interface LboProfile {
  code: string
  name: string
  law: string
  roomHeight: number
}

export const LBO_PROFILES: readonly LboProfile[] = [
  { code: 'BW', name: 'Baden-Württemberg', law: 'LBO BW', roomHeight: 2.3 },
  { code: 'BY', name: 'Bayern', law: 'BayBO', roomHeight: 2.4 },
  { code: 'BE', name: 'Berlin', law: 'BauO Bln', roomHeight: 2.5 },
  { code: 'BB', name: 'Brandenburg', law: 'BbgBO', roomHeight: 2.4 },
  { code: 'HB', name: 'Bremen', law: 'BremLBO', roomHeight: 2.4 },
  { code: 'HH', name: 'Hamburg', law: 'HBauO', roomHeight: 2.4 },
  { code: 'HE', name: 'Hessen', law: 'HBO', roomHeight: 2.4 },
  { code: 'MV', name: 'Mecklenburg-Vorpommern', law: 'LBauO M-V', roomHeight: 2.4 },
  { code: 'NI', name: 'Niedersachsen', law: 'NBauO', roomHeight: 2.4 },
  { code: 'NW', name: 'Nordrhein-Westfalen', law: 'BauO NRW', roomHeight: 2.4 },
  { code: 'RP', name: 'Rheinland-Pfalz', law: 'LBauO RP', roomHeight: 2.4 },
  { code: 'SL', name: 'Saarland', law: 'LBO SL', roomHeight: 2.4 },
  { code: 'SN', name: 'Sachsen', law: 'SächsBO', roomHeight: 2.4 },
  { code: 'ST', name: 'Sachsen-Anhalt', law: 'BauO LSA', roomHeight: 2.4 },
  { code: 'SH', name: 'Schleswig-Holstein', law: 'LBO SH', roomHeight: 2.4 },
  { code: 'TH', name: 'Thüringen', law: 'ThürBO', roomHeight: 2.4 },
]

export const MBO_PROFILE: LboProfile = { code: '', name: 'Musterbauordnung', law: 'MBO', roomHeight: 2.4 }

export function lboProfile(state: string | undefined): LboProfile {
  return LBO_PROFILES.find((p) => p.code === state?.toUpperCase()) ?? MBO_PROFILE
}

export const CHECK_TEMPLATES: Readonly<Record<string, string>> = {
  'door.width.ok': 'Door clear width {width} m ≥ 0.90 m',
  'door.width.borderline': 'Door clear width {width} m is just below 0.90 m — check the frame (a 1.01 m structural opening after DIN 18101 usually gives 0.90 m)',
  'door.width.low': 'Door clear width {width} m < 0.90 m',
  'door.height.low': 'Door clear height {height} m < 2.05 m',
  'door.threshold': 'Door threshold {sill} m > 0.02 m',
  'turning.ok': '{room}: 1.50 × 1.50 m movement area fits',
  'turning.basic': '{room}: only a 1.20 × 1.20 m movement area fits (1.50 × 1.50 m for wheelchair users)',
  'turning.low': '{room}: no 1.20 × 1.20 m movement area free of furniture',
  'corridor.ok': '{room}: corridor clear width ≥ 1.20 m',
  'corridor.narrow': '{room}: corridor narrows to about {width} m (< 1.20 m)',
  'stair.ok': 'Stair: riser {riser} m, tread {tread} m, 2R+G {pace} m, width {width} m',
  'stair.riser': 'Stair riser {riser} m outside {min}–{max} m',
  'stair.tread': 'Stair tread {tread} m outside {min}–{max} m',
  'stair.pace': 'Stair pace 2R+G {pace} m outside 0.59–0.65 m',
  'stair.width': 'Stair clear width {width} m < {min} m',
  'stair.railing.none': 'Stair without railing or handrail',
  'stair.railing.low': 'Stair railing {height} m < {min} m',
  'railing.ok': 'Railing {height} m ≥ {min} m (fall height {fall} m)',
  'railing.low': 'Railing {height} m < {min} m (fall height {fall} m)',
  'window.sill.low': 'Window sill {sill} m < {min} m at {fall} m fall height — fall protection needed',
  'balcony.railing.none': 'Balcony / terrace {fall} m above ground without a railing',
  'room.height.ok': '{room}: clear height {height} m ≥ {min} m',
  'room.height.low': '{room}: clear height {height} m < {min} m',
  'room.height.attic': '{room}: sloped ceiling — {share} % of the area above 1.50 m reaches 2.20 m (≥ 50 % usual for attic rooms)',
  'daylight.ok': '{room}: windows {windows} m² = {percent} % of {area} m² (≥ 12.5 %)',
  'daylight.low': '{room}: windows {windows} m² = {percent} % of {area} m² (< 12.5 %)',
  'daylight.none': '{room}: no window to the outside',
  'escape.ok': '{room}: exit or stair within {dist} m (≤ 35 m straight line)',
  'escape.far': '{room}: nearest exit or stair {dist} m away (> 35 m straight line)',
  'escape.none': '{room}: no stair or exit on this level',
  'zoning.noplot': 'Enter the plot area to check GRZ, GFZ and BMZ',
  'zoning.grz': 'GRZ {value} (limit {limit})',
  'zoning.gfz': 'GFZ {value} (limit {limit})',
  'zoning.bmz': 'BMZ {value} (limit {limit})',
  'zoning.storeys': 'Full storeys {value} (limit {limit})',
  'zoning.height': 'Building height {value} m (limit {limit} m)',
  'energy.wall.ok': 'External wall U = {u} W/(m²K) ≤ {ref}',
  'energy.wall.high': 'External wall U = {u} W/(m²K) > {ref} (GEG reference)',
  'energy.htprime': "H'T {value} W/(m²K) = {ratio} × reference building ({ref})",
}

const r2 = (v: number) => Math.round(v * 100) / 100
const r3 = (v: number) => Math.round(v * 1000) / 1000

export function formatTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`))
}

interface Ctx {
  out: CheckResult[]
}

function add(ctx: Ctx, code: string, category: CheckCategory, status: Status, nodeIds: string[], vars: Record<string, string | number>, rule: string): void {
  const template = CHECK_TEMPLATES[code] ?? code
  ctx.out.push({ id: `${code}:${nodeIds[0] ?? ctx.out.length}`, code, category, status, nodeIds, template, vars, message: formatTemplate(template, vars), rule })
}

const roomLabel = (r: RoomInfo) => [r.number, r.name].filter(Boolean).join(' ') || 'Room'

function distToRing(p: Vec2, ring: readonly Vec2[]): number {
  if (pointInPolygon(p, ring)) return 0
  let d = Infinity
  for (let i = 0; i < ring.length; i++) d = Math.min(d, pointSegmentDistance(p, ring[i]!, ring[(i + 1) % ring.length]!))
  return d
}

export interface CheckOptions {
  zoning?: ZoningResult
  thermal?: ThermalResult
}

export function runChecks(model: BuildingModel, opts: CheckOptions = {}): CheckResult[] {
  const ctx: Ctx = { out: [] }
  const bfFail: Status = model.site.barrierFree ? 'fail' : 'warn'
  const residential = model.buildingType === 'residential'
  const ground = model.groundLevel
  const levelById = new Map(model.levels.map((l) => [l.id, l]))
  const profile = lboProfile(model.site.state)

  // ---------------------------------------------------------------- accessibility: doors
  for (const o of model.openings) {
    if (o.kind !== 'door' || o.style === 'garage' || o.style === 'revolving') continue
    const clear = Math.max(0, o.width - 2 * o.frameWidth)
    const clearH = Math.max(0, o.height - o.frameWidth)
    const rule = 'DIN 18040-2, 4.3.3'
    if (clear >= 0.9 - 1e-6) add(ctx, 'door.width.ok', 'accessibility', 'pass', [o.id], { width: r3(clear) }, rule)
    else if (clear >= 0.88) add(ctx, 'door.width.borderline', 'accessibility', 'warn', [o.id], { width: r3(clear) }, rule)
    else add(ctx, 'door.width.low', 'accessibility', bfFail, [o.id], { width: r3(clear) }, rule)
    if (clearH < 2.05 - 1e-6) add(ctx, 'door.height.low', 'accessibility', bfFail, [o.id], { height: r3(clearH) }, rule)
    if (o.sill > 0.02 + 1e-6) add(ctx, 'door.threshold', 'accessibility', bfFail, [o.id], { sill: r3(o.sill) }, rule)
  }

  // ---------------------------------------------------------------- accessibility: rooms
  for (const r of model.rooms) {
    const move = r.tags.find((k) => k === 'bath' || k === 'kitchen' || k === 'hall')
    if (r.outdoor || !move) continue
    const blockers = [
      ...model.obstacles.filter((o) => o.levelId === r.levelId).map((o) => o.ring),
      ...model.stairs.filter((s) => s.levelId === r.levelId).map((s) => s.ring),
      ...model.columns.filter((c) => c.levelId === r.levelId).map((c) => c.ring),
    ]
    const free = blockers.length ? differencePolygons(r.polys, unionPolygons(blockers.flatMap((b) => nestRings([b])))) : r.polys
    const name = roomLabel(r)
    const moveRule = move === 'bath' ? 'DIN 18040-2, 5.5' : move === 'kitchen' ? 'DIN 18040-2, 5.4' : 'DIN 18040-2, 4.3.2'
    const clear = new SquareClearance(free, 0.02)
    const half = clear.maxHalf()
    if (half >= 0.75 - 2e-3) add(ctx, 'turning.ok', 'accessibility', 'pass', [r.id], { room: name }, moveRule)
    else if (half >= 0.6 - 2e-3) add(ctx, 'turning.basic', 'accessibility', 'warn', [r.id], { room: name }, moveRule)
    else add(ctx, 'turning.low', 'accessibility', bfFail, [r.id], { room: name }, moveRule)
    if (move === 'hall') {
      const rule = 'DIN 18040-2, 4.3.2'
      if (clear.retained(0.6) >= 0.97) add(ctx, 'corridor.ok', 'accessibility', 'pass', [r.id], { room: name }, rule)
      else {
        let lo = 0, hi = 0.6
        for (let i = 0; i < 12; i++) {
          const mid = (lo + hi) / 2
          if (clear.retained(mid) >= 0.97) lo = mid
          else hi = mid
        }
        add(ctx, 'corridor.narrow', 'accessibility', bfFail, [r.id], { room: name, width: r2(2 * lo) }, rule)
      }
    }
  }

  // ---------------------------------------------------------------- stairs (DIN 18065)
  for (const s of model.stairs) {
    const lim = residential ? { rMin: 0.14, rMax: 0.2, gMin: 0.23, gMax: 0.37, width: 0.8 } : { rMin: 0.14, rMax: 0.19, gMin: 0.26, gMax: 0.37, width: 1.0 }
    const rule = residential ? 'DIN 18065, Tab. 1 (residential ≤ 2 dwellings)' : 'DIN 18065, Tab. 1'
    const pace = 2 * s.riserHeight + s.treadDepth
    let ok = true
    if (s.riserHeight < lim.rMin - 1e-6 || s.riserHeight > lim.rMax + 1e-6) {
      ok = false
      add(ctx, 'stair.riser', 'stairs', 'fail', [s.id], { riser: r3(s.riserHeight), min: lim.rMin, max: lim.rMax }, rule)
    }
    if (s.treadDepth < lim.gMin - 1e-6 || s.treadDepth > lim.gMax + 1e-6) {
      ok = false
      add(ctx, 'stair.tread', 'stairs', 'fail', [s.id], { tread: r3(s.treadDepth), min: lim.gMin, max: lim.gMax }, rule)
    }
    if (pace < 0.59 - 1e-6 || pace > 0.65 + 1e-6) {
      ok = false
      add(ctx, 'stair.pace', 'stairs', 'warn', [s.id], { pace: r3(pace) }, 'DIN 18065, 2R + G')
    }
    if (s.width < lim.width - 1e-6) {
      ok = false
      add(ctx, 'stair.width', 'stairs', 'fail', [s.id], { width: r3(s.width), min: lim.width }, rule)
    }
    const fall = s.z + s.rise - ground
    const minRail = fall > 12 ? 1.1 : 0.9
    if (s.railing === 'none') {
      ok = false
      add(ctx, 'stair.railing.none', 'stairs', 'warn', [s.id], {}, 'DIN 18065, 6.8 / MBO § 38')
    } else if (s.railingHeight < minRail - 1e-6) {
      ok = false
      add(ctx, 'stair.railing.low', 'stairs', 'fail', [s.id], { height: r3(s.railingHeight), min: minRail }, 'DIN 18065 / MBO § 38 (3)')
    }
    if (ok) add(ctx, 'stair.ok', 'stairs', 'pass', [s.id], { riser: r3(s.riserHeight), tread: r3(s.treadDepth), pace: r3(pace), width: r3(s.width) }, rule)
  }

  // ---------------------------------------------------------------- fall protection (MBO § 38)
  for (const r of model.railings) {
    const fall = r.z - ground
    if (fall <= 1 + 1e-6) continue
    const min = fall > 12 ? 1.1 : 0.9
    add(ctx, r.height >= min - 1e-6 ? 'railing.ok' : 'railing.low', 'fall', r.height >= min - 1e-6 ? 'pass' : 'fail', [r.id], { height: r3(r.height), min, fall: r2(fall) }, 'MBO § 38 (3)')
  }
  for (const o of model.openings) {
    if (o.kind !== 'window' || o.style === 'skylight' || !o.exterior) continue
    const level = levelById.get(o.levelId)
    const fall = (level?.elevation ?? o.z - o.sill) - ground
    if (fall <= 1 + 1e-6) continue
    const min = fall > 12 ? 0.9 : 0.8
    if (o.sill < min - 1e-6) add(ctx, 'window.sill.low', 'fall', 'warn', [o.id], { sill: r3(o.sill), min, fall: r2(fall) }, 'MBO § 38 (2)')
  }
  const outdoorAreas = [
    ...model.slabs.filter((s) => s.kind === 'balcony').map((s) => ({ id: s.id, levelId: s.levelId, polys: s.polys, z: s.top })),
    ...model.rooms.filter((r) => r.outdoor).map((r) => ({ id: r.id, levelId: r.levelId as string | null, polys: r.polys, z: r.z })),
  ]
  const seenBalcony: PolyWithHoles[] = []
  for (const b of outdoorAreas) {
    const fall = b.z - ground
    if (fall <= 1 + 1e-6) continue
    const grown = offsetPolygons(b.polys, 0.3, 'miter')
    // a balcony room on a balcony slab is one balcony
    if (seenBalcony.some((p) => b.polys.some((q) => pointInPolys(q.outer[0]!, [p])))) continue
    seenBalcony.push(...grown)
    const railed = model.railings.some((r) => (r.levelId === b.levelId || Math.abs(r.z - b.z) < 0.5) && r.path.some((p) => pointInPolys(p, grown)))
    if (!railed) add(ctx, 'balcony.railing.none', 'fall', 'warn', [b.id], { fall: r2(fall) }, 'MBO § 38 (3)')
  }

  // ---------------------------------------------------------------- habitable rooms
  const exits = (levelId: string): { rings: Vec2[][]; points: Vec2[] } => {
    const level = levelById.get(levelId)
    const rings: Vec2[][] = []
    const points: Vec2[] = []
    for (const s of model.stairs) {
      const arrives = level && Math.abs(s.z + s.rise - level.elevation) < 0.3
      if (s.levelId === levelId || arrives) rings.push(s.ring)
    }
    if (level && Math.abs(level.elevation - ground) <= 1.5) for (const o of model.openings) if (o.kind === 'door' && o.exterior && o.levelId === levelId) points.push(o.center)
    return { rings, points }
  }
  const exitCache = new Map<string, { rings: Vec2[][]; points: Vec2[] }>()
  for (const r of model.rooms) {
    if (!r.habitable || r.outdoor) continue
    const name = roomLabel(r)
    // clear height
    const s = model.roomClearHeights(r.id)
    const sorted = Float64Array.from(s.heights).sort()
    // 5th percentile ignores slivers where a roof dips into the room edge; > 0.25 m spread = sloped
    const lo = sorted.length ? sorted[Math.floor(sorted.length * 0.05)]! : r.height
    const hi = sorted.length ? sorted[sorted.length - 1]! : r.height
    const lawRule = profile.code ? `${profile.law} (MBO § 47 (1))` : 'MBO § 47 (1)'
    if (s.hits > 0 && hi - lo > 0.25) {
      let over150 = 0, over220 = 0
      for (const h of s.heights) {
        if (h > 1.5 + 1e-9) over150++
        if (h >= 2.2 - 1e-9) over220++
      }
      const share = over150 ? over220 / over150 : 0
      add(ctx, 'room.height.attic', 'rooms', share >= 0.5 ? 'pass' : 'warn', [r.id], { room: name, share: Math.round(share * 100) }, `${lawRule}, attic rooms`)
    } else if (lo >= profile.roomHeight - 1e-6) add(ctx, 'room.height.ok', 'rooms', 'pass', [r.id], { room: name, height: r2(lo), min: profile.roomHeight }, lawRule)
    else add(ctx, 'room.height.low', 'rooms', residential ? 'warn' : 'fail', [r.id], { room: name, height: r2(lo), min: profile.roomHeight }, residential ? `${lawRule}; exemptions for GK 1–2 residential` : lawRule)

    // daylight (window area ≥ 1/8 of the floor area)
    const wins = model.openings.filter((o) => o.kind === 'window' && o.exterior && o.levelId === r.levelId && (pointInPolys(o.sides[0], r.polys) || pointInPolys(o.sides[1], r.polys)))
    const winArea = wins.reduce((a, o) => a + o.area, 0)
    const dRule = 'MBO § 47 (2)'
    if (!wins.length) add(ctx, 'daylight.none', 'daylight', 'fail', [r.id], { room: name }, dRule)
    else {
      const pct = r.area > 0 ? (winArea / r.area) * 100 : 0
      add(ctx, pct >= 12.5 - 1e-6 ? 'daylight.ok' : 'daylight.low', 'daylight', pct >= 12.5 - 1e-6 ? 'pass' : 'fail', [r.id, ...wins.map((w) => w.id)], { room: name, windows: r2(winArea), percent: Math.round(pct * 10) / 10, area: r2(r.area) }, dRule)
    }

    // escape route (straight line to the nearest stair or exterior door)
    let ex = exitCache.get(r.levelId)
    if (!ex) exitCache.set(r.levelId, (ex = exits(r.levelId)))
    const eRule = 'MBO § 35 (2)'
    if (!ex.rings.length && !ex.points.length) {
      add(ctx, 'escape.none', 'escape', 'fail', [r.id], { room: name }, eRule)
      continue
    }
    const pts: Vec2[] = r.polys.flatMap((p) => p.outer)
    const grid = samplePolys(r.polys, 1, 2000).points
    for (let i = 0; i < grid.length; i += 2) pts.push([grid[i]!, grid[i + 1]!])
    let worst = 0
    for (const p of pts) {
      let d = Infinity
      for (const ring of ex.rings) d = Math.min(d, distToRing(p, ring))
      for (const q of ex.points) d = Math.min(d, Math.hypot(p[0] - q[0], p[1] - q[1]))
      worst = Math.max(worst, d)
    }
    add(ctx, worst <= 35 ? 'escape.ok' : 'escape.far', 'escape', worst <= 35 ? 'pass' : 'fail', [r.id], { room: name, dist: r2(worst) }, eRule)
  }

  // ---------------------------------------------------------------- zoning
  if (opts.zoning) {
    const z = opts.zoning
    if (z.plotArea == null) add(ctx, 'zoning.noplot', 'zoning', 'info', [], {}, 'BauNVO §§ 19–21')
    for (const row of z.rows) {
      if (row.limit == null || row.value == null) continue
      add(ctx, `zoning.${row.key}`, 'zoning', row.status, [], { value: row.key === 'storeys' ? row.value : r2(row.value), limit: row.limit }, row.rule)
    }
  }

  // ---------------------------------------------------------------- energy
  if (opts.thermal) {
    const t = opts.thermal
    for (const b of t.buildUps) add(ctx, b.status === 'pass' ? 'energy.wall.ok' : 'energy.wall.high', 'energy', b.status, b.wallIds, { u: r2(b.u), ref: b.uRef }, 'GEG Anlage 1')
    if (t.area > 0 && t.status !== 'info') add(ctx, 'energy.htprime', 'energy', t.status, [], { value: r3(t.htPrime), ratio: r2(t.ratio), ref: r3(t.htPrimeRef) }, 'GEG § 16')
  }
  return ctx.out
}
