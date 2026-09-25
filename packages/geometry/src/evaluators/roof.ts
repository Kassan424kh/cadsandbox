// Roofs: flat / shed / gable / hip / mansard / gambrel / pyramid on arbitrary simple outlines.
// Sloped roofs use the (weighted) straight skeleton; the solid is the surface extruded down by
// `thickness` (vertical), giving vertical fascias. Plan: ridges/hips + outline as 'overhead'.
import type { NodeBase, RoofParams, Vec2, Vec3 } from '@cadsandbox/doc'
import type { GeometryResult, SnapPoint } from '../api'
import { DrawingBuilder } from '../core/drawing'
import { extrudePolygons } from '../core/extrude'
import { cleanPolygon, dist2, ensureCCW, polygonArea, polygonPerimeter } from '../core/math2d'
import { MeshBuilder, mergeMeshes } from '../core/mesh'
import { distanceToBoundary, labelPoint, nestRings, offsetPolygons, type Ring } from '../core/polygon'
import { straightSkeleton, type SkeletonArc, type SkeletonFace } from '../core/skeleton'
import { errorResult, finish, snap } from './result'

interface RoofSurface {
  /** planar faces (CCW in plan) with z per vertex */
  faces: { points: Vec2[]; z: number[] }[]
  /** ridge / hip lines for the plan (both ends above the eave) */
  lines: { a: Vec2; b: Vec2 }[]
  /** eave outline (after overhang) */
  outline: Ring
  ridgeHeight: number
}

/** Edge weights for gable-like roofs: edges perpendicular to the ridge axis stay vertical (weight 0). */
function gableWeights(poly: Ring, axis: 'x' | 'y'): number[] {
  return poly.map((p, i) => {
    const q = poly[(i + 1) % poly.length]!
    const dx = Math.abs(q[0] - p[0]), dy = Math.abs(q[1] - p[1])
    // an edge running along the ridge axis slopes; one running across it is a gable end
    const alongAxis = axis === 'x' ? dx >= dy : dy > dx
    return alongAxis ? 1 : 0
  })
}

function autoAxis(poly: Ring): 'x' | 'y' {
  let lx = 0, ly = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!
    lx += Math.abs(q[0] - p[0])
    ly += Math.abs(q[1] - p[1])
  }
  return lx >= ly ? 'x' : 'y'
}

function skeletonSurface(poly: Ring, weights: number[] | undefined, slope: number, zEave: number): RoofSurface {
  const sk = straightSkeleton(poly, weights)
  const faces = sk.faces.map((f: SkeletonFace) => ({ points: f.points, z: f.times.map((t) => zEave + t * slope) }))
  const lines = sk.arcs.filter((a: SkeletonArc) => a.ta > 1e-6 && a.tb > 1e-6 && dist2(a.a, a.b) > 1e-6).map((a) => ({ a: a.a, b: a.b }))
  return { faces, lines, outline: poly, ridgeHeight: zEave + sk.maxTime * slope }
}

/** Two-pitch roofs: steep lower part up to `breakHeight`, then the shallower upper roof. */
function twoPitchSurface(poly: Ring, weights: number[] | undefined, lowerSlope: number, upperSlope: number, breakHeight: number, zEave: number): RoofSurface {
  const lower = skeletonSurface(poly, weights, lowerSlope, zEave)
  const zBreak = zEave + breakHeight
  const faces: RoofSurface['faces'] = []
  const lines: RoofSurface['lines'] = []
  const breakEdges: [Vec2, Vec2][] = []
  for (const f of lower.faces) {
    // clip the planar face against z <= zBreak (Sutherland–Hodgman on a planar polygon)
    const out: Vec2[] = [], outZ: number[] = []
    const n = f.points.length
    for (let i = 0; i < n; i++) {
      const p = f.points[i]!, zp = f.z[i]!
      const q = f.points[(i + 1) % n]!, zq = f.z[(i + 1) % n]!
      const pin = zp <= zBreak + 1e-9, qin = zq <= zBreak + 1e-9
      if (pin) {
        out.push(p)
        outZ.push(zp)
      }
      if (pin !== qin) {
        const t = (zBreak - zp) / (zq - zp)
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t])
        outZ.push(zBreak)
      }
    }
    if (out.length >= 3) faces.push({ points: out, z: outZ })
    // edges at the break height form the upper polygon
    for (let i = 0; i < out.length; i++) {
      const j = (i + 1) % out.length
      if (Math.abs(outZ[i]! - zBreak) < 1e-9 && Math.abs(outZ[j]! - zBreak) < 1e-9) breakEdges.push([out[i]!, out[j]!])
    }
  }
  lines.push(...lower.lines)
  // static (gable) edges have no face: connect break points lying on them so the loop closes
  if (weights) {
    const n = poly.length
    for (let i = 0; i < n; i++) {
      if ((weights[i] ?? 1) > 0) continue
      const a = poly[i]!, b = poly[(i + 1) % n]!
      const dx = b[0] - a[0], dy = b[1] - a[1]
      const l2 = dx * dx + dy * dy
      if (l2 < 1e-18) continue
      const onEdge: { t: number; p: Vec2 }[] = []
      for (const e of breakEdges) {
        for (const p of e) {
          const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2
          if (t < -1e-6 || t > 1 + 1e-6) continue
          if (Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]) > 1e-6) continue
          if (!onEdge.some((q) => Math.abs(q.t - t) < 1e-9)) onEdge.push({ t, p })
        }
      }
      onEdge.sort((p, q) => p.t - q.t)
      for (let k = 0; k + 1 < onEdge.length; k += 2) breakEdges.push([onEdge[k]!.p, onEdge[k + 1]!.p])
    }
  }
  // chain break edges into loops → upper outline(s)
  const upper = chainLoops(breakEdges)
  let ridge = zBreak
  for (const loop of upper) {
    if (loop.length < 3) continue
    // keep every break point (no collinear cleanup) so upper faces share exact edges with the lower ones
    const ring = ensureCCW(dedupe(loop))
    if (ring.length < 3) continue
    const w = weights ? gableWeights(ring, autoAxis(ring)) : undefined
    const up = skeletonSurface(ring, w, upperSlope, zBreak)
    faces.push(...up.faces)
    lines.push(...up.lines)
    for (let i = 0; i < ring.length; i++) lines.push({ a: ring[i]!, b: ring[(i + 1) % ring.length]! })
    ridge = Math.max(ridge, up.ridgeHeight)
  }
  return { faces, lines, outline: poly, ridgeHeight: ridge }
}

function dedupe(pts: Vec2[]): Vec2[] {
  const out: Vec2[] = []
  for (const p of pts) if (!out.length || dist2(out[out.length - 1]!, p) > 1e-7) out.push(p)
  while (out.length > 1 && dist2(out[0]!, out[out.length - 1]!) < 1e-7) out.pop()
  return out
}

function chainLoops(edges: [Vec2, Vec2][]): Vec2[][] {
  const key = (p: Vec2) => `${Math.round(p[0] * 1e6)},${Math.round(p[1] * 1e6)}`
  const map = new Map<string, [Vec2, Vec2][]>()
  for (const e of edges) {
    for (const k of [key(e[0]), key(e[1])]) {
      let l = map.get(k)
      if (!l) map.set(k, (l = []))
      l.push(e)
    }
  }
  const used = new Set<[Vec2, Vec2]>()
  const loops: Vec2[][] = []
  for (const e of edges) {
    if (used.has(e)) continue
    used.add(e)
    const loop: Vec2[] = [e[0], e[1]]
    let cur = e[1]
    let guard = 0
    while (guard++ < edges.length + 1) {
      const cands = (map.get(key(cur)) ?? []).filter((x) => !used.has(x))
      if (!cands.length) break
      const nx = cands[0]!
      used.add(nx)
      const nextP = key(nx[0]) === key(cur) ? nx[1] : nx[0]
      if (key(nextP) === key(loop[0]!)) break
      loop.push(nextP)
      cur = nextP
    }
    if (loop.length >= 3) loops.push(loop)
  }
  return loops
}

function shedSurface(poly: Ring, axis: 'x' | 'y', slope: number, zEave: number): RoofSurface {
  // rises along +axis from the low eave (min coordinate)
  const idx = axis === 'x' ? 0 : 1
  const min = Math.min(...poly.map((p) => p[idx]))
  const z = poly.map((p) => zEave + (p[idx] - min) * slope)
  return { faces: [{ points: poly, z }], lines: [], outline: poly, ridgeHeight: Math.max(...z) }
}

function pyramidSurface(poly: Ring, slope: number, zEave: number): RoofSurface {
  const region = { outer: poly, holes: [] as Ring[] }
  const c = labelPoint(region)
  const apexZ = zEave + distanceToBoundary(c, [region]) * slope
  const faces = poly.map((p, i) => ({ points: [p, poly[(i + 1) % poly.length]!, c], z: [zEave, zEave, apexZ] }))
  return { faces, lines: poly.map((p) => ({ a: p, b: c })), outline: poly, ridgeHeight: apexZ }
}

/**
 * Solid roof: top faces + vertically offset bottom faces, vertical fascias along boundary edges and
 * vertical step faces where two adjacent faces meet at different heights (gable walls between wings).
 */
function buildRoofSolid(surf: RoofSurface, thickness: number): MeshBuilder {
  const mb = new MeshBuilder(512)
  const t = Math.max(0.01, thickness)
  for (const f of surf.faces) {
    const top: Vec3[] = f.points.map((p, i) => [p[0], p[1], f.z[i]!])
    const bot: Vec3[] = f.points.map((p, i) => [p[0], p[1], f.z[i]! - t])
    mb.face(top, [])
    mb.face(bot.slice().reverse(), [])
  }
  const key = (a: Vec2, b: Vec2) => `${a[0].toFixed(6)},${a[1].toFixed(6)}|${b[0].toFixed(6)},${b[1].toFixed(6)}`
  // directed plan edge → heights of its face at both ends
  const heights = new Map<string, [number, number]>()
  for (const f of surf.faces) {
    const n = f.points.length
    for (let i = 0; i < n; i++) heights.set(key(f.points[i]!, f.points[(i + 1) % n]!), [f.z[i]!, f.z[(i + 1) % n]!])
  }
  for (const f of surf.faces) {
    const n = f.points.length
    for (let i = 0; i < n; i++) {
      const a = f.points[i]!, b = f.points[(i + 1) % n]!
      const za = f.z[i]!, zb = f.z[(i + 1) % n]!
      const twin = heights.get(key(b, a))
      if (!twin) {
        // fascia: outward is to the right of a→b (faces are CCW in plan)
        mb.quadFace([a[0], a[1], za - t], [b[0], b[1], zb - t], [b[0], b[1], zb], [a[0], a[1], za])
        continue
      }
      const [zbB, zaB] = twin // twin runs b→a
      if (za + zb <= zaB + zbB + 1e-9) continue // the other face is higher (or equal): it emits the step
      // exposed step above the lower face (faces the lower side) and below it (faces our side)
      mb.quadFace([a[0], a[1], zaB], [b[0], b[1], zbB], [b[0], b[1], zb], [a[0], a[1], za])
      mb.quadFace([a[0], a[1], za - t], [b[0], b[1], zb - t], [b[0], b[1], zbB - t], [a[0], a[1], zaB - t])
    }
  }
  return mb
}

export function roofSurface(p: RoofParams, outline: Ring): RoofSurface | null {
  const slope = Math.tan(Math.max(1, Math.min(85, p.pitchDeg)) * (Math.PI / 180))
  const zEave = p.baseOffset
  const axis = p.ridgeAxis === 'auto' ? autoAxis(outline) : p.ridgeAxis
  switch (p.kind) {
    case 'flat':
      return { faces: [{ points: outline, z: outline.map(() => zEave) }], lines: [], outline, ridgeHeight: zEave }
    case 'shed':
      return shedSurface(outline, axis, slope, zEave)
    case 'gable':
      return skeletonSurface(outline, gableWeights(outline, axis), slope, zEave)
    case 'hip':
      return skeletonSurface(outline, undefined, slope, zEave)
    case 'pyramid':
      return pyramidSurface(outline, slope, zEave)
    case 'mansard':
    case 'gambrel': {
      const steep = Math.tan((70 * Math.PI) / 180)
      // break where the steep part has climbed about a storey fraction of the footprint depth
      const sk = straightSkeleton(outline, p.kind === 'gambrel' ? gableWeights(outline, axis) : undefined)
      const breakHeight = Math.max(0.3, sk.maxTime * 0.45 * steep)
      return twoPitchSurface(outline, p.kind === 'gambrel' ? gableWeights(outline, axis) : undefined, steep, slope, breakHeight, zEave)
    }
  }
}

export function evaluateRoof(node: NodeBase<'roof'>): GeometryResult {
  const p = node.params
  const base = ensureCCW(cleanPolygon(p.outline ?? []))
  if (base.length < 3) return errorResult('Roof outline needs at least 3 points')
  // overhang: outline inflated (miter) — eave height applies at the wall line, so the eave itself drops
  let outline = base
  let params = p
  if (p.overhang > 1e-6) {
    const inflated = offsetPolygons([base], p.overhang, 'miter', 20)
    const biggest = inflated.reduce((a, b) => (Math.abs(polygonArea(b.outer)) > Math.abs(polygonArea(a.outer)) ? b : a), inflated[0]!)
    if (biggest) {
      outline = ensureCCW(cleanPolygon(biggest.outer, 1e-6))
      const slope = Math.tan(Math.max(1, Math.min(85, p.pitchDeg)) * (Math.PI / 180))
      params = { ...p, baseOffset: p.kind === 'flat' ? p.baseOffset : p.baseOffset - p.overhang * slope }
    }
  }
  const surf = roofSurface(params, outline)
  if (!surf || !surf.faces.length) return errorResult('Roof could not be generated for this outline')
  const mb = buildRoofSolid(surf, p.thickness)
  const mesh = mb.build()
  const d = new DrawingBuilder()
  d.polyline('overhead', outline, true)
  if (p.overhang > 1e-6) d.polyline('overhead', base, true)
  for (const l of surf.lines) d.segP('overhead', l.a, l.b)
  const snaps: SnapPoint[] = outline.map((q) => snap('vertex', q[0], q[1], params.baseOffset))
  for (const l of surf.lines) {
    const m: Vec2 = [(l.a[0] + l.b[0]) / 2, (l.a[1] + l.b[1]) / 2]
    snaps.push(snap('midpoint', m[0], m[1], surf.ridgeHeight))
  }
  let area = 0
  for (const f of surf.faces) {
    // true (sloped) face area
    const pts: Vec3[] = f.points.map((q, i) => [q[0], q[1], f.z[i]!])
    let nx = 0, ny = 0, nz = 0
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!, b = pts[(i + 1) % pts.length]!
      nx += (a[1] - b[1]) * (a[2] + b[2])
      ny += (a[2] - b[2]) * (a[0] + b[0])
      nz += (a[0] - b[0]) * (a[1] + b[1])
    }
    area += Math.hypot(nx, ny, nz) / 2
  }
  const footprint = Math.abs(polygonArea(outline))
  return finish([{ mesh, material: 'node', castShadow: true, receiveShadow: true }], {
    edges: 'auto',
    plan: d.build(),
    snaps,
    quantities: { area, footprint, perimeter: polygonPerimeter(outline), ridgeHeight: surf.ridgeHeight, volume: area * Math.max(0.01, p.thickness) },
  })
}

export { mergeMeshes, extrudePolygons, nestRings }
