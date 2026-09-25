// Image underlays and native CadSandbox files (.csb design JSON, .csbx project archive).
import { CadDocument } from '@cadsandbox/doc'
import type { DocJSON } from '@cadsandbox/doc'
import type { ImportOptions, ImportResult } from '../api'
import { importProjectArchive } from '../archive'
import { SnapshotBuilder } from '../builder'
import { decodeText, imageSize, sniffImageMime, stem } from '../util/bytes'
import { unitScale } from './units'

/** Raster image → 'image' underlay node with pixel-accurate aspect. Default 1 px = 1 cm. */
export async function importImage(name: string, bytes: Uint8Array, opts: ImportOptions): Promise<ImportResult> {
  const mime = sniffImageMime(bytes)
  if (!mime || !['image/png', 'image/jpeg', 'image/webp'].includes(mime)) throw new Error('Unsupported image type (use PNG, JPEG or WebP).')
  const size = imageSize(bytes)
  if (!size || !size.width || !size.height) throw new Error('Could not read the image size.')
  const perPx = opts.units ? unitScale(opts.units) : 0.01
  const b = new SnapshotBuilder()
  const asset = await b.asset(bytes, mime)
  const width = size.width * perPx,
    height = size.height * perPx
  b.add('image', {
    name: stem(name),
    parent: null,
    meta: { image: { pixels: [size.width, size.height], metersPerPixel: perPx } },
    params: { asset, width, height, opacity: 1 },
  })
  b.expand([
    [-width / 2, -height / 2, 0],
    [width / 2, height / 2, 0],
  ])
  if (!opts.units) b.warn('Image placed at 1 px = 1 cm — use the measure/scale tool to calibrate it.')
  return b.result()
}

/** Snapshot of every root of a design (roots in world space, with components and materials). */
function snapshotAll(doc: CadDocument): ImportResult['snapshot'] {
  const roots = doc.getChildren(null)
  return doc.snapshot([...roots])
}

export async function importCsb(bytes: Uint8Array): Promise<ImportResult> {
  let json: DocJSON
  try {
    json = JSON.parse(decodeText(bytes)) as DocJSON
  } catch {
    throw new Error('Not a CadSandbox design file (invalid JSON).')
  }
  if (json?.format !== 'cadsandbox/doc@1') throw new Error('Not a CadSandbox design file.')
  const doc = CadDocument.fromJSON(json)
  try {
    const snapshot = snapshotAll(doc)
    const warnings: string[] = []
    if (snapshot.assets.length)
      warnings.push(`${snapshot.assets.length} referenced file(s) (textures, meshes, images) are not stored in .csb files — use a .csbx project archive to transfer them.`)
    return { snapshot, assets: [], warnings, document: json, layers: json.layers }
  } finally {
    doc.destroy()
  }
}

export async function importCsbxDesign(bytes: Uint8Array): Promise<ImportResult> {
  const archive = await importProjectArchive(bytes)
  const main = archive.manifest.info.mainFile
  const fileId = main && archive.designs.has(main) ? main : [...archive.designs.keys()][0]
  if (!fileId) throw new Error('The project archive contains no designs.')
  const doc = archive.designs.get(fileId)!
  const snapshot = snapshotAll(doc)
  const used = new Set(snapshot.assets)
  const warnings: string[] = []
  if (archive.designs.size > 1) warnings.push(`This project has ${archive.designs.size} designs; only "${archive.manifest.getFile(fileId)?.name ?? 'Main'}" was imported. Use "Open project" to import all of them.`)
  const result: ImportResult = { snapshot, assets: archive.assets.filter((a) => used.has(a.hash)), warnings, document: doc.toJSON(), layers: doc.listLayers() }
  for (const d of archive.designs.values()) d.destroy()
  archive.manifest.destroy()
  return result
}
