// Short-lived signed grants for anonymous viewers of password-protected share links: after the
// password was checked once (POST /api/share/:token/accept) the client presents the grant instead of
// the raw token, so the password is never re-sent. A grant is only a proof of "password known for
// link L until exp" — every use still re-checks that link L exists, is unexpired and still belongs to
// the project, so deleting the link revokes all grants immediately.
//
// Format: "g1." + base64url(JSON {l, p, exp}) + "." + base64url(HMAC-SHA256(key, "g1." + payload))
// Key: HKDF-SHA256(BETTER_AUTH_SECRET, info "cadsandbox/share-grant/v1") — separated from better-auth.
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'

const PREFIX = 'g1.'
export const SHARE_GRANT_TTL_SECONDS = 12 * 3600

export interface ShareGrantClaims {
  linkId: string
  projectId: string
  /** Unix seconds. */
  exp: number
}

export const isShareGrant = (credential: string) => credential.startsWith(PREFIX)

export class ShareGrants {
  private readonly key: Buffer

  constructor(
    secret: string,
    private readonly ttlSeconds = SHARE_GRANT_TTL_SECONDS,
  ) {
    this.key = Buffer.from(hkdfSync('sha256', secret, 'cadsandbox', 'cadsandbox/share-grant/v1', 32))
  }

  private sign(data: string): Buffer {
    return createHmac('sha256', this.key).update(data).digest()
  }

  /** Issue a grant for `linkId`, never outliving the link itself. */
  issue(linkId: string, projectId: string, linkExpiresAt: Date | null): { grant: string; expiresAt: Date } {
    let exp = Math.floor(Date.now() / 1000) + this.ttlSeconds
    if (linkExpiresAt) exp = Math.min(exp, Math.floor(linkExpiresAt.getTime() / 1000))
    const payload = Buffer.from(JSON.stringify({ l: linkId, p: projectId, exp })).toString('base64url')
    const sig = this.sign(`${PREFIX}${payload}`).toString('base64url')
    return { grant: `${PREFIX}${payload}.${sig}`, expiresAt: new Date(exp * 1000) }
  }

  /** Verify signature + expiry. Returns the claims or null (never throws). */
  verify(credential: string): ShareGrantClaims | null {
    if (!isShareGrant(credential) || credential.length > 512) return null
    const body = credential.slice(PREFIX.length)
    const dot = body.lastIndexOf('.')
    if (dot <= 0) return null
    const payload = body.slice(0, dot)
    const given = Buffer.from(body.slice(dot + 1), 'base64url')
    const expected = this.sign(`${PREFIX}${payload}`)
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
    try {
      const c = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { l?: unknown; p?: unknown; exp?: unknown }
      if (typeof c.l !== 'string' || typeof c.p !== 'string' || typeof c.exp !== 'number') return null
      if (c.exp * 1000 <= Date.now()) return null
      return { linkId: c.l, projectId: c.p, exp: c.exp }
    } catch {
      return null
    }
  }
}
