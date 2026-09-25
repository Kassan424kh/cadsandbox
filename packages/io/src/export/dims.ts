// Dimension geometry (German convention: 45° ticks, dimension line slightly past the ticks, text
// above the line in reading direction). Used by the DXF (block graphics), SVG and PDF writers.
import type { DimensionKind, Vec2 } from '@cadsandbox/doc'

export interface DimGeom {
  kind: DimensionKind
  /** meters (lengths) or radians (angular) */
  measured: number
  text: string
  p1: Vec2
  p2: Vec2
  /** angular vertex / radius+diameter center */
  center?: Vec2
  /** dimension line end points (linear/aligned/radius/diameter) or arc ends (angular) */
  d1: Vec2
  d2: Vec2
  /** linear/aligned: direction angle of the dimension line */
  angle: number
  arc?: { c: Vec2; r: number; start: number; sweep: number }
  lines: [Vec2, Vec2][]
  ticks: [Vec2, Vec2][]
  textPos: Vec2
  textAngle: number
  textSize: number
}

const add = (a: Vec2, b: Vec2, k = 1): Vec2 => [a[0] + b[0] * k, a[1] + b[1] * k]
const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]]
const len = (a: Vec2) => Math.hypot(a[0], a[1])
const norm = (a: Vec2): Vec2 => {
  const l = len(a) || 1
  return [a[0] / l, a[1] / l]
}
const rot = (a: Vec2, t: number): Vec2 => [a[0] * Math.cos(t) - a[1] * Math.sin(t), a[0] * Math.sin(t) + a[1] * Math.cos(t)]

/** Reading direction: rotate text by 180° when it would be upside down. */
function readable(angle: number): number {
  let a = Math.atan2(Math.sin(angle), Math.cos(angle))
  if (a > Math.PI / 2 + 1e-9) a -= Math.PI
  if (a <= -Math.PI / 2 + 1e-9) a += Math.PI
  return a
}

function tick(at: Vec2, dir: Vec2, size: number): [Vec2, Vec2] {
  const d = rot(dir, Math.PI / 4)
  return [add(at, d, -size / 2), add(at, d, size / 2)]
}

export function dimGeometry(
  kind: DimensionKind,
  pts: Vec2[],
  offset: number,
  axis: 'x' | 'y' | 'auto' | undefined,
  override: string | undefined,
  fmtLength: (m: number) => string,
  textSize: number,
): DimGeom | null {
  const label = (v: string) => (override ? override.replace('<>', v) : v)
  const gap = textSize * 0.4,
    over = textSize * 0.5
  if (kind === 'linear' || kind === 'aligned' || kind === 'arc-length') {
    const [p1, p2] = pts as [Vec2, Vec2]
    if (!p1 || !p2) return null
    let dir: Vec2, d1: Vec2, d2: Vec2, measured: number
    const dx = p2[0] - p1[0],
      dy = p2[1] - p1[1]
    const ax = kind === 'linear' ? (axis === 'auto' || !axis ? (Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y') : axis) : null
    if (ax === 'x') {
      const s = dx >= 0 ? 1 : -1
      dir = [s, 0]
      const y = p1[1] + s * offset
      d1 = [p1[0], y]
      d2 = [p2[0], y]
      measured = Math.abs(dx)
    } else if (ax === 'y') {
      const s = dy >= 0 ? 1 : -1
      dir = [0, s]
      const x = p1[0] - s * offset
      d1 = [x, p1[1]]
      d2 = [x, p2[1]]
      measured = Math.abs(dy)
    } else {
      measured = Math.hypot(dx, dy)
      if (measured < 1e-12) return null
      dir = [dx / measured, dy / measured]
      const n: Vec2 = [-dir[1], dir[0]]
      d1 = add(p1, n, offset)
      d2 = add(p2, n, offset)
    }
    const lines: [Vec2, Vec2][] = []
    for (const [p, d] of [
      [p1, d1],
      [p2, d2],
    ] as [Vec2, Vec2][]) {
      const v = sub(d, p)
      if (len(v) > gap) {
        const u = norm(v)
        lines.push([add(p, u, gap), add(d, u, over)])
      }
    }
    lines.push([add(d1, dir, -over), add(d2, dir, over)])
    const angle = Math.atan2(dir[1], dir[0])
    const ta = readable(angle)
    const up: Vec2 = [-Math.sin(ta), Math.cos(ta)]
    const mid: Vec2 = [(d1[0] + d2[0]) / 2, (d1[1] + d2[1]) / 2]
    return {
      kind,
      measured,
      text: label(fmtLength(measured)),
      p1,
      p2,
      d1,
      d2,
      angle,
      lines,
      ticks: [tick(d1, dir, textSize), tick(d2, dir, textSize)],
      textPos: add(mid, up, textSize * 0.3),
      textAngle: ta,
      textSize,
    }
  }
  if (kind === 'radius' || kind === 'diameter') {
    const [c, q] = pts as [Vec2, Vec2]
    if (!c || !q) return null
    const r = len(sub(q, c))
    if (r < 1e-12) return null
    const dir = norm(sub(q, c))
    const a: Vec2 = kind === 'diameter' ? add(c, dir, -r) : c
    const angle = Math.atan2(dir[1], dir[0])
    const ta = readable(angle)
    const up: Vec2 = [-Math.sin(ta), Math.cos(ta)]
    const mid: Vec2 = [(a[0] + q[0]) / 2, (a[1] + q[1]) / 2]
    const ticks = kind === 'diameter' ? [tick(a, dir, textSize), tick(q, dir, textSize)] : [tick(q, dir, textSize)]
    return {
      kind,
      measured: kind === 'diameter' ? 2 * r : r,
      text: label(`${kind === 'diameter' ? 'Ø' : 'R'} ${fmtLength(kind === 'diameter' ? 2 * r : r)}`),
      p1: a,
      p2: q,
      center: c,
      d1: a,
      d2: q,
      angle,
      lines: [[a, q]],
      ticks,
      textPos: add(mid, up, textSize * 0.3),
      textAngle: ta,
      textSize,
    }
  }
  if (kind === 'angular') {
    const [v, a, b] = pts as [Vec2, Vec2, Vec2]
    if (!v || !a || !b) return null
    const la = len(sub(a, v)),
      lb = len(sub(b, v))
    if (la < 1e-12 || lb < 1e-12) return null
    const start = Math.atan2(a[1] - v[1], a[0] - v[0])
    let sweep = Math.atan2(b[1] - v[1], b[0] - v[0]) - start
    while (sweep <= 0) sweep += Math.PI * 2
    while (sweep > Math.PI * 2) sweep -= Math.PI * 2
    const r = Math.abs(offset) > 1e-9 ? Math.abs(offset) : 0.6 * Math.min(la, lb)
    const d1: Vec2 = [v[0] + r * Math.cos(start), v[1] + r * Math.sin(start)]
    const d2: Vec2 = [v[0] + r * Math.cos(start + sweep), v[1] + r * Math.sin(start + sweep)]
    const lines: [Vec2, Vec2][] = []
    if (r > la + gap) lines.push([a, add(d1, norm(sub(a, v)), over)])
    if (r > lb + gap) lines.push([b, add(d2, norm(sub(b, v)), over)])
    const midA = start + sweep / 2
    const deg = (sweep * 180) / Math.PI
    return {
      kind,
      measured: sweep,
      text: label(`${Number(deg.toFixed(1))}°`),
      p1: a,
      p2: b,
      center: v,
      d1,
      d2,
      angle: midA + Math.PI / 2,
      arc: { c: v, r, start, sweep },
      lines,
      ticks: [tick(d1, [-Math.sin(start), Math.cos(start)], textSize), tick(d2, [-Math.sin(start + sweep), Math.cos(start + sweep)], textSize)],
      textPos: [v[0] + (r + textSize * 0.6) * Math.cos(midA), v[1] + (r + textSize * 0.6) * Math.sin(midA)],
      textAngle: readable(midA - Math.PI / 2),
      textSize,
    }
  }
  return null
}
