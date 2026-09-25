// Import (file picker / drag-drop) and export helpers built on @cadsandbox/io (lazy) with
// engine-only fallbacks for PNG and native .csb.
import { useCallback, useState } from 'react'
import { CadDocument } from '@cadsandbox/doc'
import type { ExportFormat, ExportOptions } from '@cadsandbox/io'
import { tn, useT } from '../../i18n'
import { downloadBlob, toast } from '../../ui'
import { useEditorCtx } from '../EditorContext'
import { usePresentationStore } from '../presentation-store'
import { IMPORT_ACCEPT, detectImportFormat, isModelFormat, isZipFile, loadIo } from './formats'

const safeName = (s: string) => s.replace(/[^\w\-. ]+/g, '_').trim() || 'design'

function imageSize(file: Blob): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = document.createElement('img')
    img.onload = () => {
      resolve({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 })
      URL.revokeObjectURL(url)
    }
    img.onerror = () => {
      resolve({ w: 4, h: 3 })
      URL.revokeObjectURL(url)
    }
    img.src = url
  })
}

export function useImportExport() {
  const { editor, doc, session, onOpenFile, onImportProject } = useEditorCtx()
  const t = useT()
  const [busy, setBusy] = useState(false)

  const importFiles = useCallback(
    async (files: File[], at?: { clientX: number; clientY: number }) => {
      if (files.length === 0) return
      const io = await loadIo()
      // A model dropped together with its companions (OBJ + MTL + textures, glTF + .bin, FBX/DAE +
      // textures): the companions are resources of that import, not files of their own — otherwise
      // the materials are lost and every .mtl/.bin reports "Unsupported file".
      const formats = new Map(files.map((f) => [f, detectImportFormat(f.name)] as const))
      const hasModel = files.some((f) => isModelFormat(formats.get(f) ?? null))
      const companions = hasModel ? files.filter((f) => !isZipFile(f.name) && (!formats.get(f) || formats.get(f) === 'image')) : []
      for (const file of files) {
        if (companions.includes(file)) continue
        // A .zip holds a model together with its companions (e.g. our own OBJ export).
        const format = formats.get(file) ?? (isZipFile(file.name) ? ('zip' as const) : null)
        if (!format) {
          toast.error(t('io.unsupported', 'Unsupported file: {name}', { name: file.name }))
          continue
        }
        // A project archive is a whole project, not content for this design: import it as a new project
        // (like "Import project" on the dashboard) instead of merging its first design into this one.
        if (format === 'csbx') {
          if (onImportProject) onImportProject(file)
          else toast.error(t('io.csbxFromDashboard', 'Project archives (.csbx) open as a new project — import them on the dashboard.'))
          continue
        }
        // Images never need the io package: store the blob and place an underlay node.
        if (format === 'image') {
          try {
            const bytes = new Uint8Array(await file.arrayBuffer())
            const hash = await session.assets.put(bytes, file.type || 'image/png')
            const { w, h } = await imageSize(file)
            const width = 4
            await editor.insert([{ type: 'image', name: file.name.replace(/\.\w+$/, ''), params: { asset: hash, width, height: (width * h) / w, opacity: 1 } }], at)
            toast.success(t('io.imageInserted', 'Image placed as reference'))
          } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err))
          }
          continue
        }
        // PDF underlays need a page/DPI choice first → dialog (PdfImportDialog does the import).
        if (format === 'pdf') {
          usePresentationStore.getState().openPdfImport(file, at)
          continue
        }
        if (!io.importFile || (format === 'zip' && !io.importFiles)) {
          toast.error(t('io.notReady', 'Import for {format} is not available yet', { format: format.toUpperCase() }))
          return
        }
        const id = toast.loading(t('io.importing', 'Importing {name}…', { name: file.name }))
        try {
          const opts = {
            levelId: editor.getState().activeLevel,
            onProgress: (fraction: number, message: string) => toast.loading(`${message} · ${Math.round(fraction * 100)}%`, { id }),
          }
          const result =
            format === 'zip'
              ? await io.importFiles!([file], opts) // unpacked by @cadsandbox/io (checked above)
              : companions.length && io.importFiles
                ? await io.importFiles([file, ...companions], opts)
                : await io.importFile(file, format, opts)
          for (const a of result.assets) await session.assets.put(a.bytes, a.mime)
          if (format === 'csb' && result.document) {
            const json = result.document
            const newId = await session.createDesign(safeName(file.name.replace(/\.csb$/i, '')), null, (d) => d.applyUpdate(CadDocument.fromJSON(json).encodeState()))
            toast.success(t('io.designImported', 'Design "{name}" added to the project', { name: file.name }), { id })
            onOpenFile(newId)
            continue
          }
          // CAD/BIM formats carry real-world coordinates → keep them; loose meshes go to the drop point.
          const keepCoords = !at || ['ifc', 'dxf', 'step', 'iges', 'brep', '3dm'].includes(format)
          const ids =
            keepCoords && io.insertImportResult
              ? io.insertImportResult(doc, result, { levelId: editor.getState().activeLevel })
              : await editor.insert(io.mergeImportLayers ? io.mergeImportLayers(doc, result) : result.snapshot, at)
          if (ids.length) {
            editor.select(ids)
            editor.zoomToFit(ids, true)
          }
          toast.success(tn('io.imported', ids.length, 'Imported {name} · {count} object', 'Imported {name} · {count} objects', { name: file.name }), { id })
          for (const w of result.warnings.slice(0, 3)) toast.warning(w)
        } catch (err) {
          toast.error(err instanceof Error ? err.message : String(err), { id })
        }
      }
    },
    [editor, session, t, onOpenFile, onImportProject],
  )

  const openImportDialog = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = IMPORT_ACCEPT
    input.onchange = () => {
      const files = Array.from(input.files ?? [])
      void importFiles(files)
    }
    input.click()
  }, [importFiles])

  const exportAs = useCallback(
    async (format: ExportFormat, opts?: ExportOptions) => {
      setBusy(true)
      const base = safeName(doc.meta.name)
      try {
        const io = await loadIo()
        if (!io.exportFile) {
          if (format === 'png') {
            const blob = await editor.screenshot({ width: opts?.width ?? 1920, height: opts?.height ?? 1080 })
            downloadBlob(blob, `${base}.png`)
            return
          }
          if (format === 'csb') {
            const blob = new Blob([JSON.stringify(doc.toJSON())], { type: 'application/x-cadsandbox' })
            downloadBlob(blob, `${base}.csb`)
            return
          }
          toast.error(t('io.exportNotReady', 'Export to {format} is not available yet', { format: format.toUpperCase() }))
          return
        }
        const id = toast.loading(t('io.exporting', 'Exporting {format}…', { format: format.toUpperCase() }))
        try {
          const res = await io.exportFile({ doc, geometry: editor.geometry, assets: session.assets, editor }, format, { units: doc.meta.units.length, ...opts })
          downloadBlob(res.blob, res.fileName)
          toast.success(t('io.exported', 'Exported {name}', { name: res.fileName }), { id })
        } catch (err) {
          toast.error(err instanceof Error ? err.message : String(err), { id })
        }
      } finally {
        setBusy(false)
      }
    },
    [doc, editor, session, t],
  )

  return { importFiles, openImportDialog, exportAs, busy }
}
