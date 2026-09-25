// Printable report (jsPDF, A4 portrait): title, disclaimer, sections of pre-formatted tables and notes,
// page numbers. Content is passed in already localized; text is folded to Latin-1 for the standard
// PDF fonts (no font downloads). Used by the editor's Analysis panel.
import type { jsPDF as JsPdf } from 'jspdf'
import { safeFileName } from '../util/bytes'

export interface ReportTable {
  title?: string
  columns: string[]
  /** Per-column alignment (default left) */
  align?: ('left' | 'right' | 'center')[]
  rows: string[][]
  /** Optional totals row (bold) */
  footer?: string[]
}

export interface ReportSection {
  title: string
  /** Short paragraph under the title */
  intro?: string
  tables: ReportTable[]
  notes?: string[]
}

export interface ReportDocument {
  title: string
  subtitle?: string
  /** Label/value pairs under the title (project, date, …) */
  meta?: [string, string][]
  /** Shown in a box on the first page and in every page footer (short form) */
  disclaimer: string
  footerNote?: string
  sections: ReportSection[]
  fileName?: string
}

const REPLACE: Record<string, string> = {
  '≥': '>=',
  '≤': '<=',
  '−': '-',
  '–': '-',
  '—': '-',
  '′': "'",
  '″': '"',
  '„': '"',
  '“': '"',
  '”': '"',
  '‘': "'",
  '’': "'",
  '…': '...',
  '→': '->',
  '≈': '~',
  '€': 'EUR',
  'λ': 'lambda',
  'Δ': 'Delta ',
  'Σ': 'Sum ',
  'Ψ': 'Psi',
  'μ': 'µ',
  '•': '·',
  '\u00a0': ' ',
  '\u202f': ' ',
}

/** Fold text to Latin-1 (standard PDF fonts); unknown characters become '?'. */
export function latin1(text: string): string {
  let out = ''
  for (const ch of text) {
    const r = REPLACE[ch]
    if (r !== undefined) out += r
    else {
      const c = ch.codePointAt(0)!
      out += c < 0x20 ? ' ' : c <= 0x7e || (c >= 0xa0 && c <= 0xff) ? ch : '?'
    }
  }
  return out
}

const PAGE_W = 210
const PAGE_H = 297
const M = 15
const BOTTOM = PAGE_H - 18

export async function exportReportPdf(report: ReportDocument): Promise<{ blob: Blob; fileName: string }> {
  const { jsPDF } = await import('jspdf')
  const pdf: JsPdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  pdf.setProperties({ title: latin1(report.title), creator: 'CadSandbox' })
  const W = PAGE_W - 2 * M
  let y = M

  const text = (s: string, x: number, yy: number, opts: { size?: number; bold?: boolean; color?: string; align?: 'left' | 'right' | 'center' } = {}) => {
    pdf.setFont('helvetica', opts.bold ? 'bold' : 'normal')
    pdf.setFontSize(opts.size ?? 9)
    pdf.setTextColor(opts.color ?? '#111111')
    pdf.text(latin1(s), x, yy, { align: opts.align ?? 'left', baseline: 'alphabetic' })
  }
  const wrap = (s: string, width: number, size: number): string[] => {
    pdf.setFontSize(size)
    return pdf.splitTextToSize(latin1(s), width) as string[]
  }
  const ensure = (h: number): boolean => {
    if (y + h <= BOTTOM) return false
    pdf.addPage()
    y = M
    return true
  }

  // title block
  text(report.title, M, y + 6, { size: 16, bold: true })
  y += 9
  if (report.subtitle) {
    text(report.subtitle, M, y + 4, { size: 10, color: '#555555' })
    y += 6
  }
  for (const [k, v] of report.meta ?? []) {
    text(k, M, y + 4, { size: 8.5, color: '#555555' })
    text(v, M + 38, y + 4, { size: 8.5 })
    y += 4.6
  }
  y += 2
  // disclaimer box
  const dl = wrap(report.disclaimer, W - 6, 8.5)
  const dh = dl.length * 3.8 + 4
  pdf.setDrawColor('#b45309')
  pdf.setFillColor('#fff7ed')
  pdf.setLineWidth(0.3)
  pdf.rect(M, y, W, dh, 'FD')
  dl.forEach((line, i) => text(line, M + 3, y + 5 + i * 3.8, { size: 8.5, color: '#7c2d12' }))
  y += dh + 6

  for (const section of report.sections) {
    ensure(14)
    text(section.title, M, y + 5, { size: 12.5, bold: true })
    y += 8
    if (section.intro) {
      for (const line of wrap(section.intro, W, 8.5)) {
        ensure(4)
        text(line, M, y + 3.2, { size: 8.5, color: '#444444' })
        y += 3.9
      }
      y += 1.5
    }
    for (const table of section.tables) drawTable(table)
    for (const note of section.notes ?? []) {
      for (const line of wrap(note, W, 7.5)) {
        ensure(3.6)
        text(line, M, y + 3, { size: 7.5, color: '#666666' })
        y += 3.4
      }
    }
    y += 4
  }

  // page footers
  const pages = pdf.getNumberOfPages()
  const foot = report.footerNote ?? report.disclaimer
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p)
    pdf.setDrawColor('#d4d4d8')
    pdf.setLineWidth(0.2)
    pdf.line(M, PAGE_H - 12, PAGE_W - M, PAGE_H - 12)
    const line = wrap(foot, W - 25, 6.5)[0] ?? ''
    text(line, M, PAGE_H - 8, { size: 6.5, color: '#777777' })
    text(`${p} / ${pages}`, PAGE_W - M, PAGE_H - 8, { size: 7, color: '#777777', align: 'right' })
  }
  const fileName = `${safeFileName(report.fileName ?? report.title, 'report')}.pdf`
  return { blob: pdf.output('blob'), fileName }

  function drawTable(table: ReportTable): void {
    const size = 7.5
    const rowH = 4.6
    pdf.setFontSize(size)
    const n = table.columns.length
    if (!n) return
    // column widths from content (header bold), scaled to the page width
    const widths = table.columns.map((c, i) => {
      pdf.setFont('helvetica', 'bold')
      let w = pdf.getTextWidth(latin1(c))
      pdf.setFont('helvetica', 'normal')
      for (const r of [...table.rows, ...(table.footer ? [table.footer] : [])]) w = Math.max(w, pdf.getTextWidth(latin1(r[i] ?? '')))
      return Math.min(w, 80) + 3
    })
    const sum = widths.reduce((a, b) => a + b, 0)
    const scale = W / sum
    const cols = widths.map((w) => w * scale)
    const x0s = cols.map((_, i) => M + cols.slice(0, i).reduce((a, b) => a + b, 0))
    const cell = (s: string, i: number, yy: number, bold = false) => {
      const align = table.align?.[i] ?? 'left'
      const maxW = cols[i]! - 2.4
      let t = latin1(s)
      pdf.setFont('helvetica', bold ? 'bold' : 'normal')
      pdf.setFontSize(size)
      while (t.length > 1 && pdf.getTextWidth(t) > maxW) t = t.slice(0, -2) + '.'
      const x = align === 'right' ? x0s[i]! + cols[i]! - 1.2 : align === 'center' ? x0s[i]! + cols[i]! / 2 : x0s[i]! + 1.2
      pdf.setTextColor('#111111')
      pdf.text(t, x, yy, { align, baseline: 'alphabetic' })
    }
    const header = () => {
      pdf.setFillColor('#f1f1f4')
      pdf.rect(M, y, W, rowH, 'F')
      table.columns.forEach((c, i) => cell(c, i, y + 3.2, true))
      y += rowH
    }
    if (table.title) {
      ensure(rowH * 3)
      text(table.title, M, y + 3.6, { size: 9, bold: true })
      y += 5.5
    }
    ensure(rowH * 2)
    header()
    pdf.setDrawColor('#e4e4e7')
    pdf.setLineWidth(0.15)
    for (const r of table.rows) {
      if (ensure(rowH)) header()
      r.forEach((c, i) => i < n && cell(c, i, y + 3.2))
      pdf.line(M, y + rowH, M + W, y + rowH)
      y += rowH
    }
    if (table.footer) {
      if (ensure(rowH)) header()
      pdf.setDrawColor('#71717a')
      pdf.setLineWidth(0.3)
      pdf.line(M, y, M + W, y)
      table.footer.forEach((c, i) => i < n && cell(c, i, y + 3.2, true))
      y += rowH
    }
    y += 3
  }
}
