// Unauthenticated endpoints: health, public config, active announcements.
import type { Hono } from 'hono'
import { and, asc, gt, isNull, lte, or, sql } from 'drizzle-orm'
import { BRAND, LIMITS, type AnnouncementDTO, type PublicConfigDTO } from '@cadsandbox/shared'
import { announcements } from '../db/schema'
import type { AppEnv } from '../http/context'
import { register } from '../http/router'

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
    let db = true
    try {
      await d.db.execute(sql`SELECT 1`)
    } catch {
      db = false
    }
    c.header('Cache-Control', 'no-store')
    return c.json({ ok: db, version: d.config.version, db: db ? 'up' : 'down' }, db ? 200 : 503)
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
