// Theme: dark / light / system. Sets [data-theme] on <html>, persists in localStorage, and notifies
// subscribers (the editor engine listens to switch its viewport palette).
import { useCallback, useEffect, useSyncExternalStore } from 'react'

export type ThemeSetting = 'dark' | 'light' | 'system'
export type ResolvedTheme = 'dark' | 'light'

const STORAGE_KEY = 'cs.theme'
const listeners = new Set<() => void>()
let setting: ThemeSetting = readSetting()
let mq: MediaQueryList | null = null

function readSetting(): ThemeSetting {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'dark' || v === 'light' || v === 'system') return v
  } catch {
    /* storage unavailable */
  }
  return 'system'
}

function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'dark'
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function resolveTheme(s: ThemeSetting = setting): ResolvedTheme {
  return s === 'system' ? systemTheme() : s
}

function apply(): void {
  if (typeof document === 'undefined') return
  const resolved = resolveTheme()
  const html = document.documentElement
  if (html.getAttribute('data-theme') !== resolved) html.setAttribute('data-theme', resolved)
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#0b0b0d' : '#f3f3f5')
  for (const l of listeners) l()
}

function ensureSystemListener(): void {
  if (mq || typeof window === 'undefined') return
  mq = window.matchMedia('(prefers-color-scheme: light)')
  mq.addEventListener('change', () => {
    if (setting === 'system') apply()
  })
}

/** Apply the persisted theme immediately (call once at startup, before first paint). */
export function initTheme(): ResolvedTheme {
  ensureSystemListener()
  apply()
  return resolveTheme()
}

export function getThemeSetting(): ThemeSetting {
  return setting
}

export function setThemeSetting(next: ThemeSetting): void {
  setting = next
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    /* ignore */
  }
  apply()
}

export function subscribeTheme(cb: () => void): () => void {
  ensureSystemListener()
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** React hook: `{ theme, resolved, setTheme, toggle }`. */
export function useTheme() {
  const theme = useSyncExternalStore(subscribeTheme, getThemeSetting, () => 'system' as ThemeSetting)
  const resolved = useSyncExternalStore(subscribeTheme, () => resolveTheme(), () => 'dark' as ResolvedTheme)
  useEffect(() => {
    initTheme()
  }, [])
  const setTheme = useCallback((t: ThemeSetting) => setThemeSetting(t), [])
  const toggle = useCallback(() => setThemeSetting(resolveTheme() === 'dark' ? 'light' : 'dark'), [])
  return { theme, resolved, setTheme, toggle }
}

if (typeof document !== 'undefined') initTheme()
