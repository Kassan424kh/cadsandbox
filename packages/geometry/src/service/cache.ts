// LRU result cache with byte accounting.
import type { GeometryResult } from '../api'
import { meshByteLength } from '../core/mesh'

export const DEFAULT_CACHE_BYTES = 256 * 1024 * 1024

export function resultBytes(r: GeometryResult): number {
  let b = 256
  for (const p of r.parts) b += meshByteLength(p.mesh) + 64
  if (r.edges) b += r.edges.byteLength
  for (const d of [r.drawing, r.plan]) {
    if (!d) continue
    for (const l of d.lines) b += l.segments.byteLength + 32
    for (const f of d.fills) b += f.triangles.byteLength + f.polygons.reduce((s, p) => s + (p.outer.length + p.holes.reduce((h, r) => h + r.length, 0)) * 24, 0)
    b += d.texts.length * 96
  }
  if (r.snaps) b += r.snaps.length * 48
  return b
}

export class LruCache<V> {
  private map = new Map<string, { value: V; bytes: number }>()
  private total = 0
  constructor(readonly maxBytes: number) {}
  get size(): number {
    return this.total
  }
  get count(): number {
    return this.map.size
  }
  get(key: string): V | undefined {
    const e = this.map.get(key)
    if (!e) return undefined
    // refresh recency
    this.map.delete(key)
    this.map.set(key, e)
    return e.value
  }
  has(key: string): boolean {
    return this.map.has(key)
  }
  set(key: string, value: V, bytes: number): void {
    const prev = this.map.get(key)
    if (prev) {
      this.total -= prev.bytes
      this.map.delete(key)
    }
    if (bytes > this.maxBytes) return
    this.map.set(key, { value, bytes })
    this.total += bytes
    this.evict()
  }
  delete(key: string): void {
    const e = this.map.get(key)
    if (!e) return
    this.total -= e.bytes
    this.map.delete(key)
  }
  clear(): void {
    this.map.clear()
    this.total = 0
  }
  private evict(): void {
    if (this.total <= this.maxBytes) return
    for (const [k, e] of this.map) {
      this.map.delete(k)
      this.total -= e.bytes
      if (this.total <= this.maxBytes) break
    }
  }
}
