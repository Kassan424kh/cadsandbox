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
  /** Fire-and-forget (errors are logged) — avoids timing side channels in auth flows. */
  queue(to: string, template: MailTemplate, locale: Locale): void
}

abstract class BaseMailer implements Mailer {
  constructor(protected readonly log: Logger) {}
  protected abstract deliver(mail: OutgoingMail): Promise<void>

  async send(to: string, template: MailTemplate, locale: Locale): Promise<void> {
    await this.deliver({ to, ...renderMail(template, locale) })
  }

  queue(to: string, template: MailTemplate, locale: Locale): void {
    this.send(to, template, locale).catch((err: unknown) =>
      this.log.error({ err: (err as Error).message, to: maskEmail(to), kind: template.kind }, 'mail delivery failed'),
    )
  }
}

class SmtpMailer extends BaseMailer {
  private readonly transport: Transporter
  private readonly from: string
  constructor(config: Config, log: Logger) {
    super(log)
    const s = config.smtp
    this.transport = nodemailer.createTransport({
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

/** Test transport: keeps messages in memory. */
export class MemoryMailer extends BaseMailer {
  readonly sent: OutgoingMail[] = []
  protected async deliver(mail: OutgoingMail): Promise<void> {
    this.sent.push(mail)
  }
}

export function createMailer(config: Config, log: Logger): Mailer {
  if (config.isTest) return new MemoryMailer(log)
  if (config.smtp.host) return new SmtpMailer(config, log)
  if (config.isProd) log.warn('SMTP not configured — e-mails are logged, not sent')
  return new LogMailer(log)
}
