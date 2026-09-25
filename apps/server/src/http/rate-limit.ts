// In-memory fixed-window rate limiter (per process). Keys use hashed IPs / user ids — never raw IPs.
// For multi-instance deployments put a shared limiter in front (e.g. Caddy rate_limit) — see DEPLOYMENT.md.

interface Bucket {
  count: number
  reset: number
}

export interface LimitResult {
  ok: boolean
  remaining: number
  retryAfterSec: number
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>()
  private readonly timer: NodeJS.Timeout

  constructor(readonly enabled: boolean) {
    this.timer = setInterval(() => this.sweep(), 60_000)
    this.timer.unref()
  }

  hit(key: string, max: number, windowSec: number): LimitResult {
    if (!this.enabled) return { ok: true, remaining: max, retryAfterSec: 0 }
    const now = Date.now()
    let b = this.buckets.get(key)
    if (!b || b.reset <= now) {
      b = { count: 0, reset: now + windowSec * 1000 }
      this.buckets.set(key, b)
    }
    b.count++
    const ok = b.count <= max
    return { ok, remaining: Math.max(0, max - b.count), retryAfterSec: ok ? 0 : (b.reset - now) / 1000 }
  }

  /** Would the next hit be refused? (does not count) */
  isLimited(key: string, max: number): LimitResult {
    const b = this.buckets.get(key)
    const now = Date.now()
    if (!this.enabled || !b || b.reset <= now || b.count < max) return { ok: true, remaining: max - (b && b.reset > now ? b.count : 0), retryAfterSec: 0 }
    return { ok: false, remaining: 0, retryAfterSec: (b.reset - now) / 1000 }
  }

  private sweep(): void {
    const now = Date.now()
    for (const [k, b] of this.buckets) if (b.reset <= now) this.buckets.delete(k)
  }

  close(): void {
    clearInterval(this.timer)
  }
}

/** Named limits (max requests per window in seconds). */
export const LIMIT_RULES = {
  apiPerIp: [1200, 60],
  apiPerUser: [2400, 60],
  authPerIp: [60, 60],
  shareAcceptPerIp: [30, 600],
  /** Wrong share-link passwords per link (checked before verifying, counted on failure). */
  sharePasswordFailPerLink: [10, 600],
  uploadPerUser: [300, 60],
  uploadPerIp: [300, 60],
  exportPerUser: [3, 3600],
  invitePerUser: [60, 3600],
  ticketPerUser: [10, 3600],
  ticketMessagePerUser: [60, 3600],
  collabUpgradePerIp: [120, 60],
  deleteAccountPerUser: [5, 3600],
} as const satisfies Record<string, readonly [number, number]>

export type LimitRule = keyof typeof LIMIT_RULES
