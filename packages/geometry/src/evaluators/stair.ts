// Stairs per DIN 18065: straight / L / U / spiral, riser rule 2R + G ≈ 0.63 m, landings, structures,
// railings, plan symbology (treads, walking line + arrow, break line at the cut height).
import type { NodeBase, StairParams, Vec2, Vec3 } from '@cadsandbox/doc'
import type { GeometryResult, MeshPart, SnapPoint } from '../api'
import { DrawingBuilder } from '../core/drawing'
import { TAU } from '../core/math2d'
import { MeshBuilder } from '../core/mesh'
import { PartSet, addBox, addCylinderBetween, addCylinderZ, addPrismAlong } from '../core/solids'
import type { EvalContext } from './context'
import { errorResult, finish, snap } from './result'

export interface RiserSolve {
  count: number
  riser: number
  tread: number
  comfort: number
}

/** DIN 18065 comfort rule: 2R + G ≈ 0.63 m, R ≤ 0.19 m (R ≥ 0.14 m when possible). */
export function solveRisers(rise: number, treadDepth: number, requested: number): RiserSolve {
  const G = Math.max(0.2, treadDepth)
  let n = requested > 0 ? Math.round(requested) : 0
  if (n <= 0) {
    const ideal = Math.max(0.14, Math.min(0.19, (0.63 - G) / 2))
    n = Math.max(1, Math.round(rise / ideal))
    while (rise / n > 0.19 + 1e-9) n++
    while (n > 1 && rise / n < 0.14 - 1e-9) n--
  }
  const riser = rise / n
  return { count: n, riser, tread: G, comfort: 2 * riser + G }
}

interface Flight {
  /** number of risers in this flight */
  n: number
  /** z of the flight start (top of the previous landing / floor) */
  z0: number
  /** riser index offset (for plan numbering / break line) */
  first: number
  /** local→node transform: flight climbs along local +Y from local origin, width across X */
  m: number[]
}

const SLAB = 0.16
const TREAD_T = 0.045
const RISER_T = 0.02

function mat(cx: number, cy: number, angle: number, z = 0): number[] {
  const c = Math.cos(angle), s = Math.sin(angle)
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, cx, cy, z, 1]
}

/** Sawtooth (y,z) profile from the top landing edge down to the first riser (CCW when closed with the soffit). */
function stepProfile(n: number, R: number, G: number, nosing: number): Vec2[] {
  const pts: Vec2[] = []
  for (let i = n - 1; i >= 0; i--) {
    const yr = i * G // riser i position
    const zt = (i + 1) * R // tread top after riser i
    pts.push([yr + G, zt]) // back of the tread (or the landing edge for the last riser)
    if (nosing > 0) {
      pts.push([yr - nosing, zt], [yr - nosing, zt - TREAD_T], [yr, zt - TREAD_T])
    } else pts.push([yr, zt])
    pts.push([yr, zt - R])
  }
  return pts
}

function buildFlight(parts: PartSet, p: StairParams, R: number, G: number, fl: Flight, width: number): void {
  const n = fl.n
  const run = n * G
  const main = new MeshBuilder(256)
  const second = new MeshBuilder(64)
  const hw = width / 2
  if (p.structure === 'solid') {
    // profile: steps (top→bottom) then floor and soffit back up to the landing edge
    const steps = stepProfile(n, R, G, p.nosing)
    const soffitStart = Math.min(run, (SLAB / R) * G) // where the sloped soffit meets the floor
    const ring: Vec2[] = [...steps, [soffitStart, 0], [run, n * R - SLAB]]
    // remove the duplicate first riser bottom (0,0) already present as the last step point
    addPrismAlong(main, ring, [-hw, 0, fl.z0], [hw, 0, fl.z0], [0, 1, 0], [0, 0, 1])
  } else {
    for (let i = 0; i < n; i++) {
      const y = i * G
      const zt = fl.z0 + (i + 1) * R
      const t = p.structure === 'floating' ? 0.06 : TREAD_T
      addBox(main, -hw, y - p.nosing, zt - t, hw, y + G, zt)
      if (p.structure === 'stringer') addBox(second, -hw + 0.05, y, zt - R, hw - 0.05, y + RISER_T, zt - t)
    }
    if (p.structure === 'stringer') {
      // two sloped stringers following the pitch line
      for (const x of [-hw, hw - 0.05]) {
        const ring: Vec2[] = [[0, 0], [run, n * R - R], [run, n * R - R + 0.25], [0, 0.25]]
        addPrismAlong(second, ring, [x, 0, fl.z0], [x + 0.05, 0, fl.z0], [0, 1, 0], [0, 0, 1])
      }
    }
  }
  const mainMesh = main.build()
  parts.get(null).append(mainMesh, fl.m)
  if (second.vertexCount) parts.get('mat-steel-dark').append(second.build(), fl.m)
  // railings
  const rail = new MeshBuilder(128)
  const sides: number[] = []
  if (p.railing === 'left' || p.railing === 'both') sides.push(-hw + 0.04)
  if (p.railing === 'right' || p.railing === 'both') sides.push(hw - 0.04)
  for (const x of sides) {
    const zTop = (y: number) => fl.z0 + (y / G) * R + R + p.railingHeight
    addCylinderBetween(rail, [x, -p.nosing, zTop(-p.nosing)], [x, run, zTop(run)], 0.02, 10)
    for (let i = 0; i <= n; i += 2) {
      const y = Math.min(run, i * G)
      addCylinderBetween(rail, [x, y, fl.z0 + Math.min(n, i + 1) * R], [x, y, zTop(y) - 0.02], 0.012, 8)
    }
  }
  if (rail.vertexCount) parts.get('mat-steel-dark').append(rail.build(), fl.m)
}

function landing(parts: PartSet, x0: number, y0: number, x1: number, y1: number, zTop: number): void {
  addBox(parts.get(null), x0, y0, zTop - SLAB, x1, y1, zTop)
}

export function evaluateStair(node: NodeBase<'stair'>, ctx: EvalContext): GeometryResult {
  const p = node.params
  const rise = p.rise > 0 ? p.rise : ctx.level.height
  const width = Math.max(0.6, p.width)
  const rs = solveRisers(rise, p.treadDepth, p.riserCount)
  const { count: n, riser: R, tread: G } = rs
  const parts = new PartSet()
  const d = new DrawingBuilder()
  const cutZ = ctx.level.cutHeight
  const snaps: SnapPoint[] = [snap('insertion', 0, 0, 0)]
  const hw = width / 2
  const turn = p.turn === 'left' ? 1 : -1
  const walk: Vec3[] = [] // walking line (node space) with z
  let run = 0
  const planFlight = (fl: Flight, riserFrom: number): void => {
    const m = fl.m
    const T = (x: number, y: number): Vec2 => [m[0]! * x + m[4]! * y + m[12]!, m[1]! * x + m[5]! * y + m[13]!]
    const runF = fl.n * G
    for (let i = 0; i <= fl.n; i++) {
      const y = i * G
      const zTop = fl.z0 + (i + 1) * R
      const above = fl.z0 + i * R >= cutZ - 1e-9
      const a = T(-hw, y), b = T(hw, y)
      d.segP(above ? 'overhead' : 'thin', a, b)
      void zTop
    }
    for (const x of [-hw, hw]) d.segP('thin', T(x, 0), T(x, runF))
    // break line where the flight crosses the cut plane
    const k = (cutZ - fl.z0) / R
    if (k > 0 && k < fl.n) {
      const y = Math.min(runF - 0.05, Math.max(0.05, Math.floor(k) * G + G * 0.5))
      const a = T(-hw, y - 0.15), b = T(-hw * 0.2, y + 0.15), c = T(hw * 0.2, y - 0.15), e = T(hw, y + 0.15)
      d.polyline('symbol', [a, b, c, e], false)
    }
    for (let i = 0; i <= fl.n; i++) walk.push([...T(0, i * G), fl.z0 + i * R])
    void riserFrom
  }
  if (p.kind === 'spiral') {
    const ri = Math.max(0.05, p.innerRadius ?? 0.15)
    const ro = ri + width
    const sweep = ((p.sweepDeg && p.sweepDeg > 0 ? p.sweepDeg : 270) * Math.PI) / 180
    const step = sweep / n
    const main = parts.get(null)
    addCylinderZ(main, 0, 0, ri, 0, rise, 24)
    const rail = parts.get('mat-steel-dark')
    for (let i = 0; i < n; i++) {
      const a0 = turn * i * step, a1 = turn * (i + 1) * step
      const zt = (i + 1) * R
      const sector: Vec3[] = []
      const segs = 6
      for (let k = 0; k <= segs; k++) sector.push([Math.cos(a0 + ((a1 - a0) * k) / segs) * ri, Math.sin(a0 + ((a1 - a0) * k) / segs) * ri, 0])
      const outer: Vec3[] = []
      for (let k = segs; k >= 0; k--) outer.push([Math.cos(a0 + ((a1 - a0) * k) / segs) * ro, Math.sin(a0 + ((a1 - a0) * k) / segs) * ro, 0])
      const ring2: Vec2[] = [...sector, ...outer].map((q) => [q[0], q[1]] as Vec2)
      const ringCCW = turn > 0 ? ring2 : ring2.slice().reverse()
      // tread slab
      const mb = new MeshBuilder(64)
      const top: Vec3[] = ringCCW.map((q) => [q[0], q[1], zt])
      const bot: Vec3[] = ringCCW.map((q) => [q[0], q[1], zt - 0.06])
      mb.face(top, [], [0, 0, 1])
      mb.face(bot, [], [0, 0, -1])
      for (let k = 0; k < ringCCW.length; k++) {
        const a = ringCCW[k]!, b = ringCCW[(k + 1) % ringCCW.length]!
        mb.quadFace([a[0], a[1], zt - 0.06], [b[0], b[1], zt - 0.06], [b[0], b[1], zt], [a[0], a[1], zt])
      }
      main.append(mb.build())
      // plan: tread edges
      const pa: Vec2 = [Math.cos(a0) * ri, Math.sin(a0) * ri], pb: Vec2 = [Math.cos(a0) * ro, Math.sin(a0) * ro]
      d.segP(i * R >= cutZ ? 'overhead' : 'thin', pa, pb)
      // railing post + handrail on the outer edge
      if (p.railing !== 'none') {
        const px = Math.cos(a0) * (ro - 0.04), py = Math.sin(a0) * (ro - 0.04)
        addCylinderZ(rail, px, py, 0.012, zt, zt + p.railingHeight, 8)
        const qx = Math.cos(a1) * (ro - 0.04), qy = Math.sin(a1) * (ro - 0.04)
        addCylinderBetween(rail, [px, py, zt + p.railingHeight], [qx, qy, zt + R + p.railingHeight], 0.02, 8)
      }
      walk.push([Math.cos(a0) * (ri + width * 0.5), Math.sin(a0) * (ri + width * 0.5), i * R])
    }
    d.circle('thin', [0, 0], ri)
    d.arc('thin', [0, 0], ro, 0, turn * sweep)
    run = sweep * (ri + width / 2)
  } else {
    const flights: Flight[] = []
    if (p.kind === 'straight') flights.push({ n, z0: 0, first: 0, m: mat(0, 0, 0) })
    else {
      const n1 = Math.max(1, Math.round(n / 2))
      const n2 = Math.max(1, n - n1)
      const run1 = n1 * G
      const L = Math.max(width, p.landingDepth)
      const zL = n1 * R
      flights.push({ n: n1, z0: 0, first: 0, m: mat(0, 0, 0) })
      if (p.kind === 'l-shape') {
        // landing square [−hw, hw] × [run1, run1 + L], flight 2 leaves toward turn side (left = −X)
        landing(parts, -hw, run1, hw, run1 + L, zL)
        d.rect('thin', -hw, run1, hw, run1 + L)
        const angle = turn > 0 ? Math.PI / 2 : -Math.PI / 2
        flights.push({ n: n2, z0: zL, first: n1, m: mat(turn * -hw, run1 + L / 2, angle) })
        walk.push([0, run1, zL])
      } else {
        // u-shape: landing spans both flights, flight 2 returns alongside
        const x0 = turn > 0 ? -1.5 * width : -hw
        const x1 = turn > 0 ? hw : 1.5 * width
        landing(parts, x0, run1, x1, run1 + L, zL)
        d.rect('thin', x0, run1, x1, run1 + L)
        flights.push({ n: n2, z0: zL, first: n1, m: mat(turn * -width, run1 + L, Math.PI) })
        walk.push([0, run1 + L / 2, zL], [turn * -width, run1 + L / 2, zL])
      }
    }
    for (const fl of flights) {
      buildFlight(parts, p, R, G, fl, width)
      planFlight(fl, fl.first)
    }
    run = flights.reduce((s, f) => s + f.n * G, 0)
  }
  // walking line with start circle and arrow head (plan symbol)
  if (walk.length >= 2) {
    const pts2: Vec2[] = walk.map((q) => [q[0], q[1]])
    d.polyline('symbol', pts2, false)
    d.circle('symbol', pts2[0]!, 0.05)
    const a = pts2[pts2.length - 2]!, b = pts2[pts2.length - 1]!
    const dx = b[0] - a[0], dy = b[1] - a[1]
    const l = Math.hypot(dx, dy) || 1
    const ux = dx / l, uy = dy / l
    d.seg('symbol', b[0], b[1], b[0] - ux * 0.15 - uy * 0.07, b[1] - uy * 0.15 + ux * 0.07)
    d.seg('symbol', b[0], b[1], b[0] - ux * 0.15 + uy * 0.07, b[1] - uy * 0.15 - ux * 0.07)
    snaps.push(snap('endpoint', ...walk[0]!), snap('endpoint', ...walk[walk.length - 1]!))
  }
  const meshParts: MeshPart[] = parts.build()
  if (!meshParts.length) return errorResult('Stair produced no geometry')
  return finish(meshParts, {
    edges: 'auto',
    plan: d.build(),
    snaps,
    quantities: { risers: n, treads: Math.max(0, n - 1), riserHeight: R, treadDepth: G, comfort: rs.comfort, rise, run, width },
  })
}

export { TAU }
