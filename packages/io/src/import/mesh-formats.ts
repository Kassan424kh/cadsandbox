// OBJ (+MTL), STL, PLY, 3MF, FBX and Collada importers (three.js example loaders, lazy-loaded).
import type { LoadingManager, Object3D } from 'three'
import type { MaterialDef, TextureRef } from '@cadsandbox/doc'
import type { ImportOptions, ImportResult } from '../api'
import { SnapshotBuilder, materialDef } from '../builder'
import { decodeText, exactBuffer, sniffImageMime, stem } from '../util/bytes'
import { MaterialConverter, ResourceMap, textureResolver } from './materials'
import { importObject3D, meshFromGeometry } from './three-scene'
import { threeMfUnitScale, unitScale } from './units'

type Progress = ImportOptions['onProgress']

/** Manager that serves dropped companion files and lets us wait for async texture loads. */
function resourceManager(three: typeof import('three'), resources: ResourceMap, b: SnapshotBuilder) {
  const manager: LoadingManager = new three.LoadingManager()
  let pending = 0
  let wake: (() => void) | null = null
  manager.setURLModifier((url) => {
    if (url.startsWith('data:') || url.startsWith('blob:')) return url
    const u = resources.url(url)
    if (u) return u
    // never fetch referenced URLs (GDPR): unresolved references load as empty data
    b.warn(`Missing referenced file: ${decodeURIComponent(url.split(/[\\/]/).pop() ?? url)}`)
    return 'data:,'
  })
  manager.itemStart = ((orig) => (url: string) => {
    pending++
    orig.call(manager, url)
  })(manager.itemStart)
  manager.itemEnd = ((orig) => (url: string) => {
    pending--
    orig.call(manager, url)
    if (pending <= 0) wake?.()
  })(manager.itemEnd)
  manager.itemError = ((orig) => (url: string) => {
    orig.call(manager, url)
  })(manager.itemError)
  const idle = () =>
    pending <= 0
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 30_000)
          wake = () => {
            clearTimeout(timer)
            resolve()
          }
        })
  return { manager, idle }
}

// ------------------------------------------------------------------ MTL
function mtlColor(parts: string[]): string {
  const [r, g, b] = parts.slice(0, 3).map((v) => Math.min(1, Math.max(0, parseFloat(v) || 0)))
  const h = (v: number | undefined) =>
    Math.round((v ?? 0) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${h(r)}${h(g ?? r)}${h(b ?? r)}`
}

/** Split `map_Kd -s 2 2 1 -bm 0.5 some file.png` into options + file name. */
function mtlMapArgs(args: string[]): { file: string; scale: [number, number] } {
  const counts: Record<string, number> = { '-blendu': 1, '-blendv': 1, '-cc': 1, '-clamp': 1, '-mm': 2, '-texres': 1, '-bm': 1, '-boost': 1, '-imfchan': 1, '-type': 1 }
  let scale: [number, number] = [1, 1]
  let i = 0
  while (i < args.length && args[i]!.startsWith('-')) {
    const opt = args[i]!.toLowerCase()
    i++
    if (opt === '-s' || opt === '-o' || opt === '-t') {
      const nums: number[] = []
      while (i < args.length && nums.length < 3 && /^-?\d*\.?\d+(e-?\d+)?$/i.test(args[i]!)) nums.push(parseFloat(args[i++]!))
      if (opt === '-s' && nums.length) scale = [nums[0]!, nums[1] ?? nums[0]!]
    } else i += counts[opt] ?? 0
  }
  return { file: args.slice(i).join(' '), scale }
}

async function parseMtl(text: string, resources: ResourceMap, b: SnapshotBuilder): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  let cur: MaterialDef | null = null
  let tile: [number, number] | null = null
  const flush = () => {
    if (!cur) return
    if (cur.maps && Object.keys(cur.maps).length) cur.uv = { size: tile ? [1 / tile[0], 1 / tile[1]] : [1, 1], rotation: 0, offset: [0, 0] }
    cur.category = cur.opacity < 0.6 ? 'glass' : cur.metalness > 0.5 ? 'metal' : 'generic'
    out.set(cur.name, b.material(cur))
  }
  const tex = async (args: string[]): Promise<TextureRef | undefined> => {
    const { file, scale } = mtlMapArgs(args)
    const res = file ? resources.find(file) : undefined
    if (!res) {
      if (file) b.warn(`Missing texture: ${file}`)
      return undefined
    }
    tile ??= scale
    return { asset: await b.asset(res.bytes, sniffImageMime(res.bytes) ?? 'application/octet-stream') }
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const [keyRaw, ...args] = line.split(/\s+/)
    const key = keyRaw!.toLowerCase()
    if (key === 'newmtl') {
      flush()
      cur = materialDef({ name: args.join(' ') || 'Material', roughness: 0.6 })
      tile = null
      continue
    }
    if (!cur) continue
    const num = parseFloat(args[0] ?? '')
    switch (key) {
      case 'kd':
        cur.color = mtlColor(args)
        break
      case 'ns':
        cur.roughness = Math.min(1, Math.max(0.03, Math.sqrt(2 / (Math.max(0, num) + 2))))
        break
      case 'd':
        if (Number.isFinite(num)) cur.opacity = Math.min(1, Math.max(0, num))
        break
      case 'tr':
        if (Number.isFinite(num)) cur.opacity = Math.min(1, Math.max(0, 1 - num))
        break
      case 'ni':
        if (num >= 1) cur.ior = num
        break
      case 'ke': {
        const c = mtlColor(args)
        if (c !== '#000000') {
          cur.emissive = c
          cur.emissiveIntensity = 1
        }
        break
      }
      case 'pr':
        cur.roughness = Math.min(1, Math.max(0, num))
        break
      case 'pm':
        cur.metalness = Math.min(1, Math.max(0, num))
        break
      case 'pc':
        cur.clearcoat = num
        break
      case 'pcr':
        cur.clearcoatRoughness = num
        break
      case 'map_kd': {
        const t = await tex(args)
        if (t) {
          cur.maps = { ...cur.maps, color: t }
          cur.color = '#ffffff'
        }
        break
      }
      case 'norm':
      case 'map_kn': {
        const t = await tex(args)
        if (t) cur.maps = { ...cur.maps, normal: t }
        break
      }
      case 'bump':
      case 'map_bump': {
        const t = await tex(args)
        // Many exporters write tangent-space normal maps as map_Bump.
        if (t) cur.maps = /norm|nrm|_n\./i.test(args.join(' ')) ? { ...cur.maps, normal: t } : { ...cur.maps, bump: t }
        break
      }
      case 'map_pr': {
        const t = await tex(args)
        if (t) cur.maps = { ...cur.maps, roughness: t }
        break
      }
      case 'map_pm': {
        const t = await tex(args)
        if (t) cur.maps = { ...cur.maps, metalness: t }
        break
      }
    }
  }
  flush()
  return out
}

export async function importObj(name: string, bytes: Uint8Array, resources: ResourceMap, opts: ImportOptions): Promise<ImportResult> {
  const text = decodeText(bytes)
  const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js')
  opts.onProgress?.(0.1, 'Parsing OBJ')
  const group = new OBJLoader().parse(text)
  const b = new SnapshotBuilder()
  const libs = [...text.matchAll(/^\s*mtllib\s+(.+?)\s*$/gm)].map((m) => m[1]!)
  const mtlTexts: string[] = []
  for (const lib of libs) {
    const f = resources.find(lib)
    if (f) mtlTexts.push(decodeText(f.bytes))
  }
  // Exporters often rename the .mtl without updating `mtllib`: fall back to every dropped .mtl.
  if (!mtlTexts.length) for (const f of resources.list('.mtl')) mtlTexts.push(decodeText(f.bytes))
  const mtl = new Map<string, string>()
  for (const t of mtlTexts) for (const [k, v] of await parseMtl(t, resources, b)) mtl.set(k, v)
  if (libs.length && !mtlTexts.length) b.warn(`Material library ${libs[0]} not found — drop it together with the .obj.`)
  await importObject3D(group, b, {
    name: stem(name),
    up: opts.upAxis ?? 'y',
    scale: unitScale(opts.units ?? 'm'),
    materials: new MaterialConverter(b, textureResolver(resources)),
    materialByName: (n) => mtl.get(n) ?? null,
    skipUnmappedMaterials: true,
    signal: opts.signal,
    onProgress: (f) => opts.onProgress?.(0.2 + 0.75 * f, 'Converting meshes'),
  })
  return b.result()
}

// ------------------------------------------------------------------ STL / PLY
export async function importStl(name: string, bytes: Uint8Array, opts: ImportOptions): Promise<ImportResult> {
  const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js')
  const geometry = new STLLoader().parse(exactBuffer(bytes))
  const b = new SnapshotBuilder()
  await importObject3D(await meshFromGeometry(geometry, stem(name)), b, {
    name: stem(name),
    up: opts.upAxis ?? 'z',
    scale: unitScale(opts.units ?? 'mm'),
    materials: new MaterialConverter(b, textureResolver(new ResourceMap())),
    skipUnmappedMaterials: true,
    materialByName: () => null,
    signal: opts.signal,
  })
  return b.result()
}

export async function importPly(name: string, bytes: Uint8Array, opts: ImportOptions): Promise<ImportResult> {
  const { PLYLoader } = await import('three/examples/jsm/loaders/PLYLoader.js')
  const geometry = new PLYLoader().parse(exactBuffer(bytes))
  if (!geometry.index && geometry.getAttribute('position')?.count && !/element\s+face\s+[1-9]/.test(decodeText(bytes.subarray(0, 4096)))) {
    throw new Error('This PLY file is a point cloud (no faces) — point clouds are not supported.')
  }
  const b = new SnapshotBuilder()
  await importObject3D(await meshFromGeometry(geometry, stem(name)), b, {
    name: stem(name),
    up: opts.upAxis ?? 'z',
    scale: unitScale(opts.units ?? 'm'),
    materials: new MaterialConverter(b, textureResolver(new ResourceMap())),
    skipUnmappedMaterials: true,
    materialByName: () => null,
    signal: opts.signal,
  })
  return b.result()
}

// ------------------------------------------------------------------ 3MF / FBX / DAE (browser: DOMParser, images)
function threeMfUnit(bytes: Uint8Array, unzip: (b: Uint8Array, o: { filter: (f: { name: string }) => boolean }) => Record<string, Uint8Array>): number {
  const files = unzip(bytes, { filter: (f) => /^3d\/.*\.model$/i.test(f.name) })
  const model = Object.values(files)[0]
  if (!model) return 0.001
  const head = new TextDecoder().decode(model.subarray(0, 4096))
  return threeMfUnitScale(/<model[^>]*\bunit\s*=\s*"([^"]+)"/i.exec(head)?.[1])
}

export async function importThreeMf(name: string, bytes: Uint8Array, opts: ImportOptions): Promise<ImportResult> {
  const [{ ThreeMFLoader }, { unzipSync }] = await Promise.all([import('three/examples/jsm/loaders/3MFLoader.js'), import('fflate')])
  const scale = opts.units ? unitScale(opts.units) : threeMfUnit(bytes, unzipSync)
  const group = new ThreeMFLoader().parse(exactBuffer(bytes))
  const b = new SnapshotBuilder()
  await importObject3D(group, b, {
    name: stem(name),
    up: opts.upAxis ?? 'z',
    scale,
    materials: new MaterialConverter(b, textureResolver(new ResourceMap())),
    signal: opts.signal,
    onProgress: (f) => opts.onProgress?.(0.2 + 0.75 * f, 'Converting meshes'),
  })
  return b.result()
}

async function loaderImport(name: string, root: Object3D, scale: number, up: 'y' | 'z', b: SnapshotBuilder, resources: ResourceMap, progress: Progress, signal?: AbortSignal): Promise<ImportResult> {
  try {
    await importObject3D(root, b, {
      name: stem(name),
      up,
      scale,
      materials: new MaterialConverter(b, textureResolver(resources)),
      signal,
      onProgress: (f) => progress?.(0.3 + 0.65 * f, 'Converting meshes'),
    })
  } finally {
    resources.dispose()
  }
  return b.result()
}

export async function importFbx(name: string, bytes: Uint8Array, resources: ResourceMap, opts: ImportOptions): Promise<ImportResult> {
  const [three, { FBXLoader }] = await Promise.all([import('three'), import('three/examples/jsm/loaders/FBXLoader.js')])
  const b = new SnapshotBuilder()
  const { manager, idle } = resourceManager(three, resources, b)
  opts.onProgress?.(0.1, 'Parsing FBX')
  const group = new FBXLoader(manager).parse(exactBuffer(bytes), '')
  await idle()
  // FBX stores UnitScaleFactor in centimeters per file unit (1 = cm).
  const factor = Number(group.userData?.unitScaleFactor) || 1
  const scale = opts.units ? unitScale(opts.units) : factor * 0.01
  if (group.animations?.length) b.warn('Animations are not imported (static pose).')
  return loaderImport(name, group, scale, opts.upAxis ?? 'y', b, resources, opts.onProgress, opts.signal)
}

export async function importDae(name: string, bytes: Uint8Array, resources: ResourceMap, opts: ImportOptions): Promise<ImportResult> {
  const [three, { ColladaLoader }] = await Promise.all([import('three'), import('three/examples/jsm/loaders/ColladaLoader.js')])
  const b = new SnapshotBuilder()
  const { manager, idle } = resourceManager(three, resources, b)
  opts.onProgress?.(0.1, 'Parsing Collada')
  const collada = new ColladaLoader(manager).parse(decodeText(bytes), '')
  if (!collada?.scene) throw new Error('Not a valid Collada file.')
  await idle()
  // The loader already converted <unit> to meters and Z_UP to Y-up.
  return loaderImport(name, collada.scene, 1, opts.upAxis ?? 'y', b, resources, opts.onProgress, opts.signal)
}
