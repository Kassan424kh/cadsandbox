// Magic-byte MIME detection. The client-declared Content-Type is never trusted.

const startsWith = (b: Buffer, sig: number[], offset = 0) => b.length >= offset + sig.length && sig.every((v, i) => b[offset + i] === v)
const ascii = (b: Buffer, s: string, offset = 0) => b.length >= offset + s.length && b.toString('latin1', offset, offset + s.length) === s

function looksLikeText(b: Buffer): boolean {
  if (!b.length) return true
  let suspicious = 0
  for (const byte of b) {
    if (byte === 0) return false
    if (byte < 7 || (byte > 13 && byte < 32 && byte !== 27)) suspicious++
  }
  return suspicious / b.length < 0.01
}

/** Detect a MIME type from the first bytes (≥ 512 recommended, we pass 4 KiB). */
export function sniffMime(head: Buffer): string {
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (ascii(head, 'GIF87a') || ascii(head, 'GIF89a')) return 'image/gif'
  if (ascii(head, 'RIFF') && ascii(head, 'WEBP', 8)) return 'image/webp'
  if (ascii(head, 'RIFF') && ascii(head, 'WAVE', 8)) return 'audio/wav'
  if (ascii(head, 'ftyp', 4)) {
    const brand = head.toString('latin1', 8, 12)
    if (brand === 'avif' || brand === 'avis') return 'image/avif'
    if (['heic', 'heix', 'mif1', 'msf1'].includes(brand)) return 'image/heic'
    return 'video/mp4'
  }
  if (ascii(head, 'BM') && head.length > 14) return 'image/bmp'
  if (startsWith(head, [0x49, 0x49, 0x2a, 0x00]) || startsWith(head, [0x4d, 0x4d, 0x00, 0x2a])) return 'image/tiff'
  if (startsWith(head, [0x00, 0x00, 0x01, 0x00])) return 'image/vnd.microsoft.icon'
  if (startsWith(head, [0x76, 0x2f, 0x31, 0x01])) return 'image/x-exr'
  if (ascii(head, '#?RADIANCE') || ascii(head, '#?RGBE')) return 'image/vnd.radiance'
  if (startsWith(head, [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb])) return 'image/ktx2'
  if (ascii(head, 'DDS ')) return 'image/vnd-ms.dds'
  if (ascii(head, 'glTF')) return 'model/gltf-binary'
  if (ascii(head, '%PDF-')) return 'application/pdf'
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04]) || startsWith(head, [0x50, 0x4b, 0x05, 0x06])) return 'application/zip'
  if (startsWith(head, [0x1f, 0x8b])) return 'application/gzip'
  if (startsWith(head, [0x28, 0xb5, 0x2f, 0xfd])) return 'application/zstd'
  if (ascii(head, 'wOFF')) return 'font/woff'
  if (ascii(head, 'wOF2')) return 'font/woff2'
  if (startsWith(head, [0x00, 0x01, 0x00, 0x00]) || ascii(head, 'OTTO') || ascii(head, 'true')) return 'font/ttf'
  if (startsWith(head, [0x1a, 0x45, 0xdf, 0xa3])) return 'video/webm'
  if (ascii(head, 'OggS')) return 'audio/ogg'
  if (ascii(head, 'ID3') || startsWith(head, [0xff, 0xfb])) return 'audio/mpeg'
  if (ascii(head, 'Kaydara FBX Binary')) return 'application/octet-stream'
  if (startsWith(head, [0x00, 0x61, 0x73, 0x6d])) return 'application/wasm'
  if (looksLikeText(head)) {
    const text = head.toString('utf8').replace(/^\uFEFF/, '').trimStart()
    const lower = text.slice(0, 1024).toLowerCase()
    if (lower.startsWith('iso-10303-21')) return 'application/p21' // IFC / STEP
    if (lower.startsWith('<?xml') || lower.startsWith('<svg') || lower.startsWith('<!doctype') || lower.startsWith('<html')) {
      if (lower.includes('<svg')) return 'image/svg+xml'
      if (lower.includes('<html') || lower.includes('<!doctype html')) return 'text/html'
      return 'application/xml'
    }
    if (lower.startsWith('{') || lower.startsWith('[')) return 'application/json'
    return 'text/plain'
  }
  return 'application/octet-stream'
}

/** Raster images that are safe to render inline from our origin. */
const INLINE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp'])

export function isInlineSafe(mime: string): boolean {
  return INLINE.has(mime)
}

/**
 * Response Content-Type for a stored blob: active content is never served as such. SVG keeps its
 * type (so <img> can decode it) but is always sent as an attachment with a sandboxing CSP.
 */
export function safeContentType(mime: string): string {
  if (isInlineSafe(mime) || mime === 'image/svg+xml') return mime
  if (mime === 'text/html' || mime === 'application/xml') return 'application/octet-stream'
  if (mime.startsWith('text/')) return 'text/plain; charset=utf-8'
  if (/^[a-z]+\/[\w.+-]+$/.test(mime)) return mime
  return 'application/octet-stream'
}
