// Clipboard (de)serialization for DocSnapshots — pure and unit-tested. The system clipboard gets a
// text payload prefixed with `cadsandbox:` so paste can distinguish our data from arbitrary text;
// an in-memory fallback is used when navigator.clipboard is unavailable or denied.
import type { AnyNode, DocSnapshot } from '@cadsandbox/doc'

export const CLIPBOARD_PREFIX = 'cadsandbox:'
export const SNAPSHOT_FORMAT = 'cadsandbox/nodes@1'

export function serializeClipboard(snapshot: DocSnapshot): string {
  return CLIPBOARD_PREFIX + JSON.stringify(snapshot)
}

function isVec3(v: unknown): v is [number, number, number] {
  return Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x))
}

function isNode(n: unknown): n is AnyNode {
  if (!n || typeof n !== 'object') return false
  const o = n as Record<string, unknown>
  if (typeof o.id !== 'string' || typeof o.type !== 'string') return false
  if (o.parent !== null && typeof o.parent !== 'string') return false
  const t = o.t as Record<string, unknown> | undefined
  if (!t || !isVec3(t.p) || !Array.isArray(t.r) || t.r.length !== 4 || !isVec3(t.s)) return false
  return typeof o.params === 'object' && o.params !== null
}

/** Parse clipboard text; null when it is not a CadSandbox snapshot (or malformed). */
export function parseClipboard(text: string | null | undefined): DocSnapshot | null {
  if (!text || !text.startsWith(CLIPBOARD_PREFIX)) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(CLIPBOARD_PREFIX.length))
  } catch {
    return null
  }
  return validateSnapshot(parsed)
}

export function validateSnapshot(parsed: unknown): DocSnapshot | null {
  if (!parsed || typeof parsed !== 'object') return null
  const s = parsed as Record<string, unknown>
  if (s.format !== SNAPSHOT_FORMAT) return null
  if (!Array.isArray(s.nodes) || !s.nodes.every(isNode)) return null
  const materials = Array.isArray(s.materials) ? s.materials : []
  const components = Array.isArray(s.components) ? s.components : []
  const componentNodes = Array.isArray(s.componentNodes) && s.componentNodes.every(isNode) ? s.componentNodes : []
  const assets = Array.isArray(s.assets) ? s.assets.filter((a): a is string => typeof a === 'string') : []
  const ids = new Set<string>()
  for (const n of s.nodes as AnyNode[]) {
    if (ids.has(n.id)) return null
    ids.add(n.id)
  }
  const out: DocSnapshot = {
    format: SNAPSHOT_FORMAT,
    nodes: s.nodes as AnyNode[],
    materials: materials as DocSnapshot['materials'],
    components: components as DocSnapshot['components'],
    componentNodes,
    assets,
  }
  const b = s.bounds as { min?: unknown; max?: unknown } | undefined
  if (b && isVec3(b.min) && isVec3(b.max)) out.bounds = { min: b.min, max: b.max }
  return out
}

/** Clipboard facade: system clipboard when permitted, memory otherwise. */
export class ClipboardStore {
  private memory: string | null = null

  async write(snapshot: DocSnapshot): Promise<void> {
    const text = serializeClipboard(snapshot)
    this.memory = text
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text)
      } catch {
        /* permission denied → memory only */
      }
    }
  }

  async read(): Promise<DocSnapshot | null> {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
      try {
        const text = await navigator.clipboard.readText()
        const snap = parseClipboard(text)
        if (snap) return snap
        // Foreign text on the system clipboard: a snapshot copied earlier in this session still wins
        // only when the system clipboard holds nothing usable.
        if (text && text.length > 0 && !text.startsWith(CLIPBOARD_PREFIX)) return parseClipboard(this.memory)
      } catch {
        /* fall through */
      }
    }
    return parseClipboard(this.memory)
  }

  /** Whether *something* is known to be available (drives EditorState.clipboard). */
  get hasContent(): boolean {
    return this.memory !== null
  }
}
