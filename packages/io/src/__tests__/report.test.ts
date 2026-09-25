import { describe, expect, it } from 'vitest'
import { exportReportPdf, latin1 } from '../export/report'

describe('analysis report PDF', () => {
  it('folds text to Latin-1 for the standard fonts', () => {
    expect(latin1('U ≤ 0,28 W/(m²K) – λ = 0,035 € ≥')).toBe("U <= 0,28 W/(m²K) - lambda = 0,035 EUR >=")
    expect(latin1('Größe 3 × 4 m · Ø')).toBe('Größe 3 × 4 m · Ø')
    expect(latin1('日本')).toBe('??')
  })
  it('renders tables across pages', async () => {
    const rows = Array.from({ length: 120 }, (_, i) => [`Raum ${i}`, `${(i * 1.5).toFixed(2)} m²`])
    const { blob, fileName } = await exportReportPdf({
      title: 'Analyse – Wohnhaus',
      disclaimer: 'Planungsschätzung, keine rechtsverbindliche Bescheinigung.',
      meta: [['Projekt', 'Test']],
      sections: [{ title: 'Flächen', tables: [{ columns: ['Raum', 'Fläche'], align: ['left', 'right'], rows, footer: ['Summe', '10.710,00 m²'] }], notes: ['Hinweis ≥ 1/8'] }],
    })
    expect(fileName).toBe('Analyse – Wohnhaus.pdf')
    const head = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()).slice(0, 5))
    expect(head).toBe('%PDF-')
    expect(blob.size).toBeGreaterThan(2000)
  })
})
