// Production: serve the built web app (apps/web/dist) from the same origin — hashed assets are
// cached immutably, HTML is revalidated, unknown non-API paths fall back to index.html (SPA).
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import type { AppEnv } from './context'

export function staticRoutes(app: Hono<AppEnv>, webDir: string): void {
  app.use(
    '/assets/*',
    serveStatic({
      root: webDir,
      onFound: (_path, c) => {
        c.header('Cache-Control', 'public, max-age=31536000, immutable')
      },
    }),
  )
  app.use(
    '*',
    serveStatic({
      root: webDir,
      onFound: (path, c) => {
        c.header('Cache-Control', path.endsWith('.html') || path.endsWith('sw.js') || path.endsWith('.webmanifest') ? 'no-cache' : 'public, max-age=3600')
      },
    }),
  )
  let indexHtml: string | null = null
  app.get('*', async (c, next) => {
    const p = c.req.path
    if (p.startsWith('/api/') || p === '/api' || p.startsWith('/collab')) return next()
    if (!(c.req.header('accept') ?? '').includes('text/html')) return next()
    indexHtml ??= await readFile(join(webDir, 'index.html'), 'utf8')
    c.header('Cache-Control', 'no-cache')
    return c.html(indexHtml)
  })
}
