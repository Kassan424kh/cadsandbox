// Audit trail for security-relevant actions. Writes never break the calling request.
import { auditLog } from '../db/schema'
import type { DbOrTx } from '../db/client'
import { newId } from '../lib/crypto'
import { truncateIp } from '../lib/ip'
import type { Logger } from '../log'

export interface AuditInput {
  actorId?: string | null
  actorEmail?: string | null
  action: string
  targetType?: string | null
  targetId?: string | null
  meta?: Record<string, unknown>
  /** Raw client IP — only the truncated form is stored. */
  ip?: string | null
}

export async function audit(db: DbOrTx, entry: AuditInput, log?: Logger): Promise<void> {
  try {
    await db.insert(auditLog).values({
      id: newId(),
      actorId: entry.actorId ?? null,
      actorEmail: entry.actorEmail ?? null,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      meta: entry.meta ?? {},
      ip: truncateIp(entry.ip),
    })
  } catch (err) {
    log?.error({ err: (err as Error).message, action: entry.action }, 'audit write failed')
  }
}

/** De-duplicates high-frequency audit events (e.g. support staff streaming a project's blobs). */
export class AuditThrottle {
  private readonly seen = new Map<string, number>()
  constructor(private readonly windowMs = 5 * 60_000) {}

  shouldLog(key: string): boolean {
    const now = Date.now()
    const last = this.seen.get(key)
    if (last && now - last < this.windowMs) return false
    this.seen.set(key, now)
    if (this.seen.size > 10_000) {
      for (const [k, t] of this.seen) if (now - t >= this.windowMs) this.seen.delete(k)
    }
    return true
  }
}
