// Content hashing for result cache keys (cyrb53 over a canonical JSON serialization).

export function hashString(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0')
}

/** JSON with sorted object keys; typed arrays are summarized by length + a content hash. */
export function stableStringify(value: unknown): string {
  const parts: string[] = []
  write(value, parts)
  return parts.join('')
}

function write(v: unknown, out: string[]): void {
  if (v === null || v === undefined) {
    out.push('null')
    return
  }
  const t = typeof v
  if (t === 'number') {
    out.push(Number.isFinite(v as number) ? String(v) : 'null')
    return
  }
  if (t === 'string' || t === 'boolean') {
    out.push(JSON.stringify(v))
    return
  }
  if (ArrayBuffer.isView(v)) {
    const arr = v as unknown as ArrayLike<number>
    let acc = ''
    // sample large arrays: full hashing of huge buffers is unnecessary for cache keys
    const step = Math.max(1, Math.floor(arr.length / 4096))
    for (let i = 0; i < arr.length; i += step) acc += arr[i]!.toString(36) + ','
    out.push(`"TA${arr.length}:${hashString(acc)}"`)
    return
  }
  if (v instanceof ArrayBuffer) {
    out.push(`"AB${v.byteLength}"`)
    return
  }
  if (Array.isArray(v)) {
    out.push('[')
    for (let i = 0; i < v.length; i++) {
      if (i) out.push(',')
      write(v[i], out)
    }
    out.push(']')
    return
  }
  if (t === 'object') {
    const keys = Object.keys(v as object).sort()
    out.push('{')
    let first = true
    for (const k of keys) {
      const val = (v as Record<string, unknown>)[k]
      if (val === undefined) continue
      if (!first) out.push(',')
      first = false
      out.push(JSON.stringify(k), ':')
      write(val, out)
    }
    out.push('}')
    return
  }
  out.push('null')
}
