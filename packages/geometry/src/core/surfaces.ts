// Parametric surface helpers: lathe (revolution) and grid surfaces.
import type { Vec2, Vec3 } from '@cadsandbox/doc'
import { MeshBuilder } from './mesh'

export interface LathePoint {
  r: number
  z: number
  /** unit normal in the (r, z) half-plane */
  nr: number
  nz: number
  /** v texture coordinate (meters along the profile) */
  v: number
}

/** Build a smooth profile with normals from an (r,z) polyline (per-vertex averaged normals). */
export function latheProfile(pts: readonly Vec2[], closed = false): LathePoint[] {
  const n = pts.length
  const out: LathePoint[] = []
  let v = 0
  for (let i = 0; i < n; i++) {
    const p = pts[i]!
    const prev = i > 0 ? pts[i - 1]! : closed ? pts[n - 1]! : null
    const next = i < n - 1 ? pts[i + 1]! : closed ? pts[0]! : null
    let nr = 0, nz = 0
    if (prev) {
      const dr = p[0] - prev[0], dz = p[1] - prev[1]
      const l = Math.hypot(dr, dz) || 1
      nr += dz / l
      nz += -dr / l
    }
    if (next) {
      const dr = next[0] - p[0], dz = next[1] - p[1]
      const l = Math.hypot(dr, dz) || 1
      nr += dz / l
      nz += -dr / l
    }
    const l = Math.hypot(nr, nz) || 1
    if (i > 0) v += Math.hypot(p[0] - pts[i - 1]![0], p[1] - pts[i - 1]![1])
    out.push({ r: p[0], z: p[1], nr: nr / l, nz: nz / l, v })
  }
  return out
}

/**
 * Revolve a profile around Z. Columns run from `start` to `start + sweep` (seam duplicated for
 * UVs). Quads face along the profile normals (which should point outward from the solid).
 */
export function latheInto(mb: MeshBuilder, profile: readonly LathePoint[], segments: number, sweep: number, start = 0): void {
  const rows = profile.length
  if (rows < 2 || segments < 1) return
  const cols = segments + 1
  const base = mb.vertexCount
  for (let i = 0; i < rows; i++) {
    const p = profile[i]!
    for (let j = 0; j < cols; j++) {
      const t = start + (sweep * j) / segments
      const c = Math.cos(t), s = Math.sin(t)
      mb.vertex(p.r * c, p.r * s, p.z, p.nr * c, p.nr * s, p.nz, (Math.abs(p.r) * sweep * j) / segments, p.v)
    }
  }
  for (let i = 0; i < rows - 1; i++) {
    const a = profile[i]!, b = profile[i + 1]!
    const aZero = Math.abs(a.r) < 1e-12, bZero = Math.abs(b.r) < 1e-12
    if (aZero && bZero) continue
    for (let j = 0; j < segments; j++) {
      const i0 = base + i * cols + j, i1 = i0 + 1
      const k0 = base + (i + 1) * cols + j, k1 = k0 + 1
      if (aZero) mb.orientedTri(i0, k1, k0)
      else if (bZero) mb.orientedTri(i0, i1, k0)
      else mb.orientedQuad(i0, i1, k1, k0)
    }
  }
}

/** Planar cap of a revolved sector at angle `t` (profile polygon in (r,z), normal chosen by `flip`). */
export function latheCap(mb: MeshBuilder, ring: readonly Vec2[], t: number, flip: boolean): void {
  const c = Math.cos(t), s = Math.sin(t)
  const pts: Vec3[] = ring.map((p) => [p[0] * c, p[0] * s, p[1]] as Vec3)
  // tangential normal: +t direction is (-s, c); start cap faces -tangent, end cap faces +tangent
  const n: Vec3 = flip ? [s, -c, 0] : [-s, c, 0]
  mb.face(pts, [], n)
}

export type GridSample = (i: number, j: number, out: { p: Vec3; n: Vec3; uv: Vec2 }) => void

/** Grid surface with rows × cols samples. Quads are oriented along the sampled normals. */
export function gridInto(mb: MeshBuilder, rows: number, cols: number, sample: GridSample, wrapCols = false): void {
  const base = mb.vertexCount
  const tmp = { p: [0, 0, 0] as Vec3, n: [0, 0, 1] as Vec3, uv: [0, 0] as Vec2 }
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      sample(i, j, tmp)
      mb.vertex(tmp.p[0], tmp.p[1], tmp.p[2], tmp.n[0], tmp.n[1], tmp.n[2], tmp.uv[0], tmp.uv[1])
    }
  }
  const cj = wrapCols ? cols : cols - 1
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < cj; j++) {
      const j1 = (j + 1) % cols
      const a = base + i * cols + j, b = base + i * cols + j1
      const c = base + (i + 1) * cols + j1, d = base + (i + 1) * cols + j
      mb.orientedQuad(a, b, c, d)
    }
  }
}
