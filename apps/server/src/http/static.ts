// Production: serve the built web app (apps/web/dist) from the same origin — hashed assets are
// cached immutably, HTML is revalidated, unknown non-API paths fall back to index.html (SPA).
// Compressible outputs have `.br`/`.gz` siblings written at build time (apps/web/vite.config.ts,
// `precompress`); `precompressed: true` picks one by Accept-Encoding and keeps the original
// Content-Type. /api never goes through here, so JSON stays identity-encoded.
import type { Context, Hono, MiddlewareHandler } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import type { AppEnv } from './context'

/** Outputs that get `.br`/`.gz` siblings at build time — keep in sync with the vite plugin. */
const COMPRESSIBLE = /\.(?:js|mjs|css|html|svg|json|wasm|webmanifest|txt)$/
const IMMUTABLE = 'public, max-age=31536000, immutable'
const revalidated = (file: string) => file.endsWith('.html') || file.endsWith('sw.js') || file.endsWith('.webmanifest')

/**
 * `serveStatic` with the response headers applied to the Response it returns: its `onFound` runs
 * after the Response is created, so `c.header()` there never reaches the client. The policy sees the
 * original file name (without the `.br`/`.gz` suffix of the sibling actually streamed).
 */
function files(root: string, cacheControl: (file: string) => string, path?: string): MiddlewareHandler<AppEnv> {
  const served = new WeakMap<Context, string>()
  const serve = serveStatic({ root, path, precompressed: true, onFound: (file, c) => void served.set(c, file) })
  return async (c, next) => {
    const res = await serve(c, next)
    const file = served.get(c)
    if (!res || file === undefined) return res
    const original = file.replace(/\.(?:br|gz)$/, '')
    res.headers.set('Cache-Control', cacheControl(original))
    if (COMPRESSIBLE.test(original)) res.headers.set('Vary', 'Accept-Encoding')
    return res
  }
}

export function staticRoutes(app: Hono<AppEnv>, webDir: string): void {
  app.use('/assets/*', files(webDir, () => IMMUTABLE))
  app.use('*', files(webDir, (file) => (revalidated(file) ? 'no-cache' : 'public, max-age=3600')))
  const index = files(webDir, () => 'no-cache', 'index.html')
  app.get('*', (c, next) => {
    const p = c.req.path
    if (p.startsWith('/api/') || p === '/api' || p.startsWith('/collab')) return next()
    if (!(c.req.header('accept') ?? '').includes('text/html')) return next()
    return index(c, next)
  })
}
