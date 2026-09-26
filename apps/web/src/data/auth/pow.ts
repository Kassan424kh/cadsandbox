// Solves the server's sign-up proof-of-work (apps/server/src/auth/captcha.ts) with WebCrypto: find n
// with sha256(salt + n) = challenge. Started when the sign-up form opens, so it is done by submit.
import type { SignupChallengeDTO } from '@cadsandbox/shared'
import { api } from '../api/endpoints'

const BATCH = 500

async function solve(ch: SignupChallengeDTO): Promise<string> {
  const target = Uint8Array.from(ch.challenge.match(/../g) ?? [], (h) => parseInt(h, 16))
  const matches = (digest: ArrayBuffer) => {
    const d = new Uint8Array(digest)
    for (let i = 0; i < d.length; i++) if (d[i] !== target[i]) return false
    return true
  }
  const enc = new TextEncoder()
  for (let start = 0; start <= ch.maxnumber; start += BATCH) {
    const end = Math.min(ch.maxnumber, start + BATCH - 1)
    const jobs: Promise<number>[] = []
    for (let n = start; n <= end; n++) jobs.push(crypto.subtle.digest('SHA-256', enc.encode(ch.salt + n)).then((d) => (matches(d) ? n : -1)))
    const hit = (await Promise.all(jobs)).find((n) => n >= 0)
    if (hit !== undefined) {
      return btoa(JSON.stringify({ algorithm: ch.algorithm, challenge: ch.challenge, number: hit, salt: ch.salt, signature: ch.signature }))
    }
  }
  throw new Error('The sign-up check could not be completed — reload the page and try again')
}

/** Fetch and solve a fresh challenge; resolves to the value for the `x-captcha` header. */
export async function signupProof(): Promise<string> {
  return solve(await api.signupChallenge())
}
