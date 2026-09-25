// S3-compatible object store (e.g. Hetzner Object Storage, IONOS, OVH, Scaleway — pick an EU region).
// Signed with SigV4 via aws4fetch; payloads are streamed (UNSIGNED-PAYLOAD over TLS).
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import type { ReadableStream as NodeWebStream } from 'node:stream/web'
import { AwsClient } from 'aws4fetch'
import type { ObjectStore } from './blob-store'

export interface S3Options {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  forcePathStyle: boolean
  prefix: string
}

export class S3Store implements ObjectStore {
  readonly kind = 's3' as const
  private readonly client: AwsClient

  constructor(private readonly o: S3Options) {
    if (!/^https:\/\//.test(o.endpoint) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(o.endpoint)) {
      throw new Error('S3_ENDPOINT must use https')
    }
    this.client = new AwsClient({ accessKeyId: o.accessKeyId, secretAccessKey: o.secretAccessKey, region: o.region, service: 's3' })
  }

  private url(key: string): string {
    const k = `${this.o.prefix}${key}`
      .split('/')
      .map(encodeURIComponent)
      .join('/')
    const base = new URL(this.o.endpoint)
    if (this.o.forcePathStyle) return `${base.origin}/${this.o.bucket}/${k}`
    return `${base.protocol}//${this.o.bucket}.${base.host}/${k}`
  }

  private async send(method: string, key: string, init: RequestInit & { duplex?: 'half' } = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    headers.set('x-amz-content-sha256', 'UNSIGNED-PAYLOAD')
    return this.client.fetch(this.url(key), { ...init, method, headers })
  }

  async putFile(key: string, path: string, size: number): Promise<void> {
    const body = Readable.toWeb(createReadStream(path)) as unknown as ReadableStream<Uint8Array>
    const res = await this.send('PUT', key, {
      body,
      duplex: 'half',
      headers: { 'content-length': String(size), 'content-type': 'application/octet-stream' },
    })
    if (!res.ok) throw new Error(`S3 PUT failed: ${res.status}`)
    await res.body?.cancel()
  }

  async get(key: string): Promise<Readable | null> {
    const res = await this.send('GET', key)
    if (res.status === 404) {
      await res.body?.cancel()
      return null
    }
    if (!res.ok || !res.body) throw new Error(`S3 GET failed: ${res.status}`)
    return Readable.fromWeb(res.body as unknown as NodeWebStream<Uint8Array>)
  }

  async exists(key: string): Promise<boolean> {
    const res = await this.send('HEAD', key)
    await res.body?.cancel()
    if (res.status === 404) return false
    if (!res.ok) throw new Error(`S3 HEAD failed: ${res.status}`)
    return true
  }

  async delete(key: string): Promise<void> {
    const res = await this.send('DELETE', key)
    await res.body?.cancel()
    if (!res.ok && res.status !== 404) throw new Error(`S3 DELETE failed: ${res.status}`)
  }
}
