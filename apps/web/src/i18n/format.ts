// Locale-aware formatting helpers (dates, sizes, numbers) that follow the active UI language.
import { getLanguage, t } from './index'

const locale = () => (getLanguage() === 'de' ? 'de-DE' : 'en-GB')

function toDate(v: string | number | Date): Date {
  return v instanceof Date ? v : new Date(v)
}

export function formatDate(v: string | number | Date, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string {
  const d = toDate(v)
  return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat(locale(), opts).format(d)
}

export function formatDateTime(v: string | number | Date): string {
  return formatDate(v, { dateStyle: 'medium', timeStyle: 'short' })
}

export function formatNumber(n: number, opts?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale(), opts).format(n)
}

/** "3 minutes ago", "in 2 days", falls back to a date after ~a month. */
export function formatRelative(v: string | number | Date, now = Date.now()): string {
  const d = toDate(v)
  const diff = d.getTime() - now
  const abs = Math.abs(diff)
  if (Number.isNaN(abs)) return '—'
  if (abs < 45_000) return t('time.justNow', 'just now')
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' })
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['minute', 60_000],
    ['hour', 3_600_000],
    ['day', 86_400_000],
  ]
  if (abs < 3_600_000) return rtf.format(Math.round(diff / units[0]![1]), 'minute')
  if (abs < 86_400_000) return rtf.format(Math.round(diff / units[1]![1]), 'hour')
  if (abs < 30 * 86_400_000) return rtf.format(Math.round(diff / units[2]![1]), 'day')
  return formatDate(d)
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = bytes
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${formatNumber(v, { maximumFractionDigits: v < 10 && i > 0 ? 1 : 0 })} ${units[i]}`
}
