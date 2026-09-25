// Annotations in vectorized sections/elevations: grid axis bubbles above the drawing where a grid
// line (vertical plane) crosses the view plane, and height markers ('levelmark' nodes with the
// section variant) as elevation flags at their world height. Called by vectorizeSectionFrame.
import type { Vec2, Vec3 } from '@cadsandbox/doc'
import { transformPoint } from '@cadsandbox/doc'
import { ANNO, defaultContext, levelmarkText, sectionLevelmarkDrawing } from '@cadsandbox/geometry'
import type { DrawingBuilder, VectorizeDeps } from './common'
import type { ViewFrame } from './mesh'

const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]

/** View-plane coordinates of a world point: [u, v, depth]. */
function toFrame(frame: ViewFrame, p: Vec3): [number, number, number] {
  const d = sub3(p, frame.origin)
  return [dot3(d, frame.u), dot3(d, frame.v), dot3(d, frame.dir)]
}

/** Adds grid bubbles + section height markers to `b` (no-op when the view has no content yet). */
export function addSectionAnnotations(b: DrawingBuilder, deps: VectorizeDeps, frame: ViewFrame, uRange?: [number, number], maxDepth = Infinity): void {
  if (b.isEmpty() || Math.abs(frame.v[2]) < 0.99) return // only views with a vertical up axis
  const { doc } = deps
  const bounds = b.build().bounds
  const inRange = (u: number) => !uRange || (u >= uRange[0] && u <= uRange[1])

  // --- grid axes: vertical planes through a→b; they cross the view plane along a vertical line at u
  const trace: Vec2 = [frame.u[0], frame.u[1]]
  const traceLen = Math.hypot(trace[0], trace[1])
  if (traceLen > 1e-6) {
    const o: Vec2 = [frame.origin[0], frame.origin[1]]
    const top = bounds.max[1] + 0.5
    for (const g of doc.nodesOfType('gridline')) {
      if (!doc.isEffectivelyVisible(g.id)) continue
      const m = doc.getWorldMatrix(g.id)
      const A = transformPoint(m, [g.params.a[0], g.params.a[1], 0])
      const B = transformPoint(m, [g.params.b[0], g.params.b[1], 0])
      const ab: Vec2 = [B[0] - A[0], B[1] - A[1]]
      const denom = ab[0] * trace[1] - ab[1] * trace[0]
      if (Math.abs(denom) < 1e-9) continue // parallel to the view plane
      const ao: Vec2 = [o[0] - A[0], o[1] - A[1]]
      const s = (ao[0] * trace[1] - ao[1] * trace[0]) / denom // along a→b
      if (s < -0.05 || s > 1.05) continue
      const P: Vec2 = [A[0] + ab[0] * s, A[1] + ab[1] * s]
      const u = ((P[0] - o[0]) * trace[0] + (P[1] - o[1]) * trace[1]) / traceLen
      if (!inRange(u)) continue
      const r = g.params.radius ?? 0.35
      const size = Math.min(ANNO.textSize, r * 1.1) * (g.params.label.length > 2 ? 2 / g.params.label.length : 1)
      b.segment('hidden', [u, bounds.min[1]], [u, top])
      b.segment('annotation', [u, top], [u, top + 0.4])
      const c: Vec2 = [u, top + 0.4 + r]
      const n = 32
      for (let i = 0; i < n; i++) {
        const t0 = (i / n) * Math.PI * 2, t1 = ((i + 1) / n) * Math.PI * 2
        b.segment('annotation', [c[0] + Math.cos(t0) * r, c[1] + Math.sin(t0) * r], [c[0] + Math.cos(t1) * r, c[1] + Math.sin(t1) * r])
      }
      b.text({ text: g.params.label, position: c, size, rotation: 0, align: 'center', baseline: 'middle', style: 'annotation' })
    }
  }

  // --- height markers (section variant) at their world elevation
  for (const lm of doc.nodesOfType('levelmark')) {
    if (lm.params.variant !== 'section' || !doc.isEffectivelyVisible(lm.id)) continue
    const W = transformPoint(doc.getWorldMatrix(lm.id), [0, 0, 0])
    const [u, v, depth] = toFrame(frame, W)
    if (depth < -0.01 || depth > maxDepth || !inRange(u)) continue
    const text = levelmarkText(lm, defaultContext({ units: doc.meta.units, elevation: W[2] }))
    const size = typeof lm.meta.textSize === 'number' ? (lm.meta.textSize as number) : ANNO.textSize
    b.addDrawing(sectionLevelmarkDrawing(text, size, !!lm.params.flip), (p) => [u + p[0], v + p[1]])
  }
}
