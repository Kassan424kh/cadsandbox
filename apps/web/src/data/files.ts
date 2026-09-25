// File-name hygiene and MIME guessing for uploads/downloads.

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i

/** Safe, portable file name: strips paths, control chars and characters invalid on Windows/macOS. */
export function sanitizeFileName(input: string, fallback = 'file'): string {
  const base = input.split(/[\\/]/).pop() ?? ''
  let name = base
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f<>:"|?*‪-‮⁦-⁩]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
  if (!name || RESERVED.test(name.split('.')[0] ?? '')) name = fallback
  if (name.length > 120) {
    const dot = name.lastIndexOf('.')
    const ext = dot > 0 && name.length - dot <= 12 ? name.slice(dot) : ''
    name = name.slice(0, 120 - ext.length) + ext
  }
  return name
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  obj: 'model/obj',
  stl: 'model/stl',
  ply: 'application/ply',
  '3mf': 'model/3mf',
  fbx: 'application/octet-stream',
  dae: 'model/vnd.collada+xml',
  '3dm': 'model/vnd.3dm',
  step: 'model/step',
  stp: 'model/step',
  iges: 'model/iges',
  igs: 'model/iges',
  ifc: 'application/x-step',
  dxf: 'image/vnd.dxf',
  csv: 'text/csv',
  txt: 'text/plain',
  json: 'application/json',
  hdr: 'image/vnd.radiance',
  exr: 'image/x-exr',
  csb: 'application/x-cadsandbox',
  csbx: 'application/zip',
  zip: 'application/zip',
}

export function guessMime(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  return MIME[ext] ?? 'application/octet-stream'
}
