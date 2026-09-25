// Low-level HTTP client for the CadSandbox API (same-origin /api, session cookie auth).
// JSON in/out, typed errors (ApiError), retries for idempotent GET/HEAD requests.
import type { ApiErrorCode } from '@cadsandbox/shared'

/** Base URL of the API origin. Empty = same origin (dev proxy / production reverse proxy). */
export const API_ORIGIN: string = (import.meta.env.VITE_API_ORIGIN as string | undefined)?.replace(/\/$/, '') ?? ''

export function apiUrl(path: string): string {
  return `${API_ORIGIN}${path}`
}

/** WebSocket URL for a path on the API origin (http → ws, https → wss). */
export function wsUrl(path: string): string {
  const base = API_ORIGIN || window.location.origin
  return `${base.replace(/^http/, 'ws')}${path}`
}

export type ClientErrorCode = ApiErrorCode | 'network' | 'timeout' | 'aborted'

export class ApiError extends Error {
  readonly status: number
  readonly code: ClientErrorCode
  readonly details: unknown
  constructor(status: number, code: ClientErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
  /** Server unreachable (offline, DNS, server down) — callers fall back to local mode. */
  get isNetwork(): boolean {
    return this.code === 'network' || this.code === 'timeout'
  }
  /** `details.reason` convention used by e.g. share links (`password_required`). */
  get reason(): string | null {
    const d = this.details as { reason?: unknown } | null | undefined
    return typeof d?.reason === 'string' ? d.reason : null
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError
}

const STATUS_CODE: Record<number, ApiErrorCode> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'payload_too_large',
  429: 'rate_limited',
}

export type Query = Record<string, string | number | boolean | null | undefined>
export type ResponseKind = 'json' | 'blob' | 'arrayBuffer' | 'text' | 'void' | 'response'

export interface RequestOptions {
  method?: string
  query?: Query
  /** JSON-serialised body. */
  json?: unknown
  /** Raw body (blobs, thumbnails). */
  body?: BodyInit
  contentType?: string
  headers?: Record<string, string>
  signal?: AbortSignal
  /** Extra attempts for idempotent requests (default 2 for GET/HEAD, 0 otherwise). */
  retries?: number
  timeoutMs?: number
  responseType?: ResponseKind
  /** Share-link token for anonymous viewers (sent as `x-share-token`). */
  shareToken?: string | null
}

function buildUrl(path: string, query?: Query): string {
  const url = apiUrl(path)
  if (!query) return url
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
  const s = qs.toString()
  return s ? `${url}?${s}` : url
}

async function toError(res: Response): Promise<ApiError> {
  let code: ClientErrorCode = STATUS_CODE[res.status] ?? 'internal'
  let message = res.statusText || `HTTP ${res.status}`
  let details: unknown
  try {
    const body = (await res.json()) as { error?: { code?: ApiErrorCode; message?: string; details?: unknown }; message?: string }
    if (body?.error) {
      code = body.error.code ?? code
      message = body.error.message ?? message
      details = body.error.details
    } else if (typeof body?.message === 'string') message = body.message
  } catch {
    /* non-JSON error body */
  }
  return new ApiError(res.status, code, message, details)
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const id = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(id)
      reject(new ApiError(0, 'aborted', 'Request aborted'))
    })
  })

function retryDelay(res: Response | null, attempt: number): number {
  const ra = res?.headers.get('retry-after')
  if (ra) {
    const secs = Number(ra)
    if (Number.isFinite(secs)) return Math.min(secs * 1000, 10_000)
  }
  return Math.min(400 * 2 ** attempt, 4000) + Math.random() * 200
}

/** Perform a request. Throws ApiError on HTTP/network errors. */
export async function request<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = (opts.method ?? 'GET').toUpperCase()
  const idempotent = method === 'GET' || method === 'HEAD'
  const retries = opts.retries ?? (idempotent ? 2 : 0)
  const headers: Record<string, string> = { accept: 'application/json', ...opts.headers }
  let body: BodyInit | undefined = opts.body
  if (opts.json !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(opts.json)
  } else if (opts.contentType) headers['content-type'] = opts.contentType
  if (opts.shareToken) headers['x-share-token'] = opts.shareToken
  const url = buildUrl(path, opts.query)

  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController()
    const onAbort = () => ctrl.abort()
    opts.signal?.addEventListener('abort', onAbort)
    const timer = setTimeout(() => ctrl.abort('timeout'), opts.timeoutMs ?? (idempotent ? 20_000 : 60_000))
    let res: Response | null = null
    try {
      res = await fetch(url, { method, headers, body, credentials: 'include', signal: ctrl.signal, cache: 'no-store' })
    } catch (err) {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      if (opts.signal?.aborted) throw new ApiError(0, 'aborted', 'Request aborted')
      const timedOut = ctrl.signal.reason === 'timeout'
      if (attempt < retries) {
        await sleep(retryDelay(null, attempt), opts.signal)
        continue
      }
      throw new ApiError(0, timedOut ? 'timeout' : 'network', timedOut ? 'The server took too long to respond' : 'Cannot reach the server', err)
    }
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onAbort)

    if (!res.ok) {
      const transient = res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504
      if (transient && attempt < retries) {
        await sleep(retryDelay(res, attempt), opts.signal)
        continue
      }
      throw await toError(res)
    }
    switch (opts.responseType ?? 'json') {
      case 'response':
        return res as T
      case 'void':
        return undefined as T
      case 'blob':
        return (await res.blob()) as T
      case 'arrayBuffer':
        return (await res.arrayBuffer()) as T
      case 'text':
        return (await res.text()) as T
      default: {
        if (res.status === 204 || method === 'HEAD') return undefined as T
        const text = await res.text()
        return (text ? JSON.parse(text) : undefined) as T
      }
    }
  }
}
