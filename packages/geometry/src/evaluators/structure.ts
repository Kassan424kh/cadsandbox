// Structural elements: slab, column, beam, railing.
import type { NodeBase, Vec2, Vec3 } from '@cadsandbox/doc'
import type { GeometryResult, SnapPoint } from '../api'
import { DrawingBuilder } from '../core/drawing'
import { extrudePolygons } from '../core/extrude'
import { hatchSegments } from '../core/hatch'
import { TAU, cleanPolygon, dist2, mid2, normalize2, perp2, polygonArea, polygonCentroid, polygonPerimeter, sub2 } from '../core/math2d'
import { MeshBuilder, cross3, normalize3, sub3 } from '../core/mesh'
import { nestRings, polygonsArea, type PolyWithHoles, type Ring } from '../core/polygon'
import { PartSet, addBox, addCylinderBetween, addCylinderZ, addPrismAlong } from '../core/solids'
import type { EvalContext } from './context'
import { drawingBounds, errorResult, finish, snap } from './result'
import { nodeHatch } from './util'

// ------------------------------------------------------------------ slab
export function evaluateSlab(node: NodeBase<'slab'>, ctx: EvalContext): GeometryResult {
  const p = node.params
  const outline = cleanPolygon(p.outline ?? [])
  if (outline.length < 3) return errorResult('Slab outline needs at least 3 points')
  const polys = nestRings([outline, ...(p.holes ?? []).filter((h) => h.length >= 3)])
  const top = p.offset
  const bottom = top - Math.max(0.01, p.thickness)
  const mesh = extrudePolygons(polys, { z0: bottom, z1: top })
  const d = new DrawingBuilder()
  const style = top > ctx.level.cutHeight ? 'overhead' : 'thin'
  for (const poly of polys) {
    d.polyline(style, poly.outer, true)
    for (const h of poly.holes) d.polyline(style, h, true)
  }
  const snaps: SnapPoint[] = []
  for (const poly of polys) {
    for (let i = 0; i < poly.outer.length; i++) {
      const m = mid2(poly.outer[i]!, poly.outer[(i + 1) % poly.outer.length]!)
      snaps.push(snap('midpoint', m[0], m[1], top))
    }
    const c = polygonCentroid(poly.outer)
    snaps.push(snap('center', c[0], c[1], top))
  }
  const area = polygonsArea(polys)
  return finish([{ mesh, material: 'node', castShadow: true, receiveShadow: true }], {
    edges: 'auto',
    plan: d.build(),
    snaps,
    quantities: { area, perimeter: polygonPerimeter(outline), volume: area * (top - bottom), thickness: top - bottom },
  })
}

// ------------------------------------------------------------------ column
function hBeamRing(w: number, d: number): Ring {
  const tf = Math.max(0.006, d * 0.1), tw = Math.max(0.006, w * 0.1)
  const hw = w / 2, hd = d / 2
  return [
    [-hw, -hd], [hw, -hd], [hw, -hd + tf], [tw / 2, -hd + tf], [tw / 2, hd - tf], [hw, hd - tf], [hw, hd], [-hw, hd],
    [-hw, hd - tf], [-tw / 2, hd - tf], [-tw / 2, -hd + tf], [-hw, -hd + tf],
  ]
}

export function evaluateColumn(node: NodeBase<'column'>, ctx: EvalContext): GeometryResult {
  const p = node.params
  const h = p.height > 0 ? p.height : ctx.level.height
  const z0 = p.baseOffset, z1 = z0 + h
  const w = Math.max(0.02, p.width), dd = Math.max(0.02, p.depth)
  let ring: Ring
  if (p.shape === 'round') {
    const n = Math.max(24, Math.min(64, Math.ceil(w * 64)))
    ring = Array.from({ length: n }, (_, i) => [Math.cos((TAU * i) / n) * (w / 2), Math.sin((TAU * i) / n) * (dd / 2)] as Vec2)
  } else if (p.shape === 'h-beam') ring = hBeamRing(w, dd)
  else ring = [[-w / 2, -dd / 2], [w / 2, -dd / 2], [w / 2, dd / 2], [-w / 2, dd / 2]]
  const mesh = extrudePolygons([{ outer: ring, holes: [] }], { z0, z1 })
  const d = new DrawingBuilder()
  const cut = ctx.level.cutHeight
  if (z0 < cut && z1 > cut) {
    const polys: PolyWithHoles[] = [{ outer: ring, holes: [] }]
    d.fill(polys, 'solid')
    const hatch = nodeHatch(node, ctx)
    if (hatch && hatch !== 'solid') {
      d.fill(polys, hatch, { scale: 0.5 })
      d.segments('thin', hatchSegments(polys, hatch, 0.5))
    }
    d.polyline('cut', ring, true)
  } else d.polyline(z1 <= cut ? 'visible' : 'overhead', ring, true)
  return finish([{ mesh, material: 'node', castShadow: true, receiveShadow: true }], {
    edges: 'auto',
    plan: d.build(),
    snaps: [snap('insertion', 0, 0, z0), snap('center', 0, 0, z1), snap('midpoint', 0, 0, (z0 + z1) / 2)],
    quantities: { height: h, area: Math.abs(polygonArea(ring)), volume: Math.abs(polygonArea(ring)) * h },
  })
}

// ------------------------------------------------------------------ beam
export function evaluateBeam(node: NodeBase<'beam'>, ctx: EvalContext): GeometryResult {
  const p = node.params
  const a = p.a, b = p.b
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  if (len < 1e-4) return errorResult('Beam is too short')
  const t = normalize3(sub3(b, a))
  // cross-section frame: u horizontal (perpendicular to the axis), v "up"
  let u: Vec3 = normalize3(cross3([0, 0, 1], t))
  if (Math.hypot(...u) < 1e-6 || Math.abs(t[2]) > 0.999) u = [1, 0, 0]
  const v = normalize3(cross3(u, t))
  const vUp: Vec3 = v[2] < 0 ? [-v[0], -v[1], -v[2]] : v
  const w = Math.max(0.02, p.width), h = Math.max(0.02, p.height)
  let ring: Ring
  if (p.shape === 'round') {
    const n = 24
    ring = Array.from({ length: n }, (_, i) => [Math.cos((TAU * i) / n) * (w / 2), Math.sin((TAU * i) / n) * (h / 2)] as Vec2)
  } else if (p.shape === 'i-beam') ring = hBeamRing(w, h)
  else ring = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]
  // ring (x = u, y = vUp): the beam's top is at +h/2 → shift so a/b describe the centerline
  const mb = new MeshBuilder(64)
  addPrismAlong(mb, ring, a, b, u, vUp)
  const mesh = mb.build()
  const d = new DrawingBuilder()
  const style = Math.min(a[2], b[2]) - h / 2 >= ctx.level.cutHeight ? 'overhead' : 'visible'
  const n2 = normalize2(perp2(sub2([b[0], b[1]], [a[0], a[1]])))
  if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-6) {
    const corners: Vec2[] = [
      [a[0] + n2[0] * (w / 2), a[1] + n2[1] * (w / 2)],
      [b[0] + n2[0] * (w / 2), b[1] + n2[1] * (w / 2)],
      [b[0] - n2[0] * (w / 2), b[1] - n2[1] * (w / 2)],
      [a[0] - n2[0] * (w / 2), a[1] - n2[1] * (w / 2)],
    ]
    d.polyline(style, corners, true)
  }
  const m: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
  return finish([{ mesh, material: 'node', castShadow: true, receiveShadow: true }], {
    edges: 'auto',
    plan: d.build(),
    snaps: [snap('endpoint', ...a), snap('endpoint', ...b), snap('midpoint', ...m)],
    quantities: { length: len, area: Math.abs(polygonArea(ring)), volume: Math.abs(polygonArea(ring)) * len },
  })
}

// ------------------------------------------------------------------ railing
export function evaluateRailing(node: NodeBase<'railing'>, ctx: EvalContext): GeometryResult {
  const p = node.params
  const path = cleanPolygon(p.path ?? [], 1e-6)
  if (path.length < 2) return errorResult('Railing path needs at least 2 points')
  const z0 = p.baseOffset
  const h = Math.max(0.3, p.height)
  const parts = new PartSet()
  const rail = parts.get(null)
  const glass = parts.get('mat-glass', { castShadow: false })
  const postR = 0.02
  const spacing = Math.max(0.3, p.postSpacing)
  const d = new DrawingBuilder()
  d.polyline('thin', path, false)
  const snaps: SnapPoint[] = []
  let total = 0
  // posts at every vertex and at even spacing along each segment
  const posts: Vec2[] = []
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!, b = path[i + 1]!
    const L = dist2(a, b)
    total += L
    const n = Math.max(1, Math.round(L / spacing))
    for (let k = 0; k < n; k++) posts.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n])
  }
  posts.push(path[path.length - 1]!)
  for (const q of posts) {
    if (p.style !== 'solid') addCylinderZ(rail, q[0], q[1], postR, z0, z0 + h - 0.02, 12)
    d.rect('thin', q[0] - 0.03, q[1] - 0.03, q[0] + 0.03, q[1] + 0.03)
    snaps.push(snap('endpoint', q[0], q[1], z0), snap('endpoint', q[0], q[1], z0 + h))
  }
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!, b = path[i + 1]!
    const L = dist2(a, b)
    if (L < 1e-6) continue
    const dir = normalize2(sub2(b, a))
    const nrm = perp2(dir)
    // handrail
    if (p.style === 'solid') {
      const ring: Ring = [[-0.03, -0.02], [0.03, -0.02], [0.03, 0.02], [-0.03, 0.02]]
      addPrismAlong(rail, ring, [a[0], a[1], z0 + h], [b[0], b[1], z0 + h], [nrm[0], nrm[1], 0], [0, 0, 1])
      // solid panel
      const panel: Ring = [[-0.025, 0], [0.025, 0], [0.025, h - 0.02], [-0.025, h - 0.02]]
      addPrismAlong(rail, panel, [a[0], a[1], z0], [b[0], b[1], z0], [nrm[0], nrm[1], 0], [0, 0, 1])
      continue
    }
    addCylinderBetween(rail, [a[0], a[1], z0 + h], [b[0], b[1], z0 + h], 0.022, 12)
    switch (p.style) {
      case 'bars': {
        const n = Math.max(1, Math.round(L / 0.11))
        for (let k = 1; k < n; k++) {
          const x = a[0] + dir[0] * (L * k) / n, y = a[1] + dir[1] * (L * k) / n
          addCylinderZ(rail, x, y, 0.006, z0 + 0.02, z0 + h - 0.022, 6)
        }
        addCylinderBetween(rail, [a[0], a[1], z0 + 0.02], [b[0], b[1], z0 + 0.02], 0.01, 8)
        break
      }
      case 'cable': {
        for (let k = 1; k <= 5; k++) {
          const z = z0 + 0.1 + ((h - 0.2) * (k - 1)) / 4
          addCylinderBetween(rail, [a[0], a[1], z], [b[0], b[1], z], 0.003, 6)
        }
        break
      }
      case 'glass': {
        // panels between consecutive posts on this segment
        const n = Math.max(1, Math.round(L / spacing))
        for (let k = 0; k < n; k++) {
          const s0 = (L * k) / n + postR + 0.01, s1 = (L * (k + 1)) / n - postR - 0.01
          if (s1 <= s0) continue
          const pa: Vec3 = [a[0] + dir[0] * s0, a[1] + dir[1] * s0, z0 + 0.08]
          const pb: Vec3 = [a[0] + dir[0] * s1, a[1] + dir[1] * s1, z0 + 0.08]
          const ring: Ring = [[-0.006, 0], [0.006, 0], [0.006, h - 0.13], [-0.006, h - 0.13]]
          addPrismAlong(glass, ring, pa, pb, [nrm[0], nrm[1], 0], [0, 0, 1])
        }
        break
      }
    }
  }
  const plan = d.build()
  const meshParts = parts.build()
  return finish(meshParts, { edges: 'none', plan, snaps, quantities: { length: total, height: h, posts: posts.length }, extraBounds: drawingBounds(plan, z0) })
}

export { addBox }
