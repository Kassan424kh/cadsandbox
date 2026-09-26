// Structured logging (pino) with redaction. Never log cookies, auth headers, tokens, passwords or raw IPs.
import pino, { type Logger } from 'pino'

export type { Logger }

const REDACT = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["set-cookie"]',
  'req.headers["x-share-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.token',
  '*.secret',
  '*.backupCodes',
  '*.cookie',
  '*.authorization',
]

/** "jane.doe@example.com" → "j***@example.com" */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null
  const at = email.indexOf('@')
  if (at <= 0) return '***'
  return `${email[0]}***${email.slice(at)}`
}

/** Remove secrets from URLs before logging (share tokens in query strings / paths). */
export function redactUrl(url: string): string {
  return url
    .replace(/([?&](?:token|share|code|password)=)[^&#]*/gi, '$1[redacted]')
    .replace(/(\/api\/share\/)[^/?#]+/, '$1[redacted]')
    .replace(/(\/reset-password\/)[^/?#]+/, '$1[redacted]')
}

/** `onError` sees the raw arguments of every error/fatal log call (see lib/error-reports.ts). */
export function createLogger(level: string, isProd: boolean, onError?: (args: unknown[]) => void): Logger {
  return pino({
    level,
    ...(onError
      ? {
          hooks: {
            logMethod(args, method, lvl) {
              if (lvl >= 50) {
                try {
                  onError(args)
                } catch {
                  // reporting must never break logging
                }
              }
              return method.apply(this, args)
            },
          },
        }
      : {}),
    base: { service: 'cadsandbox-server' },
    redact: { paths: REDACT, censor: '[redacted]' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    ...(isProd ? {} : { messageKey: 'msg' }),
  })
}
