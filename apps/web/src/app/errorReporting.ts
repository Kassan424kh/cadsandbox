// Browser errors → POST /api/client-errors → the server forwards them to the self-hosted error
// tracker (GlitchTip). Active only when the server has one configured (config.features.errorReporting).
// Sends message, error type, stack and the page path — no document content, no user data.
import { routePath } from '@cadsandbox/shared'
import { apiUrl } from '../data/api/client'

const NOISE = /ResizeObserver loop|Script error\.?$|chrome-extension:|moz-extension:|safari-extension:/
let enabled = false
let release: string | undefined
let budget = 10
const seen = new Set<string>()

export function reportError(err: unknown): void {
  if (!enabled || budget <= 0) return
  const e = err instanceof Error ? err : null
  const message = (e ? e.message : String(err ?? 'Unknown error')).slice(0, 1000)
  const stack = e?.stack?.slice(0, 8000)
  if (NOISE.test(message) || (stack && NOISE.test(stack))) return
  const key = `${e?.name ?? ''}:${message}`
  if (seen.has(key)) return
  seen.add(key)
  budget--
  const body = JSON.stringify({ message, type: e?.name, stack, path: location.pathname, release })
  void fetch(apiUrl(routePath('clientError')), { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => undefined)
}

/** Start reporting uncaught errors and unhandled rejections (idempotent). */
export function enableErrorReporting(version: string): void {
  if (enabled) return
  enabled = true
  release = version
  window.addEventListener('error', (e) => reportError(e.error ?? e.message))
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason))
}
