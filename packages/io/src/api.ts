// @cadsandbox/io — import/export contract. Everything runs client-side (WASM loaders are
// lazy-loaded on first use so they never weigh on startup).
import type { CadDocument, DocJSON, DocSnapshot, LayerDef, PaperSize, ProjectManifest } from '@cadsandbox/doc'
import type { LengthUnit } from '@cadsandbox/shared'
import type { AssetResolver, GeometryService } from '@cadsandbox/geometry'
import type { Editor } from '@cadsandbox/render'

export type ImportFormat =
  | 'glb' | 'gltf' | 'obj' | 'stl' | 'ply' | '3mf' | 'fbx' | 'dae' | '3dm'
  | 'step' | 'iges' | 'brep' | 'ifc' | 'dxf' | 'svg' | 'image' | 'pdf' | 'csb' | 'csbx'

export type ExportFormat =
  | 'glb' | 'gltf' | 'obj' | 'stl' | 'ply' | '3mf' | 'usdz' | 'ifc'
  | 'dxf' | 'svg' | 'pdf' | 'png' | 'csv' | 'csb' | 'csbx'

export interface FormatInfo<F extends string = string> {
  id: F
  label: string
  extensions: string[]
  mime: string
  kind: '3d' | '2d' | 'bim' | 'image' | 'data' | 'project'
  description: string
}

export interface ImportOptions {
  /** Unit of unitless files (OBJ, STL, PLY, unitless DXF). Default: 'mm' for STL/DXF, 'm' otherwise. */
  units?: LengthUnit
  /** Source up-axis for mesh formats (default: 'y' for glTF/OBJ/FBX/DAE, 'z' for STL/3MF/3DM/STEP/IFC). */
  upAxis?: 'y' | 'z'
  /** Level to place imported content under (IFC creates its own levels). */
  levelId?: string | null
  onProgress?: (fraction: number, message: string) => void
  signal?: AbortSignal
  /** (additive) pdf underlay: 1-based page (default 1) and raster resolution in dots per inch (default 150). */
  pdf?: { page?: number; dpi?: number }
}

export interface ImportedAsset {
  hash: string // sha256 hex of bytes
  bytes: Uint8Array
  mime: string
}

export interface ImportResult {
  /** Insert with doc.insertSnapshot(). Roots are in world space. */
  snapshot: DocSnapshot
  /** Blobs to persist in the asset store before/after inserting. */
  assets: ImportedAsset[]
  warnings: string[]
  /** Only for .csb (single design) imports: the complete design document. */
  document?: DocJSON
  /** (additive) Drafting layers referenced by the snapshot nodes' `layer` ids (DXF, 3DM, IFC…).
   *  Add them with doc.addLayer(def) keeping the ids before inserting, or use `mergeImportLayers`. */
  layers?: LayerDef[]
}

/** (additive) A file to import: a browser File or in-memory data with a file name. */
export type ImportSource = File | { name: string; data: ArrayBuffer | Uint8Array | Blob | string }

export interface ExportContext {
  doc: CadDocument
  geometry: GeometryService
  assets: AssetResolver
  /** Needed for png, pdf (sheets) and vector views. */
  editor?: Editor
}

export interface ExportOptions {
  /** Export only these nodes (default: all visible). */
  selection?: string[]
  /** Unit written to unitless formats (DXF $INSUNITS, OBJ/STL scale). Default: doc display unit. */
  units?: LengthUnit
  /** DXF/SVG/PDF: which plan/sheet to export. */
  levelId?: string | null
  sheetId?: string | null
  /** PDF/SVG plan scale denominator (100 → 1:100). */
  scale?: number
  textures?: boolean
  /** png: pixel size */
  width?: number
  height?: number
  /** csv: which schedule */
  schedule?: 'rooms' | 'doors' | 'windows' | 'walls' | 'areas'
  /** (additive) csv: ';' = German Excel (decimal comma). Default ','. */
  csvSeparator?: ',' | ';'
  /** (additive) pdf quick plan: paper size (default: smallest A-size that fits at `scale`). */
  paper?: PaperSize
}

export interface ExportResult {
  blob: Blob
  fileName: string
}

/** Portable project archive (.csbx, zip): manifest + every design (Yjs state + JSON) + blobs.
 *  Used for "Download project", GDPR data export, backups and offline → cloud upload. */
export interface ProjectArchive {
  manifest: ProjectManifest
  designs: Map<string, CadDocument> // fileId → document
  assets: ImportedAsset[]
}
