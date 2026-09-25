// PDF underlay import (pdfjs-dist, Apache-2.0): rasterize ONE page at a chosen DPI into a PNG asset
// and place it as an 'image' node at true paper size (1 PDF point = 1/72 in), so a plan printed to
// scale is calibrated with annotate.calibrate (or simply scaled ×100 for a 1:100 sheet). Lazy: pdf.js
// and its worker load on first use and are bundled by Vite (?url) — no third-party requests (GDPR).
import type { ImportOptions, ImportResult } from '../api'
import { SnapshotBuilder } from '../builder'
import { stem } from '../util/bytes'
import { isNode } from '../wasm'

type PdfJs = typeof import('pdfjs-dist')
let pdfjsPromise: Promise<PdfJs> | null = null

/** pdf.js with its worker wired: same-origin worker bundle in browsers, main-thread worker in Node. */
export function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= (async () => {
    const mod = await import('pdfjs-dist')
    if (isNode()) {
      // Node (tests/CLI): pdf.js accepts the worker module on globalThis instead of a real Worker.
      // pdf.js 6 relies on Promise.try (Node ≥ 24; every evergreen browser) — polyfill for Node 22.
      const P = Promise as unknown as { try?: unknown }
      P.try ??= (fn: (...a: unknown[]) => unknown, ...args: unknown[]) => new Promise((resolve) => resolve(fn(...args)))
      const U8 = Uint8Array.prototype as Uint8Array & { toHex?: () => string }
      U8.toHex ??= function (this: Uint8Array) {
        let s = ''
        for (const b of this) s += b.toString(16).padStart(2, '0')
        return s
      }
      const spec = 'pdfjs-dist/build/pdf.worker.mjs'
      ;(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = await import(/* @vite-ignore */ spec)
    } else if (!mod.GlobalWorkerOptions.workerSrc) {
      mod.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
    }
    return mod
  })().catch((e: unknown) => {
    pdfjsPromise = null
    throw e
  })
  return pdfjsPromise
}

export interface PdfInfo {
  pages: number
  /** Page sizes in PDF points (1/72 in), for the first pages (≤ 50) */
  sizes: { width: number; height: number }[]
}

const copyBytes = (data: ArrayBuffer | Uint8Array): Uint8Array<ArrayBuffer> => {
  // pdf.js transfers the buffer to its worker → always hand over a private copy.
  const src = data instanceof Uint8Array ? data : new Uint8Array(data)
  const out = new Uint8Array(new ArrayBuffer(src.byteLength))
  out.set(src)
  return out
}

export async function pdfInfo(data: ArrayBuffer | Uint8Array): Promise<PdfInfo> {
  const pdfjs = await loadPdfJs()
  const task = pdfjs.getDocument({ data: copyBytes(data) })
  const doc = await task.promise
  try {
    const sizes: PdfInfo['sizes'] = []
    for (let i = 1; i <= Math.min(doc.numPages, 50); i++) {
      const page = await doc.getPage(i)
      const vp = page.getViewport({ scale: 1 })
      sizes.push({ width: vp.width, height: vp.height })
      page.cleanup()
    }
    return { pages: doc.numPages, sizes }
  } finally {
    await task.destroy()
  }
}

const MAX_PIXELS = 30e6

/** Rasterize page `opts.pdf.page` (1-based, default 1) at `opts.pdf.dpi` (default 150) → image underlay. */
export async function importPdf(name: string, bytes: Uint8Array, opts: ImportOptions): Promise<ImportResult> {
  const hasCanvas = typeof OffscreenCanvas !== 'undefined' || typeof document !== 'undefined'
  if (!hasCanvas) throw new Error('PDF pages can only be rasterized in a browser.')
  const pageNo = Math.max(1, Math.floor(opts.pdf?.page ?? 1))
  let dpi = Math.min(600, Math.max(36, opts.pdf?.dpi ?? 150))
  opts.onProgress?.(0.05, 'Loading PDF')
  const pdfjs = await loadPdfJs()
  const task = pdfjs.getDocument({ data: copyBytes(bytes) })
  const doc = await task.promise
  try {
    if (pageNo > doc.numPages) throw new Error(`The PDF has ${doc.numPages} page(s) — page ${pageNo} does not exist.`)
    const page = await doc.getPage(pageNo)
    const base = page.getViewport({ scale: 1 })
    // cap the raster at MAX_PIXELS (A0 at 300 dpi would be ~140 MP)
    const wanted = (base.width * dpi) / 72 * ((base.height * dpi) / 72)
    if (wanted > MAX_PIXELS) dpi = Math.floor(dpi * Math.sqrt(MAX_PIXELS / wanted))
    const viewport = page.getViewport({ scale: dpi / 72 })
    const w = Math.max(1, Math.ceil(viewport.width))
    const h = Math.max(1, Math.ceil(viewport.height))
    opts.onProgress?.(0.2, `Rasterizing page ${pageNo} at ${dpi} dpi`)
    const offscreen = typeof OffscreenCanvas !== 'undefined'
    const canvas = offscreen ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h })
    const ctx2d = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
    if (!ctx2d) throw new Error('Could not create a 2D canvas for the PDF page.')
    ctx2d.fillStyle = '#ffffff'
    ctx2d.fillRect(0, 0, w, h)
    // pdf.js 6 takes the canvas itself (HTMLCanvasElement or OffscreenCanvas at runtime; typed as the former)
    await page.render({ canvas: canvas as HTMLCanvasElement, viewport, background: '#ffffff' }).promise
    page.cleanup()
    opts.onProgress?.(0.8, 'Encoding image')
    const blob: Blob =
      canvas instanceof OffscreenCanvas
        ? await canvas.convertToBlob({ type: 'image/png' })
        : await new Promise<Blob>((resolve, reject) => (canvas as HTMLCanvasElement).toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'))
    const png = new Uint8Array(await blob.arrayBuffer())
    const perPx = 0.0254 / dpi // paper size: meters per pixel
    const width = w * perPx, height = h * perPx
    const b = new SnapshotBuilder()
    const asset = await b.asset(png, 'image/png')
    b.add('image', {
      name: doc.numPages > 1 ? `${stem(name)} p.${pageNo}` : stem(name),
      parent: null,
      meta: { image: { pixels: [w, h], metersPerPixel: perPx }, pdf: { page: pageNo, pages: doc.numPages, dpi, paper: [base.width / 72 * 0.0254, base.height / 72 * 0.0254] } },
      params: { asset, width, height, opacity: 1, planOnly: true },
    })
    b.expand([
      [-width / 2, -height / 2, 0],
      [width / 2, height / 2, 0],
    ])
    b.warn(`PDF page placed at paper size (${(width * 100).toFixed(1)} × ${(height * 100).toFixed(1)} cm). Use Annotate ▸ Calibrate underlay to scale it to real size.`)
    opts.onProgress?.(1, 'Done')
    return b.result()
  } finally {
    await task.destroy()
  }
}
