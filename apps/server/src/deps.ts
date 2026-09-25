// Dependency container shared by routes, jobs and the collab server.
import type * as Y from 'yjs'
import type { Auth } from './auth/auth'
import type { Db } from './db/client'
import type { Config } from './env'
import type { KeyRing } from './lib/crypto'
import type { IpHasher, ProxyTrust } from './lib/ip'
import type { Logger } from './log'
import type { Mailer } from './mail/mailer'
import type { RateLimiter } from './http/rate-limit'
import type { AuditThrottle } from './services/audit'
import type { AccessEvents } from './services/events'
import type { ShareGrants } from './services/share-grants'
import type { BlobStore } from './storage'

export interface CollabContext {
  userId: string | null
  userName: string | null
  sessionId: string | null
  systemRole: string | null
  projectId: string
  role: string
  linkId: string | null
  shareToken: string | null
  via: string
  sessionExpiresAt: number | null
  /** Admin id when this is an impersonation session (content only via the user's support grant). */
  impersonatedBy: string | null
}

export interface CollabService {
  readonly enabled: boolean
  stats(): { connections: number; documents: number }
  /** Current state of a doc (live in-memory state if loaded, else persisted), or null. */
  getState(docName: string): Promise<Uint8Array | null>
  /** Apply a server-side change through a Hocuspocus direct connection (broadcast + persisted). */
  transact(docName: string, fn: (doc: Y.Doc) => void): Promise<void>
  /** Persist a raw state for a doc that is not loaded (duplicate/import). */
  writeState(docName: string, projectId: string, state: Uint8Array): Promise<void>
  /** Names of documents of a project that are currently loaded (may not be persisted yet). */
  liveDocNames(projectId: string): string[]
  /** Drop live documents of a project (used before hard delete). */
  closeProject(projectId: string): Promise<void>
  handleUpgrade(req: import('node:http').IncomingMessage, socket: import('node:stream').Duplex, head: Buffer): void
  close(): Promise<void>
}

export interface Deps {
  config: Config
  log: Logger
  db: Db
  dbDriver: 'pg' | 'pglite'
  auth: Auth
  blobs: BlobStore
  ring: KeyRing
  mailer: Mailer
  events: AccessEvents
  collab: CollabService
  ipHasher: IpHasher
  proxy: ProxyTrust
  limiter: RateLimiter
  auditThrottle: AuditThrottle
  grants: ShareGrants
}
