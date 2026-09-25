// Openings (doors / windows / plain holes) hosted by a wall. Geometry is built in the "opening
// frame" (x along the wall, y toward the wall's left side, z up from the sill, origin at the axis)
// and mapped into the node's local space via the host wall frame (node transform is ignored).
import type { NodeBase, OpeningParams, Vec3 } from '@cadsandbox/doc'
import { multiplyMatrices } from '@cadsandbox/doc'
import type { GeometryResult, SnapPoint } from '../../api'
import { transformDrawing } from '../../core/drawing'
import { affineFromMat4 } from '../../core/math2d'
import { transformBounds } from '../../core/mesh'
import { PartSet } from '../../core/solids'
import type { EvalContext } from '../context'
import { drawingBounds, finish, snapAt } from '../result'
import { WallFrame } from '../wall/frame'
import { buildDoor } from './door3d'
import { buildOpeningPlan } from './plan'
import { buildWindow } from './window3d'

export interface OpeningFrame {
  p: OpeningParams
  /** clear width / height */
  w: number
  h: number
  /** host wall thickness */
  t: number
  /** frame face width / depth (depth 0 → wall thickness) */
  fw: number
  fd: number
  /** hinge x position and the swing side sign (+1 = wall left / +y) */
  hingeX: number
  swing: 1 | -1
  /** z of the sill relative to the wall base, and wall top relative to the sill */
  sill: number
  wallTop: number
  /** plan cut plane height relative to the sill */
  cutZ: number
  materials: { frame: string | null; panel: string | null; glass: string }
}

export function openingFrame(p: OpeningParams, wallT: number, wallHeight: number, cutHeightAboveBase: number): OpeningFrame {
  const w = Math.max(0.05, p.width)
  const h = Math.max(0.05, p.height)
  const fw = Math.max(0, Math.min(p.frameWidth, w / 3))
  const fd = p.frameDepth > 0 ? Math.min(p.frameDepth, wallT) : wallT
  return {
    p,
    w,
    h,
    t: wallT,
    fw,
    fd,
    // hinge seen from the wall's left side (+y, looking toward -y): observer's left = +x
    hingeX: p.hinge === 'left' ? w / 2 : -w / 2,
    swing: p.opensTo === 'left' ? 1 : -1,
    sill: Math.max(0, p.sill),
    wallTop: wallHeight - Math.max(0, p.sill),
    cutZ: cutHeightAboveBase - Math.max(0, p.sill),
    materials: { frame: p.frameMaterial ?? null, panel: p.panelMaterial ?? null, glass: p.glassMaterial ?? 'mat-glass' },
  }
}

/** Column-major 4×4 from basis vectors and origin. */
function basisMatrix(u: Vec3, v: Vec3, w: Vec3, o: Vec3): Float64Array {
  return new Float64Array([u[0], u[1], u[2], 0, v[0], v[1], v[2], 0, w[0], w[1], w[2], 0, o[0], o[1], o[2], 1])
}

export function evaluateOpening(node: NodeBase<'opening'>, ctx: EvalContext): GeometryResult {
  const p = node.params
  let matrix: Float64Array
  let wallT: number
  let wallHeight: number
  let cutAboveBase: number
  if (ctx.host) {
    const wf = new WallFrame(ctx.host.wall, null)
    const sc = wf.sFromRef(p.offset)
    const origin = wf.point(sc, 0)
    const tan = wf.tangent(sc)
    const nrm = wf.normal(sc)
    const local = basisMatrix([tan[0], tan[1], 0], [nrm[0], nrm[1], 0], [0, 0, 1], [origin[0], origin[1], wf.z0 + Math.max(0, p.sill)])
    matrix = multiplyMatrices(Float64Array.from(ctx.host.toLocal), local)
    wallT = wf.t
    wallHeight = wf.z1 - wf.z0
    cutAboveBase = ctx.level.cutHeight - wf.z0
  } else {
    // free-standing: node local frame is the opening frame
    wallT = p.frameDepth > 0 ? p.frameDepth : 0.2
    wallHeight = ctx.level.height
    cutAboveBase = ctx.level.cutHeight
    matrix = basisMatrix([1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, 0])
  }
  const f = openingFrame(p, wallT, wallHeight, cutAboveBase)
  const parts = new PartSet()
  if (p.kind === 'door') buildDoor(parts, f)
  else if (p.kind === 'window') buildWindow(parts, f)
  const meshParts = parts.build(matrix)
  const plan = transformDrawing(buildOpeningPlan(f), affineFromMat4(matrix))
  const localBounds = { min: [-f.w / 2, -f.t / 2, 0] as Vec3, max: [f.w / 2, f.t / 2, f.h] as Vec3 }
  const worldish = transformBounds(localBounds, matrix)
  const snaps: SnapPoint[] = []
  const M = matrix
  const tp = (x: number, y: number, z: number): Vec3 => [M[0]! * x + M[4]! * y + M[8]! * z + M[12]!, M[1]! * x + M[5]! * y + M[9]! * z + M[13]!, M[2]! * x + M[6]! * y + M[10]! * z + M[14]!]
  snaps.push(snapAt('insertion', tp(0, 0, 0)), snapAt('midpoint', tp(0, 0, f.h / 2)), snapAt('midpoint', tp(0, 0, f.h)))
  for (const x of [-f.w / 2, f.w / 2]) for (const z of [0, f.h]) snaps.push(snapAt('endpoint', tp(x, 0, z)))
  const quantities = { width: f.w, height: f.h, area: f.w * f.h, sill: f.sill, count: 1 }
  const res = finish(meshParts, { edges: 'auto', plan, snaps, quantities, extraBounds: drawingBounds(plan, M[14]!) ?? worldish })
  if (!meshParts.length) res.bounds = worldish
  return res
}
