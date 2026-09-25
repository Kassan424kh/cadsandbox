// Export entry point. Each format module is loaded on demand.
import { ProjectManifest } from '@cadsandbox/doc'
import type { ExportContext, ExportFormat, ExportOptions, ExportResult, ImportedAsset } from '../api'
import { exportProjectArchive } from '../archive'
import { CSBM_MIME } from '../csbm'
import { CSBM_MAGIC } from '@cadsandbox/geometry'
import { blobOf, safeFileName, sniffImageMime } from '../util/bytes'

/** Every blob a design references (meshes, images, textures, env maps), fetched from the store. */
export async function collectDesignAssets(ctx: Pick<ExportContext, 'doc' | 'assets'>): Promise<{ assets: ImportedAsset[]; missing: string[] }> {
  const doc = ctx.doc
  const hashes = new Set(doc.snapshot([...doc.getChildren(null)]).assets)
  for (const m of doc.docMaterials()) for (const ref of Object.values(m.maps ?? {})) if (ref && 'asset' in ref) hashes.add(ref.asset)
  if (doc.meta.render.envAsset) hashes.add(doc.meta.render.envAsset)
  const assets: ImportedAsset[] = []
  const missing: string[] = []
  for (const hash of hashes) {
    const buf = await ctx.assets.get(hash)
    if (!buf) {
      missing.push(hash)
      continue
    }
    const bytes = new Uint8Array(buf)
    const csbm = bytes.length >= 4 && new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true) === CSBM_MAGIC
    assets.push({ hash, bytes, mime: csbm ? CSBM_MIME : (sniffImageMime(bytes) ?? 'application/octet-stream') })
  }
  return { assets, missing }
}

/** Export the design (or a plan/sheet/schedule of it) in the given format. */
export async function exportFile(ctx: ExportContext, format: ExportFormat, opts: ExportOptions = {}): Promise<ExportResult> {
  const base = safeFileName(ctx.doc.meta.name, 'design')
  switch (format) {
    case 'glb':
    case 'gltf':
    case 'obj':
    case 'stl':
    case 'ply':
    case 'usdz':
      return (await import('./mesh')).exportMesh(ctx, format, opts)
    case '3mf':
      return (await import('./threemf')).export3mf(ctx, opts)
    case 'ifc':
      return (await import('./ifc')).exportIfc(ctx, opts)
    case 'dxf':
      return (await import('./dxf')).exportDxf(ctx, opts)
    case 'svg':
      return (await import('./svg')).exportSvg(ctx, opts)
    case 'pdf': {
      const pdf = await import('./pdf')
      return opts.sheetId ? pdf.exportSheetPdf(ctx, opts.sheetId) : pdf.exportPlanPdf(ctx, opts)
    }
    case 'png': {
      if (!ctx.editor) throw new Error('PNG export needs an open 3D view.')
      const blob = await ctx.editor.screenshot({ width: opts.width, height: opts.height, mime: 'image/png' })
      return { blob, fileName: `${base}.png` }
    }
    case 'csv':
      return (await import('./schedules')).exportCsv(ctx, opts)
    case 'csb':
      return { blob: blobOf([JSON.stringify(ctx.doc.toJSON())], 'application/vnd.cadsandbox.design+json'), fileName: `${base}.csb` }
    case 'csbx': {
      const { manifest, mainFile } = ProjectManifest.create(ctx.doc.meta.name)
      const { assets } = await collectDesignAssets(ctx)
      try {
        const blob = await exportProjectArchive({ manifest, designs: new Map([[mainFile, ctx.doc]]), assets })
        return { blob, fileName: `${base}.csbx` }
      } finally {
        manifest.destroy()
      }
    }
  }
}
