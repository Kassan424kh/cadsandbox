// Self-hosted proof-of-work for sign-up (ALTCHA-compatible payloads): before a sign-up is accepted the
// browser must find `number` with sha256(salt + number) = challenge. A real browser solves it in about a
// second while the form is filled in; bulk sign-ups become expensive. No third-party request involved.
import { createHash, createHmac, hkdfSync, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import type { SignupChallengeDTO } from '@cadsandbox/shared'

const TTL_MS = 10 * 60_000
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

export class ProofOfWork {
  private readonly key: Buffer
  /** Solved challenges (→ expiry): each one is accepted once. */
  private readonly used = new Map<string, number>()

  constructor(
    secret: string,
    readonly maxNumber: number,
  ) {
    this.key = Buffer.from(hkdfSync('sha256', secret, 'cadsandbox', 'cadsandbox/signup-pow/v1', 32))
  }

  private sign(challenge: string): string {
    return createHmac('sha256', this.key).update(challenge).digest('hex')
  }

  issue(now = Date.now()): SignupChallengeDTO {
    const salt = `${randomBytes(12).toString('hex')}?expires=${Math.floor((now + TTL_MS) / 1000)}`
    const challenge = sha256(salt + randomInt(0, this.maxNumber + 1))
    return { algorithm: 'SHA-256', challenge, salt, maxnumber: this.maxNumber, signature: this.sign(challenge) }
  }

  /** Verify a base64(JSON) solution: our signature, not expired, correct number, not used before. */
  verify(payload: string | null | undefined, now = Date.now()): boolean {
    if (!payload || payload.length > 2048) return false
    let p: { algorithm?: unknown; challenge?: unknown; number?: unknown; salt?: unknown; signature?: unknown }
    try {
      p = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'))
    } catch {
      return false
    }
    const { challenge, number, salt, signature } = p
    if (p.algorithm !== 'SHA-256' || typeof challenge !== 'string' || typeof salt !== 'string' || typeof signature !== 'string') return false
    if (!Number.isInteger(number) || (number as number) < 0 || (number as number) > this.maxNumber) return false
    const expected = Buffer.from(this.sign(challenge), 'hex')
    const given = Buffer.from(signature, 'hex')
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false
    const expires = Number(/[?&]expires=(\d+)/.exec(salt)?.[1] ?? 0) * 1000
    if (!expires || expires < now) return false
    if (sha256(salt + number) !== challenge) return false
    for (const [c, exp] of this.used) if (exp < now) this.used.delete(c)
    if (this.used.has(challenge)) return false
    this.used.set(challenge, expires)
    return true
  }
}
