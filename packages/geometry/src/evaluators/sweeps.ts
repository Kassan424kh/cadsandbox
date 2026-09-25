// Revolve, loft and sweep solids.
import type { LoftSection, NodeBase, Vec2, Vec3 } from '@cadsandbox/doc'
import type { GeometryResult, MeshBuffers } from '../api'
import { TAU, angleOf, catmullRom, cleanPolygon, dist2, ensureCCW, polygonArea, polygonCentroid, resamplePolyline, sub2 } from '../core/math2d'
import { DEFAULT_CREASE, MeshBuilder, computeCreasedNormals, cross3, dot3, mergeMeshes, meshSurfaceArea, meshVolume, normalize3, scale3, sub3, add3 } from '../core/mesh'
import { flattenPath, pathToPolygons } from '../core/path'
import type { PolyWithHoles } from '../core/polygon'
import { latheCap, latheInto, latheProfile } from '../core/surfaces'
import { Seg3Buf } from '../core/buffers'
import { latticeWire } from '../core/wire'
import { errorResult, finish, snap } from './result'

// ------------------------------------------------------------------ revolve
/** Split a polyline into smooth runs at corners sharper than `crease`. */
function smoothRuns(pts: Vec2[], closed: boolean, crease: number): Vec2[][] {
  const n = pts.length
  const sharp: boolean[] = new Array(n).fill(false)
  const cosC = Math.cos(crease)
  for (let i = 0; i < n; i++) {
    if (!closed && (i === 0 || i === n - 1)) continue
    const a = pts[(i + n - 1) % n]!, b = pts[i]!, c = pts[(i + 1) % n]!
    const d0 = sub2(b, a), d1 = sub2(c, b)
    const l0 = Math.hypot(d0[0], d0[1]), l1 = Math.hypot(d1[0], d1[1])
    if (l0 < 1e-12 || l1 < 1e-12) continue
    sharp[i] = (d0[0] * d1[0] + d0[1] * d1[1]) / (l0 * l1) < cosC
  }
  const runs: Vec2[][] = []
  if (closed) {
    let start = sharp.indexOf(true)
    if (start < 0) {
      runs.push([...pts, pts[0]!])
      return runs
    }
    let cur: Vec2[] = [pts[start]!]
    for (let k = 1; k <= n; k++) {
      const i = (start + k) % n
      cur.push(pts[i]!)
      if (sharp[i] && k < n) {
        runs.push(cur)
        cur = [pts[i]!]
      }
    }
    runs.push(cur)
    return runs
  }
  let cur: Vec2[] = [pts[0]!]
  for (let i = 1; i < n; i++) {
    cur.push(pts[i]!)
    if (sharp[i]) {
      runs.push(cur)
      cur = [pts[i]!]
    }
  }
  runs.push(cur)
  return runs
}

export function evaluateRevolve(node: NodeBase<'revolve'>): GeometryResult {
  const p = node.params
  const angle = p.angle && p.angle > 0 ? Math.min(TAU, p.angle) : TAU
  const contours = flattenPath(p.path, 0.0005)
  if (!contours.length) return errorResult('Revolve profile is empty')
  const segs = Math.max(8, Math.round(p.segments && p.segments > 0 ? p.segments : 48) * (angle / TAU))
  const mb = new MeshBuilder(1024)
  const partial = angle < TAU - 1e-9
  for (const c of contours) {
    let pts = cleanPolygon(c.points, 1e-9)
    if (pts.length < 2) continue
    // orient so that normals point outward (CCW in the r,z half-plane)
    if (polygonArea(pts) < 0) pts = pts.slice().reverse()
    const runs = smoothRuns(pts, c.closed, DEFAULT_CREASE)
    let vOff = 0
    for (const run of runs) {
      const prof = latheProfile(run, false)
      for (const q of prof) q.v += vOff
      vOff = prof[prof.length - 1]!.v
      latheInto(mb, prof, segs, angle)
    }
    if (partial) {
      latheCap(mb, pts, 0, true)
      latheCap(mb, pts, angle, false)
    }
  }
  const mesh = mb.build()
  if (!mesh.positions.length) return errorResult('Revolve produced no geometry')
  const vol = meshVolume(mesh)
  const quantities: Record<string, number> = { area: meshSurfaceArea(mesh) }
  if (Math.abs(vol) > 1e-12) quantities.volume = Math.abs(vol)
  return finish([{ mesh, material: 'node', castShadow: true, receiveShadow: true }], { edges: 'auto', snaps: [snap('insertion', 0, 0, 0)], quantities })
}

// ------------------------------------------------------------------ loft
interface Ring3 {
  pts: Vec3[]
  z: number
}

/** Section outline in 3D after scale/rotation, CCW. */
function sectionRing(s: LoftSection): Vec2[] | null {
  const polys = pathToPolygons(s.path, 0.0005)
  if (!polys.length) return null
  const best = polys.reduce((a, b) => (Math.abs(polygonArea(b.outer)) > Math.abs(polygonArea(a.outer)) ? b : a))
  const sc = s.scale ?? 1
  const rot = s.rotation ?? 0
  const cr = Math.cos(rot), sr = Math.sin(rot)
  return ensureCCW(best.outer).map((q) => [(q[0] * cr - q[1] * sr) * sc, (q[0] * sr + q[1] * cr) * sc] as Vec2)
}

/** Rotate ring start to the vertex whose direction from the centroid is closest to `refAngle`. */
function alignStart(ring: Vec2[], refAngle: number): Vec2[] {
  const c = polygonCentroid(ring)
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < ring.length; i++) {
    const a = angleOf(sub2(ring[i]!, c))
    let d = Math.abs(a - refAngle) % TAU
    if (d > Math.PI) d = TAU - d
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return ring.slice(best).concat(ring.slice(0, best))
}

/** Corner-preserving common parametrization: sample every ring at the union of all rings' vertex parameters. */
function unifyRings(rings: Vec2[][]): Vec2[][] {
  const params = new Set<number>()
  const perRing: number[][] = []
  for (const r of rings) {
    const total = r.reduce((s, p, i) => s + dist2(p, r[(i + 1) % r.length]!), 0)
    let acc = 0
    const ts: number[] = []
    for (let i = 0; i < r.length; i++) {
      const t = Math.round((acc / total) * 1e6) / 1e6
      ts.push(t)
      params.add(t)
      acc += dist2(r[i]!, r[(i + 1) % r.length]!)
    }
    perRing.push(ts)
  }
  const all = [...params].sort((a, b) => a - b)
  // cap the sample count for very dense inputs
  const target = all.length > 256 ? Array.from({ length: 256 }, (_, i) => i / 256) : all
  return rings.map((r, k) => {
    const ts = perRing[k]!
    const out: Vec2[] = []
    for (const t of target) {
      // find segment containing t
      let i = 0
      while (i + 1 < ts.length && ts[i + 1]! <= t + 1e-12) i++
      const t0 = ts[i]!
      const t1 = i + 1 < ts.length ? ts[i + 1]! : 1
      const a = r[i]!, b = r[(i + 1) % r.length]!
      const f = t1 > t0 ? Math.max(0, Math.min(1, (t - t0) / (t1 - t0))) : 0
      out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f])
    }
    return out
  })
}

export function evaluateLoft(node: NodeBase<'loft'>): GeometryResult {
  const p = node.params
  const sections = (p.sections ?? []).slice().sort((a, b) => a.z - b.z)
  if (sections.length < 2) return errorResult('Loft needs at least two sections')
  const raw: Vec2[][] = []
  const zs: number[] = []
  let ref = 0
  for (let i = 0; i < sections.length; i++) {
    const ring = sectionRing(sections[i]!)
    if (!ring || ring.length < 3) return errorResult(`Loft section ${i + 1} is empty`)
    const aligned = i === 0 ? ring : alignStart(ring, ref)
    ref = angleOf(sub2(aligned[0]!, polygonCentroid(aligned)))
    raw.push(aligned)
    zs.push(sections[i]!.z)
  }
  const unified = unifyRings(raw)
  let rings: Ring3[] = unified.map((r, i) => ({ pts: r.map((q) => [q[0], q[1], zs[i]!] as Vec3), z: zs[i]! }))
  if (p.smooth && rings.length >= 3) {
    // Catmull-Rom across sections per column
    const sub = 6
    const M = rings[0]!.pts.length
    const out: Ring3[] = []
    for (let s = 0; s < rings.length - 1; s++) {
      for (let k = 0; k < sub; k++) {
        const t = k / sub
        const pts: Vec3[] = new Array(M)
        for (let i = 0; i < M; i++) {
          const p0 = rings[Math.max(0, s - 1)]!.pts[i]!, p1 = rings[s]!.pts[i]!, p2 = rings[s + 1]!.pts[i]!, p3 = rings[Math.min(rings.length - 1, s + 2)]!.pts[i]!
          const t2 = t * t, t3 = t2 * t
          const c = (a: number, b: number, cc: number, d: number) => 0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3)
          pts[i] = [c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1]), c(p0[2], p1[2], p2[2], p3[2])]
        }
        out.push({ pts, z: pts[0]![2] })
      }
    }
    out.push(rings[rings.length - 1]!)
    rings = out
  }
  const M = rings[0]!.pts.length
  const side = new MeshBuilder(rings.length * M)
  let v = 0
  for (let r = 0; r < rings.length; r++) {
    if (r > 0) v += Math.hypot(rings[r]!.pts[0]![0] - rings[r - 1]!.pts[0]![0], rings[r]!.pts[0]![1] - rings[r - 1]!.pts[0]![1], rings[r]!.z - rings[r - 1]!.z)
    let u = 0
    for (let i = 0; i <= M; i++) {
      const q = rings[r]!.pts[i % M]!
      if (i > 0) u += dist2([q[0], q[1]], [rings[r]!.pts[(i - 1) % M]![0], rings[r]!.pts[(i - 1) % M]![1]])
      side.vertex(q[0], q[1], q[2], 0, 0, 1, u, v)
    }
  }
  const cols = M + 1
  for (let r = 0; r < rings.length - 1; r++) {
    for (let i = 0; i < M; i++) {
      const a = r * cols + i, b = a + 1, c = (r + 1) * cols + i + 1, d = (r + 1) * cols + i
      side.quad(a, b, c, d)
    }
  }
  const sideMesh = computeCreasedNormals(side.build(), p.smooth ? (80 * Math.PI) / 180 : DEFAULT_CREASE)
  const caps = new MeshBuilder(M * 2)
  if (p.capStart) caps.face(rings[0]!.pts, [], [0, 0, -1])
  if (p.capEnd) caps.face(rings[rings.length - 1]!.pts, [], [0, 0, 1])
  const mesh = mergeMeshes([sideMesh, caps.build()])
  const quantities: Record<string, number> = { area: meshSurfaceArea(mesh) }
  if (p.capStart && p.capEnd) quantities.volume = Math.abs(meshVolume(mesh))
  return finish([{ mesh, material: 'node', castShadow: true, receiveShadow: true }], {
    edges: 'auto',
    wire: latticeWire(rings.map((r) => r.pts), true, false), // section rings + longitudinal lines
    snaps: [snap('insertion', 0, 0, 0), snap('center', 0, 0, zs[0]!), snap('center', 0, 0, zs[zs.length - 1]!)],
    quantities,
  })
}

// ------------------------------------------------------------------ sweep
interface Frame {
  p: Vec3
  t: Vec3
  n: Vec3
  b: Vec3
}

function catmullRom3(points: readonly Vec3[], sub: number, closed: boolean): Vec3[] {
  const n = points.length
  if (n < 3 || sub <= 1) return points.slice()
  const get = (i: number) => (closed ? points[((i % n) + n) % n]! : points[Math.max(0, Math.min(n - 1, i))]!)
  const out: Vec3[] = []
  const spans = closed ? n : n - 1
  for (let i = 0; i < spans; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2)
    for (let k = 0; k < sub; k++) {
      const t = k / sub, t2 = t * t, t3 = t2 * t
      const c = (a: number, b: number, cc: number, d: number) => 0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3)
      out.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1]), c(p0[2], p1[2], p2[2], p3[2])])
    }
  }
  if (!closed) out.push(points[n - 1]!)
  return out
}

/** Rotation-minimizing frames (double reflection), with twist and closed-loop correction. */
export function pathFrames(path: readonly Vec3[], closed: boolean, twist: number): Frame[] {
  const n = path.length
  const tangents: Vec3[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const prev = i > 0 ? path[i - 1]! : closed ? path[n - 1]! : null
    const next = i < n - 1 ? path[i + 1]! : closed ? path[0]! : null
    let t: Vec3 = [0, 0, 0]
    if (prev) t = add3(t, normalize3(sub3(path[i]!, prev)))
    if (next) t = add3(t, normalize3(sub3(next, path[i]!)))
    tangents[i] = normalize3(t)
  }
  const t0 = tangents[0]!
  let n0: Vec3 = Math.abs(t0[2]) < 0.99 ? [0, 0, 1] : [1, 0, 0]
  n0 = normalize3(sub3(n0, scale3(t0, dot3(n0, t0))))
  const frames: Frame[] = [{ p: path[0]!, t: t0, n: n0, b: cross3(t0, n0) }]
  for (let i = 1; i < n; i++) {
    const prev = frames[i - 1]!
    const v1 = sub3(path[i]!, path[i - 1]!)
    const c1 = dot3(v1, v1)
    let nL: Vec3 = prev.n
    let tL: Vec3 = prev.t
    if (c1 > 1e-20) {
      nL = sub3(prev.n, scale3(v1, (2 / c1) * dot3(v1, prev.n)))
      tL = sub3(prev.t, scale3(v1, (2 / c1) * dot3(v1, prev.t)))
    }
    const v2 = sub3(tangents[i]!, tL)
    const c2 = dot3(v2, v2)
    const nI = c2 > 1e-20 ? sub3(nL, scale3(v2, (2 / c2) * dot3(v2, nL))) : nL
    const ni = normalize3(sub3(nI, scale3(tangents[i]!, dot3(nI, tangents[i]!))))
    frames.push({ p: path[i]!, t: tangents[i]!, n: ni, b: cross3(tangents[i]!, ni) })
  }
  // arc length for twist distribution
  const s: number[] = [0]
  for (let i = 1; i < n; i++) s.push(s[i - 1]! + Math.hypot(...sub3(path[i]!, path[i - 1]!)))
  let total = s[n - 1]!
  let correction = 0
  if (closed) {
    total += Math.hypot(...sub3(path[0]!, path[n - 1]!))
    // transport once more to the start and measure the mismatch
    const last = frames[n - 1]!
    const v1 = sub3(path[0]!, path[n - 1]!)
    const c1 = dot3(v1, v1)
    let nL = last.n, tL = last.t
    if (c1 > 1e-20) {
      nL = sub3(last.n, scale3(v1, (2 / c1) * dot3(v1, last.n)))
      tL = sub3(last.t, scale3(v1, (2 / c1) * dot3(v1, last.t)))
    }
    const v2 = sub3(t0, tL)
    const c2 = dot3(v2, v2)
    const nI = normalize3(c2 > 1e-20 ? sub3(nL, scale3(v2, (2 / c2) * dot3(v2, nL))) : nL)
    // distribute the seam mismatch along the loop so the frames close up
    correction = -Math.atan2(dot3(cross3(nI, n0), t0), dot3(nI, n0))
  }
  for (let i = 0; i < n; i++) {
    const f = frames[i]!
    const ang = ((twist + correction) * s[i]!) / (total || 1)
    if (ang !== 0) {
      const c = Math.cos(ang), sn = Math.sin(ang)
      const nn: Vec3 = add3(scale3(f.n, c), scale3(f.b, sn))
      const bb: Vec3 = add3(scale3(f.b, c), scale3(f.n, -sn))
      f.n = nn
      f.b = bb
    }
  }
  return frames
}

export function evaluateSweep(node: NodeBase<'sweep'>): GeometryResult {
  const p = node.params
  const polys: PolyWithHoles[] = pathToPolygons(p.profile, 0.0005)
  if (!polys.length) return errorResult('Sweep profile is empty')
  let path = (p.path ?? []).filter((q) => Array.isArray(q) && q.length === 3) as Vec3[]
  // drop duplicate consecutive points
  path = path.filter((q, i) => i === 0 || Math.hypot(...sub3(q, path[i - 1]!)) > 1e-9)
  const closed = !!p.closedPath && path.length >= 3
  if (path.length < 2) return errorResult('Sweep path needs at least two points')
  if (p.smooth && path.length >= 3) path = catmullRom3(path, 8, closed)
  const frames = pathFrames(path, closed, p.twist ?? 0)
  const side = new MeshBuilder(frames.length * 32)
  const rings = polys.flatMap((poly) => [poly.outer, ...poly.holes])
  const nFrames = frames.length
  const rows = closed ? nFrames + 1 : nFrames
  const wire = new Seg3Buf(nFrames * 16)
  for (const ring of rings) {
    const M = ring.length
    const cols = M + 1
    const base = side.vertexCount
    const lattice: Vec3[][] = []
    let v = 0
    for (let r = 0; r < rows; r++) {
      const f = frames[r % nFrames]!
      if (r > 0) v += Math.hypot(...sub3(f.p, frames[(r - 1) % nFrames]!.p))
      const row: Vec3[] = []
      let u = 0
      for (let i = 0; i <= M; i++) {
        const q = ring[i % M]!
        if (i > 0) u += dist2(q, ring[(i - 1) % M]!)
        const x = f.p[0] + f.n[0] * q[0] + f.b[0] * q[1]
        const y = f.p[1] + f.n[1] * q[0] + f.b[1] * q[1]
        const z = f.p[2] + f.n[2] * q[0] + f.b[2] * q[1]
        side.vertex(x, y, z, 0, 0, 1, u, v)
        if (i < M) row.push([x, y, z])
      }
      if (r < nFrames) lattice.push(row)
    }
    wire.append(latticeWire(lattice, true, closed)) // profile rings along the path + rails
    for (let r = 0; r < rows - 1; r++) {
      for (let i = 0; i < M; i++) {
        const a = base + r * cols + i, b = a + 1, c = base + (r + 1) * cols + i + 1, d = base + (r + 1) * cols + i
        side.quad(a, b, c, d)
      }
    }
  }
  const sideMesh = computeCreasedNormals(side.build(), DEFAULT_CREASE)
  const parts: MeshBuffers[] = [sideMesh]
  if (!closed) {
    const caps = new MeshBuilder(64)
    const place = (f: Frame, q: Vec2): Vec3 => [f.p[0] + f.n[0] * q[0] + f.b[0] * q[1], f.p[1] + f.n[1] * q[0] + f.b[1] * q[1], f.p[2] + f.n[2] * q[0] + f.b[2] * q[1]]
    const f0 = frames[0]!, f1 = frames[nFrames - 1]!
    for (const poly of polys) {
      caps.face(poly.outer.map((q) => place(f0, q)), poly.holes.map((h) => h.map((q) => place(f0, q))), scale3(f0.t, -1))
      caps.face(poly.outer.map((q) => place(f1, q)), poly.holes.map((h) => h.map((q) => place(f1, q))), f1.t)
    }
    parts.push(caps.build())
  }
  const mesh = mergeMeshes(parts)
  const snaps = [snap('insertion', 0, 0, 0), snap('endpoint', ...frames[0]!.p), snap('endpoint', ...frames[nFrames - 1]!.p)]
  return finish([{ mesh, material: 'node', castShadow: true, receiveShadow: true }], {
    edges: 'auto',
    wire: wire.toArray(),
    snaps,
    quantities: { area: meshSurfaceArea(mesh), volume: Math.abs(meshVolume(mesh)), length: frames.reduce((s, f, i) => (i ? s + Math.hypot(...sub3(f.p, frames[i - 1]!.p)) : 0), 0) },
  })
}

export { catmullRom, resamplePolyline }
