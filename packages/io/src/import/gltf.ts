// glTF 2.0 / GLB import: GLTFLoader with self-hosted DRACO + meshopt decoders. Texture blobs are the
// ORIGINAL image bytes from the file (buffer views / data URIs / dropped files), not re-encodings.
import type { Texture } from 'three'
import type { GLTF, GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { ImportOptions, ImportResult } from '../api'
import { SnapshotBuilder } from '../builder'
import { decodeText, exactBuffer, sniffImageMime, stem } from '../util/bytes'
import { loadDracoLoader } from '../wasm'
import { MaterialConverter, ResourceMap, textureResolver, type ResolvedImage } from './materials'
import { importObject3D } from './three-scene'
import { unitScale } from './units'

interface GltfJson {
  asset?: { generator?: string; version?: string }
  extensionsRequired?: string[]
  textures?: { source?: number; extensions?: Record<string, { source?: number }> }[]
  images?: { uri?: string; bufferView?: number; mimeType?: string }[]
}

function glbJson(bytes: Uint8Array): GltfJson | null {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length < 20 || dv.getUint32(0, true) !== 0x46546c67) return null
  const len = dv.getUint32(12, true)
  if (dv.getUint32(16, true) !== 0x4e4f534a) return null
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + len))) as GltfJson
}

const UNSUPPORTED_REQUIRED = new Set(['KHR_texture_basisu'])

interface PackableJson extends GltfJson {
  buffers?: { uri?: string; byteLength: number; extensions?: Record<string, unknown> }[]
  bufferViews?: { buffer: number; byteOffset?: number; extensions?: Record<string, { buffer?: number; byteOffset?: number }> }[]
}

function dataUri(uri: string): Uint8Array | null {
  const m = /^data:[^,]*?(;base64)?,(.*)$/s.exec(uri)
  if (!m) return null
  const raw = m[1] ? atob(m[2]!) : decodeURIComponent(m[2]!)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i) & 0xff
  return out
}

/** Pack a .gltf and its buffers (data URIs or dropped .bin files) into one in-memory GLB, so the
 *  loader never has to fetch buffers (images keep their URIs). */
export function packGltf(json: PackableJson, resources: ResourceMap): ArrayBuffer {
  const buffers = json.buffers ?? []
  const offsets: number[] = []
  const parts: Uint8Array[] = []
  let total = 0
  for (const b of buffers) {
    let bytes: Uint8Array | null = null
    if (b.uri) bytes = b.uri.startsWith('data:') ? dataUri(b.uri) : (resources.find(b.uri)?.bytes ?? null)
    else if (b.extensions?.EXT_meshopt_compression) bytes = new Uint8Array(b.byteLength) // fallback buffer, never read
    if (!bytes) throw new Error(`Missing glTF buffer "${b.uri ?? '(embedded)'}" — drop the .bin file together with the .gltf.`)
    offsets.push(total)
    parts.push(bytes)
    total += Math.ceil(bytes.length / 4) * 4
  }
  for (const bv of json.bufferViews ?? []) {
    bv.byteOffset = (bv.byteOffset ?? 0) + (offsets[bv.buffer] ?? 0)
    bv.buffer = 0
    const mo = bv.extensions?.EXT_meshopt_compression
    if (mo && typeof mo.buffer === 'number') {
      mo.byteOffset = (mo.byteOffset ?? 0) + (offsets[mo.buffer] ?? 0)
      mo.buffer = 0
    }
  }
  json.buffers = total ? [{ byteLength: total }] : []
  const bin = new Uint8Array(total)
  parts.forEach((p, i) => bin.set(p, offsets[i]!))
  const text = new TextEncoder().encode(JSON.stringify(json))
  const jsonLen = Math.ceil(text.length / 4) * 4
  const size = 12 + 8 + jsonLen + (total ? 8 + total : 0)
  const out = new Uint8Array(size)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, 0x46546c67, true)
  dv.setUint32(4, 2, true)
  dv.setUint32(8, size, true)
  dv.setUint32(12, jsonLen, true)
  dv.setUint32(16, 0x4e4f534a, true)
  out.fill(0x20, 20, 20 + jsonLen)
  out.set(text, 20)
  if (total) {
    dv.setUint32(20 + jsonLen, total, true)
    dv.setUint32(24 + jsonLen, 0x004e4942, true)
    out.set(bin, 28 + jsonLen)
  }
  return out.buffer
}

export async function importGltf(name: string, bytes: Uint8Array, resources: ResourceMap, opts: ImportOptions): Promise<ImportResult> {
  const binary = name.toLowerCase().endsWith('.glb') || (bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46)
  const json: GltfJson | null = binary ? glbJson(bytes) : (JSON.parse(decodeText(bytes)) as GltfJson)
  if (!json) throw new Error('Not a valid glTF file.')
  for (const ext of json.extensionsRequired ?? []) {
    if (UNSUPPORTED_REQUIRED.has(ext)) throw new Error(`This glTF requires the unsupported extension ${ext}.`)
  }
  const [{ GLTFLoader }, { LoadingManager }, { MeshoptDecoder }] = await Promise.all([
    import('three/examples/jsm/loaders/GLTFLoader.js'),
    import('three'),
    import('three/examples/jsm/libs/meshopt_decoder.module.js'),
  ])
  const manager = new LoadingManager()
  const missing = new Set<string>()
  manager.setURLModifier((url) => {
    if (url.startsWith('data:') || url.startsWith('blob:')) return url
    const u = resources.url(url)
    if (u) return u
    // never fetch anything (GDPR: no third-party or even same-origin requests for file contents)
    missing.add(url.split('/').pop() ?? url)
    return 'data:,'
  })
  const loader = new GLTFLoader(manager)
  loader.setMeshoptDecoder(MeshoptDecoder)
  const draco = await loadDracoLoader()
  if (draco) loader.setDRACOLoader(draco)

  opts.onProgress?.(0.1, 'Parsing glTF')
  // Object URLs of dropped resources stay alive until texture bytes were collected (dispose below).
  const gltf: GLTF = await loader.parseAsync(binary ? exactBuffer(bytes) : packGltf(json as PackableJson, resources), '')
  const parser: GLTFParser = gltf.parser
  const imageBytes = async (tex: Texture): Promise<ResolvedImage | null> => {
    const assoc = parser.associations.get(tex) as { textures?: number } | undefined
    const ti = assoc?.textures
    if (ti === undefined) return null
    const def = json.textures?.[ti]
    const src = def?.extensions?.EXT_texture_webp?.source ?? def?.extensions?.EXT_texture_avif?.source ?? def?.source
    const img = src !== undefined ? json.images?.[src] : undefined
    if (!img) return null
    if (img.bufferView !== undefined) {
      const buf = (await parser.getDependency('bufferView', img.bufferView)) as ArrayBuffer
      const b = new Uint8Array(buf.slice(0))
      return { bytes: b, mime: sniffImageMime(b) ?? img.mimeType ?? 'image/png' }
    }
    if (img.uri && !img.uri.startsWith('data:')) {
      const r = resources.find(img.uri)
      if (r) return { bytes: r.bytes, mime: sniffImageMime(r.bytes) ?? img.mimeType ?? 'image/png' }
    }
    return null // data: URIs are handled by the generic resolver
  }

  const b = new SnapshotBuilder()
  const materials = new MaterialConverter(b, textureResolver(resources, imageBytes))
  const scene = gltf.scene ?? gltf.scenes?.[0]
  if (!scene) throw new Error('The glTF file contains no scene.')
  try {
    await importObject3D(scene, b, {
      name: stem(name),
      up: opts.upAxis ?? 'y',
      scale: opts.units ? unitScale(opts.units) : 1,
      flipV: true,
      materials,
      meta: json.asset?.generator ? { source: { format: 'gltf', generator: json.asset.generator } } : {},
      signal: opts.signal,
      onProgress: (f) => opts.onProgress?.(0.2 + f * 0.75, 'Converting meshes'),
    })
  } finally {
    resources.dispose()
  }
  if (missing.size) b.warn(`Missing external files: ${[...missing].slice(0, 5).join(', ')}${missing.size > 5 ? '…' : ''} — drop them together with the .gltf.`)
  if (gltf.animations?.length) b.warn('Animations are not imported (static pose).')
  return b.result()
}
