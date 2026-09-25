// "Import PDF underlay": choose the page and raster DPI of a dropped/opened PDF, then rasterize it
// (pdf.js in @cadsandbox/io, lazy) and place the page as an image underlay at paper size. The user
// then calibrates it with Annotate ▸ Calibrate underlay.
import { useEffect, useState } from 'react'
import type { ImportResult } from '@cadsandbox/io'
import { tn, useT } from '../../i18n'
import { Button, Dialog, DialogContent, FieldRow, Progress, Select, toast } from '../../ui'
import { useEditorCtx } from '../EditorContext'
import { loadIo } from '../io/formats'
import { usePresentationStore } from '../presentation-store'

interface PdfInfoLike {
  pages: number
  sizes: { width: number; height: number }[]
}
type IoWithPdf = Awaited<ReturnType<typeof loadIo>> & { pdfInfo?: (data: Uint8Array) => Promise<PdfInfoLike> }

const DPIS = [72, 100, 150, 200, 300]
const mm = (pt: number) => Math.round((pt / 72) * 25.4)

export function PdfImportDialog() {
  const t = useT()
  const { editor, doc, session } = useEditorCtx()
  const pending = usePresentationStore((s) => s.pdfImport)
  const close = usePresentationStore((s) => s.closePdfImport)
  const [info, setInfo] = useState<PdfInfoLike | null>(null)
  const [page, setPage] = useState('1')
  const [dpi, setDpi] = useState('150')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')

  useEffect(() => {
    if (!pending) return
    setInfo(null)
    setPage('1')
    let cancelled = false
    void (async () => {
      try {
        const io = (await loadIo()) as IoWithPdf
        if (!io.pdfInfo) throw new Error(t('pdfImport.notReady', 'PDF import is not available yet'))
        const i = await io.pdfInfo(new Uint8Array(await pending.file.arrayBuffer()))
        if (!cancelled) setInfo(i)
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : String(err))
          close()
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pending, close, t])

  const run = async () => {
    if (!pending) return
    setBusy(true)
    try {
      const io = (await loadIo()) as IoWithPdf
      if (!io.importFile) throw new Error(t('pdfImport.notReady', 'PDF import is not available yet'))
      const result: ImportResult = await io.importFile(pending.file, 'pdf', {
        levelId: editor.getState().activeLevel,
        pdf: { page: Number(page), dpi: Number(dpi) },
        onProgress: (fraction, message) => setProgress(`${message} · ${Math.round(fraction * 100)}%`),
      })
      for (const a of result.assets) await session.assets.put(a.bytes, a.mime)
      const ids = pending.at
        ? await editor.insert(result.snapshot, pending.at)
        : io.insertImportResult
          ? io.insertImportResult(doc, result, { levelId: editor.getState().activeLevel })
          : await editor.insert(result.snapshot)
      if (ids.length) {
        editor.select(ids)
        editor.zoomToFit(ids, true)
      }
      toast.success(t('pdfImport.done', 'PDF page placed as underlay — calibrate it with Annotate ▸ Calibrate underlay'))
      close()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      setProgress('')
    }
  }

  const pageOptions = info ? Array.from({ length: info.pages }, (_, i) => ({ value: String(i + 1), label: info.sizes[i] ? `${i + 1} · ${mm(info.sizes[i]!.width)} × ${mm(info.sizes[i]!.height)} mm` : String(i + 1) })) : [{ value: '1', label: '1' }]
  const size = info?.sizes[Number(page) - 1]
  const px = size ? `${Math.ceil((size.width / 72) * Number(dpi))} × ${Math.ceil((size.height / 72) * Number(dpi))} px` : ''

  return (
    <Dialog open={!!pending} onOpenChange={(o) => !o && !busy && close()}>
      <DialogContent
        title={t('pdfImport.title', 'Import PDF underlay')}
        description={t('pdfImport.desc', 'One page is rasterized and placed at paper size for tracing. Scale it afterwards with the Calibrate tool (two points + real distance).')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={busy}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button variant="primary" onClick={() => void run()} loading={busy} disabled={!info}>
              {t('pdfImport.import', 'Import page')}
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <FieldRow label={t('pdfImport.file', 'File')}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pending?.file.name}</span>
          </FieldRow>
          <FieldRow label={t('pdfImport.page', 'Page')} hint={info ? tn('pdfImport.pages', info.pages, '{count} page', '{count} pages') : t('pdfImport.reading', 'Reading…')}>
            <Select value={page} onChange={setPage} options={pageOptions} disabled={!info} aria-label={t('pdfImport.page', 'Page')} />
          </FieldRow>
          <FieldRow label={t('pdfImport.dpi', 'Resolution')} hint={px}>
            <Select value={dpi} onChange={setDpi} options={DPIS.map((d) => ({ value: String(d), label: `${d} dpi` }))} aria-label={t('pdfImport.dpi', 'Resolution')} />
          </FieldRow>
          {busy && <Progress label={progress || t('pdfImport.working', 'Rasterizing…')} />}
        </div>
      </DialogContent>
    </Dialog>
  )
}
