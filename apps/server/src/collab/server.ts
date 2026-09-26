// Real-time collaboration: Hocuspocus (Yjs) on our own HTTP server at /collab.
//  • onAuthenticate resolves the better-auth session cookie (or a share-link token) → project role;
//    viewers/commenters get read-only connections.
//  • Persistence: collab_docs (debounced by Hocuspocus), optional AES-256-GCM at rest.
//  • Access changes (member removed, link deleted, ban, logout, …) re-check live connections and
//    close those that lost access or changed read-only mode.
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { Database } from '@hocuspocus/extension-database'
import { Hocuspocus, type afterUnloadDocumentPayload, type beforeHandleAwarenessPayload, type Connection, type Extension, type onAuthenticatePayload, type onChangePayload, type onStoreDocumentPayload, type WebSocketLike } from '@hocuspocus/server'
import nodeAdapter from 'crossws/adapters/node'
import { eq, sql } from 'drizzle-orm'
import * as Y from 'yjs'
import { docNames } from '@cadsandbox/shared'
import type { Auth } from '../auth/auth'
import type { Db } from '../db/client'
import { collabDocs, projects } from '../db/schema'
import type { CollabContext, CollabService } from '../deps'
import type { Config } from '../env'
import { openRecord, sealRecord, type KeyRing } from '../lib/crypto'
import type { IpHasher, ProxyTrust } from '../lib/ip'
import type { Logger } from '../log'
import type { RateLimiter } from '../http/rate-limit'
import { LIMIT_RULES } from '../http/rate-limit'
import { audit, type AuditThrottle } from '../services/audit'
import type { AccessEvents } from '../services/events'
import type { ShareGrants } from '../services/share-grants'
import { refreshProjectSize, storageUsage } from '../services/projects'
import { decideCollabAccess, stillAllowed } from './auth'

export interface CollabDeps {
  config: Config
  log: Logger
  db: Db
  auth: Auth
  ring: KeyRing
  events: AccessEvents
  limiter: RateLimiter
  ipHasher: IpHasher
  proxy: ProxyTrust
  auditThrottle: AuditThrottle
  grants: ShareGrants
}

const docAad = (name: string) => `collab:${name}`

export async function loadDocState(db: Db, ring: KeyRing, name: string): Promise<Uint8Array | null> {
  const [row] = await db.select({ state: collabDocs.state, encrypted: collabDocs.encrypted }).from(collabDocs).where(eq(collabDocs.name, name)).limit(1)
  if (!row) return null
  return row.encrypted ? new Uint8Array(openRecord(ring, row.state, docAad(name))) : row.state
}

export async function saveDocState(db: Db, ring: KeyRing, name: string, projectId: string, state: Uint8Array): Promise<void> {
  const encrypted = !!ring.current
  const stored = encrypted ? sealRecord(ring, state, docAad(name)) : state
  const values = { name, projectId, state: stored, encrypted, size: state.byteLength, updatedAt: new Date() }
  await db
    .insert(collabDocs)
    .values(values)
    .onConflictDoUpdate({ target: collabDocs.name, set: { state: stored, encrypted, size: state.byteLength, updatedAt: values.updatedAt } })
}

/**
 * Store a live document by MERGING it with the stored state (CRDT union) instead of overwriting.
 * During zero-downtime deploys two app containers overlap and may both hold the same document; a
 * plain overwrite would drop edits that only reached the other container. The row lock serializes
 * concurrent writers; merging two states of the same document is always safe for Yjs.
 */
export async function mergeDocState(db: Db, ring: KeyRing, name: string, projectId: string, state: Uint8Array): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ state: collabDocs.state, encrypted: collabDocs.encrypted })
      .from(collabDocs)
      .where(eq(collabDocs.name, name))
      .limit(1)
      .for('update')
    let merged = state
    if (row && row.state.byteLength) {
      const existing = row.encrypted ? new Uint8Array(openRecord(ring, row.state, docAad(name))) : row.state
      merged = Y.mergeUpdates([existing, state])
    }
    await saveDocState(tx as unknown as Db, ring, name, projectId, merged)
  })
}

export function createCollab(d: CollabDeps): CollabService {
  const { config, log, db, ring } = d
  const trusted = new Set(config.trustedOrigins)
  const deletedProjects = new Set<string>()
  const limits = { storageQuotaBytes: config.storageQuotaBytes, maxDocBytes: config.collabMaxDocBytes }
  const access = { db, auth: d.auth, publicSharing: config.features.publicSharing, grants: d.grants, limits }
  /** Approximate size of each loaded document: its stored size plus the updates received since. */
  const docBytes = new Map<string, number>()
  /** Documents that crossed the size limit: connections switched to read-only (with their previous mode). */
  const oversize = new Map<string, Map<Connection, boolean>>()
  /** Owners whose storage was checked recently (ownerId → time), to keep the check off the hot path. */
  const quotaChecked = new Map<string, number>()

  const persistence = new Database({
    fetch: async ({ documentName }) => {
      const state = await loadDocState(db, ring, documentName)
      docBytes.set(documentName, state?.byteLength ?? 0)
      return state
    },
    store: async ({ documentName, state }) => {
      docBytes.set(documentName, state.byteLength)
      const parsed = docNames.parse(documentName)
      if (!parsed || deletedProjects.has(parsed.projectId)) return
      try {
        await mergeDocState(db, ring, documentName, parsed.projectId, state)
      } catch (err) {
        // Project deleted while the doc was live (FK violation) — nothing to keep.
        log.warn({ doc: documentName, err: (err as Error).message }, 'collab store skipped')
      }
    },
  })

  const lifecycle: Extension = {
    extensionName: 'cadsandbox-auth',
    async onAuthenticate(data: onAuthenticatePayload) {
      const token = data.token || data.requestParameters.get('token') || null
      const decision = await decideCollabAccess(access, { documentName: data.documentName, headers: data.requestHeaders, token })
      const ip = (data.context as { ip?: string | null })?.ip ?? null
      if (!decision.ok) {
        if (decision.reason === 'impersonation') {
          // Content blocked for an impersonating admin: record the attempt (de-duplicated per admin/doc).
          if (d.auditThrottle.shouldLog(`impersonation-denied:${decision.impersonatedBy}:${data.documentName}`)) {
            const meta = { impersonatedUserId: decision.userId, doc: data.documentName, channel: 'collab', reason: 'no_support_grant' }
            await audit(db, { actorId: decision.impersonatedBy, action: 'admin.impersonate.content_denied', targetType: 'project', targetId: decision.projectId, ip, meta }, log)
          }
          // The client shows "content is hidden while impersonating" for this reason.
          throw Object.assign(new Error(decision.reason), { reason: 'impersonation-content-blocked' })
        }
        throw Object.assign(new Error(decision.reason), { reason: decision.reason === 'bad-document' ? 'invalid-document' : 'permission-denied' })
      }
      data.connectionConfig.readOnly = decision.readOnly
      const ctx = decision.context
      if (ctx.impersonatedBy) {
        // Every content access during impersonation is audited (one entry per document connection).
        const meta = { impersonatedUserId: ctx.userId, doc: data.documentName, channel: 'collab' }
        await audit(db, { actorId: ctx.impersonatedBy, action: 'admin.impersonate.content', targetType: 'project', targetId: ctx.projectId, ip, meta }, log)
      } else if (ctx.via === 'support' && d.auditThrottle.shouldLog(`collab:${ctx.userId}:${ctx.projectId}`)) {
        await audit(db, { actorId: ctx.userId, action: 'support.project.access', targetType: 'project', targetId: ctx.projectId, ip, meta: { doc: data.documentName, channel: 'collab' } }, log)
      }
      return ctx
    },
    // Presence can't be used to impersonate: the server stamps the authenticated identity into
    // `state.user` and drops oversized states.
    async beforeHandleAwareness(data: beforeHandleAwarenessPayload) {
      const ctx = data.context as CollabContext | undefined
      if (!ctx?.projectId) return
      for (const [clientId, state] of data.states) {
        if (!state || typeof state !== 'object') continue
        if (JSON.stringify(state).length > 64 * 1024) {
          data.states.delete(clientId)
          continue
        }
        const user = state.user
        if (user && typeof user === 'object') {
          state.user = { ...(user as Record<string, unknown>), id: ctx.userId, name: ctx.userName ?? 'Guest', anonymous: !ctx.userId }
        }
      }
    },
    // Size limit per design: stop the growth at once (read-only), store, then decide in afterStoreDocument.
    async onChange(data: onChangePayload) {
      const name = data.documentName
      const size = (docBytes.get(name) ?? 0) + data.update.byteLength
      docBytes.set(name, size)
      if (size <= limits.maxDocBytes || oversize.has(name)) return
      const previous = new Map<Connection, boolean>()
      for (const conn of data.document.connections.keys()) {
        previous.set(conn, conn.readOnly)
        conn.readOnly = true
      }
      oversize.set(name, previous)
      hocuspocus.flushPendingStores()
    },
    async afterStoreDocument(data: onStoreDocumentPayload) {
      const parsed = docNames.parse(data.documentName)
      if (!parsed || deletedProjects.has(parsed.projectId)) return
      try {
        if (!parsed.fileId) await syncManifestInfo(parsed.projectId, data.document)
        await refreshProjectSize(db, parsed.projectId, true)
        await enforceLimits(parsed.projectId, data.documentName)
      } catch (err) {
        log.warn({ doc: data.documentName, err: (err as Error).message }, 'project touch failed')
      }
    },
    async afterUnloadDocument(data: afterUnloadDocumentPayload) {
      docBytes.delete(data.documentName)
      oversize.delete(data.documentName)
    },
  }

  const closeForAccess = (conn: Connection) => conn.close({ code: 4403, reason: 'access-changed' } as unknown as Parameters<Connection['close']>[0])

  /**
   * After a store: connections that must turn read-only (design too large, or the owner ran out of
   * storage) are closed — the clients reopen the project and learn why from its `writeBlock`.
   */
  async function enforceLimits(projectId: string, name: string) {
    const flipped = oversize.get(name)
    if (flipped) {
      oversize.delete(name)
      if ((docBytes.get(name) ?? 0) <= limits.maxDocBytes) {
        // The running estimate was high (updates overlap); the stored design is within the limit.
        // Updates dropped while read-only must be re-sent: a transient close makes clients resync.
        for (const [conn, readOnly] of flipped) {
          conn.readOnly = readOnly
          conn.close({ code: 4000, reason: 'resync' } as unknown as Parameters<Connection['close']>[0])
        }
      } else {
        log.warn({ doc: name, bytes: docBytes.get(name) }, 'design over the size limit — now read-only')
        for (const conn of flipped.keys()) closeForAccess(conn)
      }
    }
    const [p] = await db.select({ ownerId: projects.ownerId }).from(projects).where(eq(projects.id, projectId)).limit(1)
    if (!p) return
    const now = Date.now()
    if (now - (quotaChecked.get(p.ownerId) ?? 0) < 30_000) return
    if (quotaChecked.size > 5000) for (const [k, t] of quotaChecked) if (now - t >= 30_000) quotaChecked.delete(k)
    quotaChecked.set(p.ownerId, now)
    if ((await storageUsage(db, p.ownerId)) < limits.storageQuotaBytes) return
    for (const { conn } of liveConnections((c) => c.ownerId === p.ownerId)) if (!conn.readOnly) closeForAccess(conn)
  }

  /** Keep projects.name/description in sync with renames made in the editor. */
  async function syncManifestInfo(projectId: string, doc: Y.Doc) {
    const info = doc.getMap<unknown>('project')
    const name = info.get('name')
    const description = info.get('description')
    const patch: { name?: string; description?: string } = {}
    if (typeof name === 'string' && name.trim()) patch.name = name.trim().slice(0, 120)
    if (typeof description === 'string') patch.description = description.slice(0, 2000)
    if (!Object.keys(patch).length) return
    await db
      .update(projects)
      .set(patch)
      .where(sql`${projects.id} = ${projectId} AND (${projects.name} IS DISTINCT FROM ${patch.name ?? null} OR ${projects.description} IS DISTINCT FROM ${patch.description ?? null})`)
  }

  const hocuspocus = new Hocuspocus({
    name: 'cadsandbox',
    quiet: true,
    debounce: 2000,
    maxDebounce: 10_000,
    timeout: 30_000,
    extensions: [lifecycle, persistence],
  })

  const adapter = nodeAdapter({
    serverOptions: { maxPayload: config.collabMaxMessageBytes },
    hooks: {
      open(peer) {
        const req = peer.request as Request
        const ip = d.proxy.resolve(peer.remoteAddress ?? null, req.headers.get('x-forwarded-for'))
        const conn = hocuspocus.handleConnection(peer.websocket as unknown as WebSocketLike, req, { ip })
        ;(peer as unknown as { _hp?: typeof conn })._hp = conn
      },
      message(peer, message) {
        ;(peer as unknown as { _hp?: { handleMessage(d: Uint8Array): void } })._hp?.handleMessage(message.uint8Array())
      },
      close(peer, event) {
        ;(peer as unknown as { _hp?: { handleClose(e: { code?: number; reason?: string }): void } })._hp?.handleClose({ code: event.code, reason: event.reason })
      },
      error(_peer, error) {
        log.warn({ err: (error as Error).message }, 'collab socket error')
      },
    },
  })

  function reject(socket: Duplex, status: number, text: string) {
    socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
    socket.destroy()
  }

  function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    const path = (req.url ?? '/').split('?')[0]
    if (path !== config.collabPath || !config.features.collab) return reject(socket, 404, 'Not Found')
    // Cross-site WebSocket hijacking: browsers send cookies with any WS handshake — Origin must be ours.
    const origin = req.headers.origin
    if (!origin || !trusted.has(origin)) return reject(socket, 403, 'Forbidden')
    const ip = d.proxy.resolve(req.socket.remoteAddress ?? null, (req.headers['x-forwarded-for'] as string | undefined) ?? null)
    const [max, win] = LIMIT_RULES.collabUpgradePerIp
    if (!d.limiter.hit(`collab:${d.ipHasher.hash(ip)}`, max, win).ok) return reject(socket, 429, 'Too Many Requests')
    adapter.handleUpgrade(req, socket, head).catch((err: unknown) => {
      log.warn({ err: (err as Error).message }, 'collab upgrade failed')
      socket.destroy()
    })
  }

  function liveConnections(filter: (ctx: CollabContext) => boolean): { conn: Connection; ctx: CollabContext }[] {
    const out: { conn: Connection; ctx: CollabContext }[] = []
    for (const doc of hocuspocus.documents.values()) {
      for (const conn of doc.connections.keys()) {
        const ctx = conn.context as CollabContext | undefined
        if (ctx?.projectId && filter(ctx)) out.push({ conn, ctx })
      }
    }
    return out
  }

  let revalidating = Promise.resolve()
  /** Re-check matching connections; close the ones that lost access (client re-auths if still allowed). */
  function revalidate(filter: (ctx: CollabContext) => boolean): Promise<void> {
    revalidating = revalidating.then(async () => {
      const cache = new Map<string, boolean>()
      for (const { conn, ctx } of liveConnections(filter)) {
        const key = `${ctx.projectId}|${ctx.userId}|${ctx.sessionId}|${ctx.shareToken}|${ctx.role}|${conn.readOnly}`
        let ok = cache.get(key)
        if (ok === undefined) {
          ok = await stillAllowed(access, ctx, conn.readOnly).catch(() => false)
          cache.set(key, ok)
        }
        if (!ok) closeForAccess(conn)
      }
    }).catch((err: unknown) => log.error({ err: (err as Error).message }, 'collab revalidation failed'))
    return revalidating
  }

  const offs = [
    d.events.on('project', (id) => void revalidate((c) => c.projectId === id)),
    d.events.on('user', (id) => void revalidate((c) => c.userId === id)),
    d.events.on('session', (id) => void revalidate((c) => c.sessionId === id)),
    d.events.on('org', () => void revalidate(() => true)),
  ]
  // Safety net: expiring sessions, links and support grants.
  const sweep = setInterval(() => void revalidate(() => true), 120_000)
  sweep.unref()

  return {
    enabled: config.features.collab,
    stats: () => ({ connections: hocuspocus.getConnectionsCount(), documents: hocuspocus.getDocumentsCount() }),
    async getState(name) {
      const live = hocuspocus.documents.get(name)
      if (live && !live.isLoading) return Y.encodeStateAsUpdate(live)
      return loadDocState(db, ring, name)
    },
    async transact(name, fn) {
      const conn = await hocuspocus.openDirectConnection(name, { server: true })
      try {
        await conn.transact((doc) => fn(doc))
      } finally {
        await conn.disconnect()
      }
    },
    async writeState(name, projectId, state) {
      if (hocuspocus.documents.has(name)) throw new Error('document is live')
      await saveDocState(db, ring, name, projectId, state)
    },
    liveDocNames(projectId) {
      return [...hocuspocus.documents.keys()].filter((n) => docNames.parse(n)?.projectId === projectId)
    },
    async closeProject(projectId) {
      deletedProjects.add(projectId)
      for (const { conn } of liveConnections((c) => c.projectId === projectId)) {
        conn.close({ code: 4404, reason: 'project-deleted' } as unknown as Parameters<Connection['close']>[0])
      }
      setTimeout(() => deletedProjects.delete(projectId), 10 * 60_000).unref()
    },
    handleUpgrade,
    async close() {
      clearInterval(sweep)
      for (const off of offs) off()
      hocuspocus.flushPendingStores()
      hocuspocus.closeConnections()
      adapter.closeAll(1001, 'server shutdown')
      // Documents unload once their pending store finished. The database closes right after this, so
      // wait for all of them — bounded by the 18 s force-exit in index.ts (≈5.5 s of it is used before).
      const until = Date.now() + 11_000
      while (hocuspocus.getDocumentsCount() > 0 && Date.now() < until) await new Promise((r) => setTimeout(r, 50))
      const left = hocuspocus.getDocumentsCount()
      if (left > 0) log.warn({ documents: left }, 'collab shutdown: documents still unsaved')
    },
  }
}
