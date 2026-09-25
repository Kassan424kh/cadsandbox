// 2D geometry helpers: DXF bulge arcs, B-spline → cubic Bézier, elliptical arcs, polygons.
import type { PathPoint, Vec2 } from '@cadsandbox/doc'

export const TAU = Math.PI * 2

export function signedArea(pts: readonly Vec2[]): number {
  let a = 0
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j]![0] - pts[i]![0]) * (pts[j]![1] + pts[i]![1])
  return a / 2
}

export function pointInPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!,
      [xj, yj] = poly[j]!
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Arc through a bulge segment: center, radius, start angle and signed sweep (CCW positive). */
export function bulgeArc(a: Vec2, b: Vec2, bulge: number): { c: Vec2; r: number; start: number; sweep: number } | null {
  if (!bulge) return null
  const dx = b[0] - a[0],
    dy = b[1] - a[1]
  const chord = Math.hypot(dx, dy)
  if (chord < 1e-12) return null
  const theta = 4 * Math.atan(bulge)
  const d = chord / 2 / Math.tan(theta / 2)
  const c: Vec2 = [(a[0] + b[0]) / 2 - (dy / chord) * d, (a[1] + b[1]) / 2 + (dx / chord) * d]
  return { c, r: Math.hypot(a[0] - c[0], a[1] - c[1]), start: Math.atan2(a[1] - c[1], a[0] - c[0]), sweep: theta }
}

/** Points along a bulge arc (excluding the start point, including the end point). */
export function bulgePoints(a: Vec2, b: Vec2, bulge: number, maxStep = Math.PI / 24): Vec2[] {
  const arc = bulgeArc(a, b, bulge)
  if (!arc) return [b]
  const n = Math.max(2, Math.ceil(Math.abs(arc.sweep) / maxStep))
  const out: Vec2[] = []
  for (let k = 1; k < n; k++) {
    const t = arc.start + (arc.sweep * k) / n
    out.push([arc.c[0] + arc.r * Math.cos(t), arc.c[1] + arc.r * Math.sin(t)])
  }
  out.push(b)
  return out
}

/** Flatten a polyline with bulges into points. */
export function flattenBulged(points: readonly Vec2[], bulges: readonly number[] | undefined, closed: boolean): Vec2[] {
  if (!points.length) return []
  const out: Vec2[] = [points[0]!]
  const n = points.length
  const segs = closed ? n : n - 1
  for (let i = 0; i < segs; i++) {
    const a = points[i]!,
      b = points[(i + 1) % n]!
    const bg = bulges?.[i] ?? 0
    if (Math.abs(bg) > 1e-9) out.push(...bulgePoints(a, b, bg))
    else out.push(b)
  }
  if (closed && out.length > 1) {
    const f = out[0]!,
      l = out[out.length - 1]!
    if (Math.abs(f[0] - l[0]) < 1e-12 && Math.abs(f[1] - l[1]) < 1e-12) out.pop()
  }
  return out
}

/** Cubic Bézier approximation of an elliptical arc (≤ 90° per segment). Returns path points with handles. */
export function ellipseArcPath(cx: number, cy: number, rx: number, ry: number, rotation: number, start: number, end: number): PathPoint[] {
  let sweep = end - start
  if (sweep <= 0) sweep += TAU
  const n = Math.max(1, Math.ceil(sweep / (Math.PI / 2) - 1e-9))
  const cr = Math.cos(rotation),
    sr = Math.sin(rotation)
  const map = (x: number, y: number): Vec2 => [cx + (x * rx) * cr - (y * ry) * sr, cy + (x * rx) * sr + (y * ry) * cr]
  const step = sweep / n
  const k = (4 / 3) * Math.tan(step / 4)
  const pts: PathPoint[] = []
  for (let i = 0; i <= n; i++) {
    const t = start + step * i
    const c = Math.cos(t),
      s = Math.sin(t)
    const p: PathPoint = { p: map(c, s) }
    if (i > 0) p.hi = map(c + k * s, s - k * c)
    if (i < n) p.ho = map(c - k * s, s + k * c)
    pts.push(p)
  }
  return pts
}

// ------------------------------------------------------------------ B-splines
/** Evaluate a (rational) B-spline at parameter u with de Boor's algorithm. */
export function deBoor(degree: number, knots: readonly number[], ctrl: readonly Vec2[], weights: readonly number[] | undefined, u: number): Vec2 {
  const n = ctrl.length - 1
  let k = degree
  while (k < n && u >= knots[k + 1]!) k++
  const d: [number, number, number][] = []
  for (let j = 0; j <= degree; j++) {
    const i = Math.min(n, Math.max(0, k - degree + j))
    const w = weights?.[i] ?? 1
    d.push([ctrl[i]![0] * w, ctrl[i]![1] * w, w])
  }
  for (let r = 1; r <= degree; r++) {
    for (let j = degree; j >= r; j--) {
      const i = k - degree + j
      const den = knots[i + degree - r + 1]! - knots[i]!
      const alpha = den ? (u - knots[i]!) / den : 0
      for (let c = 0; c < 3; c++) d[j]![c] = (1 - alpha) * d[j - 1]![c]! + alpha * d[j]![c]!
    }
  }
  const w = d[degree]![2] || 1
  return [d[degree]![0] / w, d[degree]![1] / w]
}

/** Catmull-Rom interpolation through points → cubic Bézier path points. */
export function catmullRomPath(pts: readonly Vec2[], closed = false): PathPoint[] {
  const n = pts.length
  if (n < 3) return pts.map((p) => ({ p: [p[0], p[1]] }))
  const get = (i: number) => (closed ? pts[(i + n) % n]! : pts[Math.min(n - 1, Math.max(0, i))]!)
  return pts.map((p, i) => {
    const prev = get(i - 1),
      next = get(i + 1)
    const tx = (next[0] - prev[0]) / 6,
      ty = (next[1] - prev[1]) / 6
    const out: PathPoint = { p: [p[0], p[1]] }
    if (closed || i > 0) out.hi = [p[0] - tx, p[1] - ty]
    if (closed || i < n - 1) out.ho = [p[0] + tx, p[1] + ty]
    return out
  })
}

function clampedKnots(knots: readonly number[], degree: number, nCtrl: number): boolean {
  if (knots.length !== nCtrl + degree + 1) return false
  for (let i = 1; i <= degree; i++) {
    if (Math.abs(knots[i]! - knots[0]!) > 1e-12) return false
    if (Math.abs(knots[knots.length - 1 - i]! - knots[knots.length - 1]!) > 1e-12) return false
  }
  return true
}

/** Exact Bézier decomposition (NURBS Book A5.6) for clamped non-rational splines of degree 1–3;
 *  sampled Catmull-Rom approximation otherwise. */
export function bsplinePath(degree: number, knots: readonly number[], ctrl: readonly Vec2[], weights?: readonly number[], closed = false): PathPoint[] {
  const p = degree
  const rational = !!weights && weights.some((w) => Math.abs(w - weights[0]!) > 1e-9)
  if (ctrl.length < 2) return ctrl.map((c) => ({ p: [c[0], c[1]] }))
  if (p === 1 && ctrl.length >= 2) return ctrl.map((c) => ({ p: [c[0], c[1]] }))
  if (rational || p > 3 || p < 1 || !clampedKnots(knots, p, ctrl.length)) {
    const u0 = knots[p] ?? 0,
      u1 = knots[knots.length - 1 - p] ?? 1
    const count = Math.max(16, ctrl.length * 8)
    const samples: Vec2[] = []
    for (let i = 0; i <= count; i++) samples.push(deBoor(p, knots, ctrl, weights, u0 + ((u1 - u0) * i) / count))
    if (closed) samples.pop()
    return catmullRomPath(samples, closed)
  }
  const U = knots
  const m = U.length - 1
  const Q: Vec2[][] = [ctrl.slice(0, p + 1).map((c) => [c[0], c[1]] as Vec2)]
  let a = p,
    b = p + 1,
    nb = 0
  const alphas: number[] = []
  while (b < m) {
    const i = b
    while (b < m && Math.abs(U[b + 1]! - U[b]!) < 1e-12) b++
    const mult = b - i + 1
    if (mult < p) {
      const numer = U[b]! - U[a]!
      for (let j = p; j > mult; j--) alphas[j - mult - 1] = numer / (U[a + j]! - U[a]!)
      const r = p - mult
      Q[nb + 1] ??= []
      for (let j = 1; j <= r; j++) {
        const save = r - j,
          s = mult + j
        for (let k = p; k >= s; k--) {
          const al = alphas[k - s]!
          const A = Q[nb]![k]!,
            B = Q[nb]![k - 1]!
          Q[nb]![k] = [al * A[0] + (1 - al) * B[0], al * A[1] + (1 - al) * B[1]]
        }
        if (b < m) Q[nb + 1]![save] = Q[nb]![p]!
      }
    }
    nb++
    if (b < m) {
      Q[nb] ??= []
      for (let k = p - mult; k <= p; k++) Q[nb]![k] = ctrl[b - p + k]!
      a = b
      b++
    }
  }
  const segs = Q.slice(0, nb).filter((s) => s.length === p + 1 && s.every(Boolean))
  const out: PathPoint[] = []
  for (const seg of segs) {
    // degree elevation to cubic
    let c: Vec2[] = seg
    if (p === 2) {
      const [P0, P1, P2] = seg as [Vec2, Vec2, Vec2]
      c = [P0, [P0[0] + (2 / 3) * (P1[0] - P0[0]), P0[1] + (2 / 3) * (P1[1] - P0[1])], [P2[0] + (2 / 3) * (P1[0] - P2[0]), P2[1] + (2 / 3) * (P1[1] - P2[1])], P2]
    }
    const [c0, c1, c2, c3] = c as [Vec2, Vec2, Vec2, Vec2]
    if (!out.length) out.push({ p: [c0[0], c0[1]] })
    out[out.length - 1]!.ho = [c1[0], c1[1]]
    out.push({ p: [c3[0], c3[1]], hi: [c2[0], c2[1]] })
  }
  if (closed && out.length > 2) {
    const f = out[0]!,
      l = out[out.length - 1]!
    if (Math.hypot(f.p[0] - l.p[0], f.p[1] - l.p[1]) < 1e-9) {
      if (l.hi) f.hi = l.hi
      out.pop()
    }
  }
  return out
}

/** Flatten a Bézier path contour to points (for hatch boundaries / previews). */
export function flattenPath(points: readonly PathPoint[], closed: boolean, steps = 12): Vec2[] {
  const out: Vec2[] = []
  const n = points.length
  if (!n) return out
  out.push(points[0]!.p)
  const segs = closed ? n : n - 1
  for (let i = 0; i < segs; i++) {
    const a = points[i]!,
      b = points[(i + 1) % n]!
    if (!a.ho && !b.hi) {
      out.push(b.p)
      continue
    }
    const p0 = a.p,
      p1 = a.ho ?? a.p,
      p2 = b.hi ?? b.p,
      p3 = b.p
    for (let k = 1; k <= steps; k++) {
      const t = k / steps,
        u = 1 - t
      out.push([
        u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
      ])
    }
  }
  if (closed && out.length > 1) {
    const f = out[0]!,
      l = out[out.length - 1]!
    if (Math.hypot(f[0] - l[0], f[1] - l[1]) < 1e-12) out.pop()
  }
  return out
}
