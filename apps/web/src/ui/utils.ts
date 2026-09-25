import { clsx, type ClassValue } from 'clsx'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Ref, type RefCallback } from 'react'

/** Class name helper (clsx re-export with a short name). */
export const cx = (...args: ClassValue[]): string => clsx(args)

/** Merge several refs into one callback ref. */
export function mergeRefs<T>(...refs: (Ref<T> | undefined | null)[]): RefCallback<T> {
  return (value) => {
    for (const ref of refs) {
      if (!ref) continue
      if (typeof ref === 'function') ref(value)
      else (ref as { current: T | null }).current = value
    }
  }
}

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform ?? navigator.userAgent)

/** Is the platform modifier (⌘ on macOS, Ctrl elsewhere) pressed? */
export const isModKey = (e: { metaKey: boolean; ctrlKey: boolean }): boolean => (IS_MAC ? e.metaKey : e.ctrlKey)

/** True when the event target is an editable element (inputs, textareas, contenteditable). */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type
    return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'color', 'file'].includes(type)
  }
  return false
}

export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

/** Round to `decimals` avoiding float noise. */
export const roundTo = (v: number, decimals: number): number => {
  const f = 10 ** decimals
  return Math.round(v * f) / f
}

export const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

/** Media query hook. */
export function useMediaQuery(query: string): boolean {
  const get = () => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false)
  const [matches, setMatches] = useState(get)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setMatches(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return matches
}

export const useCoarsePointer = (): boolean => useMediaQuery('(pointer: coarse)')
export const useReducedMotion = (): boolean => useMediaQuery('(prefers-reduced-motion: reduce)')

/** Observe an element's size. */
export function useElementSize<T extends HTMLElement>(): [RefCallback<T>, { width: number; height: number }] {
  const [size, setSize] = useState({ width: 0, height: 0 })
  const roRef = useRef<ResizeObserver | null>(null)
  const ref = useCallback<RefCallback<T>>((el) => {
    roRef.current?.disconnect()
    roRef.current = null
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect
      if (r) setSize((s) => (s.width === r.width && s.height === r.height ? s : { width: r.width, height: r.height }))
    })
    ro.observe(el)
    roRef.current = ro
  }, [])
  return [ref, size]
}

/** Stable latest-value ref. */
export function useLatest<T>(value: T) {
  const ref = useRef(value)
  ref.current = value
  return ref
}

/** Debounced callback (trailing). */
export function useDebouncedCallback<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  const latest = useLatest(fn)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])
  return useCallback(
    (...args: A) => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => latest.current(...args), ms)
    },
    [ms, latest],
  )
}

/** Persisted state in localStorage (JSON). Safe when storage is unavailable. */
export function useLocalStorage<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw === null ? initial : (JSON.parse(raw) as T)
    } catch {
      return initial
    }
  })
  const set = useCallback(
    (v: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v
        try {
          localStorage.setItem(key, JSON.stringify(next))
        } catch {
          /* ignore quota / privacy mode */
        }
        return next
      })
    },
    [key],
  )
  return [value, set]
}

/** Format a shortcut like "Mod+Shift+D" for display on this platform: ["⌘","⇧","D"] / ["Ctrl","Shift","D"]. */
export function shortcutParts(shortcut: string): string[] {
  return shortcut.split('+').map((p) => {
    const k = p.trim()
    switch (k.toLowerCase()) {
      case 'mod':
        return IS_MAC ? '⌘' : 'Ctrl'
      case 'cmd':
      case 'meta':
        return '⌘'
      case 'ctrl':
        return IS_MAC ? '⌃' : 'Ctrl'
      case 'shift':
        return IS_MAC ? '⇧' : 'Shift'
      case 'alt':
      case 'option':
        return IS_MAC ? '⌥' : 'Alt'
      case 'enter':
        return '↵'
      case 'escape':
      case 'esc':
        return 'Esc'
      case 'backspace':
        return '⌫'
      case 'delete':
        return IS_MAC ? '⌦' : 'Del'
      case 'space':
        return '␣'
      case 'arrowup':
        return '↑'
      case 'arrowdown':
        return '↓'
      case 'arrowleft':
        return '←'
      case 'arrowright':
        return '→'
      case 'tab':
        return '⇥'
      default:
        return k.length === 1 ? k.toUpperCase() : k
    }
  })
}

/** Does a keyboard event match a shortcut string like "Mod+D", "Shift+H", "Delete", "?"? */
export function matchesShortcut(e: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.split('+').map((p) => p.trim().toLowerCase())
  const key = parts[parts.length - 1]!
  const needMod = parts.includes('mod')
  const needShift = parts.includes('shift')
  const needAlt = parts.includes('alt') || parts.includes('option')
  const needCtrl = parts.includes('ctrl')
  const mod = isModKey(e)
  if (needMod !== mod && !(needCtrl && e.ctrlKey)) return false
  if (needCtrl && !e.ctrlKey) return false
  if (needShift !== e.shiftKey && key.length === 1 && !/[?!@#$%^&*(){}<>~|:"+_]/.test(key)) return false
  if (needAlt !== e.altKey) return false
  const ek = e.key.toLowerCase()
  if (key === 'delete') return ek === 'delete' || ek === 'backspace'
  if (key === 'escape' || key === 'esc') return ek === 'escape'
  if (key === 'enter') return ek === 'enter'
  if (key === 'space') return ek === ' '
  if (key.length === 1 && e.code && /^Key[A-Z]$/.test(e.code) && !e.altKey) return e.code.slice(3).toLowerCase() === key
  if (key.length === 1 && e.code && /^Digit\d$/.test(e.code)) return e.code.slice(5) === key
  return ek === key
}

/** Deterministic pastel-ish color from a string (avatars for users without a color). */
export function colorFromString(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return `hsl(${h % 360} 70% 55%)`
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

/** Download a Blob as a file. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** Relative time ("3 min ago"). */
export function timeAgo(ts: number | string, now = Date.now()): string {
  const t = typeof ts === 'string' ? Date.parse(ts) : ts
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d} d ago`
  return new Date(t).toLocaleDateString()
}
