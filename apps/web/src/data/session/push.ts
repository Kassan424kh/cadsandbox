// Push locally persisted Yjs docs to the collab server and verify the server has everything
// (used by "Upload to cloud" and when creating cloud projects from templates).
import * as Y from 'yjs'
import { loadDoc, stateCovers } from '../yjs'
import { CollabConnection } from './collab'

const SYNC_TIMEOUT_MS = 20_000

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(message)), ms)
    p.then(
      (v) => {
        clearTimeout(id)
        resolve(v)
      },
      (e: unknown) => {
        clearTimeout(id)
        reject(e instanceof Error ? e : new Error(String(e)))
      },
    )
  })
}

async function waitUntil(check: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (check()) return true
    await new Promise((r) => setTimeout(r, 100))
  }
  return check()
}

/** Download the server's current state of `name` into a fresh doc (caller destroys it). */
async function fetchServerDoc(conn: CollabConnection, name: string): Promise<Y.Doc> {
  const ydoc = new Y.Doc()
  const collab = conn.open(name, ydoc)
  try {
    const ok = await withTimeout(collab.firstSync, SYNC_TIMEOUT_MS, 'The collaboration server did not respond')
    if (!ok) throw new Error('The server refused access to this project')
    return ydoc
  } finally {
    collab.destroy()
  }
}

/**
 * Upload each named doc from IndexedDB (docs held in memory can be passed via `docs`).
 * Resolves once the server confirmed it has every update; throws otherwise.
 */
export async function pushDocs(
  names: string[],
  opts: { docs?: Map<string, Y.Doc>; onProgress?: (done: number, total: number) => void } = {},
): Promise<void> {
  const conn = new CollabConnection(null)
  try {
    let done = 0
    for (const name of names) {
      const own = !opts.docs?.has(name)
      const local = opts.docs?.get(name) ?? (await loadDoc(name))
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          const collab = conn.open(name, local)
          try {
            const ok = await withTimeout(collab.firstSync, SYNC_TIMEOUT_MS, 'The collaboration server did not respond')
            if (!ok) throw new Error('The server refused access to this project')
            await waitUntil(() => collab.provider.unsyncedChanges === 0, 10_000)
          } finally {
            collab.destroy()
          }
          const server = await fetchServerDoc(conn, name)
          const covered = stateCovers(server, local)
          server.destroy()
          if (covered) break
          if (attempt === 2) throw new Error(`Could not upload "${name}" completely`)
        }
      } finally {
        if (own) local.destroy()
      }
      opts.onProgress?.(++done, names.length)
    }
  } finally {
    conn.destroy()
  }
}
