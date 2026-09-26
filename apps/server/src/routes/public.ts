// Unauthenticated endpoints: health, public config, active announcements.
import type { Hono } from 'hono'
import { and, asc, gt, isNull, lte, or, sql } from 'drizzle-orm'
import { BRAND, LIMITS, schemas, type AnnouncementDTO, type PublicConfigDTO } from '@cadsandbox/shared'
import { announcements } from '../db/schema'
import { jsonBody, limit, type AppEnv } from '../http/context'
import { redactUrl } from '../log'
import { jsonLimit, KB, register } from '../http/router'
import { lifecycle } from '../lifecycle'

export const announcementDTO = (a: typeof announcements.$inferSelect): AnnouncementDTO => ({
  id: a.id,
  message: a.message,
  level: a.level,
  startsAt: a.startsAt.toISOString(),
  endsAt: a.endsAt ? a.endsAt.toISOString() : null,
})

export function publicRoutes(app: Hono<AppEnv>): void {
  register(app, 'health', async (c) => {
    const d = c.get('deps')
    if (lifecycle.draining) {
      c.header('Cache-Control', 'no-store')
      return c.json({ ok: false, version: d.config.version, draining: true }, 503)
    }
    let db = true
    try {
      await d.db.execute(sql`SELECT 1`)
    } catch {
      db = false
    }
    c.header('Cache-Control', 'no-store')
    return c.json({ ok: db, version: d.config.version, db: db ? 'up' : 'down' }, db ? 200 : 503)
  })

  // Browser errors → error tracker (the page itself never contacts a third party).
  register(app, 'clientError', jsonLimit(16 * KB), async (c) => {
    const d = c.get('deps')
    limit(c, 'clientErrorsPerIp', c.get('ipHash'))
    const input = await jsonBody(c, schemas.clientError)
    d.errorReporter?.report({
      platform: 'javascript',
      message: input.message,
      type: input.type,
      stack: input.stack,
      tags: { path: redactUrl(input.path), ...(input.release ? { client: input.release } : {}) },
      extra: { userAgent: (c.req.header('user-agent') ?? '').slice(0, 300) },
    })
    return c.body(null, 204)
  })

  // Proof-of-work challenge for the sign-up form (see auth/captcha.ts).
  register(app, 'signupChallenge', (c) => {
    const d = c.get('deps')
    if (!d.pow) return c.json({ error: { code: 'not_found', message: 'Not enabled' } }, 404)
    limit(c, 'authPerIp', c.get('ipHash'))
    c.header('Cache-Control', 'no-store')
    return c.json(d.pow.issue())
  })

  register(app, 'config', (c) => {
    const { config } = c.get('deps')
    const body: PublicConfigDTO = {
      appName: BRAND.name,
      version: config.version,
      features: { ...config.features },
      limits: { maxBlobBytes: LIMITS.maxBlobBytes, maxProjectsFree: config.maxProjectsFree, storageQuotaBytes: config.storageQuotaBytes },
      legal: { ...config.legal },
      collabPath: config.collabPath,
    }
    c.header('Cache-Control', 'public, max-age=300')
    return c.json(body)
  })

  register(app, 'announcements', async (c) => {
    const now = new Date()
    const rows = await c
      .get('deps')
      .db.select()
      .from(announcements)
      .where(and(lte(announcements.startsAt, now), or(isNull(announcements.endsAt), gt(announcements.endsAt, now))))
      .orderBy(asc(announcements.startsAt))
      .limit(20)
    c.header('Cache-Control', 'public, max-age=60')
    return c.json(rows.map(announcementDTO))
  })
}
