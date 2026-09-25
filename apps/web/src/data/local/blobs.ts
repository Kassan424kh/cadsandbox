// Content-addressed blob store (sha256 hex via WebCrypto) + project → blob references.
import { db, type BlobRecord } from './db'

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'))

export async function sha256Hex(bytes: BufferSource): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  let out = ''
  for (const b of digest) out += HEX[b]
  return out
}

export const isHash = (s: string): boolean => /^[a-f0-9]{64}$/.test(s)

/** Copy into a standalone ArrayBuffer (views may share a larger buffer). */
export function toArrayBuffer(bytes: Uint8Array | ArrayBuffer): ArrayBuffer {
  if (bytes instanceof ArrayBuffer) return bytes
  return bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer
    : (bytes.slice().buffer as ArrayBuffer)
}

export async function getBlob(hash: string): Promise<BlobRecord | undefined> {
  return (await db()).get('blobs', hash)
}

export async function hasBlob(hash: string): Promise<boolean> {
  return (await (await db()).getKey('blobs', hash)) !== undefined
}

/** Store bytes (dedupes by hash). Returns the hash. */
export async function putBlob(bytes: Uint8Array | ArrayBuffer, mime: string, knownHash?: string): Promise<string> {
  const buf = toArrayBuffer(bytes)
  const hash = knownHash ?? (await sha256Hex(buf))
  const d = await db()
  if ((await d.getKey('blobs', hash)) === undefined) {
    await d.put('blobs', { hash, bytes: buf, mime: mime || 'application/octet-stream', size: buf.byteLength, createdAt: Date.now() })
  }
  return hash
}

/** Record that `projectId` references `hash`. `pending` marks it for upload (cloud projects). */
export async function linkBlob(projectId: string, hash: string, pending: boolean): Promise<void> {
  const d = await db()
  const cur = await d.get('projectBlobs', [projectId, hash])
  if (cur && (cur.pending === 0 || pending)) return
  await d.put('projectBlobs', { projectId, hash, pending: pending ? 1 : 0, addedAt: cur?.addedAt ?? Date.now() })
}

export async function markUploaded(projectId: string, hash: string): Promise<void> {
  const d = await db()
  const cur = await d.get('projectBlobs', [projectId, hash])
  if (cur) await d.put('projectBlobs', { ...cur, pending: 0 })
}

export async function projectBlobHashes(projectId: string): Promise<string[]> {
  const rows = await (await db()).getAllFromIndex('projectBlobs', 'byProject', projectId)
  return rows.map((r) => r.hash)
}

export async function pendingBlobHashes(projectId: string): Promise<string[]> {
  const rows = await (await db()).getAllFromIndex('projectBlobs', 'byPending', [projectId, 1])
  return rows.map((r) => r.hash)
}

/** Drop a project's blob references and delete blobs nobody references any more. */
export async function releaseProjectBlobs(projectId: string, keepLibraryHashes: ReadonlySet<string> = new Set()): Promise<void> {
  const d = await db()
  const rows = await d.getAllFromIndex('projectBlobs', 'byProject', projectId)
  for (const r of rows) {
    await d.delete('projectBlobs', [projectId, r.hash])
    const others = await d.countFromIndex('projectBlobs', 'byHash', r.hash)
    if (others === 0 && !keepLibraryHashes.has(r.hash)) await d.delete('blobs', r.hash)
  }
}
