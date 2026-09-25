// Import/export format tables (mirroring @cadsandbox/io) + lazy loader for the io implementation.
// The chrome renders menus from these tables even before the io package lands; actual work is
// delegated to `importFile` / `exportFile` from @cadsandbox/io when available.
import type { CadDocument, DocSnapshot } from '@cadsandbox/doc'
import type { ExportContext, ExportFormat, ExportOptions, ExportResult, FormatInfo, ImportFormat, ImportOptions, ImportResult } from '@cadsandbox/io'

const f = <F extends string>(id: F, label: string, extensions: string[], mime: string, kind: FormatInfo['kind'], description: string): FormatInfo<F> => ({ id, label, extensions, mime, kind, description })

export const IMPORT_FORMATS: FormatInfo<ImportFormat>[] = [
  f('glb', 'glTF Binary', ['glb'], 'model/gltf-binary', '3d', 'Meshes with PBR materials'),
  f('gltf', 'glTF', ['gltf'], 'model/gltf+json', '3d', 'Meshes with PBR materials'),
  f('obj', 'Wavefront OBJ', ['obj'], 'model/obj', '3d', 'Meshes (unitless)'),
  f('stl', 'STL', ['stl'], 'model/stl', '3d', 'Triangle meshes (mm)'),
  f('ply', 'PLY', ['ply'], 'application/octet-stream', '3d', 'Point/mesh data'),
  f('3mf', '3MF', ['3mf'], 'model/3mf', '3d', '3D manufacturing format'),
  f('fbx', 'FBX', ['fbx'], 'application/octet-stream', '3d', 'Autodesk FBX'),
  f('dae', 'COLLADA', ['dae'], 'model/vnd.collada+xml', '3d', 'COLLADA scenes'),
  f('3dm', 'Rhino 3DM', ['3dm'], 'model/vnd.3dm', '3d', 'Rhino models'),
  f('step', 'STEP', ['step', 'stp'], 'application/step', '3d', 'CAD solids (B-rep)'),
  f('iges', 'IGES', ['iges', 'igs'], 'application/iges', '3d', 'CAD surfaces'),
  f('ifc', 'IFC', ['ifc'], 'application/x-step', 'bim', 'Building information model'),
  f('dxf', 'DXF', ['dxf'], 'image/vnd.dxf', '2d', '2D drawings'),
  f('svg', 'SVG', ['svg'], 'image/svg+xml', '2d', 'Vector shapes'),
  f('image', 'Image', ['png', 'jpg', 'jpeg', 'webp'], 'image/*', 'image', 'Reference image / underlay'),
  f('pdf', 'PDF', ['pdf'], 'application/pdf', 'image', 'PDF page as underlay (choose page & DPI)'),
  f('csb', 'CadSandbox design', ['csb'], 'application/x-cadsandbox', 'project', 'Single design file'),
  f('csbx', 'CadSandbox project', ['csbx'], 'application/x-cadsandbox-project', 'project', 'Project archive'),
]

export const EXPORT_FORMATS: FormatInfo<ExportFormat>[] = [
  f('glb', 'glTF Binary (.glb)', ['glb'], 'model/gltf-binary', '3d', 'Web & AR ready'),
  f('gltf', 'glTF (.gltf)', ['gltf'], 'model/gltf+json', '3d', 'JSON scene'),
  f('obj', 'OBJ', ['obj'], 'model/obj', '3d', 'Universal meshes'),
  f('stl', 'STL', ['stl'], 'model/stl', '3d', '3D printing'),
  f('ply', 'PLY', ['ply'], 'application/octet-stream', '3d', 'Mesh data'),
  f('3mf', '3MF', ['3mf'], 'model/3mf', '3d', '3D manufacturing'),
  f('usdz', 'USDZ', ['usdz'], 'model/vnd.usdz+zip', '3d', 'Apple AR Quick Look'),
  f('ifc', 'IFC', ['ifc'], 'application/x-step', 'bim', 'BIM exchange'),
  f('dxf', 'DXF', ['dxf'], 'image/vnd.dxf', '2d', 'Plan drawing'),
  f('svg', 'SVG', ['svg'], 'image/svg+xml', '2d', 'Vector plan'),
  f('pdf', 'PDF sheets', ['pdf'], 'application/pdf', '2d', 'Print-ready sheets'),
  f('png', 'PNG image', ['png'], 'image/png', 'image', 'Viewport render'),
  f('csv', 'CSV schedule', ['csv'], 'text/csv', 'data', 'Room/door/window/wall lists'),
  f('csb', 'CadSandbox design (.csb)', ['csb'], 'application/x-cadsandbox', 'project', 'This design file'),
  f('csbx', 'CadSandbox project (.csbx)', ['csbx'], 'application/x-cadsandbox-project', 'project', 'Whole project archive'),
]

/** Companion files of multi-file models (OBJ materials, glTF buffers); textures are images. */
const COMPANION_EXTENSIONS = ['mtl', 'bin']

/** A zipped model with its companions (e.g. our own OBJ export) — @cadsandbox/io unpacks it. */
export function isZipFile(fileName: string): boolean {
  return /\.zip$/i.test(fileName)
}

export const IMPORT_ACCEPT = [...IMPORT_FORMATS.flatMap((x) => x.extensions), ...COMPANION_EXTENSIONS, 'zip'].map((e) => `.${e}`).join(',')

export function detectImportFormat(fileName: string): ImportFormat | null {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  return IMPORT_FORMATS.find((x) => x.extensions.includes(ext))?.id ?? null
}

/** 3D model formats — files dropped next to one of them are its companion resources. */
export function isModelFormat(format: ImportFormat | null): boolean {
  return !!format && IMPORT_FORMATS.some((x) => x.id === format && x.kind === '3d')
}

/** Expected runtime API of @cadsandbox/io (see contract requests in the final report). */
export interface IoModule {
  importFile?(file: File | Blob, format: ImportFormat, opts?: ImportOptions): Promise<ImportResult>
  /** Several files dropped together: model files plus their companions (MTL, .bin, textures). */
  importFiles?(files: File[], opts?: ImportOptions): Promise<ImportResult>
  exportFile?(ctx: ExportContext, format: ExportFormat, opts?: ExportOptions): Promise<ExportResult>
  /** Merge imported layers into the doc; returns the layer-remapped snapshot. */
  mergeImportLayers?(doc: CadDocument, result: ImportResult): DocSnapshot
  /** Insert keeping source coordinates (lifted to the level elevation); returns root ids. */
  insertImportResult?(doc: CadDocument, result: ImportResult, opts?: { levelId?: string | null }): string[]
  IMPORT_FORMATS?: FormatInfo<ImportFormat>[]
  EXPORT_FORMATS?: FormatInfo<ExportFormat>[]
}

let ioPromise: Promise<IoModule> | null = null

export function loadIo(): Promise<IoModule> {
  if (!ioPromise) ioPromise = import('@cadsandbox/io').then((m) => m as unknown as IoModule).catch(() => ({}) as IoModule)
  return ioPromise
}
