// Hono application: middleware chain + all routes of the shared contract (+ better-auth handler).
import { Hono } from 'hono'
import { CLIENT_IP_HEADER } from '../auth/auth'
import type { Deps } from '../deps'
import { errorJson } from '../lib/errors'
import { adminRoutes } from '../routes/admin'
import { blobRoutes } from '../routes/blobs'
import { collectionRoutes } from '../routes/collections'
import { folderRoutes } from '../routes/folders'
import { meRoutes } from '../routes/me'
import { projectRoutes } from '../routes/projects'
import { publicRoutes } from '../routes/public'
import { sharingRoutes } from '../routes/sharing'
import { supportRoutes } from '../routes/support'
import { versionRoutes } from '../routes/versions'
import type { AppEnv } from './context'
import { csrf, errorHandler, ipRateLimit, loadSession, requestContext, securityHeaders } from './middleware'
import { jsonLimit, KB } from './router'
import { staticRoutes } from './static'

export function createApp(deps: Deps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.onError(errorHandler)
  app.use('*', requestContext(deps))
  app.use('*', securityHeaders(deps.config))
  app.use('/api/*', csrf(deps.config))
  app.use('/api/*', ipRateLimit(deps))

  // better-auth. The client IP header is always overwritten with the value we resolved ourselves.
  app.on(['GET', 'POST'], '/api/auth/*', jsonLimit(64 * KB), async (c) => {
    const headers = new Headers(c.req.raw.headers)
    headers.delete(CLIENT_IP_HEADER)
    const ip = c.get('ip')
    if (ip) headers.set(CLIENT_IP_HEADER, ip)
    const isSignOut = c.req.method === 'POST' && c.req.path === '/api/auth/sign-out'
    const before = isSignOut && headers.get('cookie') ? await deps.auth.api.getSession({ headers }).catch(() => null) : null
    const init: RequestInit & { duplex?: 'half' } = { method: c.req.method, headers }
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      init.body = c.req.raw.body
      init.duplex = 'half'
    }
    const res = await deps.auth.handler(new Request(c.req.raw.url, init))
    if (before && res.ok) deps.events.sessionRevoked(before.session.id)
    return res
  })

  app.use('/api/*', loadSession(deps))
  publicRoutes(app)
  meRoutes(app)
  folderRoutes(app)
  projectRoutes(app)
  sharingRoutes(app)
  blobRoutes(app)
  versionRoutes(app)
  collectionRoutes(app)
  supportRoutes(app)
  adminRoutes(app)
  app.all('/api/*', (c) => c.json(errorJson('not_found', 'Not found'), 404))

  if (deps.config.webDistDir) staticRoutes(app, deps.config.webDistDir)
  app.notFound((c) => c.json(errorJson('not_found', 'Not found'), 404))
  return app
}
