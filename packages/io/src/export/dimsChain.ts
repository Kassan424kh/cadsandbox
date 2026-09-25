// Chain dimensions (Maßketten) for DXF/SVG/PDF vector export: one DimGeom per interval, all on the
// same dimension line. Stations are projected onto the chain direction (forced axis or first → last).
import type { DimensionParams, Vec2 } from '@cadsandbox/doc'
import { dimGeometry, type DimGeom } from './dims'

export function chainDimGeometry(points: Vec2[], offset: number, axis: DimensionParams['axis'], fmtLength: (m: number) => string, textSize: number): DimGeom[] {
  const first = points[0]
  if (!first || points.length < 2) return []
  let dir: Vec2
  if (axis === 'x') dir = [1, 0]
  else if (axis === 'y') dir = [0, 1]
  else {
    const last = points[points.length - 1]!
    const d: Vec2 = [last[0] - first[0], last[1] - first[1]]
    const l = Math.hypot(d[0], d[1])
    dir = l < 1e-9 ? [1, 0] : [d[0] / l, d[1] / l]
  }
  const ts = points.map((p) => (p[0] - first[0]) * dir[0] + (p[1] - first[1]) * dir[1]).sort((a, b) => a - b)
  const stations: number[] = []
  for (const t of ts) if (!stations.length || t - stations[stations.length - 1]! > 1e-6) stations.push(t)
  const out: DimGeom[] = []
  const kind = axis === 'x' || axis === 'y' ? 'linear' : 'aligned'
  for (let i = 0; i + 1 < stations.length; i++) {
    const a: Vec2 = [first[0] + dir[0] * stations[i]!, first[1] + dir[1] * stations[i]!]
    const b: Vec2 = [first[0] + dir[0] * stations[i + 1]!, first[1] + dir[1] * stations[i + 1]!]
    const g = dimGeometry(kind, [a, b], offset, kind === 'linear' ? axis : undefined, undefined, fmtLength, textSize)
    if (g) out.push(g)
  }
  return out
}
