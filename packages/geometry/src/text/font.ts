// Bundled typeface fonts (Droid, Apache-2.0 — see fonts/LICENSE.txt): glyph outlines → polygons.
// Fonts are loaded lazily (dynamic import → separate chunk) on first use.
import type { TextFont, Vec2 } from '@cadsandbox/doc'
import { flattenCubic, flattenQuadratic } from '../core/math2d'
import { nestRings, type PolyWithHoles } from '../core/polygon'

export interface FontData {
  family: string
  /** units per em */
  res: number
  asc: number
  desc: number
  /** cap height in font units */
  cap: number
  xh: number
  /** char → [advance, outline commands] */
  glyphs: Record<string, [number, string]>
}

const cache = new Map<TextFont, Promise<FontData>>()

const loaders: Record<TextFont, () => Promise<{ default: unknown }>> = {
  sans: () => import('./fonts/sans.json'),
  serif: () => import('./fonts/serif.json'),
  mono: () => import('./fonts/mono.json'),
  display: () => import('./fonts/display.json'),
}

export function loadFont(kind: TextFont): Promise<FontData> {
  const k: TextFont = loaders[kind] ? kind : 'sans'
  let p = cache.get(k)
  if (!p) {
    p = loaders[k]().then((m) => m.default as FontData)
    cache.set(k, p)
  }
  return p
}

/** Parse one glyph outline into rings (font units, y up). */
export function glyphRings(outline: string, out: Vec2[][], scale: number, ox: number, oy: number, tol: number): void {
  if (!outline) return
  const t = outline.split(' ')
  let ring: Vec2[] | null = null
  let cur: Vec2 = [0, 0]
  const P = (i: number): Vec2 => [parseFloat(t[i]!) * scale + ox, parseFloat(t[i + 1]!) * scale + oy]
  for (let i = 0; i < t.length; ) {
    const cmd = t[i++]
    switch (cmd) {
      case 'm': {
        if (ring && ring.length >= 3) out.push(ring)
        cur = P(i)
        ring = [cur]
        i += 2
        break
      }
      case 'l': {
        cur = P(i)
        ring?.push(cur)
        i += 2
        break
      }
      case 'q': {
        const end = P(i)
        const c = P(i + 2)
        if (ring) flattenQuadratic(cur, c, end, ring, tol)
        cur = end
        i += 4
        break
      }
      case 'b': {
        const end = P(i)
        const c1 = P(i + 2)
        const c2 = P(i + 4)
        if (ring) flattenCubic(cur, c1, c2, end, ring, tol)
        cur = end
        i += 6
        break
      }
      case 'z':
        break
      default:
        // unknown token: skip
        break
    }
  }
  if (ring && ring.length >= 3) out.push(ring)
}

export interface TextLayout {
  polys: PolyWithHoles[]
  /** advance width of the widest line */
  width: number
  /** number of lines */
  lines: number
  /** total height from the last baseline's descender to the first line's cap height */
  height: number
  /** per-line [x offset, baseline y] */
  lineOrigins: Vec2[]
}

/** Lay out (multi-line) text with the given cap height; baseline of the first line at y = 0. */
export function layoutText(font: FontData, text: string, capHeight: number, align: 'left' | 'center' | 'right', lineHeight = 1.4): TextLayout {
  const scale = capHeight / (font.cap || font.res * 0.7)
  const lines = text.replace(/\r/g, '').split('\n')
  const lineStep = ((font.asc - font.desc) / font.res) * (font.res * scale) * (lineHeight / 1.4) * 1.0
  const advances = lines.map((line) => {
    let w = 0
    for (const ch of line) {
      const g = font.glyphs[ch] ?? font.glyphs[ch.normalize('NFD')[0] ?? ''] ?? font.glyphs['?']
      w += (g ? g[0] : font.res * 0.5) * scale
    }
    return w
  })
  const width = Math.max(0, ...advances)
  const polys: PolyWithHoles[] = []
  const lineOrigins: Vec2[] = []
  const tol = Math.max(capHeight * 0.004, 0.0002)
  for (let li = 0; li < lines.length; li++) {
    const baseline = -li * lineStep
    const x0 = align === 'left' ? 0 : align === 'center' ? -advances[li]! / 2 : -advances[li]!
    lineOrigins.push([x0, baseline])
    let x = x0
    const rings: Vec2[][] = []
    for (const ch of lines[li]!) {
      const g = font.glyphs[ch] ?? font.glyphs[ch.normalize('NFD')[0] ?? ''] ?? font.glyphs['?']
      if (!g) {
        x += font.res * 0.5 * scale
        continue
      }
      const before = rings.length
      glyphRings(g[1], rings, scale, x, baseline, tol)
      // nest per glyph so counters (holes) attach to the right glyph
      if (rings.length > before) {
        polys.push(...nestRings(rings.splice(before)))
      }
      x += g[0] * scale
    }
  }
  const height = capHeight + (lines.length - 1) * lineStep + (-font.desc / font.res) * font.res * scale
  return { polys, width, lines: lines.length, height, lineOrigins }
}
