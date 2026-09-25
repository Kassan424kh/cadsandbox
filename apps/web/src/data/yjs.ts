// Yjs helpers: y-indexeddb persistence (database name = collab doc name from `docNames`), reading /
// writing persisted state without keeping a doc open, and restoring a snapshot into a live doc.
import * as Y from 'yjs'
import { IndexeddbPersistence, clearDocument } from 'y-indexeddb'
import { deepEqual } from '@cadsandbox/doc'

export interface PersistedDoc {
  persistence: IndexeddbPersistence
  /** Resolves once the stored updates have been applied to the doc. */
  loaded: Promise<void>
  destroy(): Promise<void>
}

/** Attach IndexedDB persistence to `ydoc` under `name`. */
export function persistDoc(name: string, ydoc: Y.Doc): PersistedDoc {
  const persistence = new IndexeddbPersistence(name, ydoc)
  const loaded = persistence.whenSynced.then(
    () => undefined,
    (err: unknown) => console.warn('[yjs] local persistence failed', name, err),
  )
  return { persistence, loaded, destroy: () => persistence.destroy() }
}

/** Load a persisted doc into a fresh Y.Doc (caller destroys it). */
export async function loadDoc(name: string): Promise<Y.Doc> {
  const ydoc = new Y.Doc()
  const p = persistDoc(name, ydoc)
  await p.loaded
  await p.destroy()
  return ydoc
}

/** Encoded state of a persisted doc, or null when nothing is stored under that name. */
export async function readDocState(name: string): Promise<Uint8Array | null> {
  const ydoc = await loadDoc(name)
  try {
    return ydoc.share.size === 0 && ydoc.store.clients.size === 0 ? null : Y.encodeStateAsUpdate(ydoc)
  } finally {
    ydoc.destroy()
  }
}

/** Merge an update into the persisted doc `name` (creates it if missing). */
export async function writeDocState(name: string, update: Uint8Array): Promise<void> {
  const ydoc = new Y.Doc()
  const p = persistDoc(name, ydoc)
  await p.loaded
  Y.applyUpdate(ydoc, update)
  await p.destroy() // closing waits for the pending IndexedDB write transaction
  ydoc.destroy()
}

export async function deleteDocState(name: string): Promise<void> {
  try {
    await clearDocument(name)
  } catch (err) {
    console.warn('[yjs] could not delete local doc', name, err)
  }
}

/** Names of local y-indexeddb databases starting with `prefix` (empty when unsupported). */
export async function listDocDatabases(prefix: string): Promise<string[]> {
  try {
    const dbs = (await indexedDB.databases?.()) ?? []
    return dbs.map((d) => d.name ?? '').filter((n) => n.startsWith(prefix))
  } catch {
    return []
  }
}

// ------------------------------------------------------------------ snapshot restore

function toJSONValue(v: unknown): unknown {
  return v instanceof Y.AbstractType ? v.toJSON() : v
}

function cloneValue(v: unknown): unknown {
  if (v instanceof Y.Map) {
    const m = new Y.Map<unknown>()
    for (const [k, x] of v.entries()) m.set(k, cloneValue(x))
    return m
  }
  if (v instanceof Y.Array) {
    const a = new Y.Array<unknown>()
    a.push(v.toArray().map(cloneValue))
    return a
  }
  if (v instanceof Y.Text) return new Y.Text(v.toString())
  if (v instanceof Uint8Array) return v.slice()
  return v === undefined ? v : structuredClone(v)
}

/** Make `dst` equal to `src` with minimal operations (recurses into nested maps). */
function syncMap(dst: Y.Map<unknown>, src: Y.Map<unknown>): void {
  for (const key of [...dst.keys()]) if (!src.has(key)) dst.delete(key)
  for (const [key, value] of src.entries()) {
    const cur = dst.get(key)
    if (cur instanceof Y.Map && value instanceof Y.Map) syncMap(cur, value)
    else if (!deepEqual(toJSONValue(cur), toJSONValue(value)) || cur instanceof Y.AbstractType !== value instanceof Y.AbstractType) {
      dst.set(key, cloneValue(value))
    }
  }
}

/**
 * Restore a snapshot (`Y.encodeStateAsUpdate` of an earlier state) into a live document as a
 * normal, forward change — it syncs to collaborators and (with LOCAL_ORIGIN) is undoable.
 * Our documents only use Y.Map roots (see @cadsandbox/doc), so maps are synced key by key.
 */
export function restoreSnapshot(live: Y.Doc, snapshot: Uint8Array, origin: unknown): void {
  const old = new Y.Doc()
  try {
    Y.applyUpdate(old, snapshot)
    const names = new Set<string>([...old.share.keys(), ...live.share.keys()])
    live.transact(() => {
      for (const name of names) syncMap(live.getMap(name), old.getMap(name))
    }, origin)
  } finally {
    old.destroy()
  }
}

/** True when `server` already contains everything in `local` (state-vector comparison). */
export function stateCovers(server: Y.Doc, local: Y.Doc): boolean {
  const sv = Y.decodeStateVector(Y.encodeStateVector(server))
  for (const [client, clock] of Y.decodeStateVector(Y.encodeStateVector(local))) {
    if ((sv.get(client) ?? 0) < clock) return false
  }
  return true
}
