// Export scene: prefers @cadsandbox/render's buildExportScene (baked procedural textures, exact
// renderer materials) and falls back to a builder working from GeometryService results + MaterialDefs.
import type { AnyNode, CadDocument, MaterialDef } from '@cadsandbox/doc'
import { TYPE_DEFAULT_MATERIAL, invertMatrix, multiplyMatrices } from '@cadsandbox/doc'
import type { AssetResolver, GeometryResult, GeometryService, MeshPart } from '@cadsandbox/geometry'
import type { BuildExportScene } from '@cadsandbox/render'
import type { Group, Material, Texture } from 'three'

let registered: BuildExportScene | null = null

/** Register the renderer's scene builder (call once at app start: setExportSceneBuilder(buildExportScene)). */
export function setExportSceneBuilder(fn: BuildExportScene | null): void {
  registered = fn
}

export async function resolveExportSceneBuilder(): Promise<BuildExportScene> {
  if (registered) return registered
  try {
    const mod = (await import('@cadsandbox/render')) as unknown as Record<string, unknown>
    const key = 'buildExportScene'
    if (typeof mod[key] === 'function') return mod[key] as BuildExportScene
  } catch {
    /* renderer not loadable here (e.g. headless) → fallback */
  }
  return buildFallbackExportScene
}

/** Build the export scene with the preferred builder; if it fails (e.g. a DOM-only code path in a
 *  worker or headless run) retry with the fallback so the export still succeeds (without baked
 *  procedural textures). */
export async function buildScene(
  ctx: { doc: CadDocument; geometry: GeometryService; assets: AssetResolver },
  opts: { selection?: string[]; textures?: boolean; yUp?: boolean },
): Promise<Group> {
  const builder = await resolveExportSceneBuilder()
  try {
    return await builder(ctx.doc, ctx.geometry, ctx.assets, opts)
  } catch (err) {
    if (builder === buildFallbackExportScene) throw err
    console.warn('[io] renderer export scene failed; using the fallback builder', err)
    return buildFallbackExportScene(ctx.doc, ctx.geometry, ctx.assets, opts)
  }
}

/** Every node to export with the matrix to use (instances expanded into their definitions). */
export function exportEntries(doc: CadDocument, geometry: GeometryService, selection?: string[]): { node: AnyNode; world: Float64Array; result: GeometryResult }[] {
  const out: { node: AnyNode; world: Float64Array; result: GeometryResult }[] = []
  const roots = selection?.length ? doc.topLevel(selection) : [...doc.getChildren(null)]
  const visit = (id: string, world: Float64Array | null, depth: number) => {
    if (depth > 32) return
    const node = doc.getNode(id) as AnyNode | undefined
    if (!node || !node.visible) return
    if (!world && !doc.isEffectivelyVisible(id)) return
    const w = world ? multiplyMatrices(world, doc.getWorldMatrix(id)) : doc.getWorldMatrix(id)
    if (node.type === 'instance') {
      const def = doc.getComponent((node as AnyNode & { params: { component: string } }).params.component)
      if (def && doc.hasNode(def.root)) {
        const base = multiplyMatrices(w, invertMatrix(doc.getWorldMatrix(def.root)))
        visit(def.root, base, depth + 1)
      }
      return
    }
    if (!geometry.isConsumed(id)) {
      const r = geometry.get(id)
      if (r && !r.error) out.push({ node, world: w, result: r })
    }
    for (const c of doc.getChildren(id)) visit(c, world, depth + 1)
  }
  for (const r of roots) visit(r, null, 0)
  return out
}

export function materialIdOf(node: AnyNode, part: MeshPart): string | null {
  if (part.material !== 'node') return part.material.id
  return node.material ?? TYPE_DEFAULT_MATERIAL[node.type] ?? 'mat-default'
}

async function textureFrom(three: typeof import('three'), assets: AssetResolver, hash: string, def: MaterialDef): Promise<Texture | null> {
  if (typeof createImageBitmap === 'undefined') return null
  const bytes = await assets.get(hash)
  if (!bytes) return null
  const bitmap = await createImageBitmap(new Blob([bytes]))
  const tex = new three.Texture(bitmap as unknown as HTMLImageElement)
  tex.flipY = true
  tex.wrapS = tex.wrapT = three.RepeatWrapping
  tex.colorSpace = three.SRGBColorSpace
  if (def.uv) {
    tex.repeat.set(1 / (def.uv.size[0] || 1), 1 / (def.uv.size[1] || 1))
    tex.rotation = def.uv.rotation
    tex.offset.set(def.uv.offset[0] / (def.uv.size[0] || 1), def.uv.offset[1] / (def.uv.size[1] || 1))
  }
  tex.needsUpdate = true
  return tex
}

/** MeshPhysicalMaterial for a MaterialDef (+ optional color override). */
export async function threeMaterial(three: typeof import('three'), def: MaterialDef | undefined, tint: string | null, assets: AssetResolver, textures: boolean): Promise<Material> {
  const d = def ?? ({ name: 'Default', color: '#cccccc', roughness: 0.6, metalness: 0, opacity: 1, transmission: 0, ior: 1.5 } as MaterialDef)
  const m = new three.MeshPhysicalMaterial({
    name: d.name,
    color: new three.Color(tint ?? d.color),
    roughness: d.roughness,
    metalness: d.metalness,
    opacity: d.opacity,
    transparent: d.opacity < 1,
    transmission: d.transmission,
    ior: d.ior,
    thickness: d.thickness ?? 0,
    clearcoat: d.clearcoat ?? 0,
    clearcoatRoughness: d.clearcoatRoughness ?? 0,
    sheen: d.sheen ?? 0,
    side: d.doubleSided ? three.DoubleSide : three.FrontSide,
  })
  if (d.sheenColor) m.sheenColor = new three.Color(d.sheenColor)
  if (d.emissive) {
    m.emissive = new three.Color(d.emissive)
    m.emissiveIntensity = d.emissiveIntensity ?? 1
  }
  m.userData = { materialId: d.id }
  if (textures && d.maps) {
    const load = async (ref: { asset: string } | { procedural: unknown } | undefined) => (ref && 'asset' in ref ? textureFrom(three, assets, ref.asset, d) : null)
    const [map, normal, rough, metal, ao] = await Promise.all([load(d.maps.color), load(d.maps.normal), load(d.maps.roughness), load(d.maps.metalness), load(d.maps.ao)])
    if (map) m.map = map
    if (normal) {
      normal.colorSpace = three.NoColorSpace
      m.normalMap = normal
      m.normalScale.set(d.normalScale ?? 1, d.normalScale ?? 1)
    }
    if (rough) (rough.colorSpace = three.NoColorSpace), (m.roughnessMap = rough)
    if (metal) (metal.colorSpace = three.NoColorSpace), (m.metalnessMap = metal)
    if (ao) (ao.colorSpace = three.NoColorSpace), (m.aoMap = ao)
  }
  return m
}

/** Fallback BuildExportScene (no procedural texture baking). */
export const buildFallbackExportScene: BuildExportScene = async (doc, geometry, assets, opts = {}) => {
  const three = await import('three')
  await geometry.idle()
  const group: Group = new three.Group()
  group.name = doc.meta.name
  const cache = new Map<string, Promise<Material>>()
  const matFor = (id: string | null, tint: string | null) => {
    const key = `${id}|${tint}`
    let p = cache.get(key)
    if (!p) cache.set(key, (p = threeMaterial(three, doc.getMaterial(id ?? 'mat-default'), tint, assets, !!opts.textures)))
    return p
  }
  for (const { node, world, result } of exportEntries(doc, geometry, opts.selection)) {
    for (const part of result.parts) {
      const m = part.mesh
      if (!m.positions.length) continue
      const g = new three.BufferGeometry()
      g.setAttribute('position', new three.BufferAttribute(m.positions, 3))
      if (m.normals?.length === m.positions.length) g.setAttribute('normal', new three.BufferAttribute(m.normals, 3))
      else g.computeVertexNormals()
      if (m.uvs && m.uvs.length === (m.positions.length / 3) * 2) g.setAttribute('uv', new three.BufferAttribute(m.uvs, 2))
      if (m.indices?.length) g.setIndex(new three.BufferAttribute(m.indices, 1))
      const mesh = new three.Mesh(g, await matFor(materialIdOf(node, part), part.material === 'node' ? node.color : null))
      mesh.name = node.name
      mesh.matrixAutoUpdate = false
      mesh.matrix.fromArray(Array.from(world))
      mesh.userData = { nodeId: node.id, nodeType: node.type }
      group.add(mesh)
    }
  }
  if (opts.yUp) group.rotation.x = -Math.PI / 2
  group.updateMatrixWorld(true)
  return group
}
