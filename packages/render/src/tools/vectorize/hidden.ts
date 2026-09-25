// Practical hidden-line removal for sections/elevations: triangles are projected into the view
// frame and binned in a uniform grid; feature edges are sampled and each sample is tested against
// the triangles covering it (closer depth = occluded). Visible runs become output segments.
import type { Vec3 } from '@cadsandbox/doc'
import type { Seg2 } from '../util/polygon'
import { projectPoint, type ViewFrame, type WorldMesh } from './mesh'

export class OcclusionGrid {
  /** flat triangle data: u0 v0 d0 u1 v1 d1 u2 v2 d2 */
  private tris: number[] = []
  private cells = new Map<string, number[]>()
  private count = 0
  constructor(
    private cell = 0.5,
    private minDepth = 0,
  ) {}

  addMesh(mesh: WorldMesh, frame: ViewFrame, maxDepth = Infinity): void {
    const P = mesh.positions
    const I = mesh.indices
    for (let t = 0; t + 2 < I.length; t += 3) {
      const pts: [number, number, number][] = []
      for (let k = 0; k < 3; k++) {
        const i = I[t + k]
        pts.push(projectPoint(frame, [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]))
      }
      // Entirely behind the cut plane or beyond the far clip → cannot occlude.
      if (pts.every((p) => p[2] < this.minDepth)) continue
      if (pts.every((p) => p[2] > maxDepth)) continue
      this.addTriangle(pts[0], pts[1], pts[2])
    }
  }

  addTriangle(a: [number, number, number], b: [number, number, number], c: [number, number, number]): void {
    const idx = this.count++
    this.tris.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2])
    const minU = Math.min(a[0], b[0], c[0]),
      maxU = Math.max(a[0], b[0], c[0])
    const minV = Math.min(a[1], b[1], c[1]),
      maxV = Math.max(a[1], b[1], c[1])
    const c0 = Math.floor(minU / this.cell),
      c1 = Math.floor(maxU / this.cell)
    const r0 = Math.floor(minV / this.cell),
      r1 = Math.floor(maxV / this.cell)
    if ((c1 - c0 + 1) * (r1 - r0 + 1) > 40000) return // degenerate/huge triangle: skip as occluder
    for (let cx = c0; cx <= c1; cx++)
      for (let cy = r0; cy <= r1; cy++) {
        const k = `${cx},${cy}`
        const arr = this.cells.get(k)
        if (arr) arr.push(idx)
        else this.cells.set(k, [idx])
      }
  }

  get size(): number {
    return this.count
  }

  /** Is the point (u, v) at `depth` hidden behind a closer triangle? */
  isHidden(u: number, v: number, depth: number): boolean {
    const arr = this.cells.get(`${Math.floor(u / this.cell)},${Math.floor(v / this.cell)}`)
    if (!arr) return false
    const eps = 1e-3 + Math.abs(depth) * 1e-4
    const T = this.tris
    for (const i of arr) {
      const o = i * 9
      const u0 = T[o],
        v0 = T[o + 1],
        d0 = T[o + 2]
      const u1 = T[o + 3],
        v1 = T[o + 4],
        d1 = T[o + 5]
      const u2 = T[o + 6],
        v2 = T[o + 7],
        d2 = T[o + 8]
      // barycentric coordinates
      const det = (v1 - v2) * (u0 - u2) + (u2 - u1) * (v0 - v2)
      if (Math.abs(det) < 1e-14) continue
      const l0 = ((v1 - v2) * (u - u2) + (u2 - u1) * (v - v2)) / det
      const l1 = ((v2 - v0) * (u - u2) + (u0 - u2) * (v - v2)) / det
      const l2 = 1 - l0 - l1
      const tol = -1e-6
      if (l0 < tol || l1 < tol || l2 < tol) continue
      const d = l0 * d0 + l1 * d1 + l2 * d2
      if (d < this.minDepth) continue // cut away
      if (d < depth - eps) return true
    }
    return false
  }
}

export interface VisibilityOptions {
  minDepth: number
  maxDepth: number
  /** Sample spacing along edges (m) */
  step: number
  /** Optional horizontal crop in frame u */
  uRange?: [number, number]
}

/** Visible parts (frame u,v) of world-space edge pairs after occlusion testing. */
export function visibleEdges(edges: ArrayLike<number>, frame: ViewFrame, grid: OcclusionGrid, opts: VisibilityOptions): Seg2[] {
  const out: Seg2[] = []
  for (let i = 0; i + 5 < edges.length; i += 6) {
    let a = projectPoint(frame, [edges[i], edges[i + 1], edges[i + 2]])
    let b = projectPoint(frame, [edges[i + 3], edges[i + 4], edges[i + 5]])
    // clip to the depth range
    const clipped = clipDepth(a, b, opts.minDepth, opts.maxDepth)
    if (!clipped) continue
    ;[a, b] = clipped
    if (opts.uRange) {
      const c = clipU(a, b, opts.uRange)
      if (!c) continue
      ;[a, b] = c
    }
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (len < 1e-6) continue
    const n = Math.max(2, Math.ceil(len / opts.step))
    let runStart: number | null = null
    for (let k = 0; k < n; k++) {
      const tm = (k + 0.5) / n
      const u = a[0] + (b[0] - a[0]) * tm,
        v = a[1] + (b[1] - a[1]) * tm,
        d = a[2] + (b[2] - a[2]) * tm
      const hidden = grid.isHidden(u, v, d)
      if (!hidden && runStart === null) runStart = k / n
      if (hidden && runStart !== null) {
        out.push(seg(a, b, runStart, k / n))
        runStart = null
      }
    }
    if (runStart !== null) out.push(seg(a, b, runStart, 1))
  }
  return out
}

function seg(a: number[], b: number[], t0: number, t1: number): Seg2 {
  return { a: [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0], b: [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1] }
}

type P3 = [number, number, number]

function lerp3(a: P3, b: P3, t: number): P3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function clipDepth(a: P3, b: P3, min: number, max: number): [P3, P3] | null {
  let t0 = 0,
    t1 = 1
  const da = a[2],
    db = b[2]
  for (const [lim, keepAbove] of [
    [min, true],
    [max, false],
  ] as [number, boolean][]) {
    if (!Number.isFinite(lim)) continue
    const fa = keepAbove ? da - lim : lim - da
    const fb = keepAbove ? db - lim : lim - db
    if (fa < 0 && fb < 0) return null
    if (fa < 0 || fb < 0) {
      const t = fa / (fa - fb)
      if (fa < 0) t0 = Math.max(t0, t)
      else t1 = Math.min(t1, t)
    }
  }
  if (t1 <= t0) return null
  return [lerp3(a, b, t0), lerp3(a, b, t1)]
}

function clipU(a: P3, b: P3, range: [number, number]): [P3, P3] | null {
  let t0 = 0,
    t1 = 1
  for (const [lim, keepAbove] of [
    [range[0], true],
    [range[1], false],
  ] as [number, boolean][]) {
    const fa = keepAbove ? a[0] - lim : lim - a[0]
    const fb = keepAbove ? b[0] - lim : lim - b[0]
    if (fa < 0 && fb < 0) return null
    if (fa < 0 || fb < 0) {
      const t = fa / (fa - fb)
      if (fa < 0) t0 = Math.max(t0, t)
      else t1 = Math.min(t1, t)
    }
  }
  if (t1 <= t0) return null
  return [lerp3(a, b, t0), lerp3(a, b, t1)]
}

export function frameFromView(origin: Vec3, dir: Vec3, up: Vec3 = [0, 0, 1]): ViewFrame {
  const d = norm(dir)
  let u = cross(d, up)
  if (Math.hypot(u[0], u[1], u[2]) < 1e-9) u = cross(d, [0, 1, 0])
  u = norm(u)
  const v = norm(cross(u, d))
  return { origin, u, v, dir: d }
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
function norm(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}
