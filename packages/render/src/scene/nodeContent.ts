// Node content builders: GeometryResult → BufferGeometry/Mesh/edges (with BVH), light nodes → three
// lights, section nodes → plane helpers. Geometry buffers are node-local; the owner applies matrices.
import * as THREE from 'three'
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree, MeshBVH, SAH } from 'three-mesh-bvh'
import { GenerateMeshBVHWorker } from 'three-mesh-bvh/worker'
import type { GeometryResult, MeshBuffers, MeshPart } from '@cadsandbox/geometry'
import { computeCleanWireframe, mergeMeshes } from '@cadsandbox/geometry'
import type { LightParams, SectionParams, Vec3 } from '@cadsandbox/doc'

// Patch three once: BVH-accelerated raycasting for every Mesh (InstancedMesh delegates to Mesh).
const geoProto = THREE.BufferGeometry.prototype as THREE.BufferGeometry & { computeBoundsTree?: unknown }
if (!geoProto.computeBoundsTree) {
  THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree
  THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree
  THREE.Mesh.prototype.raycast = acceleratedRaycast
}

/** Triangle count above which the BVH is built in a worker. */
const WORKER_BVH_THRESHOLD = 60_000

let bvhWorker: GenerateMeshBVHWorker | null | undefined
function getBvhWorker(): GenerateMeshBVHWorker | null {
  if (bvhWorker !== undefined) return bvhWorker
  try {
    bvhWorker = typeof Worker === 'undefined' ? null : new GenerateMeshBVHWorker()
  } catch {
    bvhWorker = null
  }
  return bvhWorker
}

const pendingBvh = new Set<THREE.BufferGeometry>()
let bvhQueue: Promise<void> = Promise.resolve()

/** Build the BVH synchronously for small meshes, in the worker for large ones. */
export function ensureBvh(geometry: THREE.BufferGeometry, onReady?: () => void): void {
  if (geometry.boundsTree || pendingBvh.has(geometry)) return
  const tris = (geometry.getIndex()?.count ?? geometry.getAttribute('position').count) / 3
  const worker = tris > WORKER_BVH_THRESHOLD ? getBvhWorker() : null
  if (!worker) {
    // current three-mesh-bvh options only: an explicit undefined strategy or the deprecated leaf option warns on every build
    geometry.computeBoundsTree(tris > 200_000 ? { strategy: SAH, targetLeafSize: 8 } : { targetLeafSize: 8 })
    return
  }
  pendingBvh.add(geometry)
  bvhQueue = bvhQueue.then(async () => {
    if (!pendingBvh.has(geometry)) return
    try {
      const bvh = await worker.generate(geometry, { targetLeafSize: 8 })
      if (pendingBvh.has(geometry)) {
        geometry.boundsTree = bvh as MeshBVH
        onReady?.()
      }
    } catch {
      if (pendingBvh.has(geometry)) geometry.computeBoundsTree({ targetLeafSize: 8 })
    } finally {
      pendingBvh.delete(geometry)
    }
  })
}

export function cancelBvh(geometry: THREE.BufferGeometry): void {
  pendingBvh.delete(geometry)
}

export function bufferGeometryFrom(mesh: MeshBuffers): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3))
  if (mesh.normals && mesh.normals.length === mesh.positions.length) geo.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3))
  if (mesh.uvs && mesh.uvs.length === (mesh.positions.length / 3) * 2) geo.setAttribute('uv', new THREE.BufferAttribute(mesh.uvs, 2))
  if (mesh.indices && mesh.indices.length) geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1))
  if (!geo.getAttribute('normal')) geo.computeVertexNormals()
  geo.computeBoundingBox()
  geo.computeBoundingSphere()
  return geo
}

export function edgesGeometryFrom(edges: Float32Array): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(edges, 3))
  geo.computeBoundingSphere()
  return geo
}

export interface BuiltPart {
  mesh: THREE.Mesh
  part: MeshPart
  triangles: number
}

/** Create meshes for the parts of a result (materials assigned by the caller). */
export function buildParts(result: GeometryResult, nodeId: string, onBvhReady?: () => void): BuiltPart[] {
  const out: BuiltPart[] = []
  for (const part of result.parts) {
    if (!part.mesh.positions.length) continue
    const geo = bufferGeometryFrom(part.mesh)
    const mesh = new THREE.Mesh(geo)
    mesh.castShadow = part.castShadow ?? true
    mesh.receiveShadow = part.receiveShadow ?? true
    mesh.matrixAutoUpdate = false
    mesh.userData.nodeId = nodeId
    mesh.userData.partIndex = out.length
    const triangles = (geo.getIndex()?.count ?? geo.getAttribute('position').count) / 3
    ensureBvh(geo, onBvhReady)
    out.push({ mesh, part, triangles })
  }
  return out
}

export function buildEdges(result: GeometryResult, nodeId: string): THREE.LineSegments | null {
  if (!result.edges || result.edges.length < 6) return null
  const lines = new THREE.LineSegments(edgesGeometryFrom(result.edges))
  lines.matrixAutoUpdate = false
  lines.userData.nodeId = nodeId
  lines.userData.edges = true
  lines.userData.noPathTrace = true
  lines.renderOrder = 10
  lines.raycast = () => {} // edges are never picked directly (meshes/snaps handle them)
  return lines
}

/** Vertex budget for computing a missing wireframe on the main thread (results normally carry `wire` from the worker). */
const WIRE_FALLBACK_MAX_VERTICES = 200_000

/** Wireframe-mode lines: the result's `wire` topology, or a clean wireframe of the parts for results without one. */
export function buildWire(result: GeometryResult, nodeId: string): THREE.LineSegments | null {
  let wire = result.wire
  if (!wire && result.parts.length) {
    const meshes = result.parts.map((p) => p.mesh).filter((m) => m.positions.length)
    const vertices = meshes.reduce((s, m) => s + m.positions.length / 3, 0)
    if (meshes.length && vertices <= WIRE_FALLBACK_MAX_VERTICES) wire = computeCleanWireframe(meshes.length === 1 ? meshes[0]! : mergeMeshes(meshes))
  }
  if (!wire || wire.length < 6) return null
  const lines = new THREE.LineSegments(edgesGeometryFrom(wire))
  lines.matrixAutoUpdate = false
  lines.userData.nodeId = nodeId
  lines.userData.wire = true
  lines.userData.noPathTrace = true
  lines.renderOrder = 10
  lines.raycast = () => {}
  return lines
}

// ------------------------------------------------------------------ lights
export function buildLight(params: LightParams, nodeId: string): THREE.Object3D {
  const color = new THREE.Color(params.color)
  let light: THREE.Light
  switch (params.kind) {
    case 'spot': {
      const s = new THREE.SpotLight(color, params.intensity, params.distance ?? 0, params.angle ?? Math.PI / 5, params.penumbra ?? 0.4, 2)
      s.target.position.set(0, 0, -1)
      s.add(s.target)
      light = s
      break
    }
    case 'directional': {
      const d = new THREE.DirectionalLight(color, params.intensity)
      d.target.position.set(0, 0, -1)
      d.add(d.target)
      light = d
      break
    }
    case 'area': {
      const a = new THREE.RectAreaLight(color, params.intensity, params.width ?? 1, params.height ?? 1)
      a.lookAt(0, 0, -1)
      light = a
      break
    }
    default: {
      light = new THREE.PointLight(color, params.intensity, params.distance ?? 0, 2)
    }
  }
  light.castShadow = params.castShadow && params.kind !== 'area'
  const shadow = (light as THREE.Light & { shadow?: THREE.LightShadow }).shadow
  if (shadow) {
    shadow.mapSize.set(1024, 1024)
    shadow.bias = -0.0005
    shadow.normalBias = 0.02
  }
  const group = new THREE.Group()
  group.add(light)
  // pickable marker (unlit sphere, small) so lights can be selected in the viewport
  const marker = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshBasicMaterial({ color, toneMapped: false }))
  marker.userData.nodeId = nodeId
  marker.userData.helper = true
  marker.userData.noPathTrace = true
  marker.castShadow = false
  marker.receiveShadow = false
  group.add(marker)
  group.userData.light = light
  return group
}

// ------------------------------------------------------------------ section helpers
export function buildSectionHelper(params: SectionParams, nodeId: string, accent: THREE.Color, extent?: { length?: number; height?: number }): THREE.Object3D {
  const group = new THREE.Group()
  const length = extent?.length && extent.length > 0 ? extent.length : 3
  const height = extent?.height && extent.height > 0 ? extent.height : 3
  const size = Math.max(length, height)
  // local X runs along the section line, local Y is up (0..height), +Z = clipped side
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(length, height).translate(0, height / 2, 0),
    new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: params.enabled ? 0.08 : 0.03, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }),
  )
  plane.userData.nodeId = nodeId
  plane.userData.helper = true
  plane.userData.noPathTrace = true
  const frame = new THREE.LineSegments(new THREE.EdgesGeometry(plane.geometry), new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: params.enabled ? 0.9 : 0.4, toneMapped: false }))
  frame.userData.noPathTrace = true
  frame.raycast = () => {}
  // arrow along +Z (clipped side)
  const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 0), size * 0.25, accent.getHex(), size * 0.06, size * 0.04)
  arrow.traverse((o) => {
    o.userData.noPathTrace = true
    o.raycast = () => {}
  })
  group.add(plane, frame, arrow)
  group.userData.sectionLabel = params.label
  return group
}

/** Local bounds of a result as Box3 (empty when degenerate). */
export function resultBounds(result: GeometryResult, out = new THREE.Box3()): THREE.Box3 {
  const b = result.bounds
  if (!b || !Number.isFinite(b.min[0]) || !Number.isFinite(b.max[0])) return out.makeEmpty()
  out.min.set(b.min[0], b.min[1], b.min[2])
  out.max.set(b.max[0], b.max[1], b.max[2])
  return out
}

export function vec3(v: Vec3): THREE.Vector3 {
  return new THREE.Vector3(v[0], v[1], v[2])
}
