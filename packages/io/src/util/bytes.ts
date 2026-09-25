// Byte / text / file-name helpers shared by importers and exporters. DOM-free (runs in workers
// and Node tests); `Blob` and `TextDecoder` are available in every supported runtime.
import type { ImportSource } from '../api'

/** A Uint8Array backed by a plain (non-shared) ArrayBuffer — what WebCrypto/Blob/fetch accept. */
export type Bytes = Uint8Array<ArrayBuffer>

export function asBytes(data: ArrayBuffer | ArrayBufferView): Bytes {
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (data.buffer instanceof ArrayBuffer) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  const copy = new Uint8Array(data.byteLength)
  copy.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
  return copy
}

/** An ArrayBuffer containing exactly these bytes (copies only when the view is partial). */
export function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  const b = asBytes(bytes)
  if (b.byteOffset === 0 && b.byteLength === b.buffer.byteLength) return b.buffer
  return b.slice().buffer
}

export async function toBytes(data: ArrayBuffer | Uint8Array | Blob | string): Promise<Bytes> {
  if (typeof data === 'string') return new TextEncoder().encode(data)
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer())
  return asBytes(data)
}

export async function sourceBytes(src: ImportSource): Promise<Bytes> {
  if ('data' in src) return toBytes(src.data)
  return new Uint8Array(await src.arrayBuffer())
}

export function blobOf(parts: (Uint8Array | string)[], type: string): Blob {
  return new Blob(
    parts.map((p) => (typeof p === 'string' ? p : asBytes(p))),
    { type },
  )
}

/** UTF-8 (BOM stripped); falls back to Windows-1252 for legacy ANSI files (old DXF/OBJ/MTL). */
export function decodeText(bytes: Uint8Array): string {
  let b: Uint8Array = bytes
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) b = b.subarray(3)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b)
  } catch {
    return new TextDecoder('windows-1252').decode(b)
  }
}

export function encodeText(text: string): Bytes {
  return new TextEncoder().encode(text)
}

export const extname = (name: string): string => {
  const base = basename(name)
  const i = base.lastIndexOf('.')
  return i > 0 ? base.slice(i).toLowerCase() : ''
}
export const basename = (name: string): string => name.split(/[\\/]/).pop() ?? name
export const stem = (name: string): string => {
  const base = basename(name)
  const i = base.lastIndexOf('.')
  return i > 0 ? base.slice(0, i) : base
}

/** Safe file name stem for exports. */
export function safeFileName(name: string, fallback = 'export'): string {
  const s = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, ' ').trim()
  return s.slice(0, 120) || fallback
}

export function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false
  for (let i = 0; i < sig.length; i++) if (bytes[offset + i] !== sig[i]) return false
  return true
}

export function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  let s = ''
  for (let i = offset; i < Math.min(bytes.length, offset + length); i++) s += String.fromCharCode(bytes[i]!)
  return s
}

/** MIME type of an image blob by magic bytes (null if unknown). */
export function sniffImageMime(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return 'image/png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (asciiAt(bytes, 0, 4) === 'RIFF' && asciiAt(bytes, 8, 4) === 'WEBP') return 'image/webp'
  if (asciiAt(bytes, 0, 3) === 'GIF') return 'image/gif'
  if (asciiAt(bytes, 0, 2) === 'BM') return 'image/bmp'
  if (asciiAt(bytes, 4, 8) === 'ftypavif') return 'image/avif'
  if (startsWith(bytes, [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30])) return 'image/ktx2'
  return null
}

export const IMAGE_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
  'image/ktx2': 'ktx2',
}

/** Pixel size of PNG / JPEG / WebP / GIF / BMP images from their headers (no decoding). */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const mime = sniffImageMime(bytes)
  try {
    if (mime === 'image/png') return { width: dv.getUint32(16), height: dv.getUint32(20) }
    if (mime === 'image/gif') return { width: dv.getUint16(6, true), height: dv.getUint16(8, true) }
    if (mime === 'image/bmp') return { width: Math.abs(dv.getInt32(18, true)), height: Math.abs(dv.getInt32(22, true)) }
    if (mime === 'image/webp') {
      const chunk = asciiAt(bytes, 12, 4)
      if (chunk === 'VP8 ') return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff }
      if (chunk === 'VP8L') {
        const b = dv.getUint32(21, true)
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }
      }
      if (chunk === 'VP8X') {
        const w = bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16)
        const h = bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16)
        return { width: w + 1, height: h + 1 }
      }
      return null
    }
    if (mime === 'image/jpeg') {
      let i = 2
      while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xff) {
          i++
          continue
        }
        const marker = bytes[i + 1]!
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          i += 2
          continue
        }
        const len = dv.getUint16(i + 2)
        // SOF0..SOF15 except DHT (C4), JPG (C8), DAC (CC)
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { width: dv.getUint16(i + 7), height: dv.getUint16(i + 5) }
        }
        i += 2 + len
      }
    }
  } catch {
    return null
  }
  return null
}

export const isBrowser = (): boolean => typeof window !== 'undefined' && typeof document !== 'undefined'

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException('Import aborted', 'AbortError')
}

/** Yield to the event loop so progress callbacks can repaint during long loops. */
export const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
