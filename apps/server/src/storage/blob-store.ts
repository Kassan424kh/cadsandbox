// Content-addressed blob storage with optional at-rest encryption on top of an ObjectStore
// (local disk or S3-compatible). Keys: "ab/cd/<sha256>" (plaintext) or "ab/cd/<sha256>.enc".
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { decryptStream, encryptStream, newId, type KeyRing } from '../lib/crypto'

export interface ObjectStore {
  readonly kind: 'local' | 's3'
  /** Move/upload a finished local file to `key` (the file is consumed). Must be atomic for readers. */
  putFile(key: string, path: string, size: number): Promise<void>
  get(key: string): Promise<Readable | null>
  exists(key: string): Promise<boolean>
  delete(key: string): Promise<void>
}

export const blobKey = (hash: string, encrypted: boolean) => `${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}${encrypted ? '.enc' : ''}`
export const blobAad = (hash: string) => `blob:${hash}`
export const isSha256Hex = (s: string) => /^[a-f0-9]{64}$/.test(s)

export class BlobStore {
  constructor(
    readonly objects: ObjectStore,
    readonly ring: KeyRing,
    readonly tmpDir: string,
  ) {}

  get encrypting(): boolean {
    return !!this.ring.current
  }

  async tmpPath(): Promise<string> {
    await mkdir(this.tmpDir, { recursive: true })
    return join(this.tmpDir, `${newId()}.part`)
  }

  /** Transform that encrypts for `hash` when encryption is on (used while receiving uploads). */
  encryptorFor(hash: string) {
    return this.ring.current ? encryptStream(this.ring, blobAad(hash)) : null
  }

  /** Commit a received temp file (already encrypted iff `encrypted`). */
  async commitFile(hash: string, path: string, encrypted: boolean): Promise<void> {
    try {
      const { size } = await stat(path)
      await this.objects.putFile(blobKey(hash, encrypted), path, size)
    } finally {
      await rm(path, { force: true })
    }
  }

  /** Store a small in-memory blob (thumbnails, generated files). */
  async putBuffer(hash: string, data: Uint8Array): Promise<{ encrypted: boolean }> {
    const path = await this.tmpPath()
    const enc = this.encryptorFor(hash)
    const src = Readable.from([Buffer.from(data.buffer, data.byteOffset, data.byteLength)])
    if (enc) await pipeline(src, enc, createWriteStream(path, { mode: 0o600 }))
    else await pipeline(src, createWriteStream(path, { mode: 0o600 }))
    await this.commitFile(hash, path, !!enc)
    return { encrypted: !!enc }
  }

  /** Plaintext stream of a blob, or null if missing. */
  async get(hash: string, encrypted: boolean): Promise<Readable | null> {
    const raw = await this.objects.get(blobKey(hash, encrypted))
    if (!raw || !encrypted) return raw
    const dec = decryptStream(this.ring, blobAad(hash))
    raw.on('error', (err) => dec.destroy(err))
    return raw.pipe(dec)
  }

  async getBuffer(hash: string, encrypted: boolean, maxBytes = 64 * 1024 * 1024): Promise<Buffer | null> {
    const s = await this.get(hash, encrypted)
    if (!s) return null
    const chunks: Buffer[] = []
    let total = 0
    for await (const c of s) {
      total += (c as Buffer).length
      if (total > maxBytes) {
        s.destroy()
        throw new Error('blob too large for buffering')
      }
      chunks.push(c as Buffer)
    }
    return Buffer.concat(chunks)
  }

  exists(hash: string, encrypted: boolean): Promise<boolean> {
    return this.objects.exists(blobKey(hash, encrypted))
  }

  async delete(hash: string): Promise<void> {
    await Promise.all([this.objects.delete(blobKey(hash, false)), this.objects.delete(blobKey(hash, true))])
  }
}

/** Read a local file as a stream (helper for adapters). */
export const fileStream = (path: string) => createReadStream(path)
