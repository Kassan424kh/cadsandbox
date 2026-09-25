// IFC → parametric architecture: recognizes walls that are plain vertical extrusions of a rectangle
// (→ 'wall'), openings placeable along such a wall (→ 'opening'), and space footprints (→ 'room').
// Everything returned is in world meters, Z-up.
import type { Vec2 } from '@cadsandbox/doc'
import { signedArea } from '../util/geom2d'
import { apply, applyDir, list, mul, num, ref, str, type IfcModel, type Mat } from './ifc-model'

export interface WallFit {
  a: Vec2
  b: Vec2
  thickness: number
  height: number
  baseZ: number
}

export interface OpeningFit {
  offset: number
  width: number
  sill: number
  height: number
}

type Line = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

function reps(model: IfcModel, productId: number): Line[] {
  const shape = model.line(ref(model.line(productId)?.Representation))
  return list(shape?.Representations)
    .map((r) => model.line(ref(r)))
    .filter((r): r is Line => !!r)
}

/** Closed 2D profile points of IfcRectangleProfileDef / IfcArbitraryClosedProfileDef (profile space, model units). */
function profilePoints(model: IfcModel, profileId: number | null): Vec2[] | null {
  const W = model.W
  const p = model.line(profileId)
  if (!p || !profileId) return null
  const type = model.api.GetLineType(model.id, profileId)
  const pos: Mat | null = p.Position ? model.axis3(p.Position) : null
  const place = (pts: Vec2[]): Vec2[] => (pos ? pts.map(([x, y]) => [apply(pos, x, y, 0)[0], apply(pos, x, y, 0)[1]]) : pts)
  if (type === W.IFCRECTANGLEPROFILEDEF) {
    const x = (num(p.XDim) ?? 0) / 2,
      y = (num(p.YDim) ?? 0) / 2
    if (!x || !y) return null
    return place([
      [-x, -y],
      [x, -y],
      [x, y],
      [-x, y],
    ])
  }
  if (type === W.IFCARBITRARYCLOSEDPROFILEDEF) {
    const curveId = ref(p.OuterCurve)
    const curve = model.line(curveId)
    if (!curve || !curveId) return null
    const ct = model.api.GetLineType(model.id, curveId)
    let pts: Vec2[] = []
    if (ct === W.IFCPOLYLINE) pts = list(curve.Points).map((q) => model.point(q) as unknown as Vec2)
    else if (ct === W.IFCINDEXEDPOLYCURVE) {
      if (list(curve.Segments).some((s) => String((s as { constructor?: { name?: string } })?.constructor?.name ?? '').includes('Arc'))) return null
      const pl = model.line(ref(curve.Points))
      pts = list(pl?.CoordList).map((c) => list(c).map((v) => num(v) ?? 0) as unknown as Vec2)
    } else return null
    pts = pts.map((q) => [q[0] ?? 0, q[1] ?? 0])
    if (pts.length > 1) {
      const f = pts[0]!,
        l = pts[pts.length - 1]!
      if (Math.hypot(f[0] - l[0], f[1] - l[1]) < 1e-9) pts.pop()
    }
    return pts.length >= 3 ? place(pts) : null
  }
  return null
}

interface Extrusion {
  /** profile outline in world meters (XY) */
  outline: Vec2[]
  baseZ: number
  height: number
}

/** Body = single vertical IfcExtrudedAreaSolid with a horizontal profile. */
function verticalExtrusion(model: IfcModel, productId: number): Extrusion | null {
  const W = model.W
  const body = reps(model, productId).find((r) => str(r.RepresentationIdentifier) === 'Body')
  const items = list(body?.Items)
  if (items.length !== 1) return null
  const solidId = ref(items[0])
  if (!solidId || model.api.GetLineType(model.id, solidId) !== W.IFCEXTRUDEDAREASOLID) return null
  const solid = model.line(solidId)!
  const prof = profilePoints(model, ref(solid.SweptArea))
  if (!prof) return null
  const s = model.scale
  const M = mul(model.placement(ref(model.line(productId)?.ObjectPlacement)), solid.Position ? model.axis3(solid.Position) : new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]))
  const dir = model.direction(solid.ExtrudedDirection, [0, 0, 1])
  const depth = (num(solid.Depth) ?? 0) * s
  const e = applyDir(M, dir[0] ?? 0, dir[1] ?? 0, dir[2] ?? 1)
  const el = Math.hypot(...e) || 1
  if (Math.abs(e[0]) / el > 1e-4 || Math.abs(e[1]) / el > 1e-4) return null
  const corners = prof.map(([x, y]) => apply(M, x, y, 0).map((v) => v * s) as [number, number, number])
  const z0 = corners[0]![2]
  if (corners.some((c) => Math.abs(c[2] - z0) > 1e-4)) return null
  const up = e[2] > 0
  return { outline: corners.map((c) => [c[0], c[1]]), baseZ: up ? z0 : z0 - depth, height: depth }
}

/** Parametric wall if the body is an unambiguous vertical rectangle extrusion. */
export function fitWall(model: IfcModel, wallId: number): WallFit | null {
  const ex = verticalExtrusion(model, wallId)
  if (!ex || ex.outline.length !== 4 || ex.height < 0.05) return null
  const c = ex.outline
  const e1: Vec2 = [c[1]![0] - c[0]![0], c[1]![1] - c[0]![1]]
  const e2: Vec2 = [c[2]![0] - c[1]![0], c[2]![1] - c[1]![1]]
  const e3: Vec2 = [c[3]![0] - c[2]![0], c[3]![1] - c[2]![1]]
  const l1 = Math.hypot(...e1),
    l2 = Math.hypot(...e2)
  if (!l1 || !l2) return null
  // rectangle: right angles and parallel opposite sides
  if (Math.abs((e1[0] * e2[0] + e1[1] * e2[1]) / (l1 * l2)) > 1e-4) return null
  if (Math.abs(Math.hypot(...e3) - l1) > 1e-4 * Math.max(1, l1)) return null
  // Wall direction: from the Axis representation if present, else the longer side.
  let u: Vec2 | null = null
  const axisRep = reps(model, wallId).find((r) => str(r.RepresentationIdentifier) === 'Axis')
  const axisCurve = model.line(ref(list(axisRep?.Items)[0]))
  if (axisCurve && list(axisCurve.Points).length >= 2) {
    const P = model.placement(ref(model.line(wallId)?.ObjectPlacement))
    const pts = list(axisCurve.Points).map((q) => model.point(q))
    const A = apply(P, pts[0]![0] ?? 0, pts[0]![1] ?? 0, pts[0]![2] ?? 0)
    const B = apply(P, pts[pts.length - 1]![0] ?? 0, pts[pts.length - 1]![1] ?? 0, pts[pts.length - 1]![2] ?? 0)
    const d = Math.hypot(B[0] - A[0], B[1] - A[1])
    if (d > 0) u = [(B[0] - A[0]) / d, (B[1] - A[1]) / d]
  }
  const d1: Vec2 = [e1[0] / l1, e1[1] / l1],
    d2: Vec2 = [e2[0] / l2, e2[1] / l2]
  let dir: Vec2, length: number, thickness: number
  if (u) {
    const p1 = Math.abs(u[0] * d1[0] + u[1] * d1[1]),
      p2 = Math.abs(u[0] * d2[0] + u[1] * d2[1])
    if (p1 > 0.9999) [dir, length, thickness] = [d1, l1, l2]
    else if (p2 > 0.9999) [dir, length, thickness] = [d2, l2, l1]
    else return null
    if (dir[0] * u[0] + dir[1] * u[1] < 0) dir = [-dir[0], -dir[1]]
  } else {
    if (Math.abs(l1 - l2) < 1e-6) return null
    ;[dir, length, thickness] = l1 > l2 ? [d1, l1, l2] : [d2, l2, l1]
  }
  if (thickness < 0.01 || thickness > 5 || length < 0.05) return null
  const cx = (c[0]![0] + c[1]![0] + c[2]![0] + c[3]![0]) / 4,
    cy = (c[0]![1] + c[1]![1] + c[2]![1] + c[3]![1]) / 4
  return {
    a: [cx - (dir[0] * length) / 2, cy - (dir[1] * length) / 2],
    b: [cx + (dir[0] * length) / 2, cy + (dir[1] * length) / 2],
    thickness,
    height: ex.height,
    baseZ: ex.baseZ,
  }
}

/** Place an opening (world vertices of the void or its filling) along a fitted wall. */
export function fitOpening(w: WallFit, verts: ArrayLike<number>): OpeningFit | null {
  const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1])
  const ux = (w.b[0] - w.a[0]) / L,
    uy = (w.b[1] - w.a[1]) / L
  let s0 = Infinity,
    s1 = -Infinity,
    z0 = Infinity,
    z1 = -Infinity,
    lat = 0
  for (let i = 0; i + 2 < verts.length; i += 3) {
    const dx = verts[i]! - w.a[0],
      dy = verts[i + 1]! - w.a[1]
    const s = dx * ux + dy * uy
    lat = Math.max(lat, Math.abs(-dx * uy + dy * ux))
    s0 = Math.min(s0, s)
    s1 = Math.max(s1, s)
    z0 = Math.min(z0, verts[i + 2]!)
    z1 = Math.max(z1, verts[i + 2]!)
  }
  if (!Number.isFinite(s0)) return null
  const tol = 0.01
  if (lat > w.thickness / 2 + 0.35) return null
  s0 = Math.max(0, s0)
  s1 = Math.min(L, s1)
  z0 = Math.max(w.baseZ, z0)
  z1 = Math.min(w.baseZ + w.height, z1)
  if (s1 - s0 < 0.1 || z1 - z0 < 0.1 || s0 > L - tol || s1 < tol) return null
  return { offset: (s0 + s1) / 2, width: s1 - s0, sill: z0 - w.baseZ, height: z1 - z0 }
}

/** Space outline from a vertical extrusion body. */
export function spaceFromProfile(model: IfcModel, spaceId: number): Extrusion | null {
  const ex = verticalExtrusion(model, spaceId)
  if (!ex || ex.outline.length < 3 || Math.abs(signedArea(ex.outline)) < 0.05) return null
  return ex
}

/** Footprint of a mesh: boundary loop of its flat bottom faces (largest loop). */
export function footprintFromMesh(pos: ArrayLike<number>, idx: ArrayLike<number>): { outline: Vec2[]; z: number; height: number } | null {
  let zMin = Infinity,
    zMax = -Infinity
  for (let i = 2; i < pos.length; i += 3) {
    zMin = Math.min(zMin, pos[i]!)
    zMax = Math.max(zMax, pos[i]!)
  }
  if (!Number.isFinite(zMin) || zMax - zMin < 0.1) return null
  const q = (i: number) => `${Math.round(pos[i * 3]! * 1e4)},${Math.round(pos[i * 3 + 1]! * 1e4)}`
  const coord = new Map<string, Vec2>()
  const edges = new Map<string, number>()
  const dirEdge = new Map<string, string>()
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const v = [idx[t]!, idx[t + 1]!, idx[t + 2]!]
    if (v.some((i) => Math.abs(pos[i * 3 + 2]! - zMin) > 1e-3)) continue
    const keys = v.map(q)
    v.forEach((i, k) => coord.set(keys[k]!, [pos[i * 3]!, pos[i * 3 + 1]!]))
    for (let k = 0; k < 3; k++) {
      const a = keys[k]!,
        b = keys[(k + 1) % 3]!
      if (a === b) continue
      const key = a < b ? `${a}|${b}` : `${b}|${a}`
      edges.set(key, (edges.get(key) ?? 0) + 1)
      dirEdge.set(key, `${a}>${b}`)
    }
  }
  const next = new Map<string, string>()
  for (const [key, n] of edges) {
    if (n !== 1) continue
    const [a, b] = dirEdge.get(key)!.split('>') as [string, string]
    next.set(a, b)
  }
  let best: Vec2[] | null = null
  const seen = new Set<string>()
  for (const start of next.keys()) {
    if (seen.has(start)) continue
    const loop: Vec2[] = []
    let cur: string | undefined = start
    while (cur && !seen.has(cur)) {
      seen.add(cur)
      loop.push(coord.get(cur)!)
      cur = next.get(cur)
    }
    if (cur === start && loop.length >= 3 && (!best || Math.abs(signedArea(loop)) > Math.abs(signedArea(best)))) best = loop
  }
  if (!best) return null
  // drop collinear vertices
  const simple = best.filter((p, i) => {
    const a = best![(i - 1 + best!.length) % best!.length]!,
      b = best![(i + 1) % best!.length]!
    return Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) > 1e-8
  })
  if (simple.length < 3) return null
  return { outline: signedArea(simple) < 0 ? simple.reverse() : simple, z: zMin, height: zMax - zMin }
}
