// Parametric solids. Origin = center of the base on Z=0 (sphere-like shapes touch the ground).
import type { NodeBase, PrimitiveParams, Vec2, Vec3 } from '@cadsandbox/doc'
import type { GeometryResult, SnapPoint } from '../api'
import { TAU } from '../core/math2d'
import { MeshBuilder, meshSurfaceArea, meshVolume } from '../core/mesh'
import { latheCap, latheInto, latheProfile, type LathePoint } from '../core/surfaces'
import { finish, snap } from './result'

const clampSweep = (s: number | undefined): number => {
  const v = s === undefined || !Number.isFinite(s) || s <= 0 ? TAU : Math.min(TAU, s)
  return v
}
const partial = (sweep: number): boolean => sweep < TAU - 1e-9

export function autoSegments(radius: number, hint: number | undefined, min = 24, max = 128): number {
  if (hint && hint >= 3) return Math.round(hint)
  return Math.max(min, Math.min(max, Math.ceil(Math.abs(radius) * 64)))
}

function quadrantSnaps(snaps: SnapPoint[], r: number, z: number, sweep: number): void {
  for (let k = 0; k < 4; k++) {
    const t = (k * Math.PI) / 2
    if (t <= sweep + 1e-9) snaps.push(snap('quadrant', Math.cos(t) * r, Math.sin(t) * r, z))
  }
}

/** Straight-sided revolved band between two rings (cylinder/cone side with smooth normals). */
function conicSide(mb: MeshBuilder, r0: number, r1: number, z0: number, z1: number, segs: number, sweep: number): void {
  const dr = r1 - r0, dz = z1 - z0
  const l = Math.hypot(dr, dz) || 1
  const nr = dz / l, nz = -dr / l
  latheInto(mb, [{ r: r0, z: z0, nr, nz, v: 0 }, { r: r1, z: z1, nr, nz, v: l }], segs, sweep)
}

function discFace(mb: MeshBuilder, rOuter: number, rInner: number, z: number, segs: number, sweep: number, up: boolean): void {
  const pts: Vec3[] = []
  const full = !partial(sweep)
  const n = full ? segs : segs + 1
  for (let j = 0; j < n; j++) {
    const t = (sweep * j) / segs
    pts.push([Math.cos(t) * rOuter, Math.sin(t) * rOuter, z])
  }
  if (rInner > 1e-9) {
    if (full) {
      const hole: Vec3[] = []
      for (let j = 0; j < segs; j++) {
        const t = (sweep * j) / segs
        hole.push([Math.cos(t) * rInner, Math.sin(t) * rInner, z])
      }
      mb.face(pts, [hole.reverse()], [0, 0, up ? 1 : -1])
      return
    }
    for (let j = segs; j >= 0; j--) {
      const t = (sweep * j) / segs
      pts.push([Math.cos(t) * rInner, Math.sin(t) * rInner, z])
    }
  } else if (!full) pts.push([0, 0, z])
  mb.face(pts, [], [0, 0, up ? 1 : -1])
}

function box(mb: MeshBuilder, w: number, d: number, h: number): void {
  const x = w / 2, y = d / 2
  const p = (a: number, b: number, c: number): Vec3 => [a, b, c]
  mb.quadFace(p(-x, -y, 0), p(-x, y, 0), p(x, y, 0), p(x, -y, 0)) // bottom (-Z)
  mb.quadFace(p(-x, -y, h), p(x, -y, h), p(x, y, h), p(-x, y, h)) // top
  mb.quadFace(p(-x, -y, 0), p(x, -y, 0), p(x, -y, h), p(-x, -y, h)) // front (-Y)
  mb.quadFace(p(x, y, 0), p(-x, y, 0), p(-x, y, h), p(x, y, h)) // back (+Y)
  mb.quadFace(p(x, -y, 0), p(x, y, 0), p(x, y, h), p(x, -y, h)) // right (+X)
  mb.quadFace(p(-x, y, 0), p(-x, -y, 0), p(-x, -y, h), p(-x, y, h)) // left (-X)
}

/** Rounded box = 6 faces + 12 quarter cylinders + 8 sphere octants sharing exact seam vertices. */
function roundedBox(mb: MeshBuilder, w: number, d: number, h: number, r: number, n: number): void {
  const hx = w / 2, hy = d / 2, hz = h / 2
  const ix = hx - r, iy = hy - r, iz = hz - r
  const zc = hz // shift so the box sits on z=0
  const P = (x: number, y: number, z: number): Vec3 => [x, y, z + zc]
  // flat faces
  mb.quadFace(P(hx, -iy, -iz), P(hx, iy, -iz), P(hx, iy, iz), P(hx, -iy, iz))
  mb.quadFace(P(-hx, iy, -iz), P(-hx, -iy, -iz), P(-hx, -iy, iz), P(-hx, iy, iz))
  mb.quadFace(P(ix, hy, -iz), P(-ix, hy, -iz), P(-ix, hy, iz), P(ix, hy, iz))
  mb.quadFace(P(-ix, -hy, -iz), P(ix, -hy, -iz), P(ix, -hy, iz), P(-ix, -hy, iz))
  mb.quadFace(P(-ix, -iy, hz), P(ix, -iy, hz), P(ix, iy, hz), P(-ix, iy, hz))
  mb.quadFace(P(-ix, iy, -hz), P(ix, iy, -hz), P(ix, -iy, -hz), P(-ix, -iy, -hz))
  // quarter cylinders: axis along one coordinate, quarter in the other two
  const quarter = (axis: 0 | 1 | 2, sa: number, sb: number) => {
    // axis = the edge direction; (a, b) = the other two axes in cyclic order
    const a = ((axis + 1) % 3) as 0 | 1 | 2
    const b = ((axis + 2) % 3) as 0 | 1 | 2
    const inner = [ix, iy, iz]
    const half = [hx, hy, hz]
    const base = Math.atan2(sb, sa) - Math.PI / 4
    const rows = 2
    const startIdx = mb.vertexCount
    for (let i = 0; i < rows; i++) {
      const along = (i === 0 ? -1 : 1) * inner[axis]!
      for (let k = 0; k <= n; k++) {
        const t = base + ((Math.PI / 2) * k) / n
        const ca = Math.cos(t), sb2 = Math.sin(t)
        const pos: number[] = [0, 0, 0]
        const nor: number[] = [0, 0, 0]
        pos[axis] = along
        pos[a] = sa * inner[a]! + ca * r
        pos[b] = sb * inner[b]! + sb2 * r
        nor[a] = ca
        nor[b] = sb2
        mb.vertex(pos[0]!, pos[1]!, pos[2]! + zc, nor[0]!, nor[1]!, nor[2]!, (r * Math.PI * k) / (2 * n), along + half[axis]!)
      }
    }
    for (let k = 0; k < n; k++) {
      const i0 = startIdx + k, i1 = i0 + 1
      const j0 = startIdx + (n + 1) + k, j1 = j0 + 1
      mb.orientedQuad(i0, i1, j1, j0)
    }
  }
  for (const sa of [-1, 1]) for (const sb of [-1, 1]) {
    quarter(2, sa, sb) // vertical edges
    quarter(0, sa, sb) // edges along X
    quarter(1, sa, sb) // edges along Y
  }
  // sphere octants
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const cx = sx * ix, cy = sy * iy, cz = sz * iz
    const base = Math.atan2(sy, sx) - Math.PI / 4
    const start = mb.vertexCount
    for (let i = 0; i <= n; i++) {
      const phi = (sz * (Math.PI / 2) * i) / n
      const cp = Math.cos(phi), sp = Math.sin(phi)
      for (let k = 0; k <= n; k++) {
        const t = base + ((Math.PI / 2) * k) / n
        const nx = cp * Math.cos(t), ny = cp * Math.sin(t), nz = sp
        mb.vertex(cx + nx * r, cy + ny * r, cz + nz * r + zc, nx, ny, nz, (r * Math.PI * k) / (2 * n), (r * Math.PI * i) / (2 * n))
      }
    }
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < n; k++) {
        const a = start + i * (n + 1) + k, b = a + 1
        const c = start + (i + 1) * (n + 1) + k + 1, d = c - 1
        if (i === n - 1) mb.orientedTri(a, b, d)
        else mb.orientedQuad(a, b, c, d)
      }
    }
  }
}

function sphereProfile(r: number, rings: number, zc: number): LathePoint[] {
  const out: LathePoint[] = []
  for (let i = 0; i <= rings; i++) {
    const phi = -Math.PI / 2 + (Math.PI * i) / rings
    out.push({ r: Math.cos(phi) * r, z: zc + Math.sin(phi) * r, nr: Math.cos(phi), nz: Math.sin(phi), v: r * (phi + Math.PI / 2) })
  }
  return out
}

function icosphere(mb: MeshBuilder, r: number, sub: number, zc: number): void {
  const t = (1 + Math.sqrt(5)) / 2
  let verts: Vec3[] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map((v) => {
    const l = Math.hypot(v[0]!, v[1]!, v[2]!)
    return [v[0]! / l, v[1]! / l, v[2]! / l] as Vec3
  })
  let faces: [number, number, number][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ]
  for (let s = 0; s < sub; s++) {
    const cache = new Map<number, number>()
    const mid = (a: number, b: number): number => {
      const key = a < b ? a * 65536 + b : b * 65536 + a
      let m = cache.get(key)
      if (m === undefined) {
        const va = verts[a]!, vb = verts[b]!
        const v: Vec3 = [va[0] + vb[0], va[1] + vb[1], va[2] + vb[2]]
        const l = Math.hypot(v[0], v[1], v[2])
        verts.push([v[0] / l, v[1] / l, v[2] / l])
        m = verts.length - 1
        cache.set(key, m)
      }
      return m
    }
    const next: [number, number, number][] = []
    for (const [a, b, c] of faces) {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a)
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca])
    }
    faces = next
  }
  const base = mb.vertexCount
  for (const v of verts) {
    const u = r * (Math.atan2(v[1], v[0]) + Math.PI)
    const vv = r * (Math.asin(Math.max(-1, Math.min(1, v[2]))) + Math.PI / 2)
    mb.vertex(v[0] * r, v[1] * r, v[2] * r + zc, v[0], v[1], v[2], u, vv)
  }
  for (const [a, b, c] of faces) mb.tri(base + a, base + b, base + c)
  verts = []
}

export function evaluatePrimitive(node: NodeBase<'primitive'>): GeometryResult {
  const p: PrimitiveParams = node.params
  const mb = new MeshBuilder(512)
  const snaps: SnapPoint[] = [snap('insertion', 0, 0, 0)]
  const w = Math.max(1e-6, p.width ?? 1)
  const d = Math.max(1e-6, p.depth ?? 1)
  const h = Math.max(1e-6, p.height ?? 1)
  const r = Math.max(1e-6, p.radius ?? 0.5)
  const r2 = Math.max(0, p.radius2 ?? 0)
  const sweep = clampSweep(p.sweep)
  const segs = autoSegments(r, p.segments)
  const sweepSegs = Math.max(3, Math.ceil((segs * sweep) / TAU))
  switch (p.shape) {
    case 'box': {
      const cr = Math.min(p.cornerRadius ?? 0, Math.min(w, d, h) / 2 - 1e-6)
      if (cr > 1e-6) roundedBox(mb, w, d, h, cr, p.segments && p.segments >= 4 ? Math.round(p.segments / 4) : Math.max(3, Math.min(12, Math.ceil(cr * 40) + 2)))
      else box(mb, w, d, h)
      snaps.push(snap('center', 0, 0, h / 2), snap('center', 0, 0, h))
      break
    }
    case 'plane':
      mb.quadFace([-w / 2, -d / 2, 0], [w / 2, -d / 2, 0], [w / 2, d / 2, 0], [-w / 2, d / 2, 0])
      snaps.push(snap('midpoint', 0, -d / 2, 0), snap('midpoint', 0, d / 2, 0), snap('midpoint', -w / 2, 0, 0), snap('midpoint', w / 2, 0, 0))
      break
    case 'disc':
      discFace(mb, r, 0, 0, sweepSegs, sweep, true)
      quadrantSnaps(snaps, r, 0, sweep)
      break
    case 'cylinder':
      conicSide(mb, r, r, 0, h, sweepSegs, sweep)
      discFace(mb, r, 0, 0, sweepSegs, sweep, false)
      discFace(mb, r, 0, h, sweepSegs, sweep, true)
      if (partial(sweep)) {
        const ring: Vec2[] = [[0, 0], [r, 0], [r, h], [0, h]]
        latheCap(mb, ring, 0, true)
        latheCap(mb, ring, sweep, false)
      }
      quadrantSnaps(snaps, r, 0, sweep)
      quadrantSnaps(snaps, r, h, sweep)
      snaps.push(snap('center', 0, 0, h))
      break
    case 'cone': {
      const top = Math.min(r2, r)
      conicSide(mb, r, top, 0, h, sweepSegs, sweep)
      discFace(mb, r, 0, 0, sweepSegs, sweep, false)
      if (top > 1e-9) discFace(mb, top, 0, h, sweepSegs, sweep, true)
      if (partial(sweep)) {
        const ring: Vec2[] = top > 1e-9 ? [[0, 0], [r, 0], [top, h], [0, h]] : [[0, 0], [r, 0], [0, h]]
        latheCap(mb, ring, 0, true)
        latheCap(mb, ring, sweep, false)
      }
      quadrantSnaps(snaps, r, 0, sweep)
      snaps.push(snap('center', 0, 0, h))
      break
    }
    case 'tube': {
      const inner = Math.min(Math.max(1e-6, r2 || r * 0.7), r - 1e-6)
      conicSide(mb, r, r, 0, h, sweepSegs, sweep)
      // inner wall: normals point inward
      latheInto(mb, [{ r: inner, z: 0, nr: -1, nz: 0, v: 0 }, { r: inner, z: h, nr: -1, nz: 0, v: h }], sweepSegs, sweep)
      discFace(mb, r, inner, 0, sweepSegs, sweep, false)
      discFace(mb, r, inner, h, sweepSegs, sweep, true)
      if (partial(sweep)) {
        const ring: Vec2[] = [[inner, 0], [r, 0], [r, h], [inner, h]]
        latheCap(mb, ring, 0, true)
        latheCap(mb, ring, sweep, false)
      }
      quadrantSnaps(snaps, r, 0, sweep)
      snaps.push(snap('center', 0, 0, h))
      break
    }
    case 'sphere': {
      const rings = Math.max(8, Math.round(segs / 2))
      latheInto(mb, sphereProfile(r, rings, r), segs, TAU)
      snaps.push(snap('center', 0, 0, r), snap('center', 0, 0, 2 * r))
      quadrantSnaps(snaps, r, r, TAU)
      break
    }
    case 'icosphere': {
      const sub = p.segments && p.segments > 0 ? Math.min(5, Math.round(p.segments)) : 2
      icosphere(mb, r, sub, r)
      snaps.push(snap('center', 0, 0, r))
      break
    }
    case 'capsule': {
      const cyl = Math.max(0, h - 2 * r)
      const rr = cyl > 0 ? r : h / 2
      const rings = Math.max(4, Math.round(segs / 4))
      const prof: LathePoint[] = []
      for (let i = 0; i <= rings; i++) {
        const phi = -Math.PI / 2 + ((Math.PI / 2) * i) / rings
        prof.push({ r: Math.cos(phi) * rr, z: rr + Math.sin(phi) * rr, nr: Math.cos(phi), nz: Math.sin(phi), v: rr * (phi + Math.PI / 2) })
      }
      for (let i = 0; i <= rings; i++) {
        const phi = ((Math.PI / 2) * i) / rings
        prof.push({ r: Math.cos(phi) * rr, z: rr + cyl + Math.sin(phi) * rr, nr: Math.cos(phi), nz: Math.sin(phi), v: (rr * Math.PI) / 2 + cyl + rr * phi })
      }
      latheInto(mb, prof, segs, TAU)
      snaps.push(snap('center', 0, 0, h / 2))
      break
    }
    case 'torus': {
      const tube = Math.min(Math.max(1e-6, r2 || r * 0.3), r)
      const radial = Math.max(12, Math.round(segs / 2))
      const prof: LathePoint[] = []
      for (let i = 0; i <= radial; i++) {
        const phi = (TAU * i) / radial
        prof.push({ r: r + Math.cos(phi) * tube, z: tube + Math.sin(phi) * tube, nr: Math.cos(phi), nz: Math.sin(phi), v: tube * phi })
      }
      latheInto(mb, prof, sweepSegs, sweep)
      if (partial(sweep)) {
        const ring: Vec2[] = prof.slice(0, radial).map((q) => [q.r, q.z] as Vec2)
        latheCap(mb, ring, 0, true)
        latheCap(mb, ring, sweep, false)
      }
      snaps.push(snap('center', 0, 0, tube))
      quadrantSnaps(snaps, r, tube, sweep)
      break
    }
    case 'pyramid': {
      const x = w / 2, y = d / 2
      const apex: Vec3 = [0, 0, h]
      mb.quadFace([-x, -y, 0], [-x, y, 0], [x, y, 0], [x, -y, 0])
      mb.triFace([-x, -y, 0], [x, -y, 0], apex)
      mb.triFace([x, -y, 0], [x, y, 0], apex)
      mb.triFace([x, y, 0], [-x, y, 0], apex)
      mb.triFace([-x, y, 0], [-x, -y, 0], apex)
      snaps.push(snap('vertex', 0, 0, h))
      break
    }
    case 'wedge': {
      // vertical back face at -Y, slope descending toward +Y
      const x = w / 2, y = d / 2
      mb.quadFace([-x, -y, 0], [-x, y, 0], [x, y, 0], [x, -y, 0]) // bottom
      mb.quadFace([-x, -y, 0], [x, -y, 0], [x, -y, h], [-x, -y, h]) // back (-Y)
      mb.quadFace([-x, -y, h], [x, -y, h], [x, y, 0], [-x, y, 0]) // slope (+Y/+Z)
      mb.triFace([-x, -y, 0], [-x, -y, h], [-x, y, 0]) // left
      mb.triFace([x, -y, 0], [x, y, 0], [x, -y, h]) // right
      snaps.push(snap('midpoint', 0, -y, h))
      break
    }
    case 'prism': {
      const n = Math.max(3, Math.round(p.sides ?? 6))
      const ring: Vec3[] = []
      for (let i = 0; i < n; i++) {
        const t = Math.PI / 2 + (i / n) * TAU
        ring.push([Math.cos(t) * r, Math.sin(t) * r, 0])
      }
      mb.face(ring, [], [0, 0, -1])
      mb.face(ring.map((q) => [q[0], q[1], h] as Vec3), [], [0, 0, 1])
      for (let i = 0; i < n; i++) {
        const a = ring[i]!, b = ring[(i + 1) % n]!
        mb.quadFace(a, b, [b[0], b[1], h], [a[0], a[1], h])
      }
      snaps.push(snap('center', 0, 0, h))
      break
    }
  }
  const mesh = mb.build()
  const flat = p.shape === 'plane' || p.shape === 'disc'
  const quantities: Record<string, number> = flat ? { area: meshSurfaceArea(mesh) } : { volume: Math.abs(meshVolume(mesh)), area: meshSurfaceArea(mesh) }
  return finish([{ mesh, material: 'node', castShadow: true, receiveShadow: true }], { edges: 'auto', snaps, quantities })
}
