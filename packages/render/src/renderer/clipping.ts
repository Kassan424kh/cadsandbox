// Section / plan-cut clipping and mesh slicing (cap polygons + cut outlines). Slicing uses the
// three-mesh-bvh tree when present and caches per (geometry, plane).
import * as THREE from 'three'
import type { MeshBVH } from 'three-mesh-bvh'
import type { Vec2 } from '@cadsandbox/doc'

export interface SliceResult {
  /** Segment pairs in the geometry's local space [x,y,z, x,y,z, …] */
  segments: Float32Array
  /** Triangulated cap in local space (3 vertices per triangle). Empty when no closed loops. */
  capTriangles: Float32Array
  /** Loops (local 3D points) for vector output. */
  loops: THREE.Vector3[][]
}

/** three.js keeps the half-space where distance ≥ 0. To clip the +normal side, pass -normal. */
export function clipPlane(normal: THREE.Vector3, point: THREE.Vector3): THREE.Plane {
  return new THREE.Plane().setFromNormalAndCoplanarPoint(normal.clone().negate().normalize(), point)
}

/** Plan cut: clip everything above z (world). */
export function planCutPlane(z: number): THREE.Plane {
  return new THREE.Plane(new THREE.Vector3(0, 0, -1), z)
}

type BVHGeometry = THREE.BufferGeometry & { boundsTree?: MeshBVH }

/** Intersect a (local-space) plane with a geometry; returns segments and a triangulated cap. */
export function sliceGeometry(geometry: THREE.BufferGeometry, plane: THREE.Plane): SliceResult {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!pos) return { segments: new Float32Array(0), capTriangles: new Float32Array(0), loops: [] }
  const segs: number[] = []
  const tri = new THREE.Triangle()
  const pushSegment = (a: THREE.Vector3, b: THREE.Vector3) => {
    if (a.distanceToSquared(b) < 1e-14) return
    segs.push(a.x, a.y, a.z, b.x, b.y, b.z)
  }
  const handle = (t: THREE.Triangle) => {
    const da = plane.distanceToPoint(t.a)
    const db = plane.distanceToPoint(t.b)
    const dc = plane.distanceToPoint(t.c)
    const sa = da > 0,
      sb = db > 0,
      sc = dc > 0
    if (sa === sb && sb === sc) return
    const pts: THREE.Vector3[] = []
    const edge = (p: THREE.Vector3, q: THREE.Vector3, dp: number, dq: number) => {
      if (dp > 0 === dq > 0) return
      const t2 = dp / (dp - dq)
      pts.push(new THREE.Vector3().lerpVectors(p, q, t2))
    }
    edge(t.a, t.b, da, db)
    edge(t.b, t.c, db, dc)
    edge(t.c, t.a, dc, da)
    if (pts.length >= 2) pushSegment(pts[0]!, pts[1]!)
  }
  const bvh = (geometry as BVHGeometry).boundsTree
  if (bvh) {
    bvh.shapecast({
      intersectsBounds: (box) => plane.intersectsBox(box),
      intersectsTriangle: (t) => {
        handle(t)
        return false
      },
    })
  } else {
    const index = geometry.getIndex()
    const count = index ? index.count : pos.count
    for (let i = 0; i < count; i += 3) {
      const ia = index ? index.getX(i) : i
      const ib = index ? index.getX(i + 1) : i + 1
      const ic = index ? index.getX(i + 2) : i + 2
      tri.a.fromBufferAttribute(pos, ia)
      tri.b.fromBufferAttribute(pos, ib)
      tri.c.fromBufferAttribute(pos, ic)
      handle(tri)
    }
  }
  const segments = new Float32Array(segs)
  const loops = chainLoops(segments)
  const capTriangles = triangulateLoops(loops, plane)
  return { segments, capTriangles, loops }
}

/** Chain segments into closed loops (endpoint hashing with tolerance). Open chains are dropped. */
export function chainLoops(segments: Float32Array, tolerance = 1e-5): THREE.Vector3[][] {
  const n = segments.length / 6
  if (n < 3) return []
  const key = (x: number, y: number, z: number) => `${Math.round(x / tolerance)},${Math.round(y / tolerance)},${Math.round(z / tolerance)}`
  const adjacency = new Map<string, number[]>()
  const used = new Uint8Array(n)
  const ptA = (i: number) => new THREE.Vector3(segments[i * 6]!, segments[i * 6 + 1]!, segments[i * 6 + 2]!)
  const ptB = (i: number) => new THREE.Vector3(segments[i * 6 + 3]!, segments[i * 6 + 4]!, segments[i * 6 + 5]!)
  for (let i = 0; i < n; i++) {
    const ka = key(segments[i * 6]!, segments[i * 6 + 1]!, segments[i * 6 + 2]!)
    const kb = key(segments[i * 6 + 3]!, segments[i * 6 + 4]!, segments[i * 6 + 5]!)
    ;(adjacency.get(ka) ?? adjacency.set(ka, []).get(ka)!).push(i)
    ;(adjacency.get(kb) ?? adjacency.set(kb, []).get(kb)!).push(i)
  }
  const loops: THREE.Vector3[][] = []
  for (let start = 0; start < n; start++) {
    if (used[start]) continue
    used[start] = 1
    const loop: THREE.Vector3[] = [ptA(start)]
    let cur = ptB(start)
    let guard = 0
    let closed = false
    while (guard++ < n + 2) {
      loop.push(cur)
      const k = key(cur.x, cur.y, cur.z)
      const cands = adjacency.get(k) ?? []
      let next = -1
      for (const c of cands) if (!used[c]) {
        next = c
        break
      }
      if (next < 0) {
        // back at the start?
        if (loop.length > 2 && cur.distanceTo(loop[0]!) < tolerance * 4) closed = true
        break
      }
      used[next] = 1
      const a = ptA(next)
      const b = ptB(next)
      cur = a.distanceTo(cur) < tolerance * 4 ? b : a
      if (cur.distanceTo(loop[0]!) < tolerance * 4) {
        closed = true
        break
      }
    }
    if (closed && loop.length >= 3) loops.push(loop)
  }
  return loops
}

/** Triangulate loops lying on `plane` (holes = loops contained in another loop). */
export function triangulateLoops(loops: THREE.Vector3[][], plane: THREE.Plane): Float32Array {
  if (!loops.length) return new Float32Array(0)
  const n = plane.normal
  const u = Math.abs(n.z) < 0.9 ? new THREE.Vector3(0, 0, 1).cross(n).normalize() : new THREE.Vector3(1, 0, 0)
  const v = new THREE.Vector3().crossVectors(n, u).normalize()
  const origin = plane.coplanarPoint(new THREE.Vector3())
  const to2D = (p: THREE.Vector3): THREE.Vector2 => {
    _d.copy(p).sub(origin)
    return new THREE.Vector2(_d.dot(u), _d.dot(v))
  }
  const polys = loops.map((loop) => {
    const pts = loop.map(to2D)
    return { pts, area: signedArea(pts), loop }
  })
  polys.sort((a, b) => Math.abs(b.area) - Math.abs(a.area))
  const assigned = new Set<number>()
  const out: number[] = []
  for (let i = 0; i < polys.length; i++) {
    if (assigned.has(i)) continue
    const outer = polys[i]!
    assigned.add(i)
    const holes: THREE.Vector2[][] = []
    for (let j = i + 1; j < polys.length; j++) {
      if (assigned.has(j)) continue
      const inner = polys[j]!
      if (pointInPolygon(inner.pts[0]!, outer.pts)) {
        // nested twice → island, handled as its own outer later
        let depth = 0
        for (let k = 0; k < polys.length; k++) if (k !== j && k !== i && !assigned.has(k) && pointInPolygon(inner.pts[0]!, polys[k]!.pts) && pointInPolygon(polys[k]!.pts[0]!, outer.pts)) depth++
        if (depth % 2 === 0) {
          holes.push(inner.pts)
          assigned.add(j)
        }
      }
    }
    const contour = outer.area < 0 ? [...outer.pts].reverse() : outer.pts
    const holeList = holes.map((h) => (signedArea(h) > 0 ? [...h].reverse() : h))
    let tris: number[][]
    try {
      tris = THREE.ShapeUtils.triangulateShape(contour, holeList)
    } catch {
      continue
    }
    const all = [...contour, ...holeList.flat()]
    for (const t of tris) {
      for (const idx of t) {
        const p2 = all[idx]!
        const p3 = origin.clone().addScaledVector(u, p2.x).addScaledVector(v, p2.y)
        out.push(p3.x, p3.y, p3.z)
      }
    }
  }
  return new Float32Array(out)
}

export function signedArea(pts: THREE.Vector2[]): number {
  let a = 0
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i]!,
      q = pts[(i + 1) % n]!
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

export function pointInPolygon(p: THREE.Vector2 | Vec2, poly: THREE.Vector2[]): boolean {
  const px = 'x' in p ? p.x : p[0]
  const py = 'x' in p ? p.y : p[1]
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!,
      b = poly[j]!
    if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** Per-mesh slice cache keyed by geometry identity + plane. */
export class SliceCache {
  private cache = new WeakMap<THREE.BufferGeometry, Map<string, SliceResult>>()

  get(geometry: THREE.BufferGeometry, localPlane: THREE.Plane): SliceResult {
    let byPlane = this.cache.get(geometry)
    if (!byPlane) this.cache.set(geometry, (byPlane = new Map()))
    const key = `${localPlane.normal.x.toFixed(6)},${localPlane.normal.y.toFixed(6)},${localPlane.normal.z.toFixed(6)},${localPlane.constant.toFixed(5)}`
    let r = byPlane.get(key)
    if (!r) {
      r = sliceGeometry(geometry, localPlane)
      if (byPlane.size > 6) byPlane.delete(byPlane.keys().next().value!)
      byPlane.set(key, r)
    }
    return r
  }

  invalidate(geometry: THREE.BufferGeometry): void {
    this.cache.delete(geometry)
  }
}

/** Transform a world plane into an object's local space. */
export function planeToLocal(world: THREE.Plane, matrixWorld: THREE.Matrix4, out: THREE.Plane): THREE.Plane {
  _inv.copy(matrixWorld).invert()
  return out.copy(world).applyMatrix4(_inv)
}

const _d = new THREE.Vector3()
const _inv = new THREE.Matrix4()
