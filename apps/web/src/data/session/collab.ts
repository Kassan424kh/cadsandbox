// Hocuspocus (Yjs websocket) connections. One multiplexed socket per project session; one provider
// per collab doc (manifest + each open design). Auth = session cookie on the upgrade request, or a
// share-link token for anonymous viewers of public/link-shared projects.
import * as Y from 'yjs'
import { HocuspocusProvider, HocuspocusProviderWebsocket, WebSocketStatus } from '@hocuspocus/provider'
import type { Awareness } from 'y-protocols/awareness'
import { wsUrl } from '../api/client'
import type { SyncStatus } from '../types'

const COLLAB_PATH = '/collab'
/** After this long without a first connection we report 'offline' instead of 'connecting'. */
const CONNECT_GRACE_MS = 8000
/** Re-authentication backoff after the server closed a document for a transient reason. */
const REAUTH_DELAY_MS = 1000
const REAUTH_MAX_DELAY_MS = 30_000
/**
 * Per-document CLOSE reasons our server sends when it revoked or changed the caller's access (see
 * apps/server/src/collab/server.ts). Any other CLOSE — Hocuspocus' 'Reset Connection' on server
 * shutdown/restart or a document reload, … — is a transient outage: resync, don't report it.
 */
const ACCESS_CLOSE_REASONS = new Set(['access-changed', 'project-deleted'])

export interface CollabDoc {
  readonly name: string
  readonly provider: HocuspocusProvider
  readonly awareness: Awareness | null
  /** Resolves true after the first server sync, false on auth failure / destroy. */
  readonly firstSync: Promise<boolean>
  status(): SyncStatus
  onStatus(cb: (s: SyncStatus) => void): () => void
  /** 'readonly' when the server only granted read access. */
  scope(): 'read-write' | 'readonly' | null
  /** The server's reason when it refused the connection (e.g. 'impersonation-content-blocked'). */
  deniedReason(): string | null
  destroy(): void
}

/**
 * The server revoked or changed the caller's access to a document (member removed, role changed, link
 * deleted, project trashed/deleted, session revoked, …). `reason` is the server's close reason, e.g.
 * 'access-changed' or 'project-deleted', 'scope-changed' when the granted scope differs from the
 * expected one, or the server's refusal reason. `denied` is true only for an explicit authorization
 * failure: the server refused to authenticate the document (e.g. 'permission-denied').
 * Transport disconnects and server restarts are never reported here — the documents reconnect.
 */
export type AccessChangeListener = (reason: string, docName: string, denied: boolean) => void

export class CollabConnection {
  readonly socket: HocuspocusProviderWebsocket
  private docs = new Set<CollabDoc>()
  private destroyed = false
  private readonly accessListeners = new Set<AccessChangeListener>()

  /**
   * @param expectWritable whether the session was opened with a role that may edit; a server grant
   *   that differs (role changed while we were offline / since the metadata was fetched) is reported
   *   as an access change.
   */
  constructor(
    private readonly shareToken: string | null = null,
    private readonly expectWritable = true,
  ) {
    this.socket = new HocuspocusProviderWebsocket({
      url: wsUrl(COLLAB_PATH),
      // exponential backoff, capped: keeps retrying forever while the tab is open (offline-first)
      delay: 1000,
      factor: 1.8,
      maxDelay: 30_000,
      maxAttempts: 0,
      messageReconnectTimeout: 30_000,
    })
  }

  open(name: string, ydoc: Y.Doc): CollabDoc {
    if (this.destroyed) throw new Error('Collab connection closed')
    const onAccessChange = (reason: string, denied: boolean) => {
      if (this.destroyed) return
      for (const l of [...this.accessListeners]) l(reason, name, denied)
    }
    const doc = createCollabDoc(name, ydoc, this.socket, this.shareToken, this.expectWritable, () => this.docs.delete(doc), onAccessChange)
    this.docs.add(doc)
    return doc
  }

  /** Subscribe to server-side closes of any document on this connection (see AccessChangeListener). */
  onAccessChange(cb: AccessChangeListener): () => void {
    this.accessListeners.add(cb)
    return () => this.accessListeners.delete(cb)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.accessListeners.clear()
    for (const d of [...this.docs]) d.destroy()
    this.socket.destroy()
  }
}

function createCollabDoc(
  name: string,
  ydoc: Y.Doc,
  socket: HocuspocusProviderWebsocket,
  shareToken: string | null,
  expectWritable: boolean,
  onDestroy: () => void,
  onAccessChange: (reason: string, denied: boolean) => void,
): CollabDoc {
  let ws: WebSocketStatus = WebSocketStatus.Connecting
  let synced = false
  let unsynced = 0
  let authFailed = false
  let deniedReason: string | null = null
  let slow = false
  let destroyed = false
  let authorized: 'read-write' | 'readonly' | null = null
  const listeners = new Set<(s: SyncStatus) => void>()
  let last: SyncStatus | null = null
  let slowTimer: ReturnType<typeof setTimeout> | null = null
  let reauthTimer: ReturnType<typeof setTimeout> | null = null
  let reauthAttempts = 0
  let resolveFirst!: (ok: boolean) => void
  const firstSync = new Promise<boolean>((r) => (resolveFirst = r))

  const compute = (): SyncStatus => {
    if (authFailed) return 'error'
    if (typeof navigator !== 'undefined' && !navigator.onLine) return 'offline'
    if (ws !== WebSocketStatus.Connected) return slow ? 'offline' : 'connecting'
    if (!synced || unsynced > 0) return 'syncing'
    return 'synced'
  }
  const emit = () => {
    const s = compute()
    if (s === last) return
    last = s
    for (const l of listeners) l(s)
  }
  const armSlowTimer = () => {
    if (slowTimer) clearTimeout(slowTimer)
    slowTimer = setTimeout(() => {
      slow = true
      emit()
    }, CONNECT_GRACE_MS)
  }
  armSlowTimer()

  const cancelReauth = () => {
    if (reauthTimer) clearTimeout(reauthTimer)
    reauthTimer = null
  }
  /**
   * The server closed this document while the socket stays open. The provider does not
   * re-authenticate by itself, so without this the document would silently stop syncing. (After a
   * socket-level close the provider re-authenticates on reconnect; see onStatus.)
   */
  const reauthenticate = (delay: number) => {
    cancelReauth()
    reauthTimer = setTimeout(() => {
      reauthTimer = null
      if (destroyed || provider.isAuthenticated || socket.status !== WebSocketStatus.Connected) return
      void provider.onOpen(socket.receivedOnOpenPayload ?? new Event('open'))
    }, delay)
  }

  const provider = new HocuspocusProvider({
    name,
    document: ydoc,
    websocketProvider: socket,
    token: shareToken ?? '',
    onStatus: ({ status }) => {
      const wasConnected = ws === WebSocketStatus.Connected
      ws = status
      if (status === WebSocketStatus.Connected) {
        slow = false
        if (slowTimer) clearTimeout(slowTimer)
        slowTimer = null
      } else {
        // The socket reconnects with backoff and the provider re-authenticates on open.
        cancelReauth()
        if (wasConnected) {
          // Connection lost (network, server restart): a transient outage — edits stay local until
          // the socket is back ('offline' → 'syncing' → 'synced'), never an access change.
          slow = true
          if (slowTimer) clearTimeout(slowTimer)
          slowTimer = null
        }
      }
      if (status === WebSocketStatus.Disconnected) synced = false
      emit()
    },
    onSynced: ({ state }) => {
      synced = state
      if (state) {
        reauthAttempts = 0
        resolveFirst(true)
      }
      emit()
    },
    onUnsyncedChanges: ({ number }) => {
      unsynced = number
      emit()
    },
    onAuthenticated: ({ scope }) => {
      authorized = scope
      authFailed = false
      deniedReason = null
      emit()
      // Granted, but not with the access the session was opened for (role changed while we were
      // offline, or after the project metadata was fetched): edits would be dropped silently, or
      // a new editor would stay read-only — let the app reopen the project with its current role.
      if ((scope === 'read-write') !== expectWritable) onAccessChange('scope-changed', false)
    },
    onAuthenticationFailed: ({ reason }) => {
      console.warn('[collab] access denied', name, reason)
      authFailed = true
      deniedReason = reason || 'permission-denied'
      resolveFirst(false)
      emit()
      // E.g. access revoked or session expired while offline; before the session is ready nobody
      // listens yet (whenReady turns the failure into AccessDeniedError instead).
      onAccessChange(deniedReason, true)
    },
    // A CLOSE message for this document while the socket stays open. (Socket-level closes arrive after
    // the socket already reports Disconnected; the provider re-authenticates on reconnect.)
    onClose: ({ event }) => {
      if (destroyed || socket.status !== WebSocketStatus.Connected) return
      synced = false
      emit()
      const reason = event?.reason ?? ''
      if (ACCESS_CLOSE_REASONS.has(reason)) {
        // The server revoked or changed our access: report it and re-authenticate right away — a
        // revoked caller ends in 'error', a changed role gets its new scope.
        onAccessChange(reason, false)
        reauthenticate(0)
      } else {
        // Transient ('Reset Connection' while the server shuts down or reloads the document): resync
        // with backoff. If the socket drops meanwhile, the reconnect re-authenticates instead.
        reauthenticate(Math.min(REAUTH_DELAY_MS * 1.8 ** reauthAttempts++, REAUTH_MAX_DELAY_MS))
      }
    },
  })
  provider.attach()
  ws = socket.status // attaching to an already-open socket emits no status event
  if (ws === WebSocketStatus.Connected && slowTimer) {
    clearTimeout(slowTimer)
    slowTimer = null
  }

  const onNetwork = () => emit()
  window.addEventListener('online', onNetwork)
  window.addEventListener('offline', onNetwork)

  return {
    name,
    provider,
    awareness: provider.awareness,
    firstSync,
    status: compute,
    onStatus(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    scope: () => authorized,
    deniedReason: () => deniedReason,
    destroy() {
      if (destroyed) return
      destroyed = true
      if (slowTimer) clearTimeout(slowTimer)
      cancelReauth()
      window.removeEventListener('online', onNetwork)
      window.removeEventListener('offline', onNetwork)
      listeners.clear()
      resolveFirst(false)
      provider.destroy()
      onDestroy()
    },
  }
}

/** Aggregate several statuses into one (worst wins). */
export function aggregateStatus(statuses: SyncStatus[]): SyncStatus {
  const order: SyncStatus[] = ['error', 'offline', 'connecting', 'syncing', 'synced', 'local']
  return statuses.reduce<SyncStatus>((worst, s) => (order.indexOf(s) < order.indexOf(worst) ? s : worst), statuses[0] ?? 'local')
}
