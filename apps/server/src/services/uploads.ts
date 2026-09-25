// Streaming uploads: size-limited, sha256-verified, MIME-sniffed, encrypted on the fly (if enabled),
// then committed to content-addressed storage. Quota is charged to the project owner / asset owner.
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { Readable, Transform, type TransformCallback } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeWebStream } from 'node:stream/web'
import { and, eq, sql } from 'drizzle-orm'
import { blobs } from '../db/schema'
import type { Db, Tx } from '../db/client'
import { badRequest, HttpError, payloadTooLarge, quotaExceeded } from '../lib/errors'
import { sniffMime, type BlobStore } from '../storage'
import { storageUsage } from './projects'

export interface ReceivedBlob {
  path: string
  size: number
  hash: string
  mime: string
  encrypted: boolean
}

/** Read a small request body fully (thumbnails), enforcing `maxBytes`. */
export async function readLimited(body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<Buffer> {
  if (!body) return Buffer.alloc(0)
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of Readable.fromWeb(body as unknown as NodeWebStream<Uint8Array>)) {
    total += (chunk as Buffer).length
    if (total > maxBytes) throw payloadTooLarge()
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

/** Stream a request body to a temp file while hashing; rejects on size overflow or hash mismatch. */
export async function receiveBlob(store: BlobStore, body: ReadableStream<Uint8Array> | null, expectedHash: string, maxBytes: number): Promise<ReceivedBlob> {
  if (!body) throw badRequest('Request body required')
  const path = await store.tmpPath()
  const hash = createHash('sha256')
  let size = 0
  let head = Buffer.alloc(0)
  const meter = new Transform({
    transform(chunk: Buffer, _enc, cb: TransformCallback) {
      size += chunk.length
      if (size > maxBytes) return cb(payloadTooLarge(`File exceeds ${maxBytes} bytes`))
      hash.update(chunk)
      if (head.length < 4096) head = Buffer.concat([head, chunk.subarray(0, 4096 - head.length)])
      cb(null, chunk)
    },
  })
  const enc = store.encryptorFor(expectedHash)
  const source = Readable.fromWeb(body as unknown as NodeWebStream<Uint8Array>)
  const sink = createWriteStream(path, { mode: 0o600 })
  try {
    if (enc) await pipeline(source, meter, enc, sink)
    else await pipeline(source, meter, sink)
  } catch (err) {
    await rm(path, { force: true })
    if (err instanceof HttpError) throw err
    throw badRequest('Upload interrupted')
  }
  const digest = hash.digest('hex')
  if (digest !== expectedHash) {
    await rm(path, { force: true })
    throw badRequest('Content hash does not match the sha256 in the URL')
  }
  return { path, size, hash: digest, mime: sniffMime(head), encrypted: !!enc }
}

/** Does `userId` already pay for this blob (owned project, own asset, own thumbnail)? */
async function alreadyCharged(tx: Tx | Db, userId: string, hash: string): Promise<boolean> {
  const res = await tx.execute(sql`SELECT 1 AS x WHERE EXISTS (
      SELECT 1 FROM project_blobs pb JOIN projects p ON p.id = pb.project_id WHERE p.owner_id = ${userId} AND pb.hash = ${hash})
    OR EXISTS (SELECT 1 FROM user_assets ua WHERE ua.user_id = ${userId} AND ua.hash = ${hash})
    OR EXISTS (SELECT 1 FROM projects p WHERE p.owner_id = ${userId} AND p.thumbnail_hash = ${hash})`)
  return ((res as { rows?: unknown[] }).rows ?? []).length > 0
}

export async function assertQuota(db: Db, userId: string, quota: number, extraBytes: number): Promise<void> {
  if (extraBytes <= 0) return
  const used = await storageUsage(db, userId)
  if (used + extraBytes > quota) throw quotaExceeded()
}

/**
 * Commit a received blob: store it (dedup by hash), register the row, and run `link` (the reference
 * insert) inside a transaction that re-checks the payer's quota under an advisory lock.
 */
export async function commitBlob(
  db: Db,
  store: BlobStore,
  received: ReceivedBlob,
  payerId: string,
  quota: number,
  link: (tx: Tx) => Promise<void>,
): Promise<void> {
  try {
    const [existing] = await db.select().from(blobs).where(eq(blobs.hash, received.hash)).limit(1)
    const stored = existing ? await store.exists(existing.hash, existing.encrypted) : false
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`quota:${payerId}`}))`)
      if (!(await alreadyCharged(tx, payerId, received.hash))) {
        const used = await storageUsage(tx, payerId)
        if (used + received.size > quota) throw quotaExceeded()
      }
      if (!existing || !stored) {
        await store.commitFile(received.hash, received.path, received.encrypted)
        await tx
          .insert(blobs)
          .values({ hash: received.hash, size: received.size, mime: received.mime, encrypted: received.encrypted })
          .onConflictDoUpdate({ target: blobs.hash, set: { encrypted: received.encrypted, size: received.size, mime: received.mime } })
      }
      await link(tx)
    })
  } finally {
    await rm(received.path, { force: true })
  }
}

export async function blobRow(db: Db, hash: string) {
  const [row] = await db.select().from(blobs).where(and(eq(blobs.hash, hash))).limit(1)
  return row ?? null
}
