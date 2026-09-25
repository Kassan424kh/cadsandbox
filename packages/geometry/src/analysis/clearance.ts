// Square clearance of a plan region (movement areas, corridor widths). The region is rotated into the
// frame of its longest edge (walls are usually parallel to it), rasterized, and every cell gets its
// L∞ distance to the boundary = the half-size of the largest wall-aligned square centered there.
// Robust for non-convex shapes with holes (unlike naive polygon offsetting).
import type { Vec2 } from '@cadsandbox/doc'
import { pointInPolys, type PolyWithHoles } from '../core/polygon'

/** L∞ distance from p to segment a–b. */
function linfSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const ux = ax - px, uy = ay - py, dx = bx - ax, dy = by - ay
  const f = (t: number) => Math.max(Math.abs(ux + t * dx), Math.abs(uy + t * dy))
  let best = Math.min(f(0), f(1))
  // kinks of max(|u|, |v|): u = v and u = −v
  const d1 = dx - dy
  if (Math.abs(d1) > 1e-12) {
    const t = (uy - ux) / d1
    if (t > 0 && t < 1) best = Math.min(best, f(t))
  }
  const d2 = dx + dy
  if (Math.abs(d2) > 1e-12) {
    const t = -(ux + uy) / d2
    if (t > 0 && t < 1) best = Math.min(best, f(t))
  }
  return best
}

export class SquareClearance {
  readonly spacing: number
  private nx = 0
  private ny = 0
  private x0 = 0
  private y0 = 0
  private inside: Uint8Array = new Uint8Array(0)
  private dinf: Float64Array = new Float64Array(0)
  private edges: number[] = []
  private polys: PolyWithHoles[] = []
  private insideCount = 0

  constructor(polys: readonly PolyWithHoles[], spacing = 0.02, maxCells = 80_000) {
    // frame of the longest edge
    let angle = 0, longest = -1
    for (const p of polys)
      for (let i = 0; i < p.outer.length; i++) {
        const a = p.outer[i]!, b = p.outer[(i + 1) % p.outer.length]!
        const l = Math.hypot(b[0] - a[0], b[1] - a[1])
        if (l > longest) {
          longest = l
          angle = Math.atan2(b[1] - a[1], b[0] - a[0])
        }
      }
    const c = Math.cos(-angle), s = Math.sin(-angle)
    const rot = (q: Vec2): Vec2 => [q[0] * c - q[1] * s, q[0] * s + q[1] * c]
    this.polys = polys.map((p) => ({ outer: p.outer.map(rot), holes: p.holes.map((h) => h.map(rot)) }))
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const p of this.polys) {
      for (const ring of [p.outer, ...p.holes])
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i]!, b = ring[(i + 1) % ring.length]!
          this.edges.push(a[0], a[1], b[0], b[1])
        }
      for (const q of p.outer) {
        minX = Math.min(minX, q[0])
        minY = Math.min(minY, q[1])
        maxX = Math.max(maxX, q[0])
        maxY = Math.max(maxY, q[1])
      }
    }
    if (!Number.isFinite(minX)) {
      this.spacing = spacing
      return
    }
    const area = (maxX - minX) * (maxY - minY)
    this.spacing = Math.max(spacing, Math.sqrt(area / maxCells))
    const h = this.spacing
    this.nx = Math.max(1, Math.ceil((maxX - minX) / h))
    this.ny = Math.max(1, Math.ceil((maxY - minY) / h))
    this.x0 = minX
    this.y0 = minY
    const n = this.nx * this.ny
    this.inside = new Uint8Array(n)
    this.dinf = new Float64Array(n)
    for (let j = 0; j < this.ny; j++)
      for (let i = 0; i < this.nx; i++) {
        const x = minX + (i + 0.5) * h, y = minY + (j + 0.5) * h
        if (!pointInPolys([x, y], this.polys)) continue
        const k = j * this.nx + i
        this.inside[k] = 1
        this.insideCount++
        this.dinf[k] = this.distance(x, y)
      }
  }

  private distance(x: number, y: number): number {
    const E = this.edges
    let d = Infinity
    for (let e = 0; e < E.length; e += 4) d = Math.min(d, linfSegment(x, y, E[e]!, E[e + 1]!, E[e + 2]!, E[e + 3]!))
    return d
  }

  /** Half-size of the largest wall-aligned square that fits (refined beyond the raster). */
  maxHalf(): number {
    let best = -1, bx = 0, by = 0
    for (let k = 0; k < this.dinf.length; k++) {
      if (this.inside[k] && this.dinf[k]! > best) {
        best = this.dinf[k]!
        bx = this.x0 + ((k % this.nx) + 0.5) * this.spacing
        by = this.y0 + (Math.floor(k / this.nx) + 0.5) * this.spacing
      }
    }
    if (best < 0) return 0
    // pattern search around the best cell
    let step = this.spacing / 2
    while (step > 5e-4) {
      let moved = false
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
        const x = bx + dx * step, y = by + dy * step
        if (!pointInPolys([x, y], this.polys)) continue
        const d = this.distance(x, y)
        if (d > best + 1e-9) {
          best = d
          bx = x
          by = y
          moved = true
        }
      }
      if (!moved) step /= 2
    }
    return best
  }

  /** Share of the region covered by wall-aligned squares of half-size `half` that fit (morphological opening). */
  retained(half: number): number {
    if (!this.insideCount) return 0
    const { nx, ny } = this
    const tol = this.spacing / 2
    const k = Math.max(0, Math.floor(half / this.spacing + 1e-6))
    const valid = new Uint8Array(nx * ny)
    let any = false
    for (let i = 0; i < valid.length; i++)
      if (this.inside[i] && this.dinf[i]! >= half - tol) {
        valid[i] = 1
        any = true
      }
    if (!any) return 0
    // separable box dilation (L∞) by k cells
    const rows = new Uint8Array(nx * ny)
    for (let j = 0; j < ny; j++) {
      let count = 0
      const base = j * nx
      for (let i = 0; i < Math.min(nx, k); i++) count += valid[base + i]!
      for (let i = 0; i < nx; i++) {
        if (i + k < nx) count += valid[base + i + k]!
        if (i - k - 1 >= 0) count -= valid[base + i - k - 1]!
        rows[base + i] = count > 0 ? 1 : 0
      }
    }
    let covered = 0
    for (let i = 0; i < nx; i++) {
      let count = 0
      for (let j = 0; j < Math.min(ny, k); j++) count += rows[j * nx + i]!
      for (let j = 0; j < ny; j++) {
        if (j + k < ny) count += rows[(j + k) * nx + i]!
        if (j - k - 1 >= 0) count -= rows[(j - k - 1) * nx + i]!
        if (count > 0 && this.inside[j * nx + i]) covered++
      }
    }
    return covered / this.insideCount
  }
}
