// buildExportScene — self-contained three Group of the (visible or selected) scene with world
// transforms and MeshPhysicalMaterials; procedural textures baked to canvases; optional Y-up.
import * as THREE from 'three'
import type { AnyNode, CadDocument, MaterialDef, TextureRef } from '@cadsandbox/doc'
import { BUILTIN_MATERIAL_MAP, TYPE_DEFAULT_MATERIAL } from '@cadsandbox/doc'
import type { AssetResolver, GeometryResult, GeometryService, MeshPart } from '@cadsandbox/geometry'
import type { BuildExportScene, EditorAssets } from '../api'
import { bufferGeometryFrom } from '../scene/nodeContent'
import { generateProcedural } from '../materials/proceduralCore'
import { mat4FromDoc } from '../util/math'

const TEXTURE_SIZE = 512

export const buildExportScene: BuildExportScene = async (doc, geometry, assets, opts = {}) => {
  const group = new THREE.Group()
  group.name = doc.meta.name
  const textures = opts.textures !== false
  const materialCache = new Map<string, THREE.MeshPhysicalMaterial>()
  const texturePromises: Promise<void>[] = []
  const ids = collectIds(doc, opts.selection)
  const consumed = (id: string) => geometry.isConsumed(id) || doc.getAncestors(id).some((a) => geometry.isConsumed(a))

  const materialFor = (node: AnyNode, part: MeshPart): THREE.MeshPhysicalMaterial => {
    let id: string
    let tint: string | null = null
    if (part.material !== 'node') id = part.material.id
    else {
      id = node.material ?? TYPE_DEFAULT_MATERIAL[node.type] ?? 'mat-default'
      tint = node.color
    }
    const def = doc.getMaterial(id) ?? BUILTIN_MATERIAL_MAP.get('mat-default')!
    const key = `${id}|${tint ?? ''}`
    let m = materialCache.get(key)
    if (!m) {
      m = physicalMaterial(def, tint)
      m.name = tint ? `${def.name} (${tint})` : def.name
      m.userData.materialId = def.id
      m.userData.tint = tint
      if (textures && canRasterize()) texturePromises.push(applyTextures(m, def, assets))
      materialCache.set(key, m)
    }
    return m
  }

  const addResult = (node: AnyNode, result: GeometryResult, world: THREE.Matrix4, nameSuffix = '') => {
    const parts = result.parts.filter((p) => p.mesh.positions.length)
    if (parts.length) {
      const holder = parts.length === 1 ? null : new THREE.Group()
      for (const part of parts) {
        const mesh = new THREE.Mesh(bufferGeometryFrom(part.mesh), materialFor(node, part))
        mesh.name = parts.length === 1 ? node.name + nameSuffix : `${node.name}${nameSuffix} · part`
        mesh.userData.nodeId = node.id
        mesh.castShadow = part.castShadow ?? true
        mesh.receiveShadow = part.receiveShadow ?? true
        if (holder) holder.add(mesh)
        else {
          mesh.matrix.copy(world)
          mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale)
          group.add(mesh)
        }
      }
      if (holder) {
        holder.name = node.name + nameSuffix
        holder.userData.nodeId = node.id
        holder.matrix.copy(world)
        holder.matrix.decompose(holder.position, holder.quaternion, holder.scale)
        group.add(holder)
      }
    }
    if (opts.includeDrawings && result.drawing && result.drawing.lines.length) {
      const pos: number[] = []
      for (const l of result.drawing.lines) for (let i = 0; i + 3 < l.segments.length; i += 4) pos.push(l.segments[i]!, l.segments[i + 1]!, 0, l.segments[i + 2]!, l.segments[i + 3]!, 0)
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x222222 }))
      lines.name = `${node.name}${nameSuffix} · drawing`
      lines.matrix.copy(world)
      lines.matrix.decompose(lines.position, lines.quaternion, lines.scale)
      group.add(lines)
    }
  }

  for (const id of ids) {
    const node = doc.getNode(id) as AnyNode | undefined
    if (!node || consumed(id)) continue
    if (node.type === 'instance') {
      const def = doc.getComponent(node.params.component)
      if (!def) continue
      const instWorld = mat4FromDoc(doc.getWorldMatrix(id))
      for (const defId of [def.root, ...doc.getDescendants(def.root)]) {
        const r = geometry.get(defId)
        const dn = doc.getNode(defId) as AnyNode | undefined
        if (!r || !dn || !dn.visible || geometry.isConsumed(defId)) continue
        const world = new THREE.Matrix4().multiplyMatrices(instWorld, mat4FromDoc(doc.getWorldMatrix(defId)))
        addResult(dn, r, world, ` (${node.name})`)
      }
      continue
    }
    const r = geometry.get(id)
    if (!r) continue
    const world = node.type === 'opening' ? mat4FromDoc(doc.getWorldMatrix(node.parent)) : mat4FromDoc(doc.getWorldMatrix(id))
    addResult(node, r, world)
  }
  await Promise.all(texturePromises)
  if (opts.yUp) {
    group.rotation.x = -Math.PI / 2
    group.updateMatrixWorld(true)
  }
  return group
}

function collectIds(doc: CadDocument, selection: string[] | undefined): string[] {
  const out: string[] = []
  if (selection && selection.length) {
    for (const id of doc.topLevel(selection)) {
      out.push(id)
      for (const d of doc.getDescendants(id)) out.push(d)
    }
    return out.filter((id) => doc.isEffectivelyVisible(id) && !doc.isDefinitionNode(id))
  }
  for (const id of doc.nodeIds()) if (!doc.isDefinitionNode(id) && doc.isEffectivelyVisible(id)) out.push(id)
  return out
}

/** MeshPhysicalMaterial from a MaterialDef (shared with the editor's material cache semantics). */
export function physicalMaterial(def: MaterialDef, tint: string | null): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial()
  m.color.set(tint ?? def.color)
  m.roughness = def.roughness
  m.metalness = def.metalness
  m.opacity = def.opacity
  m.transparent = def.opacity < 1
  m.side = def.doubleSided ? THREE.DoubleSide : THREE.FrontSide
  if (def.transmission > 0) {
    m.transmission = def.transmission
    m.ior = def.ior || 1.5
    m.thickness = def.thickness ?? 0.01
    m.transparent = true
  }
  if (def.emissive) {
    m.emissive.set(def.emissive)
    m.emissiveIntensity = def.emissiveIntensity ?? 1
  }
  if (def.clearcoat) {
    m.clearcoat = def.clearcoat
    m.clearcoatRoughness = def.clearcoatRoughness ?? 0.1
  }
  if (def.sheen) {
    m.sheen = def.sheen
    if (def.sheenColor) m.sheenColor.set(def.sheenColor)
  }
  return m
}

async function applyTextures(m: THREE.MeshPhysicalMaterial, def: MaterialDef, assets: EditorAssets | AssetResolver): Promise<void> {
  const maps = def.maps
  if (!maps) return
  const uv = def.uv ?? { size: [1, 1] as [number, number], rotation: 0, offset: [0, 0] as [number, number] }
  const configure = (t: THREE.Texture, srgb: boolean) => {
    t.wrapS = THREE.RepeatWrapping
    t.wrapT = THREE.RepeatWrapping
    t.repeat.set(1 / Math.max(1e-4, uv.size[0]), 1 / Math.max(1e-4, uv.size[1]))
    t.offset.set(-uv.offset[0] / Math.max(1e-4, uv.size[0]), -uv.offset[1] / Math.max(1e-4, uv.size[1]))
    t.rotation = uv.rotation
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
    t.flipY = false
    t.needsUpdate = true
    return t
  }
  const fromRef = async (ref: TextureRef, channel: 'color' | 'normal' | 'roughness'): Promise<THREE.Texture | null> => {
    if ('procedural' in ref) {
      const px = generateProcedural({ kind: ref.procedural.kind, seed: ref.procedural.seed ?? 0, size: TEXTURE_SIZE, params: ref.procedural.params ?? {} })
      const data = channel === 'color' ? px.color : channel === 'normal' ? px.normal : px.roughness
      const canvas = createCanvas(px.size)
      if (!canvas) return null
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
      if (!ctx) return null
      ctx.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, px.size, px.size), 0, 0)
      const tex = new THREE.CanvasTexture(canvas as HTMLCanvasElement)
      tex.userData.procedural = { kind: ref.procedural.kind, seed: ref.procedural.seed ?? 0, params: ref.procedural.params ?? {}, channel }
      return configure(tex, channel === 'color')
    }
    if (typeof Image === 'undefined') return null
    const url = 'url' in assets && typeof assets.url === 'function' ? await assets.url(ref.asset) : await bytesToUrl(assets, ref.asset)
    if (!url) return null
    return new Promise<THREE.Texture | null>((resolve) => {
      new THREE.TextureLoader().load(url, (t) => resolve(configure(t, channel === 'color')), undefined, () => resolve(null))
    })
  }
  const jobs: Promise<void>[] = []
  if (maps.color) jobs.push(fromRef(maps.color, 'color').then((t) => void (t && (m.map = t))))
  const normalRef = maps.normal ?? (maps.color && 'procedural' in maps.color ? maps.color : undefined)
  if (normalRef) jobs.push(fromRef(normalRef, 'normal').then((t) => void (t && (m.normalMap = t))))
  const roughRef = maps.roughness ?? (maps.color && 'procedural' in maps.color ? maps.color : undefined)
  if (roughRef) jobs.push(fromRef(roughRef, 'roughness').then((t) => void (t && (m.roughnessMap = t))))
  if (maps.metalness) jobs.push(fromRef(maps.metalness, 'roughness').then((t) => void (t && (m.metalnessMap = t))))
  if (maps.ao) jobs.push(fromRef(maps.ao, 'roughness').then((t) => void (t && (m.aoMap = t))))
  await Promise.all(jobs)
  m.needsUpdate = true
}

/** Textures need a 2D canvas: OffscreenCanvas (workers, modern browsers) or a DOM canvas; Node skips textures. */
function canRasterize(): boolean {
  return typeof OffscreenCanvas !== 'undefined' || (typeof document !== 'undefined' && typeof document.createElement === 'function')
}

function createCanvas(size: number): HTMLCanvasElement | OffscreenCanvas | null {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(size, size)
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas')
    c.width = c.height = size
    return c
  }
  return null
}

async function bytesToUrl(assets: AssetResolver, hash: string): Promise<string | null> {
  const buf = await assets.get(hash)
  if (!buf) return null
  return URL.createObjectURL(new Blob([buf]))
}

export type { GeometryService }
