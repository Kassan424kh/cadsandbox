// Error reports to a Sentry-compatible tracker — meant for a self-hosted GlitchTip. Events go straight
// to the DSN's envelope endpoint (no SDK). Browsers never talk to the tracker: they post to
// /api/client-errors and the server forwards (keeps the DSN private and the page free of third parties).
// Reports carry the error, its stack and a few whitelisted tags — no request bodies, cookies or IPs.
import { randomBytes } from 'node:crypto'

export interface StackFrame {
  filename: string
  function: string
  lineno: number
  colno: number
  in_app: boolean
}

export interface ErrorReport {
  message: string
  type?: string
  stack?: string
  platform: 'node' | 'javascript'
  tags?: Record<string, string>
  extra?: Record<string, unknown>
}

/** V8 ("at fn (file:1:2)") and Firefox/Safari ("fn@file:1:2") stacks → frames, oldest call first. */
export function parseStack(stack: string | undefined): StackFrame[] {
  if (!stack) return []
  const frames: Omit<StackFrame, 'in_app'>[] = []
  for (const line of stack.split('\n').slice(0, 60)) {
    const m = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/.exec(line) ?? /^(.*?)@(.+?):(\d+):(\d+)\s*$/.exec(line)
    if (m) frames.push({ function: m[1] || '?', filename: m[2]!, lineno: Number(m[3]), colno: Number(m[4]) })
  }
  return frames.reverse().map((f) => ({ ...f, in_app: !/node_modules|^node:|^internal\//.test(f.filename) }))
}

const MAX_PER_MINUTE = 30
const DEDUPE_MS = 60_000

export class ErrorReporter {
  private readonly endpoint: string
  private readonly auth: string
  private readonly sentAt: number[] = []
  private readonly recent = new Map<string, number>()

  constructor(
    dsn: string,
    private readonly meta: { release: string; environment: string },
  ) {
    const u = new URL(dsn)
    const projectId = u.pathname.replace(/^\/+|\/+$/g, '')
    if (!u.username || !projectId) throw new Error('SENTRY_DSN must look like https://<key>@<host>/<project>')
    this.endpoint = `${u.protocol}//${u.host}/api/${projectId}/envelope/`
    this.auth = `Sentry sentry_version=7, sentry_key=${decodeURIComponent(u.username)}, sentry_client=cadsandbox/${meta.release}`
  }

  /** Fire-and-forget; drops repeats of the same error within a minute and anything past 30/minute. */
  report(r: ErrorReport): void {
    const now = Date.now()
    const key = `${r.platform}|${r.type ?? ''}|${r.message}`
    if ((this.recent.get(key) ?? 0) > now - DEDUPE_MS) return
    while (this.sentAt.length && this.sentAt[0]! < now - 60_000) this.sentAt.shift()
    if (this.sentAt.length >= MAX_PER_MINUTE) return
    this.sentAt.push(now)
    this.recent.set(key, now)
    if (this.recent.size > 500) for (const [k, t] of this.recent) if (t < now - DEDUPE_MS) this.recent.delete(k)

    const eventId = randomBytes(16).toString('hex')
    const frames = parseStack(r.stack)
    const event = {
      event_id: eventId,
      timestamp: now / 1000,
      platform: r.platform,
      level: 'error',
      logger: r.platform === 'node' ? 'server' : 'browser',
      release: this.meta.release,
      environment: this.meta.environment,
      exception: { values: [{ type: r.type || 'Error', value: r.message.slice(0, 2000), ...(frames.length ? { stacktrace: { frames } } : {}) }] },
      tags: r.tags,
      extra: r.extra,
    }
    const body = `${JSON.stringify({ event_id: eventId, sent_at: new Date(now).toISOString() })}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify(event)}\n`
    void this.send(body)
  }

  protected async send(body: string): Promise<void> {
    try {
      await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-sentry-envelope', 'X-Sentry-Auth': this.auth },
        body,
        signal: AbortSignal.timeout(5000),
      })
    } catch {
      // The tracker being down must never affect the app.
    }
  }
}

/** Fields of error-level log lines worth forwarding (the rest may hold ids we don't want to ship). */
const LOG_TAGS = ['job', 'kind', 'code', 'route', 'method', 'channel'] as const

/**
 * Turn a pino error-level call's arguments into a report: `log.error({ err, job }, 'job failed')`.
 * `err` may be an Error-like object (message/name/stack) or a plain message string.
 */
export function reportFromLog(args: unknown[]): ErrorReport | null {
  const [first, second] = args
  const obj = first && typeof first === 'object' ? (first as Record<string, unknown>) : {}
  const msg = typeof first === 'string' ? first : typeof second === 'string' ? second : 'error'
  const err = obj.err
  const e = err && typeof err === 'object' ? (err as { message?: unknown; name?: unknown; stack?: unknown }) : null
  const detail = typeof err === 'string' ? err : typeof e?.message === 'string' ? e.message : null
  const tags: Record<string, string> = {}
  for (const k of LOG_TAGS) if (typeof obj[k] === 'string' || typeof obj[k] === 'number') tags[k] = String(obj[k])
  return {
    platform: 'node',
    message: detail ? `${msg}: ${detail}` : msg,
    type: typeof e?.name === 'string' ? e.name : undefined,
    stack: typeof e?.stack === 'string' ? e.stack : undefined,
    tags,
  }
}
