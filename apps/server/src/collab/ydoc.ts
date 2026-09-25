// Server-side Yjs operations: version restore (generic Y.Map-root sync) and comment mutations.
import * as Y from 'yjs'
import type { CommentDef, CommentReply } from '@cadsandbox/doc'

const isYType = (v: unknown): v is Y.AbstractType<unknown> => v instanceof Y.AbstractType

/** Plain JSON view of a value (Y types → toJSON) for deep comparison. */
function plain(v: unknown): unknown {
  return isYType(v) ? (v as { toJSON(): unknown }).toJSON() : v
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a instanceof Uint8Array && b instanceof Uint8Array) return a.length === b.length && a.every((x, i) => x === b[i])
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const bb = b as unknown[]
    return a.length === bb.length && a.every((x, i) => deepEqual(x, bb[i]))
  }
  const ka = Object.keys(a as object)
  const kb = Object.keys(b as object)
  if (ka.length !== kb.length) return false
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

/** Deep-copy a value from one doc for insertion into another (Y types are re-created). */
function cloneForDoc(v: unknown): unknown {
  if (v instanceof Y.Map) {
    const m = new Y.Map<unknown>()
    for (const [k, x] of v.entries()) m.set(k, cloneForDoc(x))
    return m
  }
  if (v instanceof Y.Array) {
    const a = new Y.Array<unknown>()
    a.push(v.toArray().map(cloneForDoc))
    return a
  }
  if (v instanceof Y.Text) {
    const t = new Y.Text()
    t.applyDelta(v.toDelta())
    return t
  }
  if (v instanceof Uint8Array) return new Uint8Array(v)
  return v === undefined ? null : structuredClone(v)
}

/** A root that is (or can become) a Y.Map — sequence-typed roots (Y.Array/Y.Text) are skipped. */
function isMapLike(t: Y.AbstractType<any> | undefined): boolean {
  if (!t || t instanceof Y.Map) return true
  if (t.constructor !== Y.AbstractType) return false
  return !(t._start !== null && t._map.size === 0)
}

/** Top-level shared type names present in a doc (types are materialised lazily by Yjs). */
export function rootNames(doc: Y.Doc): string[] {
  return [...doc.share.keys()]
}

/**
 * Make every top-level Y.Map of `live` equal to the version's — deleting extra keys and setting
 * changed values (deep compare) — inside one transaction. History is preserved: this produces
 * normal Yjs operations that sync to all clients. `preserve` roots are left untouched.
 */
export function restoreMapRoots(live: Y.Doc, versionState: Uint8Array, preserve: ReadonlySet<string> = new Set(['comments'])): { changedKeys: number } {
  const version = new Y.Doc()
  let changedKeys = 0
  try {
    Y.applyUpdate(version, versionState)
    const names = new Set([...rootNames(version), ...rootNames(live)])
    live.transact(() => {
      for (const name of names) {
        if (preserve.has(name) || !isMapLike(live.share.get(name)) || !isMapLike(version.share.get(name))) continue
        const src = version.getMap<unknown>(name)
        const dst = live.getMap<unknown>(name)
        for (const key of [...dst.keys()]) {
          if (!src.has(key)) {
            dst.delete(key)
            changedKeys++
          }
        }
        for (const [key, value] of src.entries()) {
          if (!dst.has(key) || !deepEqual(plain(dst.get(key)), plain(value))) {
            dst.set(key, cloneForDoc(value))
            changedKeys++
          }
        }
      }
    }, 'version-restore')
  } finally {
    version.destroy()
  }
  return { changedKeys }
}

// ------------------------------------------------------------------ comments (design docs)

export function commentsMap(doc: Y.Doc): Y.Map<CommentDef> {
  return doc.getMap<CommentDef>('comments')
}

export function addComment(doc: Y.Doc, c: CommentDef): void {
  doc.transact(() => commentsMap(doc).set(c.id, c), 'server-comment')
}

export function addReply(doc: Y.Doc, commentId: string, reply: CommentReply): boolean {
  const map = commentsMap(doc)
  const cur = map.get(commentId)
  if (!cur) return false
  doc.transact(() => map.set(commentId, { ...cur, replies: [...(cur.replies ?? []), reply] }), 'server-comment')
  return true
}

export function setResolved(doc: Y.Doc, commentId: string, resolved: boolean): boolean {
  const map = commentsMap(doc)
  const cur = map.get(commentId)
  if (!cur) return false
  if (cur.resolved !== resolved) doc.transact(() => map.set(commentId, { ...cur, resolved }), 'server-comment')
  return true
}

/** JSON-ish dump of all Y.Map roots (GDPR export). */
export function dumpDoc(state: Uint8Array): Record<string, unknown> {
  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, state)
    const out: Record<string, unknown> = {}
    for (const name of rootNames(doc)) {
      out[name] = isMapLike(doc.share.get(name)) ? doc.getMap(name).toJSON() : doc.getArray(name).toJSON()
    }
    return out
  } finally {
    doc.destroy()
  }
}
