// Supported formats + detection by magic bytes (preferred) or file extension.
import type { ExportFormat, FormatInfo, ImportFormat } from './api'
import { asciiAt, extname, sniffImageMime, startsWith } from './util/bytes'

const f = <F extends string>(id: F, label: string, extensions: string[], mime: string, kind: FormatInfo['kind'], description: string): FormatInfo<F> => ({
  id,
  label,
  extensions,
  mime,
  kind,
  description,
})

export const IMPORT_FORMATS: FormatInfo<ImportFormat>[] = [
  f('glb', 'glTF Binary', ['.glb'], 'model/gltf-binary', '3d', 'Meshes, PBR materials and textures; Draco/meshopt compressed files supported.'),
  f('gltf', 'glTF', ['.gltf'], 'model/gltf+json', '3d', 'glTF JSON (drop the .bin and textures together with it, or a .zip of them).'),
  f('obj', 'Wavefront OBJ', ['.obj'], 'model/obj', '3d', 'Meshes; drop the .mtl and textures together (or a .zip of them) for materials.'),
  f('stl', 'STL', ['.stl'], 'model/stl', '3d', 'Binary or ASCII triangle meshes (unitless, default millimeters).'),
  f('ply', 'PLY', ['.ply'], 'application/x-ply', '3d', 'Polygon meshes (ASCII or binary).'),
  f('3mf', '3MF', ['.3mf'], 'model/3mf', '3d', '3D printing package with units and colors.'),
  f('fbx', 'FBX', ['.fbx'], 'application/octet-stream', '3d', 'Autodesk FBX meshes and materials.'),
  f('dae', 'Collada', ['.dae'], 'model/vnd.collada+xml', '3d', 'Collada DAE scenes.'),
  f('3dm', 'Rhino 3DM', ['.3dm'], 'model/vnd.3dm', '3d', 'Rhino meshes, render meshes of Breps/Extrusions, SubD, curves, blocks and layers.'),
  f('step', 'STEP', ['.step', '.stp'], 'model/step', '3d', 'CAD solids (AP203/AP214/AP242), tessellated on import.'),
  f('iges', 'IGES', ['.iges', '.igs'], 'model/iges', '3d', 'CAD surfaces/solids, tessellated on import.'),
  f('brep', 'OpenCASCADE BREP', ['.brep', '.brp'], 'application/octet-stream', '3d', 'OpenCASCADE boundary representation, tessellated on import.'),
  f('ifc', 'IFC', ['.ifc'], 'application/x-step', 'bim', 'BIM models (IFC2x3/IFC4): storeys, walls, doors, windows, spaces, properties.'),
  f('dxf', 'DXF', ['.dxf'], 'image/vnd.dxf', '2d', 'AutoCAD drawing exchange (for DWG files: save as DXF in your CAD app).'),
  f('svg', 'SVG', ['.svg'], 'image/svg+xml', '2d', 'Vector paths as editable 2D shapes and curves.'),
  f('image', 'Image', ['.png', '.jpg', '.jpeg', '.webp'], 'image/*', 'image', 'Reference image / scanned plan as an underlay.'),
  f('pdf', 'PDF', ['.pdf'], 'application/pdf', 'image', 'One page rasterized as an underlay for tracing (choose page and DPI, then calibrate).'),
  f('csb', 'CadSandbox Design', ['.csb'], 'application/vnd.cadsandbox.design+json', 'project', 'A single CadSandbox design (JSON).'),
  f('csbx', 'CadSandbox Project', ['.csbx'], 'application/vnd.cadsandbox.project+zip', 'project', 'Complete project archive with all designs and files.'),
]

export const EXPORT_FORMATS: FormatInfo<ExportFormat>[] = [
  f('glb', 'glTF Binary', ['.glb'], 'model/gltf-binary', '3d', 'Web, AR/VR and most 3D apps (embedded textures).'),
  f('gltf', 'glTF', ['.gltf'], 'model/gltf+json', '3d', 'glTF JSON with embedded buffers and textures.'),
  f('obj', 'Wavefront OBJ', ['.zip'], 'application/zip', '3d', 'OBJ + MTL + textures (zipped).'),
  f('stl', 'STL', ['.stl'], 'model/stl', '3d', 'Binary STL for 3D printing (Z-up, millimeters by default).'),
  f('ply', 'PLY', ['.ply'], 'application/x-ply', '3d', 'Binary PLY mesh (Z-up).'),
  f('3mf', '3MF', ['.3mf'], 'model/3mf', '3d', '3D printing package (millimeters, per-object colors).'),
  f('usdz', 'USDZ', ['.usdz'], 'model/vnd.usdz+zip', '3d', 'Apple AR Quick Look.'),
  f('ifc', 'IFC4', ['.ifc'], 'application/x-step', 'bim', 'BIM exchange: storeys, walls, openings, slabs, spaces, properties.'),
  f('dxf', 'DXF', ['.dxf'], 'image/vnd.dxf', '2d', 'AutoCAD R2018 DXF of a plan with layers, hatches and dimensions.'),
  f('svg', 'SVG', ['.svg'], 'image/svg+xml', '2d', 'Vector plan with line weights and hatches.'),
  f('pdf', 'PDF', ['.pdf'], 'application/pdf', '2d', 'Layout sheets with title block, or a scaled plan.'),
  f('png', 'PNG', ['.png'], 'image/png', 'image', 'Screenshot of the current view.'),
  f('csv', 'CSV', ['.csv'], 'text/csv', 'data', 'Schedules: rooms, doors, windows, walls, areas (DIN 277).'),
  f('csb', 'CadSandbox Design', ['.csb'], 'application/vnd.cadsandbox.design+json', 'project', 'This design as JSON.'),
  f('csbx', 'CadSandbox Project', ['.csbx'], 'application/vnd.cadsandbox.project+zip', 'project', 'Portable archive with blobs.'),
]

export function importFormatInfo(id: ImportFormat): FormatInfo<ImportFormat> {
  return IMPORT_FORMATS.find((x) => x.id === id)!
}
export function exportFormatInfo(id: ExportFormat): FormatInfo<ExportFormat> {
  return EXPORT_FORMATS.find((x) => x.id === id)!
}

function byExtension(name: string): ImportFormat | null {
  const ext = extname(name)
  if (!ext) return null
  return IMPORT_FORMATS.find((x) => x.extensions.includes(ext))?.id ?? null
}

/** Names of the entries of a zip (central directory scan, no decompression). */
function zipEntryNames(bytes: Uint8Array, limit = 64): string[] {
  const names: string[] = []
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // End of central directory record: search backwards (max comment 64 KiB).
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (dv.getUint32(i, true) !== 0x06054b50) continue
    let o = dv.getUint32(i + 16, true)
    const count = dv.getUint16(i + 10, true)
    for (let k = 0; k < Math.min(count, limit) && o + 46 <= bytes.length; k++) {
      if (dv.getUint32(o, true) !== 0x02014b50) break
      const nl = dv.getUint16(o + 28, true),
        el = dv.getUint16(o + 30, true),
        cl = dv.getUint16(o + 32, true)
      names.push(new TextDecoder().decode(bytes.subarray(o + 46, o + 46 + nl)))
      o += 46 + nl + el + cl
    }
    break
  }
  return names
}

/**
 * Detect the import format of a file. Content sniffing wins over the extension (a mis-named
 * `.stp` that is really IFC is imported as IFC); falls back to the extension, else null.
 */
export function detectFormat(name: string, bytes?: Uint8Array | ArrayBuffer | null): ImportFormat | null {
  const ext = byExtension(name)
  if (!bytes) return ext
  const b = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes
  if (b.length === 0) return ext
  const head = asciiAt(b, 0, 2048)
  if (asciiAt(b, 0, 4) === 'glTF') return 'glb'
  if (asciiAt(b, 0, 5) === '%PDF-') return 'pdf'
  if (sniffImageMime(b) && ['image/png', 'image/jpeg', 'image/webp'].includes(sniffImageMime(b)!)) return 'image'
  if (startsWith(b, [0x50, 0x4b, 0x03, 0x04])) {
    const names = zipEntryNames(b)
    if (names.some((n) => n.toLowerCase().endsWith('.model') && n.toLowerCase().startsWith('3d/'))) return '3mf'
    if (names.includes('archive.json') || names.includes('cadsandbox.json')) return 'csbx'
    return ext === '3mf' || ext === 'csbx' ? ext : ext
  }
  if (head.startsWith('Kaydara FBX Binary')) return 'fbx'
  if (head.startsWith('; FBX')) return 'fbx'
  if (head.startsWith('3D Geometry File Format')) return '3dm'
  if (head.startsWith('ISO-10303-21')) return /FILE_SCHEMA\s*\(\s*\(\s*'IFC/i.test(head) ? 'ifc' : 'step'
  if (/^ply\r?\n/.test(head)) return 'ply'
  if (head.startsWith('DBRep_DrawableShape') || head.startsWith('CASCADE Topology')) return 'brep'
  const trimmed = head.replace(/^﻿/, '').trimStart()
  if (trimmed.startsWith('{')) {
    if (trimmed.includes('"cadsandbox/doc@1"')) return 'csb'
    if (/"asset"\s*:/.test(trimmed)) return 'gltf'
  }
  if (/^<\?xml[\s\S]*?<svg[\s>]/i.test(trimmed) || /^<svg[\s>]/i.test(trimmed) || (/<!DOCTYPE svg/i.test(trimmed) && /<svg/i.test(head))) return 'svg'
  if (/<COLLADA[\s>]/i.test(head)) return 'dae'
  if (/^\s*0\s*\r?\n\s*SECTION\s*\r?\n/.test(head) || /^\s*999\s*\r?\n/.test(head)) return 'dxf'
  if (head.startsWith('AutoCAD Binary DXF')) return 'dxf'
  if (/^solid\s/i.test(trimmed) && /facet\s+normal/i.test(head)) return 'stl'
  // IGES: fixed 80-column records with the section letter in column 73 ("S      1").
  if (/^.{72}S\s{0,6}1\r?\n/.test(head)) return 'iges'
  // Binary STL: 80-byte header + triangle count matching the file size.
  if (b.length >= 84) {
    const tris = new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(80, true)
    if (84 + tris * 50 === b.length) return 'stl'
  }
  if (ext === 'obj' || /^(#.*\r?\n|\s*\r?\n)*(v|vn|vt|o|g|mtllib)\s/m.test(head.slice(0, 1024))) return ext ?? 'obj'
  return ext
}

/** Formats whose importer accepts companion files (MTL, textures, .bin). */
export const MULTI_FILE_FORMATS: readonly ImportFormat[] = ['obj', 'gltf', 'fbx', 'dae']
