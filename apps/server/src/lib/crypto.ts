// Crypto primitives: ids/tokens, sha256, scrypt secrets, AES-256-GCM at-rest encryption.
//
// At-rest encryption (optional, STORAGE_ENCRYPTION_KEY = 32 random bytes, base64):
//  • Every record/object gets its own key: HKDF-SHA256(master, random 16-byte salt).
//  • Associated data binds the ciphertext to its identity (e.g. "collab:<docName>", "blob:<sha256>"),
//    so ciphertexts cannot be swapped between records.
//  • A 4-byte key id (sha256(master)[0..4]) selects the master key → rotation via
//    STORAGE_ENCRYPTION_OLD_KEYS (decrypt-only).
//  Record format  "CSE1" | keyId(4) | salt(16) | iv(12) | ciphertext | tag(16)
//  Stream format  "CSS1" | keyId(4) | salt(16) | segments…  (64 KiB plaintext segments, each sealed
//                 with nonce = 0^7 | uint32 index | lastFlag — truncation and reordering are detected,
//                 plaintext is only released after each segment authenticates.)
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'
import { Transform, type TransformCallback } from 'node:stream'

export const sha256Hex = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex')
/** 128-bit random id, base64url (22 chars, matches the collab doc-name charset). */
export const newId = (): string => randomBytes(16).toString('base64url')
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url')
export const hashToken = (token: string): string => sha256Hex(`share-link:${token}`)

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

// ------------------------------------------------------------------ scrypt secrets (share-link passwords)

function scryptAsync(pw: string, salt: Buffer, len: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((res, rej) => scrypt(pw, salt, len, opts, (err, key) => (err ? rej(err) : res(key))))
}

const SCRYPT = { N: 32768, r: 8, p: 1 }

export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scryptAsync(secret.normalize('NFKC'), salt, 32, { ...SCRYPT, maxmem: 128 * 1024 * 1024 })
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${key.toString('base64url')}`
}

export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, saltB64, keyB64] = stored.split('$')
  if (alg !== 'scrypt' || !saltB64 || !keyB64) return false
  const expected = Buffer.from(keyB64, 'base64url')
  const key = await scryptAsync(secret.normalize('NFKC'), Buffer.from(saltB64, 'base64url'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 128 * 1024 * 1024,
  })
  return key.length === expected.length && timingSafeEqual(key, expected)
}

// ------------------------------------------------------------------ key ring

export interface KeyRing {
  /** Current key (encrypt + decrypt); null → encryption disabled. */
  current: { id: Buffer; key: Buffer } | null
  byId: Map<string, Buffer>
}

export function createKeyRing(currentB64: string | undefined, oldB64: string[] = []): KeyRing {
  const byId = new Map<string, Buffer>()
  const add = (b64: string) => {
    const key = Buffer.from(b64, 'base64')
    if (key.length !== 32) throw new Error('encryption keys must be 32 bytes')
    const id = createHash('sha256').update(key).digest().subarray(0, 4)
    byId.set(id.toString('hex'), key)
    return { id, key }
  }
  for (const k of oldB64) add(k)
  return { current: currentB64 ? add(currentB64) : null, byId }
}

const REC_MAGIC = Buffer.from('CSE1')
const STREAM_MAGIC = Buffer.from('CSS1')
const HEADER_LEN = 4 + 4 + 16
const TAG = 16
export const SEGMENT = 64 * 1024

function subKey(master: Buffer, salt: Buffer, info: string): Buffer {
  return Buffer.from(hkdfSync('sha256', master, salt, info, 32))
}

function lookupKey(ring: KeyRing, header: Buffer, magic: Buffer): { key: Buffer; salt: Buffer } {
  if (header.length < HEADER_LEN || !header.subarray(0, 4).equals(magic)) throw new Error('not an encrypted record')
  const master = ring.byId.get(header.subarray(4, 8).toString('hex'))
  if (!master) throw new Error('unknown encryption key id — is STORAGE_ENCRYPTION_KEY / _OLD_KEYS complete?')
  return { key: master, salt: header.subarray(8, 24) }
}

/** Encrypt a small record (collab doc state, version). */
export function sealRecord(ring: KeyRing, plaintext: Uint8Array, aad: string): Buffer {
  if (!ring.current) throw new Error('encryption disabled')
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', subKey(ring.current.key, salt, 'cadsandbox/record/v1'), iv)
  cipher.setAAD(Buffer.from(aad))
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return Buffer.concat([REC_MAGIC, ring.current.id, salt, iv, ct, cipher.getAuthTag()])
}

export function openRecord(ring: KeyRing, sealed: Uint8Array, aad: string): Buffer {
  const buf = Buffer.from(sealed.buffer, sealed.byteOffset, sealed.byteLength)
  const { key, salt } = lookupKey(ring, buf, REC_MAGIC)
  if (buf.length < HEADER_LEN + 12 + TAG) throw new Error('truncated record')
  const iv = buf.subarray(HEADER_LEN, HEADER_LEN + 12)
  const decipher = createDecipheriv('aes-256-gcm', subKey(key, salt, 'cadsandbox/record/v1'), iv)
  decipher.setAAD(Buffer.from(aad))
  decipher.setAuthTag(buf.subarray(buf.length - TAG))
  return Buffer.concat([decipher.update(buf.subarray(HEADER_LEN + 12, buf.length - TAG)), decipher.final()])
}

function segmentNonce(index: number, last: boolean): Buffer {
  const n = Buffer.alloc(12)
  n.writeUInt32BE(index, 7)
  n[11] = last ? 1 : 0
  return n
}

function sealSegment(key: Buffer, aad: Buffer, index: number, last: boolean, chunk: Buffer): Buffer {
  const c = createCipheriv('aes-256-gcm', key, segmentNonce(index, last))
  c.setAAD(aad)
  return Buffer.concat([c.update(chunk), c.final(), c.getAuthTag()])
}

function openSegment(key: Buffer, aad: Buffer, index: number, last: boolean, seg: Buffer): Buffer {
  if (seg.length < TAG) throw new Error('truncated segment')
  const d = createDecipheriv('aes-256-gcm', key, segmentNonce(index, last))
  d.setAAD(aad)
  d.setAuthTag(seg.subarray(seg.length - TAG))
  return Buffer.concat([d.update(seg.subarray(0, seg.length - TAG)), d.final()])
}

/** Streaming encryptor (blobs). Output size = 24 + plaintext + 16 × ⌈segments⌉. */
export function encryptStream(ring: KeyRing, aad: string): Transform {
  if (!ring.current) throw new Error('encryption disabled')
  const salt = randomBytes(16)
  const key = subKey(ring.current.key, salt, 'cadsandbox/stream/v1')
  const ad = Buffer.from(aad)
  const header = Buffer.concat([STREAM_MAGIC, ring.current.id, salt])
  let buf: Buffer = Buffer.alloc(0)
  let index = 0
  let headerSent = false
  const emitHeader = (t: Transform) => {
    if (!headerSent) {
      t.push(header)
      headerSent = true
    }
  }
  return new Transform({
    transform(chunk: Buffer, _enc, cb: TransformCallback) {
      emitHeader(this)
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk
      // Keep at least one byte back so the final segment is always emitted by flush().
      while (buf.length > SEGMENT) {
        this.push(sealSegment(key, ad, index++, false, buf.subarray(0, SEGMENT)))
        buf = buf.subarray(SEGMENT)
      }
      cb()
    },
    flush(cb: TransformCallback) {
      emitHeader(this)
      this.push(sealSegment(key, ad, index++, true, buf))
      cb()
    },
  })
}

export function decryptStream(ring: KeyRing, aad: string): Transform {
  const ad = Buffer.from(aad)
  let key: Buffer | null = null
  let buf: Buffer = Buffer.alloc(0)
  let index = 0
  const SEG = SEGMENT + TAG
  return new Transform({
    transform(chunk: Buffer, _enc, cb: TransformCallback) {
      try {
        buf = buf.length ? Buffer.concat([buf, chunk]) : chunk
        if (!key) {
          if (buf.length < HEADER_LEN) return cb()
          const k = lookupKey(ring, buf.subarray(0, HEADER_LEN), STREAM_MAGIC)
          key = subKey(k.key, k.salt, 'cadsandbox/stream/v1')
          buf = buf.subarray(HEADER_LEN)
        }
        while (buf.length > SEG) {
          this.push(openSegment(key, ad, index++, false, buf.subarray(0, SEG)))
          buf = buf.subarray(SEG)
        }
        cb()
      } catch (err) {
        cb(err as Error)
      }
    },
    flush(cb: TransformCallback) {
      try {
        if (!key) throw new Error('truncated encrypted stream')
        this.push(openSegment(key, ad, index++, true, buf))
        cb()
      } catch (err) {
        cb(err as Error)
      }
    },
  })
}

/** Plaintext size of an encrypted stream of `cipherLen` bytes. */
export function plainStreamSize(cipherLen: number): number {
  const body = cipherLen - HEADER_LEN
  const segs = Math.max(1, Math.ceil(body / (SEGMENT + TAG)))
  return body - segs * TAG
}
