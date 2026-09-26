import pino from 'pino'
import { describe, expect, it } from 'vitest'
import { MemoryMailer } from '../src/mail/mailer'

const log = pino({ level: 'silent' })
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const template = { kind: 'verify', url: 'https://example.test/verify?token=x' } as const

describe('queued mail', () => {
  it('retries temporary failures', async () => {
    const m = new MemoryMailer(log, [10, 10])
    m.failNext = 2
    m.queue('someone@example.com', template, 'en')
    await wait(80)
    expect(m.sent).toHaveLength(1)
  })

  it('gives up after the last retry', async () => {
    const m = new MemoryMailer(log, [10])
    m.failNext = 5
    m.queue('someone@example.com', template, 'en')
    await wait(80)
    expect(m.sent).toHaveLength(0)
  })
})
