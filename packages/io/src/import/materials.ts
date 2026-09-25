// three.js Material → MaterialDef (+ texture blobs). Keeps the original image bytes whenever the
// source file provides them (glTF buffer views, dropped texture files, data/blob URLs); only
// decoded-only images are re-encoded as PNG (browser only).
import type { Color, Material, MeshPhongMaterial, MeshPhysicalMaterial, MeshStandardMaterial, Texture } from 'three'
import type { MaterialDef, TextureRef } from '@cadsandbox/doc'
import { materialDef, type SnapshotBuilder } from '../builder'
import { basename, sniffImageMime } from '../util/bytes'

export interface ResolvedImage {
  bytes: Uint8Array
  mime: string
}
export type TextureResolver = (tex: Texture) => Promise<ResolvedImage | null>

const hex = (c: Color | undefined | null, fallback = '#cccccc'): string => (c ? `#${c.getHexString()}` : fallback)
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** Resource files of a multi-file drop, looked up by (case-insensitive) base name or URL. */
export class ResourceMap {
  private readonly byName = new Map<string, { bytes: Uint8Array; name: string }>()
  private readonly urls = new Map<string, { bytes: Uint8Array; name: string }>()
  private readonly created: string[] = []

  constructor(files: { name: string; bytes: Uint8Array }[] = []) {
    for (const f of files) this.byName.set(basename(f.name).toLowerCase(), f)
  }
  get size(): number {
    return this.byName.size
  }
  /** Dropped files with the given extension (e.g. '.mtl'). */
  list(ext: string): { bytes: Uint8Array; name: string }[] {
    return [...this.byName.values()].filter((f) => f.name.toLowerCase().endsWith(ext))
  }
  find(ref: string): { bytes: Uint8Array; name: string } | undefined {
    const direct = this.urls.get(ref)
    if (direct) return direct
    let clean = ref
    try {
      clean = decodeURIComponent(ref)
    } catch {
      /* keep raw */
    }
    clean = clean.split(/[?#]/)[0]!
    return this.byName.get(basename(clean).toLowerCase())
  }
  /** Object URL for a resource (for loaders that fetch by URL). Revoke with dispose(). */
  url(ref: string): string | null {
    const f = this.find(ref)
    if (!f || typeof URL.createObjectURL !== 'function') return null
    const u = URL.createObjectURL(new Blob([f.bytes.slice()]))
    this.urls.set(u, f)
    this.created.push(u)
    return u
  }
  dispose(): void {
    for (const u of this.created) URL.revokeObjectURL(u)
    this.created.length = 0
  }
}

function dataUrlBytes(url: string): ResolvedImage | null {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(url)
  if (!m) return null
  const raw = m[2] ? atob(m[3]!) : decodeURIComponent(m[3]!)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i) & 0xff
  return { bytes, mime: sniffImageMime(bytes) ?? (m[1] || 'application/octet-stream') }
}

/** Encode a decoded image (ImageBitmap/HTMLImageElement/canvas/RGBA data) as PNG (browser only). */
async function encodePng(image: unknown): Promise<ResolvedImage | null> {
  if (typeof OffscreenCanvas === 'undefined' || !image || typeof image !== 'object') return null
  const img = image as { width?: number; height?: number; data?: ArrayLike<number> }
  const w = img.width ?? 0,
    h = img.height ?? 0
  if (!w || !h) return null
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  if (img.data && img.data.length >= w * h * 4) {
    const rgba = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < rgba.length; i++) rgba[i] = img.data[i]!
    ctx.putImageData(new ImageData(rgba, w, h), 0, 0)
  } else ctx.drawImage(image as CanvasImageSource, 0, 0)
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/png' }
}

/** Default chain: custom → dropped resources → data:/blob: URLs → PNG re-encode. */
export function textureResolver(resources: ResourceMap, custom?: TextureResolver): TextureResolver {
  return async (tex) => {
    const fromCustom = custom ? await custom(tex) : null
    if (fromCustom) return fromCustom
    const image = (tex.source?.data ?? tex.image) as { src?: string; currentSrc?: string } | undefined
    const src = image?.currentSrc || image?.src || (tex.userData?.url as string | undefined) || tex.name
    if (typeof src === 'string' && src) {
      const res = resources.find(src)
      if (res) return { bytes: res.bytes, mime: sniffImageMime(res.bytes) ?? 'application/octet-stream' }
      if (src.startsWith('data:')) return dataUrlBytes(src)
      if (src.startsWith('blob:')) {
        try {
          const bytes = new Uint8Array(await (await fetch(src)).arrayBuffer()) // same-origin object URL, no network
          return { bytes, mime: sniffImageMime(bytes) ?? 'image/png' }
        } catch {
          /* fall through */
        }
      }
    }
    return encodePng(tex.source?.data ?? tex.image)
  }
}

export class MaterialConverter {
  private readonly cache = new Map<Material, Promise<string>>()
  private readonly textures = new Map<unknown, Promise<TextureRef | undefined>>()

  constructor(
    private readonly b: SnapshotBuilder,
    private readonly resolve: TextureResolver,
  ) {}

  convert(mat: Material): Promise<string> {
    let p = this.cache.get(mat)
    if (!p) {
      p = this.build(mat)
      this.cache.set(mat, p)
    }
    return p
  }

  private texture(t: Texture | null | undefined): Promise<TextureRef | undefined> {
    if (!t) return Promise.resolve(undefined)
    const key = t.source ?? t
    let p = this.textures.get(key)
    if (!p) {
      p = (async () => {
        try {
          const img = await this.resolve(t)
          if (!img) {
            this.b.warn('Some textures could not be read and were skipped.')
            return undefined
          }
          return { asset: await this.b.asset(img.bytes, img.mime) }
        } catch {
          this.b.warn('Some textures could not be read and were skipped.')
          return undefined
        }
      })()
      this.textures.set(key, p)
    }
    return p
  }

  private async build(mat: Material): Promise<string> {
    const std = mat as MeshStandardMaterial & Partial<MeshPhysicalMaterial>
    const phong = mat as MeshPhongMaterial
    const def: MaterialDef = materialDef({ name: mat.name || 'Material' })
    const withColor = mat as Material & { color?: Color; map?: Texture | null }
    def.color = hex(withColor.color)
    def.opacity = mat.transparent ? clamp01(mat.opacity) : 1
    if (mat.side === 2) def.doubleSided = true
    if ((std as { isMeshStandardMaterial?: boolean }).isMeshStandardMaterial) {
      def.roughness = clamp01(std.roughness)
      def.metalness = clamp01(std.metalness)
      if (std.isMeshPhysicalMaterial) {
        def.transmission = clamp01(std.transmission ?? 0)
        def.ior = std.ior ?? 1.5
        if (std.thickness) def.thickness = std.thickness
        if (std.clearcoat) {
          def.clearcoat = std.clearcoat
          def.clearcoatRoughness = std.clearcoatRoughness ?? 0
        }
        if (std.sheen) {
          def.sheen = std.sheen
          def.sheenColor = hex(std.sheenColor, '#ffffff')
        }
      }
      if (std.normalMap) def.normalScale = std.normalScale?.x ?? 1
    } else if ((phong as { isMeshPhongMaterial?: boolean }).isMeshPhongMaterial) {
      def.roughness = clamp01(Math.sqrt(2 / (Math.max(0, phong.shininess) + 2)))
      def.metalness = 0
    } else {
      def.roughness = 0.9
    }
    const emissive = (mat as Material & { emissive?: Color; emissiveIntensity?: number }).emissive
    if (emissive && (emissive.r > 0.001 || emissive.g > 0.001 || emissive.b > 0.001)) {
      def.emissive = hex(emissive)
      def.emissiveIntensity = (mat as { emissiveIntensity?: number }).emissiveIntensity ?? 1
    }
    const any = mat as Material & Record<string, Texture | null | undefined>
    const [color, normal, roughness, metalness, ao, bump] = await Promise.all([
      this.texture(withColor.map),
      this.texture(any.normalMap),
      this.texture(any.roughnessMap),
      this.texture(any.metalnessMap),
      this.texture(any.aoMap),
      this.texture(any.bumpMap),
    ])
    const maps: NonNullable<MaterialDef['maps']> = {}
    if (color) maps.color = color
    if (normal) maps.normal = normal
    if (roughness) maps.roughness = roughness
    if (metalness) maps.metalness = metalness
    if (ao) maps.ao = ao
    if (bump) maps.bump = bump
    if (Object.keys(maps).length) {
      def.maps = maps
      // Imported meshes carry their own UVs in texture space: one tile = one UV unit.
      const t = withColor.map ?? any.normalMap ?? null
      const rx = t?.repeat.x || 1,
        ry = t?.repeat.y || 1
      def.uv = { size: [1 / rx, 1 / ry], rotation: t?.rotation ?? 0, offset: [(t?.offset.x ?? 0) / rx, (t?.offset.y ?? 0) / ry] }
      if (color) def.color = hex(withColor.color, '#ffffff')
    }
    def.category = def.transmission > 0.3 || def.opacity < 0.6 ? 'glass' : def.metalness > 0.5 ? 'metal' : def.emissive ? 'light' : 'generic'
    return this.b.material(def)
  }
}
