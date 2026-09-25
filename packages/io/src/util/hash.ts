// Content addressing (sha256 hex, WebCrypto) + a fast synchronous 128-bit hash for stable ids.
import { asBytes } from './bytes'

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'))

export function toHex(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += HEX[bytes[i]!]
  return s
}

/** sha256 of the bytes as lowercase hex — the content address of every blob. */
export async function sha256Hex(bytes: Uint8Array | ArrayBuffer): Promise<string> {
  const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : asBytes(bytes)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', view)
  return toHex(new Uint8Array(digest))
}

/** Deterministic 16 bytes from a string (cyrb128, 4 × 32-bit lanes). Not cryptographic —
 *  used for stable IFC GlobalIds so re-exports keep element identity. */
export function hash128(str: string): Uint8Array {
  let h1 = 1779033703,
    h2 = 3144134277,
    h3 = 1013904242,
    h4 = 2773480762
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i)
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067)
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233)
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213)
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179)
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067)
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233)
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213)
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179)
  h1 ^= h2 ^ h3 ^ h4
  h2 ^= h1
  h3 ^= h1
  h4 ^= h1
  const out = new Uint8Array(16)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, h1 >>> 0)
  dv.setUint32(4, h2 >>> 0)
  dv.setUint32(8, h3 >>> 0)
  dv.setUint32(12, h4 >>> 0)
  return out
}
