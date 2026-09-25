// three.js scene graph → document nodes. Used by every mesh importer (glTF, OBJ, STL, PLY, 3MF, FBX,
// DAE). Converts the source up-axis to Z-up, bakes the unit scale into vertices (node transforms stay
// in meters with unit scale), keeps hierarchy + names, splits multi-material meshes and maps
// GPU-instanced meshes to components.
import { BufferGeometry, Matrix3, Matrix4, Quaternion, Vector3 } from 'three'
import type { BufferAttribute, InstancedMesh, InterleavedBufferAttribute, Light, Line, Material, Mesh, Object3D } from 'three'
import type { AnyNode, Transform, Vec3 } from '@cadsandbox/doc'
import type { SnapshotBuilder } from '../builder'
import { CSBM_MIME, encodeCSBM, positionBounds } from '../csbm'
import { throwIfAborted, tick } from '../util/bytes'
import type { MaterialConverter } from './materials'

export interface SceneImportOptions {
  /** Name of the created root group (usually the file name). */
  name: string
  /** Up-axis of the source coordinates (after the loader's own corrections). */
  up: 'y' | 'z'
  /** Meters per source unit. */
  scale: number
  /** glTF stores UVs with a top-left origin; flip to the OpenGL convention used by CSBM. */
  flipV?: boolean
  materials: MaterialConverter
  /** Override the material of a mesh part by source material name (e.g. OBJ + MTL). */
  materialByName?: (name: string) => string | null
  /** With `materialByName`: parts whose material it does not know get the type default (null). */
  skipUnmappedMaterials?: boolean
  meta?: Record<string, unknown>
  signal?: AbortSignal
  onProgress?: (fraction: number) => void
}

interface Part {
  materialIndex: number
  positions: Float32Array
  normals: Float32Array
  uvs?: Float32Array
  indices?: Uint32Array
}

const EPS = 1e-6

function toTransform(m: Matrix4): Transform {
  const p = new Vector3(),
    q = new Quaternion(),
    s = new Vector3()
  m.decompose(p, q, s)
  return { p: [p.x, p.y, p.z], r: [q.x, q.y, q.z, q.w], s: [s.x, s.y, s.z] }
}
function fromTransform(t: Transform): Matrix4 {
  return new Matrix4().compose(new Vector3(...t.p), new Quaternion(...t.r), new Vector3(...t.s))
}
function nearlyEqual(a: Matrix4, b: Matrix4): boolean {
  let scale = 1
  for (const v of a.elements) scale = Math.max(scale, Math.abs(v))
  for (let i = 0; i < 16; i++) if (Math.abs(a.elements[i]! - b.elements[i]!) > EPS * scale) return false
  return true
}
const isIdentity = (m: Matrix4) => nearlyEqual(m, new Matrix4())

function readAttr(attr: BufferAttribute | InterleavedBufferAttribute, size: number): Float32Array {
  const out = new Float32Array(attr.count * size)
  for (let i = 0; i < attr.count; i++) {
    out[i * size] = attr.getX(i)
    if (size > 1) out[i * size + 1] = attr.getY(i)
    if (size > 2) out[i * size + 2] = attr.getZ(i)
  }
  return out
}

/** Split a geometry into per-material parts with compact vertex arrays. */
export function splitGeometry(geometry: BufferGeometry, flipV = false): Part[] {
  let g = geometry
  if (!g.getAttribute('position')) return []
  if (!g.getAttribute('normal')) {
    g = geometry.clone()
    g.computeVertexNormals()
  }
  const pos = readAttr(g.getAttribute('position'), 3)
  const nor = readAttr(g.getAttribute('normal'), 3)
  const uvAttr = g.getAttribute('uv')
  const uv = uvAttr ? readAttr(uvAttr, 2) : undefined
  if (uv && flipV) for (let i = 1; i < uv.length; i += 2) uv[i] = 1 - uv[i]!
  const index = g.index ? Uint32Array.from({ length: g.index.count }, (_, i) => g.index!.getX(i)) : null
  const total = index ? index.length : pos.length / 3
  const groups = g.groups.length ? g.groups : [{ start: 0, count: total, materialIndex: 0 }]
  if (groups.length === 1 && groups[0]!.start === 0 && groups[0]!.count >= total) {
    const part: Part = { materialIndex: groups[0]!.materialIndex ?? 0, positions: pos, normals: nor }
    if (uv) part.uvs = uv
    if (index) part.indices = index
    return [part]
  }
  const byMat = new Map<number, number[]>() // materialIndex → element indices (vertex ids)
  for (const grp of groups) {
    const list = byMat.get(grp.materialIndex ?? 0) ?? []
    const end = Math.min(total, grp.start + grp.count)
    for (let i = grp.start; i < end; i++) list.push(index ? index[i]! : i)
    byMat.set(grp.materialIndex ?? 0, list)
  }
  const parts: Part[] = []
  for (const [materialIndex, elems] of byMat) {
    const remap = new Map<number, number>()
    const idx = new Uint32Array(elems.length)
    for (let i = 0; i < elems.length; i++) {
      const v = elems[i]!
      let r = remap.get(v)
      if (r === undefined) remap.set(v, (r = remap.size))
      idx[i] = r
    }
    const n = remap.size
    const p = new Float32Array(n * 3),
      nn = new Float32Array(n * 3),
      u = uv ? new Float32Array(n * 2) : undefined
    for (const [src, dst] of remap) {
      p.set(pos.subarray(src * 3, src * 3 + 3), dst * 3)
      nn.set(nor.subarray(src * 3, src * 3 + 3), dst * 3)
      if (u && uv) u.set(uv.subarray(src * 2, src * 2 + 2), dst * 2)
    }
    const part: Part = { materialIndex, positions: p, normals: nn, indices: idx }
    if (u) part.uvs = u
    parts.push(part)
  }
  return parts
}

/** Apply scale + optional matrix to a part (in place). Flips winding for mirroring matrices. */
function bakePart(part: Part, scale: number, m: Matrix4 | null): void {
  const p = part.positions
  if (!m) {
    if (scale !== 1) for (let i = 0; i < p.length; i++) p[i] = p[i]! * scale
    return
  }
  const v = new Vector3()
  for (let i = 0; i < p.length; i += 3) {
    v.set(p[i]! * scale, p[i + 1]! * scale, p[i + 2]! * scale).applyMatrix4(m)
    p[i] = v.x
    p[i + 1] = v.y
    p[i + 2] = v.z
  }
  const nm = new Matrix3().getNormalMatrix(m)
  const n = part.normals
  for (let i = 0; i < n.length; i += 3) {
    v.set(n[i]!, n[i + 1]!, n[i + 2]!).applyMatrix3(nm).normalize()
    n[i] = v.x
    n[i + 1] = v.y
    n[i + 2] = v.z
  }
  if (m.determinant() < 0) {
    if (!part.indices) part.indices = Uint32Array.from({ length: p.length / 3 }, (_, i) => i)
    const idx = part.indices
    for (let i = 0; i + 2 < idx.length; i += 3) {
      const t = idx[i + 1]!
      idx[i + 1] = idx[i + 2]!
      idx[i + 2] = t
    }
  }
}

function avgVertexColor(g: BufferGeometry): string | null {
  const c = g.getAttribute('color')
  if (!c || !c.count) return null
  let r = 0,
    gg = 0,
    b = 0
  for (let i = 0; i < c.count; i++) {
    r += c.getX(i)
    gg += c.getY(i)
    b += c.getZ(i)
  }
  const h = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v / c.count)) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${h(r)}${h(gg)}${h(b)}`
}

function jsonMeta(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== 'object' || !Object.keys(data).length) return null
  try {
    const s = JSON.stringify(data)
    return s.length < 64_000 ? (JSON.parse(s) as Record<string, unknown>) : null
  } catch {
    return null
  }
}

type Kind = 'mesh' | 'line' | 'light' | 'group' | 'skip'
function kindOf(o: Object3D): Kind {
  const x = o as Object3D & { isMesh?: boolean; isLine?: boolean; isLight?: boolean; isPoints?: boolean; isCamera?: boolean; isBone?: boolean }
  if (x.isMesh) return 'mesh'
  if (x.isLine) return 'line'
  if (x.isLight) return 'light'
  if (x.isPoints || x.isCamera || x.isBone) return 'skip'
  return 'group'
}

/** Convert a loaded three.js object tree; returns the created root group node. */
export async function importObject3D(root: Object3D, b: SnapshotBuilder, o: SceneImportOptions): Promise<AnyNode> {
  root.updateMatrixWorld(true)
  const s = o.scale
  const C = new Matrix4()
  if (o.up === 'y') C.makeRotationX(Math.PI / 2)
  const pre = C.clone().multiply(new Matrix4().makeScale(s, s, s))
  const post = new Matrix4().makeScale(1 / s, 1 / s, 1 / s)
  const docWorld = (obj: Object3D) => pre.clone().multiply(obj.matrixWorld).multiply(post)

  // Which subtrees contain anything convertible?
  const useful = new Map<Object3D, boolean>()
  let meshTotal = 0
  const scan = (obj: Object3D): boolean => {
    const k = kindOf(obj)
    if (k === 'mesh') meshTotal++
    let any = k === 'mesh' || k === 'line' || k === 'light'
    for (const c of obj.children) any = scan(c) || any
    useful.set(obj, any)
    return any
  }
  scan(root)

  const top = b.add('group', { name: o.name, parent: null, meta: o.meta ?? {} })
  const geoParts = new Map<BufferGeometry, Part[]>()
  let skippedPoints = 0,
    done = 0

  const partsOf = (g: BufferGeometry): Part[] => {
    let p = geoParts.get(g)
    if (!p) geoParts.set(g, (p = splitGeometry(g, o.flipV)))
    return p.map((x) => ({
      ...x,
      positions: x.positions.slice(),
      normals: x.normals.slice(),
      ...(x.uvs ? { uvs: x.uvs.slice() } : {}),
      ...(x.indices ? { indices: x.indices.slice() } : {}),
    }))
  }

  /** Emit the parts of a mesh under `parent`; returns the created node. */
  const emitMeshParts = async (mesh: Mesh, parent: string, t: Transform, bake: Matrix4 | null, def: boolean): Promise<AnyNode | null> => {
    const parts = partsOf(mesh.geometry)
    if (!parts.length) return null
    const mats: Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const name = mesh.name || mesh.geometry.name || 'Mesh'
    const tint = avgVertexColor(mesh.geometry)
    if (tint) b.warn('Vertex colors are not supported; meshes were tinted with their average color.')
    const meta = jsonMeta(mesh.userData) ?? {}
    const multi = parts.length > 1
    const holder = multi ? b.add('group', { name, parent, t, visible: mesh.visible, meta }, def) : null
    let first: AnyNode | null = holder
    for (const part of parts) {
      bakePart(part, s, bake)
      const bytes = encodeCSBM(part)
      const hash = await b.asset(bytes, CSBM_MIME)
      const mat = mats[part.materialIndex] ?? mats[0]
      let materialId: string | null = null
      if (mat) {
        materialId = (mat.name && o.materialByName?.(mat.name)) || null
        if (!materialId && !o.skipUnmappedMaterials) materialId = await o.materials.convert(mat)
      }
      const bounds = positionBounds(part.positions)
      const node = b.add(
        'mesh',
        {
          name: multi ? `${name} · ${mat?.name || `Part ${part.materialIndex + 1}`}` : name,
          parent: holder ? holder.id : parent,
          t: holder ? undefined : t,
          visible: mesh.visible,
          material: materialId,
          color: tint,
          meta: holder ? {} : meta,
          params: { asset: hash, bounds },
        },
        def,
      )
      first ??= node
      if (!def) {
        const world = worldOf.get(parent)!.clone().multiply(fromTransform(t))
        const bb = [bounds.min, bounds.max]
        const corners: Vec3[] = []
        for (const x of bb) for (const y of bb) for (const z of bb) corners.push([x[0], y[1], z[2]])
        b.expand(corners, new Float64Array(world.elements))
      }
    }
    return first
  }

  const worldOf = new Map<string, Matrix4>([[top.id, new Matrix4()]])

  const localFor = (parentId: string, target: Matrix4): { t: Transform; bake: Matrix4 | null; world: Matrix4 } => {
    const parentWorld = worldOf.get(parentId)!
    const local = parentWorld.clone().invert().multiply(target)
    const t = toTransform(local)
    const re = fromTransform(t)
    if (nearlyEqual(re, local)) return { t, bake: null, world: parentWorld.clone().multiply(re) }
    // Shear (non-uniform scale under rotation): bake the exact local matrix into the vertices.
    return { t: { p: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }, bake: local, world: parentWorld.clone() }
  }

  const emitInstanced = async (mesh: InstancedMesh, parent: string, target: Matrix4) => {
    const { def, root } = b.component(mesh.name || 'Instanced mesh')
    await emitMeshParts(mesh, root.id, { p: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }, null, true)
    const m = new Matrix4()
    const sInv = new Matrix4().makeScale(1 / s, 1 / s, 1 / s)
    const sM = new Matrix4().makeScale(s, s, s)
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m)
      const world = target.clone().multiply(sM).multiply(m).multiply(sInv)
      const { t } = localFor(parent, world)
      b.add('instance', { name: `${def.name} ${i + 1}`, parent, t, params: { component: def.id } })
    }
  }

  const emitLine = (line: Line) => {
    const g = line.geometry
    const pos = g.getAttribute('position')
    if (!pos || pos.count < 2) return
    const m = docWorld(line).multiply(new Matrix4().makeScale(s, s, s))
    const pts: Vector3[] = []
    for (let i = 0; i < pos.count; i++) pts.push(new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(m))
    const z = pts[0]!.z
    if (pts.some((p) => Math.abs(p.z - z) > 1e-6)) {
      b.warn('3D (non-planar) curves were skipped.')
      return
    }
    const segs = (line as Line & { isLineSegments?: boolean }).isLineSegments
    const closed = !!(line as Line & { isLineLoop?: boolean }).isLineLoop
    const runs: Vector3[][] = []
    if (segs) {
      for (let i = 0; i + 1 < pts.length; i += 2) {
        const last = runs[runs.length - 1]
        if (last && last[last.length - 1]!.distanceTo(pts[i]!) < 1e-9) last.push(pts[i + 1]!)
        else runs.push([pts[i]!, pts[i + 1]!])
      }
    } else runs.push(pts)
    for (const run of runs) {
      b.add('polyline', {
        name: line.name || 'Curve',
        parent: top.id,
        t: { p: [0, 0, z], r: [0, 0, 0, 1], s: [1, 1, 1] },
        params: { points: run.map((p) => [p.x, p.y]), closed },
      })
      b.expand(run.map((p) => [p.x, p.y, p.z] as Vec3))
    }
  }

  const emitLight = (light: Light, parent: string, target: Matrix4) => {
    const x = light as Light & { isPointLight?: boolean; isSpotLight?: boolean; isDirectionalLight?: boolean; distance?: number; angle?: number; penumbra?: number }
    const kind = x.isSpotLight ? 'spot' : x.isDirectionalLight ? 'directional' : x.isPointLight ? 'point' : null
    if (!kind) return
    const { t } = localFor(parent, target)
    b.add('light', {
      name: light.name || 'Light',
      parent,
      t,
      params: {
        kind,
        color: `#${light.color.getHexString()}`,
        intensity: light.intensity,
        distance: x.distance ?? 0,
        ...(kind === 'spot' ? { angle: x.angle ?? Math.PI / 4, penumbra: x.penumbra ?? 0 } : {}),
        castShadow: false,
      },
    })
  }

  const visit = async (obj: Object3D, parent: string) => {
    throwIfAborted(o.signal)
    if (!useful.get(obj)) {
      if ((obj as { isPoints?: boolean }).isPoints) skippedPoints++
      return
    }
    const kind = kindOf(obj)
    const target = docWorld(obj)
    if (kind === 'line') return emitLine(obj as Line)
    if (kind === 'light') return emitLight(obj as Light, parent, target)
    if (kind === 'mesh') {
      done++
      if (done % 25 === 0) {
        o.onProgress?.(done / Math.max(1, meshTotal))
        await tick()
      }
      if ((obj as InstancedMesh).isInstancedMesh) await emitInstanced(obj as InstancedMesh, parent, target)
      else {
        const hasKids = obj.children.some((c) => useful.get(c))
        const { t, bake, world } = localFor(parent, target)
        if (hasKids) {
          const g = b.add('group', { name: obj.name || 'Group', parent, t: bake ? undefined : t, visible: obj.visible })
          worldOf.set(g.id, world)
          await emitMeshParts(obj as Mesh, g.id, { p: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }, bake, false)
          for (const c of obj.children) await visit(c, g.id)
        } else await emitMeshParts(obj as Mesh, parent, t, bake, false)
      }
      return
    }
    // group-like
    const { t, world } = localFor(parent, target)
    const kids = obj.children.filter((c) => useful.get(c))
    if (obj === root || (kids.length === 1 && !obj.name && isIdentity(worldOf.get(parent)!.clone().invert().multiply(world)))) {
      for (const c of obj.children) await visit(c, parent)
      return
    }
    const g = b.add('group', { name: obj.name || 'Group', parent, t, visible: obj.visible, meta: jsonMeta(obj.userData) ?? {} })
    worldOf.set(g.id, world)
    for (const c of obj.children) await visit(c, g.id)
  }

  await visit(root, top.id)
  if (skippedPoints) b.warn(`${skippedPoints} point cloud object(s) were skipped (not supported).`)
  if (!meshTotal) b.warn('The file contains no meshes.')
  o.onProgress?.(1)
  return top
}

/** Wrap bare geometry (STL/PLY) as a mesh object for importObject3D. */
export async function meshFromGeometry(geometry: BufferGeometry, name: string, material?: Material): Promise<Object3D> {
  const { Mesh, MeshStandardMaterial, Group } = await import('three')
  const mesh = new Mesh(geometry, material ?? new MeshStandardMaterial({ color: 0xcccccc, roughness: 0.6 }))
  mesh.name = name
  const g = new Group()
  g.add(mesh)
  return g
}
