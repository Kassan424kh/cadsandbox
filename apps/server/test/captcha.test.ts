import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LEGAL } from '@cadsandbox/shared'
import { testServer, type TestServer } from './helpers'

let s: TestServer
beforeAll(async () => {
  s = await testServer({ SIGNUP_CAPTCHA: 'true', SIGNUP_CAPTCHA_DIFFICULTY: '2000' })
})
afterAll(() => s.close())

async function solve(): Promise<string> {
  const ch = (await s.json('GET', '/api/signup-challenge')).body as { challenge: string; salt: string; maxnumber: number; signature: string; algorithm: string }
  for (let n = 0; n <= ch.maxnumber; n++) {
    if (createHash('sha256').update(ch.salt + n).digest('hex') === ch.challenge) {
      return Buffer.from(JSON.stringify({ algorithm: ch.algorithm, challenge: ch.challenge, number: n, salt: ch.salt, signature: ch.signature })).toString('base64')
    }
  }
  throw new Error('unsolved')
}

const signUp = (email: string, captcha?: string) =>
  s.req('POST', '/api/auth/sign-up/email', {
    json: { email, password: 'correct-horse-battery-staple', name: 'P', termsVersion: LEGAL.termsVersion },
    headers: captcha ? { 'x-captcha': captcha } : {},
  })

describe('sign-up proof-of-work', () => {
  it('is advertised in the public config', async () => {
    expect((await s.json('GET', '/api/config')).body.features.signupCaptcha).toBe(true)
  })

  it('rejects sign-ups without a valid solution', async () => {
    expect((await signUp('pow-none@example.com')).status).toBe(400)
    const good = JSON.parse(Buffer.from(await solve(), 'base64').toString())
    const forged = Buffer.from(JSON.stringify({ ...good, signature: '0'.repeat(64) })).toString('base64')
    expect((await signUp('pow-forged@example.com', forged)).status).toBe(400)
    const wrong = Buffer.from(JSON.stringify({ ...good, number: good.number + 1 })).toString('base64')
    expect((await signUp('pow-wrong@example.com', wrong)).status).toBe(400)
  })

  it('accepts a solved challenge exactly once', async () => {
    const solution = await solve()
    expect((await signUp('pow-ok@example.com', solution)).status).toBe(200)
    expect((await signUp('pow-replay@example.com', solution)).status).toBe(400)
  })
})
