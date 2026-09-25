// Mesh exporters: glTF/GLB + USDZ (three.js exporters, Y-up) and our own binary STL, PLY and
// OBJ(+MTL+textures, zipped) writers with explicit units and axis conventions.
import type { Material, Mesh, Object3D } from 'three'
import { METERS_PER_UNIT } from '@cadsandbox/shared'
import type { LengthUnit } from '@cadsandbox/shared'
import type { ExportContext, ExportOptions, ExportResult } from '../api'
import { IMAGE_EXT, blobOf, safeFileName, sniffImageMime } from '../util/bytes'
import { splitGeometry } from '../import/three-scene'
import { buildScene } from './scene'

export interface FlatMesh {
  name: string
  positions: Float64Array
  normals: Float32Array
  uvs: Float32Array | null
  indices: Uint32Array
  material: Material | null
  color: [number, number, number]
}

/** World-space triangle meshes of an export scene, scaled (meters × scale). */
export async function flattenScene(root: Object3D, scale: number): Promise<FlatMesh[]> {
  const { Matrix3, Vector3 } = await import('three')
  root.updateMatrixWorld(true)
  const out: FlatMesh[] = []
  const v = new Vector3()
  root.traverse((o) => {
    const mesh = o as Mesh
    if (!mesh.isMesh || !mesh.visible) return
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const m = mesh.matrixWorld
    const nm = new Matrix3().getNormalMatrix(m)
    const flip = m.determinant() < 0
    for (const part of splitGeometry(mesh.geometry)) {
      const n = part.positions.length / 3
      const positions = new Float64Array(n * 3)
      const normals = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) {
        v.set(part.positions[i * 3]!, part.positions[i * 3 + 1]!, part.positions[i * 3 + 2]!).applyMatrix4(m)
        positions[i * 3] = v.x * scale
        positions[i * 3 + 1] = v.y * scale
        positions[i * 3 + 2] = v.z * scale
        v.set(part.normals[i * 3]!, part.normals[i * 3 + 1]!, part.normals[i * 3 + 2]!).applyMatrix3(nm).normalize()
        normals[i * 3] = v.x
        normals[i * 3 + 1] = v.y
        normals[i * 3 + 2] = v.z
      }
      const indices = part.indices ? part.indices.slice() : Uint32Array.from({ length: n }, (_, i) => i)
      if (flip) for (let t = 0; t + 2 < indices.length; t += 3) [indices[t + 1], indices[t + 2]] = [indices[t + 2]!, indices[t + 1]!]
      const mat = mats[part.materialIndex] ?? mats[0] ?? null
      const c = (mat as Material & { color?: { r: number; g: number; b: number } } | null)?.color
      out.push({ name: mesh.name || 'Mesh', positions, normals, uvs: part.uvs ?? null, indices, material: mat, color: c ? [c.r, c.g, c.b] : [0.8, 0.8, 0.8] })
    }
  })
  return out
}

const unitFactor = (u: LengthUnit) => 1 / METERS_PER_UNIT[u]

/** Binary STL (Z-up). */
export function writeStl(meshes: FlatMesh[], title: string): Uint8Array<ArrayBuffer> {
  let tris = 0
  for (const m of meshes) tris += m.indices.length / 3
  const buf = new ArrayBuffer(84 + tris * 50)
  const dv = new DataView(buf)
  const header = new TextEncoder().encode(`CadSandbox STL: ${title}`.slice(0, 79))
  new Uint8Array(buf, 0, 80).set(header)
  dv.setUint32(80, tris, true)
  let o = 84
  for (const m of meshes) {
    const p = m.positions
    for (let t = 0; t < m.indices.length; t += 3) {
      const a = m.indices[t]! * 3,
        b = m.indices[t + 1]! * 3,
        c = m.indices[t + 2]! * 3
      const ux = p[b]! - p[a]!,
        uy = p[b + 1]! - p[a + 1]!,
        uz = p[b + 2]! - p[a + 2]!
      const vx = p[c]! - p[a]!,
        vy = p[c + 1]! - p[a + 1]!,
        vz = p[c + 2]! - p[a + 2]!
      let nx = uy * vz - uz * vy,
        ny = uz * vx - ux * vz,
        nz = ux * vy - uy * vx
      const l = Math.hypot(nx, ny, nz) || 1
      nx /= l
      ny /= l
      nz /= l
      for (const val of [nx, ny, nz, p[a]!, p[a + 1]!, p[a + 2]!, p[b]!, p[b + 1]!, p[b + 2]!, p[c]!, p[c + 1]!, p[c + 2]!]) {
        dv.setFloat32(o, val, true)
        o += 4
      }
      dv.setUint16(o, 0, true)
      o += 2
    }
  }
  return new Uint8Array(buf)
}

/** Binary little-endian PLY with normals and per-vertex material colors (Z-up). */
export function writePly(meshes: FlatMesh[], unit: LengthUnit): Uint8Array<ArrayBuffer> {
  let nv = 0,
    nf = 0
  for (const m of meshes) {
    nv += m.positions.length / 3
    nf += m.indices.length / 3
  }
  const header =
    `ply\nformat binary_little_endian 1.0\ncomment CadSandbox export (units: ${unit}, Z-up)\n` +
    `element vertex ${nv}\nproperty float x\nproperty float y\nproperty float z\nproperty float nx\nproperty float ny\nproperty float nz\n` +
    `property uchar red\nproperty uchar green\nproperty uchar blue\nelement face ${nf}\nproperty list uchar int vertex_indices\nend_header\n`
  const hb = new TextEncoder().encode(header)
  const buf = new ArrayBuffer(hb.length + nv * 27 + nf * 13)
  new Uint8Array(buf).set(hb)
  const dv = new DataView(buf)
  let o = hb.length
  for (const m of meshes) {
    const col = m.color.map((c) => Math.round(Math.min(1, Math.max(0, Math.pow(c, 1 / 2.2))) * 255))
    for (let i = 0; i < m.positions.length; i += 3) {
      for (let k = 0; k < 3; k++) dv.setFloat32(o + k * 4, m.positions[i + k]!, true)
      for (let k = 0; k < 3; k++) dv.setFloat32(o + 12 + k * 4, m.normals[i + k]!, true)
      dv.setUint8(o + 24, col[0]!)
      dv.setUint8(o + 25, col[1]!)
      dv.setUint8(o + 26, col[2]!)
      o += 27
    }
  }
  let base = 0
  for (const m of meshes) {
    for (let t = 0; t < m.indices.length; t += 3) {
      dv.setUint8(o, 3)
      dv.setInt32(o + 1, base + m.indices[t]!, true)
      dv.setInt32(o + 5, base + m.indices[t + 1]!, true)
      dv.setInt32(o + 9, base + m.indices[t + 2]!, true)
      o += 13
    }
    base += m.positions.length / 3
  }
  return new Uint8Array(buf)
}

const fmt = (x: number) => (Math.abs(x) < 1e-12 ? '0' : Number(x.toPrecision(9)).toString())
const srgb = (c: number) => fmt(Math.pow(Math.min(1, Math.max(0, c)), 1 / 2.2))

/** OBJ + MTL text (+ texture files referenced by the MTL). Y-up expected in `meshes`. */
export async function writeObj(meshes: FlatMesh[], base: string, ctx: ExportContext, textures: boolean): Promise<{ obj: string; mtl: string; files: Map<string, Uint8Array> }> {
  const obj: string[] = [`# CadSandbox OBJ export`, `mtllib ${base}.mtl`]
  const mtl: string[] = ['# CadSandbox MTL export']
  const files = new Map<string, Uint8Array>()
  const names = new Map<Material | null, string>()
  const used = new Set<string>()
  const matName = async (m: Material | null): Promise<string> => {
    if (names.has(m)) return names.get(m)!
    let n = (m?.name || 'Material').replace(/\s+/g, '_').replace(/[^\w.-]/g, '') || 'Material'
    for (let i = 2; used.has(n); i++) n = `${n.replace(/_\d+$/, '')}_${i}`
    used.add(n)
    names.set(m, n)
    const mm = m as (Material & { color?: { r: number; g: number; b: number }; roughness?: number; metalness?: number; ior?: number; emissive?: { r: number; g: number; b: number } }) | null
    const c = mm?.color ?? { r: 0.8, g: 0.8, b: 0.8 }
    const rough = mm?.roughness ?? 0.6
    mtl.push('', `newmtl ${n}`, `Kd ${srgb(c.r)} ${srgb(c.g)} ${srgb(c.b)}`, `Ka 0 0 0`, `Ks 0.04 0.04 0.04`, `Ns ${fmt(Math.min(1000, 2 / Math.max(0.0025, rough * rough) - 2))}`)
    mtl.push(`d ${fmt(m?.opacity ?? 1)}`, `Ni ${fmt(mm?.ior ?? 1.5)}`, `Pr ${fmt(rough)}`, `Pm ${fmt(mm?.metalness ?? 0)}`, `illum 2`)
    if (mm?.emissive && (mm.emissive.r || mm.emissive.g || mm.emissive.b)) mtl.push(`Ke ${srgb(mm.emissive.r)} ${srgb(mm.emissive.g)} ${srgb(mm.emissive.b)}`)
    // fallback builder tags materials with their id; the renderer's builder keeps the name
    const def = textures ? (ctx.doc.getMaterial(m?.userData?.materialId as string | undefined) ?? ctx.doc.listMaterials().find((d) => d.name === m?.name)) : undefined
    const colorRef = def?.maps?.color
    if (colorRef && 'asset' in colorRef) {
      const bytes = await ctx.assets.get(colorRef.asset)
      if (bytes) {
        const u8 = new Uint8Array(bytes)
        const file = `textures/${colorRef.asset.slice(0, 16)}.${IMAGE_EXT[sniffImageMime(u8) ?? 'image/png'] ?? 'png'}`
        files.set(file, u8)
        mtl.push(`map_Kd ${file}`)
      }
    }
    return n
  }
  let vBase = 1
  for (const m of meshes) {
    obj.push(`o ${m.name.replace(/\s+/g, '_') || 'Mesh'}`)
    const n = m.positions.length / 3
    for (let i = 0; i < n; i++) obj.push(`v ${fmt(m.positions[i * 3]!)} ${fmt(m.positions[i * 3 + 1]!)} ${fmt(m.positions[i * 3 + 2]!)}`)
    for (let i = 0; i < n; i++) obj.push(`vn ${fmt(m.normals[i * 3]!)} ${fmt(m.normals[i * 3 + 1]!)} ${fmt(m.normals[i * 3 + 2]!)}`)
    const hasUv = !!m.uvs
    if (m.uvs) for (let i = 0; i < n; i++) obj.push(`vt ${fmt(m.uvs[i * 2]!)} ${fmt(m.uvs[i * 2 + 1]!)}`)
    obj.push(`usemtl ${await matName(m.material)}`)
    for (let t = 0; t < m.indices.length; t += 3) {
      const f = [m.indices[t]!, m.indices[t + 1]!, m.indices[t + 2]!].map((i) => (hasUv ? `${i + vBase}/${i + vBase}/${i + vBase}` : `${i + vBase}//${i + vBase}`))
      obj.push(`f ${f.join(' ')}`)
    }
    vBase += n
  }
  return { obj: obj.join('\n') + '\n', mtl: mtl.join('\n') + '\n', files }
}

export async function exportMesh(ctx: ExportContext, format: 'glb' | 'gltf' | 'obj' | 'stl' | 'ply' | 'usdz', opts: ExportOptions): Promise<ExportResult> {
  await ctx.geometry.idle()
  const yUp = format === 'glb' || format === 'gltf' || format === 'obj' || format === 'usdz'
  const textures = opts.textures ?? (format !== 'stl' && format !== 'ply')
  const scene = await buildScene(ctx, { selection: opts.selection, textures, yUp })
  const base = safeFileName(ctx.doc.meta.name, 'design')
  switch (format) {
    case 'glb':
    case 'gltf': {
      const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js')
      const out = await new GLTFExporter().parseAsync(scene, { binary: format === 'glb', onlyVisible: true, embedImages: true, maxTextureSize: 4096 })
      if (format === 'glb') return { blob: blobOf([new Uint8Array(out as ArrayBuffer)], 'model/gltf-binary'), fileName: `${base}.glb` }
      return { blob: blobOf([JSON.stringify(out)], 'model/gltf+json'), fileName: `${base}.gltf` }
    }
    case 'usdz': {
      const { USDZExporter } = await import('three/examples/jsm/exporters/USDZExporter.js')
      const out = await new USDZExporter().parseAsync(scene, { quickLookCompatible: true })
      return { blob: blobOf([out], 'model/vnd.usdz+zip'), fileName: `${base}.usdz` }
    }
    case 'stl': {
      const unit = opts.units ?? 'mm'
      return { blob: blobOf([writeStl(await flattenScene(scene, unitFactor(unit)), ctx.doc.meta.name)], 'model/stl'), fileName: `${base}.stl` }
    }
    case 'ply': {
      const unit = opts.units ?? 'm'
      return { blob: blobOf([writePly(await flattenScene(scene, unitFactor(unit)), unit)], 'application/x-ply'), fileName: `${base}.ply` }
    }
    case 'obj': {
      const unit = opts.units ?? 'm'
      const { obj, mtl, files } = await writeObj(await flattenScene(scene, unitFactor(unit)), base, ctx, textures)
      const { zipSync, strToU8 } = await import('fflate')
      const entries: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = { [`${base}.obj`]: strToU8(obj), [`${base}.mtl`]: strToU8(mtl) }
      for (const [name, bytes] of files) entries[name] = [bytes, { level: 0 }]
      return { blob: blobOf([zipSync(entries, { level: 6 })], 'application/zip'), fileName: `${base}.obj.zip` }
    }
  }
}
