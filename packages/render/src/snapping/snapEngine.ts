// SnapEngine — ctx.snap(): grid, object snaps (endpoint/midpoint/center/quadrant/vertex from
// GeometryResult.snaps + hit triangle vertices), nearest-on-edge, 2D intersections, perpendicular /
// parallel / extension / axis inference from a reference point, polar angle steps and ortho lock.
// Object snap points live in per-level spatial hashes refreshed lazily from NodeView versions.
import * as THREE from 'three'
import type { CadDocument, Vec3 } from '@cadsandbox/doc'
import type { SnapKind } from '@cadsandbox/geometry'
import type { SnapSettings } from '../api'
import type { SnapQuery, SnapResult, SnapResultKind, ToolPointerEvent, WorkPlane } from '../tools/types'
import type { Viewport } from '../renderer/viewport'
import type { SceneSync, NodeView } from '../scene/sceneSync'
import type { Picker, PickHit } from '../core/picker'
import { SpatialHash, type HashedPoint } from './spatialHash'
import {
  axisOf,
  closestPointOnLine,
  closestPointOnSegment,
  intersectSegments2D,
  orthoSnap,
  perpendicularFoot,
  planePoint,
  planeUV,
  polarSnap,
  rayPlane,
  snapToGrid,
} from './snapMath'
import { vecAdd, vecDist, vecDot, vecLen, vecNorm, vecScale, vecSub } from '../util/math'

const PRIORITY: Record<SnapResultKind, number> = {
  endpoint: 0,
  midpoint: 1,
  center: 2,
  intersection: 3,
  quadrant: 4,
  insertion: 4,
  vertex: 5,
  perpendicular: 6,
  extension: 7,
  nearest: 8,
  parallel: 9,
  axis: 10,
  face: 11,
  grid: 12,
  free: 13,
}

const MAX_INDEX_POINTS = 4000
const MAX_EDGE_SEGMENTS = 60_000

interface Candidate {
  point: Vec3
  kind: SnapResultKind
  nodeId: string | null
  screenDist: number
  guide: SnapResult['guide']
  normal: Vec3 | null
}

interface SnapEnv {
  doc: CadDocument
  sync: SceneSync
  picker: Picker
  settings: () => SnapSettings
  gridStep: (vp: Viewport, plane: WorkPlane) => number
  workPlane: (vp: Viewport) => WorkPlane
  hidden: () => ReadonlySet<string>
  viewportAt: (index: number) => Viewport
}

export class SnapEngine {
  private env: SnapEnv
  private hashes = new Map<string, SpatialHash>()
  private indexed = new Map<string, number>()
  private lastContentVersion = -1
  private queryBuf: HashedPoint[] = []
  lastResult: SnapResult | null = null

  constructor(env: SnapEnv) {
    this.env = env
  }

  // ------------------------------------------------------------------ index
  private hashFor(levelId: string | null): SpatialHash {
    const key = levelId ?? '__root__'
    let h = this.hashes.get(key)
    if (!h) this.hashes.set(key, (h = new SpatialHash(0.5)))
    return h
  }

  /** Refresh the point index for views whose version changed. */
  private refreshIndex(): void {
    const sync = this.env.sync
    if (sync.contentVersion === this.lastContentVersion && this.indexed.size === sync.views.size) return
    this.lastContentVersion = sync.contentVersion
    for (const id of this.indexed.keys()) if (!sync.views.has(id)) {
      for (const h of this.hashes.values()) h.remove(id)
      this.indexed.delete(id)
    }
    for (const view of sync.views.values()) {
      if (this.indexed.get(view.id) === view.version) continue
      this.indexed.set(view.id, view.version)
      for (const h of this.hashes.values()) h.remove(view.id)
      if (!view.group.visible || !view.content.visible || !view.result) continue
      const pts = this.collectPoints(view)
      if (pts.length) this.hashFor(view.levelId).set(view.id, pts)
    }
  }

  private collectPoints(view: NodeView): HashedPoint[] {
    const out: HashedPoint[] = []
    this.env.sync.flushMatrices() // pending moves of the view or its ancestors
    const m = view.group.matrixWorld
    const push = (x: number, y: number, z: number, kind: SnapKind) => {
      _v.set(x, y, z).applyMatrix4(m)
      out.push({ p: [_v.x, _v.y, _v.z], kind, nodeId: view.id })
    }
    const r = view.result!
    if (r.snaps && r.snaps.length) {
      for (const s of r.snaps) {
        if (out.length >= MAX_INDEX_POINTS) break
        push(s.p[0], s.p[1], s.p[2], s.kind)
      }
    } else if (r.edges && r.edges.length) {
      // derive endpoints + midpoints of feature edges (deduplicated)
      const seen = new Set<string>()
      const e = r.edges
      for (let i = 0; i + 5 < e.length && out.length < MAX_INDEX_POINTS; i += 6) {
        const ax = e[i]!, ay = e[i + 1]!, az = e[i + 2]!, bx = e[i + 3]!, by = e[i + 4]!, bz = e[i + 5]!
        for (const [x, y, z] of [[ax, ay, az], [bx, by, bz]] as const) {
          const k = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`
          if (!seen.has(k)) {
            seen.add(k)
            push(x, y, z, 'endpoint')
          }
        }
        push((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, 'midpoint')
      }
    } else if (!view.localBounds.isEmpty() && view.parts.length) {
      const b = view.localBounds
      for (let i = 0; i < 8; i++) push(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z, 'vertex')
      const c = b.getCenter(_c)
      push(c.x, c.y, c.z, 'center')
    }
    return out
  }

  // ------------------------------------------------------------------ snap
  snap(e: ToolPointerEvent, query: SnapQuery = {}): SnapResult {
    const vp = this.env.viewportAt(e.viewport)
    const settings: SnapSettings = { ...this.env.settings(), ...(query.settings ?? {}) }
    const plane = query.plane ?? this.env.workPlane(vp)
    const exclude = new Set<string>(query.exclude ?? [])
    for (const h of this.env.hidden()) exclude.add(h)
    const origin: Vec3 = [e.ray.origin[0], e.ray.origin[1], e.ray.origin[2]]
    const dir: Vec3 = [e.ray.direction[0], e.ray.direction[1], e.ray.direction[2]]

    // raw point: surface hit or plane intersection
    let raw: Vec3 | null = null
    let normal: Vec3 | null = null
    let hit: PickHit | null = null
    let rawKind: SnapResultKind = 'free'
    if (query.surfaces) {
      _ndc.set(e.ndc[0], e.ndc[1])
      hit = this.env.picker.pick(vp, _ndc, { exclude, skipLocked: false })
      if (hit && !hit.flat) {
        raw = [hit.point.x, hit.point.y, hit.point.z]
        normal = hit.normal ? [hit.normal.x, hit.normal.y, hit.normal.z] : null
        rawKind = 'face'
      } else if (hit) {
        raw = [hit.point.x, hit.point.y, hit.point.z]
        normal = hit.normal ? [hit.normal.x, hit.normal.y, hit.normal.z] : null
        rawKind = 'face'
      }
    }
    if (!raw) {
      raw = rayPlane(origin, dir, plane) ?? rayPlane(origin, dir, plane, true) ?? planePoint(plane, [0, 0])
      normal = plane.normal
    }
    const result: SnapResult = { point: raw, kind: rawKind, nodeId: hit?.nodeId ?? null, normal, guide: null, raw }
    if (!settings.enabled) {
      this.lastResult = result
      return result
    }

    const radiusPx = Math.max(2, settings.radiusPx)
    const wpp = vp.worldPerPixel(_v.set(raw[0], raw[1], raw[2]))
    const radiusWorld = radiusPx * wpp
    const candidates: Candidate[] = []
    const screenDist = (p: Vec3): number => {
      if (!vp.project(_v.set(p[0], p[1], p[2]), _s)) return Infinity
      const rect = vp.rect
      const cx = ((e.ndc[0] + 1) / 2) * rect.w
      const cy = ((1 - e.ndc[1]) / 2) * rect.h
      return Math.hypot(_s.x - cx, _s.y - cy)
    }
    const add = (point: Vec3, kind: SnapResultKind, nodeId: string | null, guide: SnapResult['guide'] = null, n: Vec3 | null = null) => {
      const d = screenDist(point)
      if (d <= radiusPx) candidates.push({ point, kind, nodeId, screenDist: d, guide, normal: n })
    }

    // object snaps from the index
    if (settings.endpoint || settings.midpoint || settings.center) {
      this.refreshIndex()
      const levelIds = [null, ...this.env.doc.levels().map((l) => l.id)]
      for (const lid of levelIds) {
        const h = this.hashes.get(lid ?? '__root__')
        if (!h) continue
        // search radius grows with perspective distance; cap to keep cells bounded
        const pts = h.query(raw, Math.min(radiusWorld * 2, 5), exclude, this.queryBuf)
        for (const p of pts) {
          const kind = p.kind
          if (kind === 'endpoint' && !settings.endpoint) continue
          if (kind === 'midpoint' && !settings.midpoint) continue
          if ((kind === 'center' || kind === 'quadrant') && !settings.center) continue
          if (kind === 'vertex' && !settings.endpoint) continue
          add(p.p, kind, p.nodeId)
        }
      }
    }
    // vertices of the hit triangle (mesh vertices near cursor)
    if (hit && !hit.flat && settings.endpoint && hit.faceIndex !== null) {
      const mesh = hit.object as THREE.Mesh
      const geo = mesh.geometry
      const pos = geo.getAttribute('position') as THREE.BufferAttribute | undefined
      if (pos) {
        const idx = geo.getIndex()
        _im.copy(mesh.matrixWorld)
        if (hit.instanceId !== null && (mesh as THREE.InstancedMesh).isInstancedMesh) {
          ;(mesh as THREE.InstancedMesh).getMatrixAt(hit.instanceId, _im2)
          _im.multiply(_im2)
        }
        for (let k = 0; k < 3; k++) {
          const vi = idx ? idx.getX(hit.faceIndex * 3 + k) : hit.faceIndex * 3 + k
          _v.fromBufferAttribute(pos, vi).applyMatrix4(_im)
          add([_v.x, _v.y, _v.z], 'vertex', hit.nodeId)
        }
      }
    }

    // edge-based snaps (nearest, intersection, perpendicular, parallel, extension)
    const segs = settings.nearest || settings.intersection || settings.perpendicular || settings.parallel || settings.extension ? this.nearbySegments(vp, e, raw, radiusPx, exclude, hit) : []
    if (segs.length) {
      const from = query.from ?? null
      for (const s of segs) {
        if (settings.nearest) {
          const c = closestPointOnSegment(raw, s.a, s.b)
          add(c.point, 'nearest', s.nodeId)
        }
        if (from) {
          if (settings.perpendicular) {
            const foot = perpendicularFoot(from, s.a, s.b)
            if (foot) {
              const t = vecDot(vecSub(foot, s.a), vecSub(s.b, s.a)) / Math.max(1e-12, vecDot(vecSub(s.b, s.a), vecSub(s.b, s.a)))
              if (t >= -0.05 && t <= 1.05) add(foot, 'perpendicular', s.nodeId, { from, to: foot, axis: 'custom' })
            }
          }
          if (settings.parallel) {
            const d = vecSub(s.b, s.a)
            const dl = vecLen(d)
            const cur = vecSub(raw, from)
            const cl = vecLen(cur)
            if (dl > 1e-9 && cl > 1e-9) {
              const cosA = Math.abs(vecDot(d, cur)) / (dl * cl)
              if (cosA > 0.995) {
                const dirN = vecScale(vecNorm(d), Math.sign(vecDot(d, cur)) || 1)
                const p = vecAdd(from, vecScale(dirN, cl))
                add(p, 'parallel', s.nodeId, { from, to: p, axis: axisOf(dirN) })
              }
            }
          }
        }
        if (settings.extension) {
          const ext = closestPointOnLine(raw, s.a, s.b)
          if (ext && (ext.t < -0.001 || ext.t > 1.001) && Math.abs(ext.t) < 50) {
            const end = ext.t < 0 ? s.a : s.b
            add(ext.point, 'extension', s.nodeId, { from: end, to: ext.point, axis: axisOf(vecSub(s.b, s.a)) })
          }
        }
      }
      if (settings.intersection && segs.length > 1) this.intersections(segs, plane, raw, add)
    }

    // axis / polar / ortho inference from the reference point
    const from = query.from ?? null
    let inferred: Candidate | null = null
    if (from) {
      const cur = vecSub(raw, from)
      const len = vecLen(cur)
      if (len > 1e-6) {
        if (settings.ortho) {
          const o = orthoSnap(plane, from, raw)
          inferred = { point: o.point, kind: 'axis', nodeId: null, screenDist: 0, guide: { from, to: o.point, axis: axisOf(o.axis === 'u' ? plane.u : plane.v) }, normal: null }
        } else {
          // world axes through `from` (SketchUp-style colored inference)
          const axes: { d: Vec3; axis: 'x' | 'y' | 'z' }[] = [
            { d: [1, 0, 0], axis: 'x' },
            { d: [0, 1, 0], axis: 'y' },
            { d: [0, 0, 1], axis: 'z' },
          ]
          for (const a of axes) {
            const t = vecDot(cur, a.d)
            const p = vecAdd(from, vecScale(a.d, t))
            const d = screenDist(p)
            if (d <= radiusPx * 0.8 && Math.abs(t) > wpp * 4) {
              const cand: Candidate = { point: p, kind: 'axis', nodeId: null, screenDist: d, guide: { from, to: p, axis: a.axis }, normal: null }
              if (!inferred || d < inferred.screenDist) inferred = cand
            }
          }
          if (!inferred && settings.angle && settings.angleStepDeg > 0) {
            const ps = polarSnap(plane, from, raw, (settings.angleStepDeg * Math.PI) / 180)
            if (ps) {
              const d = screenDist(ps.point)
              if (d <= radiusPx * 0.8) inferred = { point: ps.point, kind: 'axis', nodeId: null, screenDist: d, guide: { from, to: ps.point, axis: axisOf(vecSub(ps.point, from)) }, normal: null }
            }
          }
        }
      }
    }

    // pick the winner: object snaps first, then inference, then grid
    candidates.sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || a.screenDist - b.screenDist)
    let best: Candidate | null = candidates[0] ?? null
    if (best && inferred && best.kind !== 'endpoint' && best.kind !== 'midpoint' && best.kind !== 'center' && best.kind !== 'intersection') {
      // keep the inference line but slide the point onto it when an on-edge snap is also close
      best = inferred
    }
    if (!best && inferred) best = inferred
    if (best) {
      result.point = best.point
      result.kind = best.kind
      result.nodeId = best.nodeId
      result.guide = best.guide
      if (best.normal) result.normal = best.normal
    } else if (settings.grid) {
      const step = this.env.gridStep(vp, plane)
      const gp = snapToGrid(plane, raw, step)
      // in surface mode keep the surface height, snap only in-plane
      result.point = query.surfaces && rawKind === 'face' ? raw : gp
      result.kind = query.surfaces && rawKind === 'face' ? 'face' : vecDist(gp, raw) < step * 0.5 ? 'grid' : 'free'
    }
    this.lastResult = result
    return result
  }

  /** Edge segments (world) of nodes under/near the cursor, capped for speed. */
  private nearbySegments(vp: Viewport, e: ToolPointerEvent, raw: Vec3, radiusPx: number, exclude: Set<string>, hit: PickHit | null): { a: Vec3; b: Vec3; nodeId: string }[] {
    const out: { a: Vec3; b: Vec3; nodeId: string }[] = []
    const views: NodeView[] = []
    const rect = vp.rect
    const cx = ((e.ndc[0] + 1) / 2) * rect.w
    const cy = ((1 - e.ndc[1]) / 2) * rect.h
    const pad = radiusPx * 3
    if (hit) {
      const hv = this.env.sync.views.get(hit.nodeId)
      if (hv && !exclude.has(hv.id)) views.push(hv)
    }
    for (const view of this.env.sync.views.values()) {
      if (views.length >= 24) break
      if (exclude.has(view.id) || !view.group.visible || !view.content.visible || !view.result?.edges) continue
      if (views.includes(view)) continue
      // screen-space bounds test
      this.env.sync.flushMatrices()
      _wb.copy(view.localBounds).applyMatrix4(view.group.matrixWorld)
      if (_wb.isEmpty()) continue
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (let i = 0; i < 8; i++) {
        _v.set(i & 1 ? _wb.max.x : _wb.min.x, i & 2 ? _wb.max.y : _wb.min.y, i & 4 ? _wb.max.z : _wb.min.z)
        if (!vp.project(_v, _s)) continue
        minX = Math.min(minX, _s.x)
        maxX = Math.max(maxX, _s.x)
        minY = Math.min(minY, _s.y)
        maxY = Math.max(maxY, _s.y)
      }
      if (cx < minX - pad || cx > maxX + pad || cy < minY - pad || cy > maxY + pad) continue
      views.push(view)
    }
    let budget = MAX_EDGE_SEGMENTS
    for (const view of views) {
      const edges = view.result!.edges!
      const m = view.group.matrixWorld
      for (let i = 0; i + 5 < edges.length && budget > 0; i += 6, budget--) {
        _v.set(edges[i]!, edges[i + 1]!, edges[i + 2]!).applyMatrix4(m)
        const a: Vec3 = [_v.x, _v.y, _v.z]
        _v.set(edges[i + 3]!, edges[i + 4]!, edges[i + 5]!).applyMatrix4(m)
        const b: Vec3 = [_v.x, _v.y, _v.z]
        // keep only segments passing near the cursor in screen space
        const c = closestPointOnSegment(raw, a, b)
        if (!vp.project(_v.set(c.point[0], c.point[1], c.point[2]), _s)) continue
        if (Math.hypot(_s.x - cx, _s.y - cy) > pad * 2) continue
        out.push({ a, b, nodeId: view.id })
        if (out.length >= 400) return out
      }
    }
    return out
  }

  private intersections(segs: { a: Vec3; b: Vec3; nodeId: string }[], plane: WorkPlane, raw: Vec3, add: (p: Vec3, k: SnapResultKind, n: string | null) => void): void {
    const proj = segs.map((s) => ({ a: planeUV(plane, s.a), b: planeUV(plane, s.b), h: vecDot(vecSub(s.a, plane.origin), plane.normal), nodeId: s.nodeId }))
    const n = Math.min(proj.length, 60)
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const p = intersectSegments2D(proj[i]!.a, proj[i]!.b, proj[j]!.a, proj[j]!.b)
        if (!p) continue
        const world = planePoint(plane, p, (proj[i]!.h + proj[j]!.h) / 2)
        if (vecDist(world, raw) > 2) continue
        add(world, 'intersection', proj[i]!.nodeId)
      }
  }

  dispose(): void {
    this.hashes.clear()
    this.indexed.clear()
  }
}

const _v = new THREE.Vector3()
const _c = new THREE.Vector3()
const _s = new THREE.Vector2()
const _ndc = new THREE.Vector2()
const _im = new THREE.Matrix4()
const _im2 = new THREE.Matrix4()
const _wb = new THREE.Box3()
