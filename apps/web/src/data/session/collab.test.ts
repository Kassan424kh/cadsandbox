// CollabDoc against the real Hocuspocus provider, with a scripted fake WebSocket as the server: a server
// restart must be a transient outage, only explicit access changes / refusals reach the app.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import type { SyncStatus } from '../types'
import { CollabConnection, type CollabDoc } from './collab'

// ------------------------------------------------------------------ Hocuspocus wire format (lib0)
const MSG = { sync: 0, auth: 2, close: 7, syncStatus: 8 } as const
const AUTH = { permissionDenied: 1, authenticated: 2 } as const

function varUint(n: number): number[] {
  const out: number[] = []
  while (n > 0x7f) {
    out.push(0x80 | (n & 0x7f))
    n = Math.floor(n / 128)
  }
  out.push(n)
  return out
}
const varBytes = (b: Uint8Array) => [...varUint(b.length), ...b]
const varString = (s: string) => varBytes(new TextEncoder().encode(s))
const frame = (...parts: number[][]) => new Uint8Array(parts.flat())

const authenticated = (doc: string, scope = 'read-write') => frame(varString(doc), [MSG.auth, AUTH.authenticated], varString(scope))
const permissionDenied = (doc: string, reason: string) => frame(varString(doc), [MSG.auth, AUTH.permissionDenied], varString(reason))
const closeDoc = (doc: string, reason: string) => frame(varString(doc), [MSG.close], varString(reason))
/** Sync step 2 (marks the provider synced) + a sync-status ack (no unsynced local changes left). */
const synced = (doc: string) => [
  frame(varString(doc), [MSG.sync, 1], varBytes(Y.encodeStateAsUpdate(new Y.Doc()))),
  frame(varString(doc), [MSG.syncStatus, 1]),
]

/** Message types the client sent on a socket (after the document name). */
function sentTypes(ws: FakeWebSocket): number[] {
  return ws.sent.map((m) => {
    let i = 0
    let len = 0
    for (let shift = 0; ; shift += 7) {
      const b = m[i++]
      len += (b & 0x7f) * 2 ** shift
      if (b < 0x80) break
    }
    return m[i + len]
  })
}

// ------------------------------------------------------------------ fake socket + browser globals
class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  readyState = 0
  binaryType = 'blob'
  sent: Uint8Array[] = []
  private readonly handlers = new Map<string, Set<(e: unknown) => void>>()
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
  }
  addEventListener(type: string, cb: (e: unknown) => void) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set())
    this.handlers.get(type)!.add(cb)
  }
  removeEventListener(type: string, cb: (e: unknown) => void) {
    this.handlers.get(type)?.delete(cb)
  }
  send(data: Uint8Array) {
    this.sent.push(new Uint8Array(data))
  }
  close() {
    this.readyState = 3
  }
  private dispatch(type: string, e: unknown) {
    for (const cb of [...(this.handlers.get(type) ?? [])]) cb(e)
  }
  // server side
  accept() {
    this.readyState = 1
    this.dispatch('open', new Event('open'))
  }
  deliver(...messages: Uint8Array[]) {
    for (const m of messages) this.dispatch('message', { data: m.buffer.slice(m.byteOffset, m.byteOffset + m.byteLength) })
  }
  drop(code = 1001, reason = 'server shutdown') {
    this.readyState = 3
    this.dispatch('close', { code, reason })
  }
}

const latest = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms)

describe('CollabDoc connection lifecycle', () => {
  const DOC = 'project:p1'
  let conn: CollabConnection
  let doc: CollabDoc
  let statuses: SyncStatus[]
  let access: ReturnType<typeof vi.fn<(reason: string, docName: string, denied: boolean) => void>>

  /** Open a socket to the fake server and complete auth + first sync. */
  async function connectAndSync(): Promise<FakeWebSocket> {
    const ws = latest()
    ws.accept()
    await tick()
    ws.deliver(authenticated(DOC), ...synced(DOC))
    await tick()
    return ws
  }

  beforeEach(async () => {
    vi.useFakeTimers()
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.stubGlobal('navigator', { onLine: true })
    vi.stubGlobal('window', Object.assign(new EventTarget(), { location: { origin: 'http://localhost:5173' } }))
    conn = new CollabConnection(null, true)
    access = vi.fn<(reason: string, docName: string, denied: boolean) => void>()
    conn.onAccessChange(access)
    doc = conn.open(DOC, new Y.Doc())
    statuses = []
    doc.onStatus((s) => statuses.push(s))
    await tick()
    await connectAndSync()
    expect(doc.status()).toBe('synced')
    statuses.length = 0
  })

  afterEach(() => {
    conn.destroy()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('treats a server restart as a transient outage: offline → syncing → synced, no access change', async () => {
    const before = latest()
    // Graceful shutdown: Hocuspocus closes every document ('Reset Connection'), then the socket.
    before.deliver(closeDoc(DOC, 'Reset Connection'))
    await tick()
    before.drop()
    await tick()
    expect(doc.status()).toBe('offline')

    await tick(5_000) // reconnect with backoff; the server is back
    const after = latest()
    expect(after).not.toBe(before)
    after.accept()
    await tick()
    expect(sentTypes(after)).toContain(MSG.auth) // the provider re-authenticates on reconnect
    expect(doc.status()).toBe('syncing')
    after.deliver(authenticated(DOC), ...synced(DOC))
    await tick()

    expect(doc.status()).toBe('synced')
    expect(statuses).toEqual(['syncing', 'offline', 'syncing', 'synced'])
    expect(access).not.toHaveBeenCalled()
  })

  it('treats a dropped socket (no close message) the same way', async () => {
    latest().drop(1006, '')
    await tick()
    expect(doc.status()).toBe('offline')
    await tick(5_000)
    await connectAndSync()
    expect(doc.status()).toBe('synced')
    expect(statuses).not.toContain('error')
    expect(access).not.toHaveBeenCalled()
  })

  it('re-authenticates with backoff when the server resets a document but keeps the socket', async () => {
    const ws = latest()
    const authsBefore = sentTypes(ws).filter((t) => t === MSG.auth).length
    ws.deliver(closeDoc(DOC, 'Reset Connection'))
    await tick()
    expect(doc.status()).toBe('syncing')
    expect(sentTypes(ws).filter((t) => t === MSG.auth).length).toBe(authsBefore) // not immediately
    await tick(1_000)
    expect(sentTypes(ws).filter((t) => t === MSG.auth).length).toBe(authsBefore + 1)
    ws.deliver(authenticated(DOC), ...synced(DOC))
    await tick()
    expect(doc.status()).toBe('synced')
    expect(access).not.toHaveBeenCalled()
  })

  it('reports server access changes, and a refusal as an explicit denial', async () => {
    const ws = latest()
    ws.deliver(closeDoc(DOC, 'access-changed'))
    await tick()
    expect(access).toHaveBeenLastCalledWith('access-changed', DOC, false)
    // re-authenticates right away: a revoked caller is refused …
    ws.deliver(permissionDenied(DOC, 'permission-denied'))
    await tick()
    expect(access).toHaveBeenLastCalledWith('permission-denied', DOC, true)
    expect(doc.status()).toBe('error')
    expect(doc.deniedReason()).toBe('permission-denied')
  })
})
