// Small solid primitives appended into builders + a per-material part collector.
import type { Vec3 } from '@cadsandbox/doc'
import type { MeshPart } from '../api'
import { MeshBuilder, cross3, normalize3, sub3, type Mat4Like } from './mesh'
import { TAU } from './math2d'

/** Axis-aligned box between min and max corners. */
export function addBox(mb: MeshBuilder, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
  if (x1 < x0) [x0, x1] = [x1, x0]
  if (y1 < y0) [y0, y1] = [y1, y0]
  if (z1 < z0) [z0, z1] = [z1, z0]
  const p = (x: number, y: number, z: number): Vec3 => [x, y, z]
  mb.quadFace(p(x0, y0, z0), p(x0, y1, z0), p(x1, y1, z0), p(x1, y0, z0))
  mb.quadFace(p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1))
  mb.quadFace(p(x0, y0, z0), p(x1, y0, z0), p(x1, y0, z1), p(x0, y0, z1))
  mb.quadFace(p(x1, y1, z0), p(x0, y1, z0), p(x0, y1, z1), p(x1, y1, z1))
  mb.quadFace(p(x1, y0, z0), p(x1, y1, z0), p(x1, y1, z1), p(x1, y0, z1))
  mb.quadFace(p(x0, y1, z0), p(x0, y0, z0), p(x0, y0, z1), p(x0, y1, z1))
}

/** Box given by center, size and rotation about Z. */
export function addBoxRotated(mb: MeshBuilder, cx: number, cy: number, z0: number, sx: number, sy: number, sz: number, angle: number): void {
  const c = Math.cos(angle), s = Math.sin(angle)
  const P = (x: number, y: number, z: number): Vec3 => [cx + x * c - y * s, cy + x * s + y * c, z]
  const hx = sx / 2, hy = sy / 2, z1 = z0 + sz
  mb.quadFace(P(-hx, -hy, z0), P(-hx, hy, z0), P(hx, hy, z0), P(hx, -hy, z0))
  mb.quadFace(P(-hx, -hy, z1), P(hx, -hy, z1), P(hx, hy, z1), P(-hx, hy, z1))
  mb.quadFace(P(-hx, -hy, z0), P(hx, -hy, z0), P(hx, -hy, z1), P(-hx, -hy, z1))
  mb.quadFace(P(hx, hy, z0), P(-hx, hy, z0), P(-hx, hy, z1), P(hx, hy, z1))
  mb.quadFace(P(hx, -hy, z0), P(hx, hy, z0), P(hx, hy, z1), P(hx, -hy, z1))
  mb.quadFace(P(-hx, hy, z0), P(-hx, -hy, z0), P(-hx, -hy, z1), P(-hx, hy, z1))
}

/** Vertical cylinder (closed) with smooth sides. */
export function addCylinderZ(mb: MeshBuilder, cx: number, cy: number, r: number, z0: number, z1: number, segs = 24): void {
  addCylinderBetween(mb, [cx, cy, z0], [cx, cy, z1], r, segs)
}

/** Closed cylinder between two points (any axis). */
export function addCylinderBetween(mb: MeshBuilder, a: Vec3, b: Vec3, r: number, segs = 16, r2 = r): void {
  const axis = sub3(b, a)
  const len = Math.hypot(axis[0], axis[1], axis[2])
  if (len < 1e-9 || r <= 0) return
  const t = normalize3(axis)
  const ref: Vec3 = Math.abs(t[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]
  const u = normalize3(cross3(ref, t))
  const v = cross3(t, u)
  const base = mb.vertexCount
  for (let i = 0; i <= segs; i++) {
    const ang = (TAU * i) / segs
    const c = Math.cos(ang), s = Math.sin(ang)
    const nx = u[0] * c + v[0] * s, ny = u[1] * c + v[1] * s, nz = u[2] * c + v[2] * s
    mb.vertex(a[0] + nx * r, a[1] + ny * r, a[2] + nz * r, nx, ny, nz, r * ang, 0)
    mb.vertex(b[0] + nx * r2, b[1] + ny * r2, b[2] + nz * r2, nx, ny, nz, r2 * ang, len)
  }
  for (let i = 0; i < segs; i++) {
    const a0 = base + i * 2, a1 = a0 + 2
    mb.orientedQuad(a0, a1, a1 + 1, a0 + 1)
  }
  // caps
  const capA: Vec3[] = [], capB: Vec3[] = []
  for (let i = 0; i < segs; i++) {
    const ang = (TAU * i) / segs
    const c = Math.cos(ang), s = Math.sin(ang)
    const nx = u[0] * c + v[0] * s, ny = u[1] * c + v[1] * s, nz = u[2] * c + v[2] * s
    capA.push([a[0] + nx * r, a[1] + ny * r, a[2] + nz * r])
    capB.push([b[0] + nx * r2, b[1] + ny * r2, b[2] + nz * r2])
  }
  mb.face(capA, [], [-t[0], -t[1], -t[2]])
  mb.face(capB, [], t)
}

/** UV sphere. */
export function addSphere(mb: MeshBuilder, c: Vec3, r: number, segs = 16): void {
  const rings = Math.max(4, Math.round(segs / 2))
  const base = mb.vertexCount
  for (let i = 0; i <= rings; i++) {
    const phi = -Math.PI / 2 + (Math.PI * i) / rings
    const cp = Math.cos(phi), sp = Math.sin(phi)
    for (let j = 0; j <= segs; j++) {
      const th = (TAU * j) / segs
      const nx = cp * Math.cos(th), ny = cp * Math.sin(th), nz = sp
      mb.vertex(c[0] + nx * r, c[1] + ny * r, c[2] + nz * r, nx, ny, nz, r * th, r * (phi + Math.PI / 2))
    }
  }
  const cols = segs + 1
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = base + i * cols + j, b = a + 1, cc = base + (i + 1) * cols + j + 1, d = cc - 1
      if (i === 0) mb.orientedTri(a, b, cc)
      else if (i === rings - 1) mb.orientedTri(a, b, d)
      else mb.orientedQuad(a, b, cc, d)
    }
  }
}

/** Collects geometry per material id ('' = node material) and emits MeshParts. */
export class PartSet {
  private map = new Map<string, MeshBuilder>()
  private flags = new Map<string, { castShadow: boolean }>()
  get(material?: string | null, opts: { castShadow?: boolean } = {}): MeshBuilder {
    const key = material ?? ''
    let mb = this.map.get(key)
    if (!mb) {
      this.map.set(key, (mb = new MeshBuilder(128)))
      this.flags.set(key, { castShadow: opts.castShadow ?? true })
    }
    return mb
  }
  build(transform?: Mat4Like): MeshPart[] {
    const parts: MeshPart[] = []
    for (const [key, mb] of this.map) {
      if (!mb.vertexCount) continue
      let mesh = mb.build()
      if (transform) {
        const t = new MeshBuilder(mesh.positions.length / 3)
        t.append(mesh, transform)
        mesh = t.build()
      }
      parts.push({ mesh, material: key ? { id: key } : 'node', castShadow: this.flags.get(key)?.castShadow ?? true, receiveShadow: true })
    }
    return parts
  }
}

/**
 * Straight prism: a CCW 2D ring in the (u, v) cross-section plane is swept from a to b.
 * u and v must be unit vectors perpendicular to the axis (v × u pointing along a→b keeps normals outward).
 */
export function addPrismAlong(mb: MeshBuilder, ring: readonly [number, number][], a: Vec3, b: Vec3, u: Vec3, v: Vec3): void {
  const n = ring.length
  if (n < 3) return
  const at = (q: [number, number], o: Vec3): Vec3 => [o[0] + u[0] * q[0] + v[0] * q[1], o[1] + u[1] * q[0] + v[1] * q[1], o[2] + u[2] * q[0] + v[2] * q[1]]
  const axis = normalize3(sub3(b, a))
  const startCap = ring.map((q) => at(q, a))
  const endCap = ring.map((q) => at(q, b))
  mb.face(startCap, [], [-axis[0], -axis[1], -axis[2]])
  mb.face(endCap, [], axis)
  // a CCW ring (seen with u × v toward the viewer) swept along u × v gives outward side quads
  let area = 0
  for (let i = 0; i < n; i++) {
    const p = ring[i]!, q = ring[(i + 1) % n]!
    area += p[0] * q[1] - q[0] * p[1]
  }
  const w = cross3(u, v)
  const forward = (area > 0) === (w[0] * axis[0] + w[1] * axis[1] + w[2] * axis[2] > 0)
  for (let i = 0; i < n; i++) {
    const p0 = startCap[i]!, p1 = startCap[(i + 1) % n]!, p2 = endCap[(i + 1) % n]!, p3 = endCap[i]!
    if (forward) mb.quadFace(p0, p1, p2, p3)
    else mb.quadFace(p0, p3, p2, p1)
  }
}
