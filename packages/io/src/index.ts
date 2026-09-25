export * from './api'
export { IMPORT_FORMATS, EXPORT_FORMATS, detectFormat, importFormatInfo, exportFormatInfo, MULTI_FILE_FORMATS } from './formats'
export { importFile, importFiles } from './import/index'
export { exportFile, collectDesignAssets } from './export/index'
export { exportProjectArchive, importProjectArchive, ARCHIVE_FORMAT, ARCHIVE_VERSION, ARCHIVE_MIME } from './archive'
export type { ArchiveIndex } from './archive'
export { sha256Hex } from './util/hash'
export { encodeCSBM, decodeCSBM, CSBM_MIME } from './csbm'
export { mergeImportLayers, insertImportResult } from './insert'
export { setExportSceneBuilder } from './export/scene'

/** Page count + page sizes (points) of a PDF, for the import dialog (pdf.js loads lazily). */
export async function pdfInfo(data: ArrayBuffer | Uint8Array): Promise<import('./import/pdf').PdfInfo> {
  return (await import('./import/pdf')).pdfInfo(data)
}
export type { PdfInfo } from './import/pdf'

/** Render a layout sheet (SheetDef) to PDF. */
export async function exportSheetPdf(ctx: import('./api').ExportContext, sheetId: string): Promise<import('./api').ExportResult> {
  return (await import('./export/pdf')).exportSheetPdf(ctx, sheetId)
}

/** Schedules (rooms, doors, windows, walls, DIN 277 areas) of a design. */
export async function computeDesignSchedules(ctx: Pick<import('./api').ExportContext, 'doc' | 'geometry'>): Promise<import('@cadsandbox/geometry').Schedules> {
  return (await import('./export/schedules')).getSchedules(ctx)
}

export type { ReportDocument, ReportSection, ReportTable } from './export/report'

/** Printable A4 report of pre-formatted tables (analysis summaries); jsPDF is loaded lazily. */
export async function exportReportPdf(report: import('./export/report').ReportDocument): Promise<{ blob: Blob; fileName: string }> {
  return (await import('./export/report')).exportReportPdf(report)
}
