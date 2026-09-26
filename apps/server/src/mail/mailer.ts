// Outgoing mail: SMTP (EU provider, TLS) in production; development logs messages instead of sending.
import nodemailer, { type Transporter } from 'nodemailer'
import type { Config } from '../env'
import type { Logger } from '../log'
import { maskEmail } from '../log'
import { renderMail, type Locale, type MailTemplate, type RenderedMail } from './templates'

export interface OutgoingMail extends RenderedMail {
  to: string
}

export interface Mailer {
  send(to: string, template: MailTemplate, locale: Locale): Promise<void>
  /**
   * Fire-and-forget (avoids timing side channels in auth flows). Temporary failures are retried a few
   * times over ~40 minutes; the message is kept in memory only — it may contain sign-in links.
   */
  queue(to: string, template: MailTemplate, locale: Locale): void
}

/** Delays before the 2nd, 3rd, … attempt of a queued message. */
export const MAIL_RETRY_MS = [30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000]

/** SMTP 5xx replies (unknown mailbox, rejected sender, …) will not succeed on a retry. */
const isPermanent = (err: unknown) => {
  const code = (err as { responseCode?: number }).responseCode
  return typeof code === 'number' && code >= 500 && code < 600
}

abstract class BaseMailer implements Mailer {
  constructor(
    protected readonly log: Logger,
    private readonly retryMs: readonly number[] = MAIL_RETRY_MS,
  ) {}
  protected abstract deliver(mail: OutgoingMail): Promise<void>

  async send(to: string, template: MailTemplate, locale: Locale): Promise<void> {
    await this.deliver({ to, ...renderMail(template, locale) })
  }

  queue(to: string, template: MailTemplate, locale: Locale): void {
    let mail: OutgoingMail
    try {
      mail = { to, ...renderMail(template, locale) }
    } catch (err) {
      this.log.error({ err: (err as Error).message, kind: template.kind }, 'mail rendering failed')
      return
    }
    void this.attempt(mail, template.kind, 0)
  }

  private async attempt(mail: OutgoingMail, kind: string, n: number): Promise<void> {
    try {
      await this.deliver(mail)
    } catch (err) {
      const delay = isPermanent(err) ? undefined : this.retryMs[n]
      const fields = { err: (err as Error).message, to: maskEmail(mail.to), kind, attempt: n + 1 }
      if (delay === undefined) {
        this.log.error(fields, 'mail delivery failed')
        return
      }
      this.log.warn({ ...fields, retryInMs: delay }, 'mail delivery failed — will retry')
      setTimeout(() => void this.attempt(mail, kind, n + 1), delay).unref()
    }
  }
}

class SmtpMailer extends BaseMailer {
  private readonly transport: Transporter
  private readonly from: string
  constructor(config: Config, log: Logger) {
    super(log)
    const s = config.smtp
    // Pooled: bursts (e.g. the account-deletion job) share a few connections instead of one per mail.
    this.transport = nodemailer.createTransport({
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
      host: s.host,
      port: s.port,
      secure: s.secure,
      requireTLS: !s.secure,
      auth: s.user ? { user: s.user, pass: s.pass ?? '' } : undefined,
      tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    })
    this.from = s.from
  }

  protected async deliver(mail: OutgoingMail): Promise<void> {
    await this.transport.sendMail({ from: this.from, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html })
    this.log.info({ to: maskEmail(mail.to), subject: mail.subject }, 'mail sent')
  }
}

/** Development transport: prints the message (including links) to the server log. */
class LogMailer extends BaseMailer {
  protected async deliver(mail: OutgoingMail): Promise<void> {
    this.log.warn({ to: mail.to, subject: mail.subject }, `[dev mail]\n${mail.text}`)
  }
}

/** Test transport: keeps messages in memory; `failNext` simulates temporary delivery failures. */
export class MemoryMailer extends BaseMailer {
  readonly sent: OutgoingMail[] = []
  failNext = 0
  protected async deliver(mail: OutgoingMail): Promise<void> {
    if (this.failNext > 0) {
      this.failNext--
      throw new Error('temporary failure')
    }
    this.sent.push(mail)
  }
}

export function createMailer(config: Config, log: Logger): Mailer {
  if (config.isTest) return new MemoryMailer(log)
  if (config.smtp.host) return new SmtpMailer(config, log)
  if (config.isProd) log.warn('SMTP not configured — e-mails are logged, not sent')
  return new LogMailer(log)
}
