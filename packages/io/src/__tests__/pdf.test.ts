import { describe, expect, it } from 'vitest'
import { detectFormat, IMPORT_FORMATS } from '../formats'
import { pdfInfo } from '../import/pdf'

// Minimal single-page A4 PDF (no xref table — pdf.js rebuilds it).
const MINI_PDF = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >> endobj
trailer << /Root 1 0 R >>
%%EOF`

describe('pdf import', () => {
  it('is a registered import format detected by magic bytes and extension', () => {
    const bytes = new TextEncoder().encode(MINI_PDF)
    expect(IMPORT_FORMATS.some((f) => f.id === 'pdf' && f.extensions.includes('.pdf'))).toBe(true)
    expect(detectFormat('plan.pdf')).toBe('pdf')
    expect(detectFormat('scan.bin', bytes)).toBe('pdf')
    expect(detectFormat('plan.pdf', bytes)).toBe('pdf')
  })

  it('reads the page count and page sizes (points) with pdf.js on the main thread', async () => {
    const info = await pdfInfo(new TextEncoder().encode(MINI_PDF))
    expect(info.pages).toBe(1)
    expect(info.sizes[0]?.width).toBeCloseTo(595, 0)
    expect(info.sizes[0]?.height).toBeCloseTo(842, 0)
  }, 20000)
})
