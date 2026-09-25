// troika-three-text configured for GDPR: only the bundled subset font (Inter, OFL) is ever loaded.
// troika falls back to a CDN-hosted unicode font resolver for glyphs missing from the font, so text
// is sanitized against the font's exact coverage before it reaches troika — no request can leave.
import * as THREE from 'three'
import { Text, configureTextBuilder, preloadFont } from 'troika-three-text'
import fontUrl from '../assets/cs-sans.ttf?url'

export const FONT_URL: string = fontUrl

/** Inclusive codepoint ranges present in assets/cs-sans.ttf (generated from its cmap). */
const COVERAGE: readonly number[] = [
  32, 126, 160, 172, 174, 328, 330, 383, 402, 402, 710, 711, 732, 732, 884, 886, 890, 895, 900, 906, 908, 908, 910, 929, 931, 983, 988, 989, 1008, 1014, 1017, 1018, 1020, 1119, 8192, 8203, 8208, 8231,
  8239, 8277, 8279, 8279, 8287, 8287, 8364, 8364, 8467, 8467, 8470, 8470, 8482, 8482, 8486, 8486, 8494, 8494, 8592, 8601, 8629, 8629, 8656, 8656, 8658, 8658, 8706, 8706, 8709, 8710, 8719, 8719, 8721,
  8722, 8730, 8730, 8734, 8734, 8747, 8747, 8758, 8758, 8776, 8776, 8800, 8800, 8804, 8805, 8853, 8856, 8963, 8963, 9312, 9320, 9632, 9634, 9642, 9642, 9650, 9651, 9654, 9655, 9658, 9661, 9664, 9665,
  9668, 9671, 9674, 9675, 9679, 9679, 9702, 9702, 9711, 9711, 9728, 9728, 9733, 9734, 9788, 9788, 9825, 9825, 9829, 9829, 10003, 10003, 10007, 10007, 11014, 11014,
]

/** Common CAD glyphs missing from the subset → visually equivalent covered characters. */
const SUBSTITUTES: Record<number, string> = {
  0x2300: 'Ø', // ⌀ diameter
  0x2205: 'Ø',
  0x2033: '"',
  0x2032: "'",
  0x2212: '-',
  0x2215: '/',
  0x2236: ':',
  0x00b2: '²',
  0x2044: '/',
}

export function isCovered(cp: number): boolean {
  // binary search over range pairs
  let lo = 0
  let hi = COVERAGE.length / 2 - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const a = COVERAGE[mid * 2]!
    const b = COVERAGE[mid * 2 + 1]!
    if (cp < a) hi = mid - 1
    else if (cp > b) lo = mid + 1
    else return true
  }
  return false
}

/** Replace glyphs the bundled font cannot render (keeps newlines/tabs). */
export function sanitizeText(s: string): string {
  let out = ''
  let changed = false
  for (const ch of s) {
    const cp = ch.codePointAt(0)!
    if (cp === 10 || cp === 9 || isCovered(cp)) {
      out += ch
      continue
    }
    changed = true
    const sub = SUBSTITUTES[cp]
    if (sub && [...sub].every((c) => isCovered(c.codePointAt(0)!))) out += sub
    else out += '□'
  }
  return changed ? out : s
}

let configured = false

/** Configure troika once: bundled font, same-origin (never reached) fallback path, NO worker —
 *  troika builds its worker from stringified functions (eval), which our strict production CSP
 *  (script-src without 'unsafe-eval') correctly blocks. Glyph SDFs are cached, so main-thread
 *  generation only costs on first use of a glyph. */
export function ensureTextConfigured(): void {
  if (configured) return
  configured = true
  configureTextBuilder({
    defaultFontURL: FONT_URL,
    // Only used if sanitizeText were bypassed; a same-origin path that cannot resolve to a CDN.
    unicodeFontsURL: new URL('cs-fonts-unavailable', typeof location !== 'undefined' ? location.href : 'http://localhost/').toString(),
    sdfGlyphSize: 64,
    textureWidth: 2048,
    useWorker: false,
  })
  try {
    preloadFont({ font: FONT_URL, characters: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,;:-+=/()° m²³' }, () => {})
  } catch {
    /* preloading is an optimization only */
  }
}

export interface TextOptions {
  text: string
  /** Cap height in meters */
  size: number
  color: THREE.Color
  align?: 'left' | 'center' | 'right'
  baseline?: 'top' | 'middle' | 'bottom'
  maxWidth?: number
  bold?: boolean
  outlineColor?: THREE.Color | null
  onSync?: () => void
}

/** Inter's cap height is ≈ 0.727 em. */
const CAP_HEIGHT_EM = 0.727

export function createText(opts: TextOptions): Text {
  ensureTextConfigured()
  const t = new Text()
  applyText(t, opts)
  t.userData.noPathTrace = true
  t.userData.isText = true
  return t
}

export function applyText(t: Text, opts: TextOptions): void {
  t.text = sanitizeText(opts.text)
  t.font = FONT_URL
  t.unicodeFontsURL = null
  t.fontSize = opts.size / CAP_HEIGHT_EM
  t.color = opts.color
  t.anchorX = opts.align ?? 'left'
  t.anchorY = opts.baseline === 'top' ? 'top-cap' : opts.baseline === 'bottom' ? 'bottom-baseline' : 'middle'
  t.textAlign = opts.align ?? 'left'
  t.maxWidth = opts.maxWidth ?? Infinity
  t.fontWeight = opts.bold ? 'bold' : 'normal'
  t.depthOffset = -2
  t.sdfGlyphSize = 64
  if (opts.outlineColor) {
    t.outlineWidth = '6%'
    t.outlineColor = opts.outlineColor
    t.outlineOpacity = 0.85
  } else t.outlineWidth = 0
  const mat = t.material as THREE.Material
  mat.toneMapped = false
  mat.side = THREE.DoubleSide
  t.sync(opts.onSync)
}
