// /api/me — profile, GDPR export (Art. 15/20), account deletion with grace period (Art. 17).
import type { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { LIMITS, schemas, type MeDTO } from '@cadsandbox/shared'
import { deletionRequests, user } from '../db/schema'
import { badRequest } from '../lib/errors'
import { jsonBody, limit, requireAuth, requireRealUser, type AppEnv } from '../http/context'
import { jsonLimit, KB, register } from '../http/router'
import { pickLocale } from '../mail/templates'
import { audit } from '../services/audit'
import { exportUserData } from '../services/export'
import { orgsOfUser } from '../services/orgs'
import { storageUsage } from '../services/projects'
import { toUserDTO } from '../services/users'

const DATA_IMAGE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/
const LOCALE = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/

export function meRoutes(app: Hono<AppEnv>): void {
  register(app, 'me', async (c) => {
    const s = requireAuth(c)
    const d = c.get('deps')
    const [u] = await d.db.select().from(user).where(eq(user.id, s.user.id)).limit(1)
    if (!u) return c.json({ error: { code: 'unauthorized', message: 'Authentication required' } }, 401)
    const [orgs, used, [del]] = await Promise.all([
      orgsOfUser(d.db, u.id),
      storageUsage(d.db, u.id),
      d.db.select().from(deletionRequests).where(eq(deletionRequests.userId, u.id)).limit(1),
    ])
    const body: MeDTO = {
      user: toUserDTO(u),
      orgs,
      storage: { usedBytes: used, quotaBytes: d.config.storageQuotaBytes },
      deletionScheduledAt: del ? del.executeAfter.toISOString() : null,
    }
    return c.json(body)
  })

  register(app, 'updateMe', jsonLimit(300 * KB), async (c) => {
    const s = requireAuth(c)
    const d = c.get('deps')
    const input = await jsonBody(c, schemas.updateMe)
    // Avatars are data: URLs only — remote URLs would make every viewer contact a third party.
    if (input.image && !DATA_IMAGE.test(input.image)) throw badRequest('image must be a data:image/(png|jpeg|webp);base64 URL')
    if (input.locale !== undefined && !LOCALE.test(input.locale)) throw badRequest('Invalid locale')
    const patch: Partial<typeof user.$inferInsert> = { updatedAt: new Date() }
    if (input.name !== undefined) patch.name = input.name
    if (input.image !== undefined) patch.image = input.image
    if (input.locale !== undefined) patch.locale = input.locale
    const [u] = await d.db.update(user).set(patch).where(eq(user.id, s.user.id)).returning()
    return c.json(toUserDTO(u!))
  })

  register(app, 'exportMe', async (c) => {
    const s = requireRealUser(c)
    limit(c, 'exportPerUser', s.user.id)
    const d = c.get('deps')
    await audit(d.db, { actorId: s.user.id, actorEmail: s.user.email, action: 'account.export', targetType: 'user', targetId: s.user.id, ip: c.get('ip') }, d.log)
    const stream = await exportUserData(d, s.user.id)
    const date = new Date()
    d.mailer.queue(s.user.email, { kind: 'exportReady', date: date.toISOString().slice(0, 10), url: `${d.config.publicUrl}/settings/security` }, pickLocale((s.user as { locale?: string }).locale))
    return new Response(stream, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="cadsandbox-export-${date.toISOString().slice(0, 10)}.zip"`,
        'Cache-Control': 'no-store',
      },
    })
  })

  register(app, 'deleteMe', jsonLimit(8 * KB), async (c) => {
    const s = requireRealUser(c)
    limit(c, 'deleteAccountPerUser', s.user.id)
    const d = c.get('deps')
    const { confirmEmail } = await jsonBody(c, schemas.deleteMe)
    if (confirmEmail.trim().toLowerCase() !== s.user.email.toLowerCase()) throw badRequest('Confirmation e-mail does not match')
    const executeAfter = new Date(Date.now() + LIMITS.accountDeletionGraceDays * 86_400_000)
    const [row] = await d.db
      .insert(deletionRequests)
      .values({ userId: s.user.id, executeAfter })
      .onConflictDoUpdate({ target: deletionRequests.userId, set: { userId: s.user.id } })
      .returning()
    const when = row!.executeAfter
    await audit(d.db, { actorId: s.user.id, actorEmail: s.user.email, action: 'account.deletion.requested', targetType: 'user', targetId: s.user.id, ip: c.get('ip'), meta: { executeAfter: when.toISOString() } }, d.log)
    const locale = pickLocale((s.user as { locale?: string }).locale)
    d.mailer.queue(s.user.email, { kind: 'deletionScheduled', date: when.toISOString().slice(0, 10), url: `${d.config.publicUrl}/settings/privacy` }, locale)
    return c.json({ deletionScheduledAt: when.toISOString() })
  })

  register(app, 'cancelDeleteMe', async (c) => {
    const s = requireRealUser(c)
    const d = c.get('deps')
    const removed = await d.db.delete(deletionRequests).where(eq(deletionRequests.userId, s.user.id)).returning()
    if (removed.length) await audit(d.db, { actorId: s.user.id, actorEmail: s.user.email, action: 'account.deletion.cancelled', targetType: 'user', targetId: s.user.id, ip: c.get('ip') }, d.log)
    return c.json({ deletionScheduledAt: null })
  })
}
