// Content-addressed blobs: project blobs (/api/projects/:id/blobs/:hash) and the per-user asset space
// (/api/assets/:hash). Uploads are streamed, size-limited, quota-checked and sha256-verified; downloads
// get sanitised types, nosniff, a sandboxing CSP and immutable caching.
import { Readable } from 'node:stream'
import type { Hono } from 'hono'
import { and, eq, sql } from 'drizzle-orm'
import { LIMITS } from '@cadsandbox/shared'
import { rowsOf } from '../db/client'
import { blobs, projectBlobs, userAssets } from '../db/schema'
import { notFound, payloadTooLarge } from '../lib/errors'
import { limit, param, projectAccess, requireAuth, requireRealUser, type AppEnv, type Ctx } from '../http/context'
import { register } from '../http/router'
import { refreshProjectSize } from '../services/projects'
import { assertQuota, commitBlob, receiveBlob } from '../services/uploads'
import { isInlineSafe, safeContentType } from '../storage'

const HASH = /^[a-f0-9]{64}$/
const BLOB_CSP = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox"

type BlobRow = typeof blobs.$inferSelect

async function serveBlob(c: Ctx, b: BlobRow): Promise<Response> {
  const d = c.get('deps')
  const etag = `"${b.hash}"`
  const headers: Record<string, string> = {
    'Content-Type': safeContentType(b.mime),
    ETag: etag,
    'Cache-Control': 'private, max-age=31536000, immutable',
    'Content-Security-Policy': BLOB_CSP,
    'Content-Disposition': isInlineSafe(b.mime) ? 'inline' : `attachment; filename="${b.hash}"`,
  }
  if (c.req.header('if-none-match') === etag) return new Response(null, { status: 304, headers })
  if (c.req.method === 'HEAD') return new Response(null, { status: 200, headers: { ...headers, 'Content-Length': String(b.size) } })
  const stream = await d.blobs.get(b.hash, b.encrypted)
  if (!stream) {
    c.get('log').error({ hash: b.hash }, 'blob row without stored object')
    throw notFound('Blob not found')
  }
  stream.on('error', (err) => c.get('log').error({ hash: b.hash, err: err.message }, 'blob stream failed'))
  return new Response(Readable.toWeb(stream) as unknown as ReadableStream, { status: 200, headers: { ...headers, 'Content-Length': String(b.size) } })
}

function declaredLength(c: Ctx): number | null {
  const v = c.req.header('content-length')
  if (!v) return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : null
}

async function projectBlob(c: Ctx): Promise<Response> {
  const d = c.get('deps')
  const hash = param(c, 'hash', HASH)
  const a = await projectAccess(c, param(c, 'id'), 'view')
  const [b] = await d.db
    .select({ b: blobs })
    .from(projectBlobs)
    .innerJoin(blobs, eq(blobs.hash, projectBlobs.hash))
    .where(and(eq(projectBlobs.projectId, a.project.id), eq(projectBlobs.hash, hash)))
    .limit(1)
  if (!b) throw notFound('Blob not found')
  return serveBlob(c, b.b)
}

/** Assets are readable by their uploader and by anyone who can see a collection item referencing them. */
async function canReadAsset(c: Ctx, userId: string, hash: string): Promise<boolean> {
  const { db } = c.get('deps')
  const res = await db.execute(sql`SELECT 1 AS ok WHERE EXISTS (SELECT 1 FROM user_assets ua WHERE ua.user_id = ${userId} AND ua.hash = ${hash})
    OR EXISTS (
      SELECT 1 FROM collection_items ci JOIN collections col ON col.id = ci.collection_id
      WHERE ci.assets @> jsonb_build_array(${hash}::text)
        AND (col.owner_id = ${userId} OR (col.org_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM member m WHERE m.organization_id = col.org_id AND m.user_id = ${userId}))))`)
  return rowsOf(res).length > 0
}

export function blobRoutes(app: Hono<AppEnv>): void {
  register(app, 'getBlob', projectBlob)
  register(app, 'headBlob', projectBlob)

  register(app, 'putBlob', async (c) => {
    const s = requireAuth(c)
    const d = c.get('deps')
    const hash = param(c, 'hash', HASH)
    limit(c, 'uploadPerUser', s.user.id)
    limit(c, 'uploadPerIp', c.get('ipHash'))
    const a = await projectAccess(c, param(c, 'id'), 'edit')
    const [ref] = await d.db
      .select({ b: blobs })
      .from(projectBlobs)
      .innerJoin(blobs, eq(blobs.hash, projectBlobs.hash))
      .where(and(eq(projectBlobs.projectId, a.project.id), eq(projectBlobs.hash, hash)))
      .limit(1)
    if (ref) return c.json({ hash, size: ref.b.size, mime: ref.b.mime }, 200)
    const len = declaredLength(c)
    if (len !== null && len > LIMITS.maxBlobBytes) throw payloadTooLarge(`Files are limited to ${LIMITS.maxBlobBytes} bytes`)
    await assertQuota(d.db, a.project.ownerId, d.config.storageQuotaBytes, len ?? 0)
    const received = await receiveBlob(d.blobs, c.req.raw.body, hash, LIMITS.maxBlobBytes)
    await commitBlob(d.db, d.blobs, received, a.project.ownerId, d.config.storageQuotaBytes, async (tx) => {
      await tx.insert(projectBlobs).values({ projectId: a.project.id, hash }).onConflictDoNothing()
    })
    await refreshProjectSize(d.db, a.project.id, true)
    return c.json({ hash, size: received.size, mime: received.mime }, 201)
  })

  register(app, 'getAsset', async (c) => {
    // Library assets are user content; there is no support grant for them.
    const s = requireRealUser(c, 'The library is not available while impersonating a user')
    const d = c.get('deps')
    const hash = param(c, 'hash', HASH)
    if (!(await canReadAsset(c, s.user.id, hash))) throw notFound('Asset not found')
    const [b] = await d.db.select().from(blobs).where(eq(blobs.hash, hash)).limit(1)
    if (!b) throw notFound('Asset not found')
    return serveBlob(c, b)
  })

  register(app, 'putAsset', async (c) => {
    const s = requireRealUser(c, 'The library is not available while impersonating a user')
    const d = c.get('deps')
    const hash = param(c, 'hash', HASH)
    limit(c, 'uploadPerUser', s.user.id)
    limit(c, 'uploadPerIp', c.get('ipHash'))
    const [ref] = await d.db
      .select({ b: blobs })
      .from(userAssets)
      .innerJoin(blobs, eq(blobs.hash, userAssets.hash))
      .where(and(eq(userAssets.userId, s.user.id), eq(userAssets.hash, hash)))
      .limit(1)
    if (ref) return c.json({ hash, size: ref.b.size, mime: ref.b.mime }, 200)
    const len = declaredLength(c)
    if (len !== null && len > LIMITS.maxBlobBytes) throw payloadTooLarge(`Files are limited to ${LIMITS.maxBlobBytes} bytes`)
    await assertQuota(d.db, s.user.id, d.config.storageQuotaBytes, len ?? 0)
    const received = await receiveBlob(d.blobs, c.req.raw.body, hash, LIMITS.maxBlobBytes)
    await commitBlob(d.db, d.blobs, received, s.user.id, d.config.storageQuotaBytes, async (tx) => {
      await tx.insert(userAssets).values({ userId: s.user.id, hash }).onConflictDoNothing()
    })
    return c.json({ hash, size: received.size, mime: received.mime }, 201)
  })
}
