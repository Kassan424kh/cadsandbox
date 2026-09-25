// EditorAssets for a project: content-addressed blobs cached in IndexedDB. Cloud projects fetch
// missing blobs from /api/projects/:id/blobs/:hash and upload new ones (queued while offline).
import type { EditorAssets } from '@cadsandbox/render'
import { api } from '../api/endpoints'
import { getBlob, isHash, linkBlob, markUploaded, pendingBlobHashes, putBlob, sha256Hex } from '../local/blobs'

export class ProjectAssets implements EditorAssets {
  private urls = new Map<string, string>()
  private inflight = new Map<string, Promise<ArrayBuffer | null>>()
  private flushing: Promise<void> | null = null
  private disposed = false
  private readonly onOnline = () => void this.flush()

  constructor(
    private readonly projectId: string,
    private readonly mode: 'local' | 'cloud',
    private readonly shareToken: string | null,
    private readonly canUpload: boolean,
  ) {
    if (mode === 'cloud' && canUpload) {
      window.addEventListener('online', this.onOnline)
      void this.flush()
    }
  }

  async get(hash: string): Promise<ArrayBuffer | null> {
    if (!isHash(hash)) return null
    const rec = await getBlob(hash)
    if (rec) {
      if (this.mode === 'local') void linkBlob(this.projectId, hash, false)
      return rec.bytes
    }
    if (this.mode === 'local') return null
    let p = this.inflight.get(hash)
    if (!p) {
      p = this.download(hash).finally(() => this.inflight.delete(hash))
      this.inflight.set(hash, p)
    }
    return p
  }

  private async download(hash: string): Promise<ArrayBuffer | null> {
    try {
      const res = await api.blobs.get(this.projectId, hash, this.shareToken)
      const buf = await res.arrayBuffer()
      if ((await sha256Hex(buf)) !== hash) {
        console.warn('[assets] integrity check failed', hash)
        return null
      }
      const mime = res.headers.get('content-type')?.split(';')[0] ?? 'application/octet-stream'
      await putBlob(buf, mime, hash)
      await linkBlob(this.projectId, hash, false)
      return buf
    } catch (err) {
      console.warn('[assets] blob unavailable', hash, err)
      return null
    }
  }

  async put(bytes: Uint8Array, mime: string): Promise<string> {
    const hash = await putBlob(bytes, mime)
    await linkBlob(this.projectId, hash, this.mode === 'cloud')
    if (this.mode === 'cloud' && this.canUpload) void this.flush()
    return hash
  }

  async url(hash: string): Promise<string | null> {
    const cached = this.urls.get(hash)
    if (cached) return cached
    const buf = await this.get(hash)
    if (!buf || this.disposed) return null
    const rec = await getBlob(hash)
    const url = URL.createObjectURL(new Blob([buf], { type: rec?.mime ?? 'application/octet-stream' }))
    this.urls.set(hash, url)
    return url
  }

  async mime(hash: string): Promise<string | null> {
    return (await getBlob(hash))?.mime ?? null
  }

  /** Upload blobs added while offline (or not yet confirmed by the server). */
  flush(): Promise<void> {
    if (this.mode !== 'cloud' || !this.canUpload || this.disposed) return Promise.resolve()
    this.flushing ??= this.uploadPending().finally(() => (this.flushing = null))
    return this.flushing
  }

  private async uploadPending(): Promise<void> {
    if (!navigator.onLine) return
    for (const hash of await pendingBlobHashes(this.projectId)) {
      if (this.disposed) return
      try {
        const rec = await getBlob(hash)
        if (!rec) continue
        if (!(await api.blobs.exists(this.projectId, hash))) await api.blobs.put(this.projectId, hash, rec.bytes, rec.mime)
        await markUploaded(this.projectId, hash)
      } catch (err) {
        console.warn('[assets] upload deferred', hash, err)
        return // retry on the next 'online' event / flush
      }
    }
  }

  dispose(): void {
    this.disposed = true
    window.removeEventListener('online', this.onOnline)
    for (const url of this.urls.values()) URL.revokeObjectURL(url)
    this.urls.clear()
  }
}
