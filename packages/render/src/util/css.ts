// Theme-aware color access. Overlays and shaders read the UI kit's CSS variables (--cs-*) with
// fallbacks so the editor renders correctly even without the app's stylesheet.
import * as THREE from 'three'

export interface RGBA {
  color: THREE.Color
  alpha: number
}

const cache = new Map<string, string>()

/** Read a CSS custom property from the element (computed), falling back when unset. */
export function cssVar(el: Element | null, name: string, fallback: string): string {
  if (!el || typeof getComputedStyle !== 'function') return fallback
  const v = getComputedStyle(el).getPropertyValue(name).trim()
  return v || fallback
}

/** Parse a CSS color (#rgb, #rrggbb, #rrggbbaa, rgb[a](), hsl[a]()) into a linear three Color + alpha. */
export function parseCssColor(input: string, fallback = '#ffffff'): RGBA {
  const s = (input || fallback).trim()
  const color = new THREE.Color()
  let alpha = 1
  const m = /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+%?))?\s*\)$/i.exec(s)
  if (m) {
    color.setRGB(+m[1]! / 255, +m[2]! / 255, +m[3]! / 255, THREE.SRGBColorSpace)
    if (m[4]) alpha = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])
    return { color, alpha }
  }
  const hex8 = /^#([0-9a-f]{8})$/i.exec(s)
  if (hex8) {
    const v = parseInt(hex8[1]!, 16)
    color.setHex(v >>> 8, THREE.SRGBColorSpace)
    alpha = (v & 0xff) / 255
    return { color, alpha }
  }
  const hex4 = /^#([0-9a-f]{4})$/i.exec(s)
  if (hex4) {
    const h = hex4[1]!
    color.setStyle(`#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`, THREE.SRGBColorSpace)
    alpha = parseInt(h[3]! + h[3]!, 16) / 255
    return { color, alpha }
  }
  const hsla = /^hsla?\(\s*([\d.]+)(?:deg)?\s*[, ]\s*([\d.]+)%\s*[, ]\s*([\d.]+)%\s*(?:[,/]\s*([\d.]+%?))?\s*\)$/i.exec(s)
  if (hsla) {
    color.setHSL(+hsla[1]! / 360, +hsla[2]! / 100, +hsla[3]! / 100, THREE.SRGBColorSpace)
    if (hsla[4]) alpha = hsla[4].endsWith('%') ? parseFloat(hsla[4]) / 100 : parseFloat(hsla[4])
    return { color, alpha }
  }
  if (/^#[0-9a-f]{3}$|^#[0-9a-f]{6}$/i.test(s)) {
    color.setStyle(s, THREE.SRGBColorSpace)
    return { color, alpha }
  }
  // Named colors or anything else: let a canvas normalize it when available.
  const norm = normalizeViaCanvas(s)
  if (norm) return parseCssColor(norm, fallback)
  color.setStyle(fallback, THREE.SRGBColorSpace)
  return { color, alpha }
}

function normalizeViaCanvas(s: string): string | null {
  const hit = cache.get(s)
  if (hit) return hit
  if (typeof document === 'undefined') return null
  try {
    const ctx = document.createElement('canvas').getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#000'
    ctx.fillStyle = s
    const out = String(ctx.fillStyle)
    if (out === '#000000' && s !== 'black' && s !== '#000') return null
    cache.set(s, out)
    return out
  } catch {
    return null
  }
}

/** Convenience: CSS variable → color + alpha. */
export function cssColor(el: Element | null, name: string, fallback: string): RGBA {
  return parseCssColor(cssVar(el, name, fallback), fallback)
}

/** #rrggbb string for a three color (sRGB). */
export function toHex(c: THREE.Color): string {
  return `#${c.getHexString(THREE.SRGBColorSpace)}`
}

/** Fallback palette matching apps/web/src/styles/tokens.css, keyed by theme. */
export const TOKEN_FALLBACKS: Record<'dark' | 'light', Record<string, string>> = {
  dark: {
    '--cs-bg': '#0b0b0d',
    '--cs-surface': '#19191d',
    '--cs-glass': 'rgba(28, 28, 33, 0.72)',
    '--cs-border': 'rgba(255, 255, 255, 0.08)',
    '--cs-border-strong': 'rgba(255, 255, 255, 0.16)',
    '--cs-text': '#f4f4f6',
    '--cs-text-2': '#b3b3bb',
    '--cs-text-3': '#7c7c86',
    '--cs-accent': '#7c5cff',
    '--cs-accent-2': '#a18bff',
    '--cs-danger': '#ff4d5e',
    '--cs-warning': '#ffb020',
    '--cs-success': '#2fd67b',
    '--cs-info': '#3fb6ff',
    '--cs-selection': '#7c5cff',
    '--cs-viewport-bg': '#0e0e11',
    '--cs-grid-minor': 'rgba(255, 255, 255, 0.045)',
    '--cs-grid-major': 'rgba(255, 255, 255, 0.09)',
  },
  light: {
    '--cs-bg': '#f3f3f5',
    '--cs-surface': '#ffffff',
    '--cs-glass': 'rgba(255, 255, 255, 0.74)',
    '--cs-border': 'rgba(10, 10, 20, 0.08)',
    '--cs-border-strong': 'rgba(10, 10, 20, 0.16)',
    '--cs-text': '#111116',
    '--cs-text-2': '#4b4b55',
    '--cs-text-3': '#8a8a94',
    '--cs-accent': '#6a47ff',
    '--cs-accent-2': '#8a70ff',
    '--cs-danger': '#e5364a',
    '--cs-warning': '#d98a00',
    '--cs-success': '#16a35a',
    '--cs-info': '#0a8fd6',
    '--cs-selection': '#6a47ff',
    '--cs-viewport-bg': '#e9e9ee',
    '--cs-grid-minor': 'rgba(0, 0, 0, 0.05)',
    '--cs-grid-major': 'rgba(0, 0, 0, 0.1)',
  },
}

/** Resolved theme palette used by shaders and canvas overlays (re-read on setTheme). */
export class ThemeColors {
  theme: 'dark' | 'light' = 'dark'
  private el: Element | null = null

  constructor(el: Element | null, theme: 'dark' | 'light') {
    this.el = el
    this.theme = theme
  }

  setTheme(theme: 'dark' | 'light'): void {
    this.theme = theme
  }

  /** Raw CSS string for a token (for HTML overlays use `var(--cs-x, fallback)` instead). */
  raw(name: string): string {
    const fb = TOKEN_FALLBACKS[this.theme][name] ?? '#ff00ff'
    return cssVar(this.el, name, fb)
  }

  get(name: string): RGBA {
    return parseCssColor(this.raw(name), TOKEN_FALLBACKS[this.theme][name] ?? '#ffffff')
  }

  /** CSS expression usable in inline styles with the right fallback. */
  css(name: string): string {
    return `var(${name}, ${TOKEN_FALLBACKS[this.theme][name] ?? '#ffffff'})`
  }

  get isDark(): boolean {
    return this.theme === 'dark'
  }
}
