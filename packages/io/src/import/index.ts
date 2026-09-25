// Import entry points: single files and multi-file drops (OBJ + MTL + textures, glTF + .bin, …), also
// zipped (our own OBJ export is a .zip). Every format module is loaded on demand so the app never pays
// for loaders it does not use.
import type { ImportFormat, ImportOptions, ImportResult, ImportSource } from '../api'
import { IMPORT_FORMATS, detectFormat } from '../formats'
import { sourceBytes, startsWith, throwIfAborted } from '../util/bytes'
import { ResourceMap } from './materials'

interface Loaded {
  name: string
  bytes: Uint8Array
  format: ImportFormat | null
}

/** Formats that are a model of their own (everything else in a drop is a companion resource). */
const PRIMARY: ReadonlySet<ImportFormat> = new Set<ImportFormat>(['glb', 'gltf', 'obj', 'stl', 'ply', '3mf', 'fbx', 'dae', '3dm', 'step', 'iges', 'brep', 'ifc', 'dxf', 'svg', 'pdf', 'csb', 'csbx'])
/** Formats that are zip packages themselves — never unpacked as a container of files. */
const ZIP_FORMATS: ReadonlySet<ImportFormat> = new Set<ImportFormat>(['3mf', 'csbx'])
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]
/** Folders and OS metadata inside zips (macOS resource forks, Finder/Explorer caches). */
const isZipJunk = (path: string) => path.endsWith('/') || path.startsWith('__MACOSX/') || /(^|\/)(\._[^/]*|\.DS_Store|Thumbs\.db)$/i.test(path)

/** The files inside a plain zip (e.g. model.obj + model.mtl + textures/…), as if dropped together. */
async function unpackZip(name: string, bytes: Uint8Array): Promise<Loaded[]> {
  const { unzipSync } = await import('fflate')
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(bytes, { filter: (f) => !isZipJunk(f.name) })
  } catch {
    throw new Error(`${name} is not a valid zip archive.`)
  }
  return Object.entries(entries).map(([path, data]) => ({ name: path, bytes: data, format: detectFormat(path, data) }))
}

async function importOne(f: Loaded, format: ImportFormat, resources: ResourceMap, opts: ImportOptions): Promise<ImportResult> {
  switch (format) {
    case 'glb':
    case 'gltf':
      return (await import('./gltf')).importGltf(f.name, f.bytes, resources, opts)
    case 'obj':
      return (await import('./mesh-formats')).importObj(f.name, f.bytes, resources, opts)
    case 'stl':
      return (await import('./mesh-formats')).importStl(f.name, f.bytes, opts)
    case 'ply':
      return (await import('./mesh-formats')).importPly(f.name, f.bytes, opts)
    case '3mf':
      return (await import('./mesh-formats')).importThreeMf(f.name, f.bytes, opts)
    case 'fbx':
      return (await import('./mesh-formats')).importFbx(f.name, f.bytes, resources, opts)
    case 'dae':
      return (await import('./mesh-formats')).importDae(f.name, f.bytes, resources, opts)
    case '3dm':
      return (await import('./rhino')).importRhino(f.name, f.bytes, opts)
    case 'step':
    case 'iges':
    case 'brep':
      return (await import('./occt')).importOcct(format, f.name, f.bytes, opts)
    case 'ifc':
      return (await import('./ifc')).importIfc(f.name, f.bytes, opts)
    case 'dxf':
      return (await import('./dxf')).importDxf(f.name, f.bytes, opts)
    case 'svg':
      return (await import('./svg')).importSvg(f.name, f.bytes, opts)
    case 'image':
      return (await import('./simple')).importImage(f.name, f.bytes, opts)
    case 'pdf':
      return (await import('./pdf')).importPdf(f.name, f.bytes, opts)
    case 'csb':
      return (await import('./simple')).importCsb(f.bytes)
    case 'csbx':
      return (await import('./simple')).importCsbxDesign(f.bytes)
  }
}

function mergeResults(results: ImportResult[]): ImportResult {
  if (results.length === 1) return results[0]!
  const out: ImportResult = {
    snapshot: { format: 'cadsandbox/nodes@1', nodes: [], materials: [], components: [], componentNodes: [], assets: [] },
    assets: [],
    warnings: [],
  }
  const seenAssets = new Set<string>()
  let min: [number, number, number] | null = null,
    max: [number, number, number] | null = null
  for (const r of results) {
    const s = r.snapshot
    out.snapshot.nodes.push(...s.nodes)
    out.snapshot.materials.push(...s.materials)
    out.snapshot.components.push(...s.components)
    out.snapshot.componentNodes.push(...s.componentNodes)
    for (const h of s.assets) if (!out.snapshot.assets.includes(h)) out.snapshot.assets.push(h)
    for (const a of r.assets) if (!seenAssets.has(a.hash)) (seenAssets.add(a.hash), out.assets.push(a))
    out.warnings.push(...r.warnings)
    if (r.layers?.length) out.layers = [...(out.layers ?? []), ...r.layers]
    if (s.bounds) {
      min = min ? [Math.min(min[0], s.bounds.min[0]), Math.min(min[1], s.bounds.min[1]), Math.min(min[2], s.bounds.min[2])] : [...s.bounds.min]
      max = max ? [Math.max(max[0], s.bounds.max[0]), Math.max(max[1], s.bounds.max[1]), Math.max(max[2], s.bounds.max[2])] : [...s.bounds.max]
    }
  }
  if (min && max) out.snapshot.bounds = { min, max }
  return out
}

/**
 * Import several files dropped together. Model files are imported (and merged); the remaining files
 * (MTL, textures, .bin buffers) serve as their companion resources. A plain .zip (e.g. an OBJ export:
 * .obj + .mtl + textures, or glTF + .bin + textures) is unpacked and treated the same way.
 */
export async function importFiles(files: ImportSource[], opts: ImportOptions = {}): Promise<ImportResult> {
  return importSources(files, opts, null)
}

async function importSources(files: ImportSource[], opts: ImportOptions, forced: ImportFormat | null): Promise<ImportResult> {
  if (!files.length) throw new Error('No files to import.')
  const loaded: Loaded[] = []
  const zips: string[] = []
  for (const [i, f] of files.entries()) {
    throwIfAborted(opts.signal)
    const bytes = await sourceBytes(f)
    const format = i === 0 && forced ? forced : detectFormat(f.name, bytes)
    // A plain zip is a container: its model(s) are imported with the other entries as their resources.
    if (startsWith(bytes, ZIP_MAGIC) && !(format && ZIP_FORMATS.has(format))) {
      zips.push(f.name)
      loaded.push(...(await unpackZip(f.name, bytes)))
      continue
    }
    loaded.push({ name: f.name, bytes, format })
  }
  let primaries = loaded.filter((f) => f.format && PRIMARY.has(f.format))
  if (!primaries.length) primaries = loaded.filter((f) => f.format === 'image')
  if (!primaries.length) {
    if (zips.length) throw new Error(`No supported model file found in ${zips.join(', ')}.`)
    const names = loaded.map((f) => f.name).join(', ')
    throw new Error(`Unsupported file type: ${names}. DWG files are not supported — please save them as DXF.`)
  }
  const resources = new ResourceMap(loaded.filter((f) => !primaries.includes(f)))
  const results: ImportResult[] = []
  for (let i = 0; i < primaries.length; i++) {
    const f = primaries[i]!
    const sub: ImportOptions = {
      ...opts,
      onProgress: opts.onProgress ? (fr, msg) => opts.onProgress!((i + fr) / primaries.length, primaries.length > 1 ? `${f.name}: ${msg}` : msg) : undefined,
    }
    results.push(await importOne(f, f.format!, resources, sub))
  }
  return mergeResults(results)
}

/**
 * Import one file (or in-memory data with a file name). The format is detected from the content and
 * name; `importFile(blob, 'dxf', opts)` forces it (and allows name-less Blobs). A plain .zip of model
 * files is unpacked (see importFiles).
 */
export function importFile(file: ImportSource | Blob, formatOrOpts?: ImportFormat | ImportOptions, maybeOpts?: ImportOptions): Promise<ImportResult> {
  const forced = typeof formatOrOpts === 'string' ? formatOrOpts : null
  const opts = (typeof formatOrOpts === 'string' ? maybeOpts : formatOrOpts) ?? {}
  let src: ImportSource
  if ('name' in file && typeof file.name === 'string') src = file as ImportSource
  else {
    const ext = forced ? (IMPORT_FORMATS.find((f) => f.id === forced)?.extensions[0] ?? '') : ''
    src = { name: `import${ext}`, data: file as Blob }
  }
  return importSources([src], opts, forced)
}
