// i18n runtime — owned by the app-shell engineer. Stable API: t(key, fallback, vars?) and useT().
// Missing keys fall back to the English `fallback`, so callers never break.
//
// Dictionaries live in ./locales/<lang> and load lazily (one small chunk per language).
// `initI18n()` is awaited once before the first render so the persisted language paints directly.
import { useEffect, useSyncExternalStore, type ReactNode } from 'react'

export type Vars = Record<string, string | number>
export type Lang = 'en' | 'de'
export type Dictionary = Readonly<Record<string, string>>

export const LANGUAGES: readonly { id: Lang; label: string; native: string }[] = [
  { id: 'en', label: 'English', native: 'English' },
  { id: 'de', label: 'German', native: 'Deutsch' },
]

const STORAGE_KEY = 'cadsandbox.lang'
const loaders: Record<Lang, () => Promise<Dictionary>> = {
  en: () => import('./locales/en').then((m) => m.default),
  de: () => import('./locales/de').then((m) => m.default),
}

let lang: Lang = detectLanguage()
let dict: Dictionary = {}
let version = 0
const listeners = new Set<() => void>()
const reported = new Set<string>()

function isLang(v: unknown): v is Lang {
  return v === 'en' || v === 'de'
}

function detectLanguage(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (isLang(stored)) return stored
  } catch {
    /* storage unavailable (privacy mode) */
  }
  const prefs = typeof navigator !== 'undefined' ? (navigator.languages ?? [navigator.language]) : []
  for (const l of prefs) {
    const base = l?.toLowerCase().split('-')[0]
    if (isLang(base)) return base
  }
  return 'en'
}

const format = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`)) : s)

/** Translate `key`; falls back to the English `fallback` (with `{var}` interpolation). */
export function t(key: string, fallback: string, vars?: Vars): string {
  const hit = dict[key]
  if (hit === undefined && import.meta.env.DEV && lang !== 'en' && !reported.has(key)) {
    reported.add(key)
    console.debug(`[i18n] missing "${lang}" key: ${key}`)
  }
  return format(hit ?? fallback, vars)
}

/** Plural helper: looks up `${key}.one` / `${key}.other` and interpolates `{count}`. */
export function tn(key: string, count: number, one: string, other: string, vars?: Vars): string {
  const plural = new Intl.PluralRules(lang).select(count) === 'one'
  return t(plural ? `${key}.one` : `${key}.other`, plural ? one : other, { count, ...vars })
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
const getVersion = () => version

/** Returns `t`; re-renders the caller when the language changes. */
export function useT(): typeof t {
  useSyncExternalStore(subscribe, getVersion, getVersion)
  return t
}

export function getLanguage(): Lang {
  return lang
}

/** Current language (reactive). */
export function useLanguage(): Lang {
  useSyncExternalStore(subscribe, getVersion, getVersion)
  return lang
}

async function load(next: Lang): Promise<void> {
  try {
    dict = await loaders[next]()
  } catch (err) {
    // Offline with an uncached chunk: keep the English fallbacks rather than failing.
    console.warn('[i18n] could not load dictionary', next, err)
    dict = {}
  }
  lang = next
  reported.clear()
  document.documentElement.lang = next
  version++
  for (const l of listeners) l()
}

/** Load the persisted/detected language. Await before the first render. */
export function initI18n(): Promise<void> {
  return load(lang)
}

/** Switch language (persisted on this device). */
export async function setLanguage(next: Lang): Promise<void> {
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    /* ignore */
  }
  if (next !== lang || Object.keys(dict).length === 0) await load(next)
}

/** Adopt an account locale (e.g. after sign-in on a new device) unless the device has a choice. */
export function adoptLocale(locale: string | null | undefined): void {
  let stored: string | null = null
  try {
    stored = localStorage.getItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
  const base = locale?.toLowerCase().split('-')[0]
  if (!stored && isLang(base) && base !== lang) void setLanguage(base)
}

/** Keeps <html lang> in sync. Components re-render through useT()/useLanguage(). */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const current = useLanguage()
  useEffect(() => {
    document.documentElement.lang = current
  }, [current])
  return children
}

export { formatBytes, formatDate, formatDateTime, formatNumber, formatRelative } from './format'
