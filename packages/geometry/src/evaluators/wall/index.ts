// Wall evaluator: frame → joins → layered solids with openings → plan → quantities & snaps.
import type { NodeBase } from '@cadsandbox/doc'
import type { GeometryResult, MeshPart, SnapPoint } from '../../api'
import { polygonArea } from '../../core/math2d'
import type { EvalContext } from '../context'
import { errorResult, finish, snap } from '../result'
import { WallFrame, transformWallParams } from './frame'
import { solveJoins, type NeighborFrame, type WallSolve } from './joins'
import { buildWallMesh, openingCuts } from './mesh'
import { buildWallPlan } from './plan'

export { WallFrame, solveJoins, openingCuts, buildWallMesh, buildWallPlan }

/** Build neighbour frames in the wall's local frame (skips walls on other elevations). */
export function neighborFrames(ctx: EvalContext, self: WallFrame): NeighborFrame[] {
  const out: NeighborFrame[] = []
  for (const nb of ctx.walls ?? []) {
    const p = transformWallParams(nb.params, nb.xf)
    // shift base elevation into our frame
    const frame = new WallFrame({ ...p, baseOffset: (p.baseOffset ?? 0) + nb.dz }, null)
    if (frame.z1 <= self.z0 + 1e-6 || frame.z0 >= self.z1 - 1e-6) continue
    out.push({ id: nb.id, frame })
  }
  return out
}

export function evaluateWall(node: NodeBase<'wall'>, ctx: EvalContext): GeometryResult {
  const p = node.params
  if (!p.a || !p.b || Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]) < 1e-4) return errorResult('Wall is too short')
  const frame = new WallFrame(p, node.material)
  const solve: WallSolve = solveJoins(node.id, frame, neighborFrames(ctx, frame))
  const cuts = openingCuts(frame, solve, ctx.openings)
  const built = buildWallMesh(frame, solve, cuts)
  const parts: MeshPart[] = built.layers.map((l) => ({
    mesh: l.mesh,
    material: l.band.material && (frame.layers.length > 1 || l.band.material !== node.material) ? { id: l.band.material } : 'node',
    castShadow: true,
    receiveShadow: true,
  }))
  const plan = buildWallPlan(frame, solve, cuts, ctx)
  const height = frame.z1 - frame.z0
  const footprintArea = Math.abs(polygonArea(solve.footprint))
  let openingArea = 0
  let openingVolume = 0
  for (const c of cuts) {
    const a = (c.s1 - c.s0) * (c.z1 - c.z0)
    openingArea += a
    openingVolume += a * frame.t
  }
  // Quantities (one reference face unless stated): grossArea = length × height, netArea = grossArea −
  // openingArea, surfaceArea = both faces net, volume = joined footprint × height − opening volumes.
  const gross = frame.L * height
  const net = Math.max(0, gross - openingArea)
  const quantities: Record<string, number> = {
    length: frame.L,
    height,
    thickness: frame.t,
    grossArea: gross,
    openingArea,
    netArea: net,
    surfaceArea: 2 * net,
    volume: Math.max(0, footprintArea * height - openingVolume),
    openings: cuts.reduce((s, c) => s + c.ids.length, 0),
  }
  const snaps: SnapPoint[] = []
  for (const z of [frame.z0, frame.z1]) {
    const a = frame.point(0, 0), b = frame.point(frame.L, 0), m = frame.point(frame.L / 2, 0)
    snaps.push(snap('endpoint', a[0], a[1], z), snap('endpoint', b[0], b[1], z), snap('midpoint', m[0], m[1], z))
  }
  for (const q of solve.footprint) snaps.push(snap('vertex', q[0], q[1], frame.z0))
  return finish(parts, { edges: built.edges, plan, snaps, quantities })
}
