// Cross-cutting HTTP middleware: request ids + privacy-preserving logs, security headers, CSRF
// (Origin / Sec-Fetch-Site), rate limits, session loading, error mapping.
import type { ErrorHandler, MiddlewareHandler } from 'hono'
import { randomBytes } from 'node:crypto'
import type { Config } from '../env'
import type { Deps } from '../deps'
import { errorJson, HttpError, rateLimited } from '../lib/errors'
import { redactUrl } from '../log'
import { LIMIT_RULES } from './rate-limit'
import type { AppEnv } from './context'

export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "img-src 'self' data: blob:",
  "connect-src 'self' ws: wss:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ')

const PERMISSIONS_POLICY = [
  'accelerometer=()',
  'autoplay=()',
  'camera=()',
  'display-capture=()',
  'geolocation=()',
  'gyroscope=()',
  'hid=()',
  'magnetometer=()',
  'microphone=()',
  'midi=()',
  'payment=()',
  'publickey-credentials-get=(self)',
  'publickey-credentials-create=(self)',
  'serial=()',
  'usb=()',
  'xr-spatial-tracking=(self)',
  'fullscreen=(self)',
  'clipboard-write=(self)',
  'interest-cohort=()',
  'browsing-topics=()',
].join(', ')

export function requestContext(deps: Deps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const started = performance.now()
    const requestId = randomBytes(9).toString('base64url')
    const incoming = c.env?.incoming
    const ip = deps.proxy.resolve(incoming?.socket?.remoteAddress ?? null, c.req.header('x-forwarded-for') ?? null)
    const ipHash = deps.ipHasher.hash(ip)
    const log = deps.log.child({ reqId: requestId })
    c.set('deps', deps)
    c.set('requestId', requestId)
    c.set('ip', ip)
    c.set('ipHash', ipHash)
    c.set('log', log)
    c.set('session', null)
    await next()
    c.header('X-Request-Id', requestId)
    const ms = Math.round(performance.now() - started)
    const status = c.res.status
    if (c.req.path.startsWith('/api/') || status >= 500) {
      const fields = { method: c.req.method, path: redactUrl(c.req.path), status, ms, ip: ipHash, user: c.get('session')?.user.id }
      if (status >= 500) log.error(fields, 'request failed')
      else log.info(fields, 'request')
    }
  }
}

export function securityHeaders(config: Config): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await next()
    const h = c.res.headers
    if (!h.has('Content-Security-Policy')) h.set('Content-Security-Policy', CSP)
    h.set('Cross-Origin-Opener-Policy', 'same-origin')
    h.set('Cross-Origin-Embedder-Policy', 'require-corp')
    h.set('Cross-Origin-Resource-Policy', 'same-origin')
    h.set('Referrer-Policy', 'no-referrer')
    h.set('Permissions-Policy', PERMISSIONS_POLICY)
    h.set('X-Content-Type-Options', 'nosniff')
    h.set('X-Frame-Options', 'DENY')
    h.set('Origin-Agent-Cluster', '?1')
    h.set('X-DNS-Prefetch-Control', 'off')
    h.set('X-Permitted-Cross-Domain-Policies', 'none')
    if (config.isProd) h.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
    h.delete('X-Powered-By')
    if (c.req.path.startsWith('/api/') && !h.has('Cache-Control')) h.set('Cache-Control', 'no-store')
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * CSRF defence for state-changing requests (on top of SameSite=Lax cookies): the Origin must be one
 * of ours; without Origin, Sec-Fetch-Site must be same-origin; cookie-bearing requests carrying
 * neither header are rejected.
 */
export function csrf(config: Config): MiddlewareHandler<AppEnv> {
  const trusted = new Set(config.trustedOrigins)
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next()
    const origin = c.req.header('origin')
    const site = c.req.header('sec-fetch-site')
    let ok: boolean
    if (origin) ok = origin !== 'null' && trusted.has(origin)
    else if (site) ok = site === 'same-origin' || site === 'none'
    else ok = !c.req.header('cookie')
    if (!ok) {
      c.get('log').warn({ origin: origin ?? null, site: site ?? null, path: c.req.path }, 'csrf check failed')
      return c.json(errorJson('forbidden', 'Cross-site request blocked'), 403)
    }
    return next()
  }
}

/** Global API limits per hashed IP (and per user once the session is known). */
export function ipRateLimit(deps: Deps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const isAuth = c.req.path.startsWith('/api/auth/') && !c.req.path.endsWith('/get-session')
    const [max, win] = isAuth ? LIMIT_RULES.authPerIp : LIMIT_RULES.apiPerIp
    const r = deps.limiter.hit(`${isAuth ? 'auth' : 'api'}:${c.get('ipHash')}`, max, win)
    if (!r.ok) throw rateLimited(r.retryAfterSec)
    return next()
  }
}

export function loadSession(deps: Deps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (c.req.header('cookie')) {
      const s = await deps.auth.api.getSession({ headers: c.req.raw.headers })
      const banned = s?.user.banned && (!s.user.banExpires || new Date(s.user.banExpires) > new Date())
      if (s && !banned) {
        c.set('session', s)
        const [max, win] = LIMIT_RULES.apiPerUser
        const r = deps.limiter.hit(`user:${s.user.id}`, max, win)
        if (!r.ok) throw rateLimited(r.retryAfterSec)
      }
    }
    return next()
  }
}

export const errorHandler: ErrorHandler<AppEnv> = (err, c) => {
  if (err instanceof HttpError) {
    if (err.headers) for (const [k, v] of Object.entries(err.headers)) c.header(k, v)
    return c.json(err.body(), err.status)
  }
  const e = err as Error & { status?: number }
  // Hono's own HTTPExceptions (e.g. body-limit) carry a status.
  if (e.status === 413) return c.json(errorJson('payload_too_large', 'Payload too large'), 413)
  const log = c.get('log') ?? c.get('deps')?.log
  log?.error({ err: { message: e.message, name: e.name, stack: e.stack } }, 'unhandled error')
  return c.json(errorJson('internal', 'Internal server error'), 500)
}
