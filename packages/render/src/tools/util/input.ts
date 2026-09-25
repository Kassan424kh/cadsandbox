// VCB (numeric input box) parsing shared by all tools.
//   "2400"        → length (doc units)         "2.4m" / "8' 6\"" → length with unit
//   "2400<45" or "2.4m,45°" or "2400, 45" → length + angle (polar from the last point)
//   "1200;800"    → dx;dy (relative offsets)   "1;2;0.5" → dx;dy;dz
// A bare comma between plain digits is a decimal separator ("2,5" = 2.5), so polar input needs
// '<', a degree sign, a unit or a space after the comma.
import type { ToolContext } from '../types'

export type VcbValue =
  | { kind: 'length'; value: number }
  | { kind: 'polar'; length: number; angle: number }
  | { kind: 'delta'; dx: number; dy: number; dz: number }

export function parseVcb(text: string, ctx: Pick<ToolContext, 'parseLength' | 'parseAngle'>): VcbValue | null {
  const s = text.trim()
  if (!s) return null
  if (s.includes(';')) {
    const parts = s.split(';').map((p) => p.trim())
    if (parts.length < 2 || parts.length > 3) return null
    const vals = parts.map((p) => (p === '' ? 0 : ctx.parseLength(p)))
    if (vals.some((v) => v === null)) return null
    return { kind: 'delta', dx: vals[0]!, dy: vals[1]!, dz: vals[2] ?? 0 }
  }
  if (s.includes('<')) {
    const [l, a] = s.split('<')
    const length = ctx.parseLength(l ?? '')
    const angle = ctx.parseAngle(a ?? '')
    if (length === null || angle === null) return null
    return { kind: 'polar', length, angle }
  }
  const commaIdx = s.indexOf(',')
  if (commaIdx > 0 && s.indexOf(',', commaIdx + 1) < 0) {
    const l = s.slice(0, commaIdx).trim()
    const a = s.slice(commaIdx + 1)
    const separator = /^\s/.test(a) || /°|deg|rad/i.test(a) || /[a-z"'.]/i.test(l)
    if (separator) {
      const length = ctx.parseLength(l)
      const angle = ctx.parseAngle(a.trim())
      if (length !== null && angle !== null) return { kind: 'polar', length, angle }
    }
  }
  const value = ctx.parseLength(s)
  if (value === null) return null
  return { kind: 'length', value }
}

/** Parse a plain integer (array counts, sides…). */
export function parseCount(text: string): number | null {
  const m = /^\s*(\d+)\s*$/.exec(text)
  if (!m) return null
  const n = parseInt(m[1]!, 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Human readable "ΔX 1.20 m" style suffix used by measure/dimension labels. */
export function formatDelta(ctx: Pick<ToolContext, 'formatLength'>, dx: number, dy: number, dz: number): string {
  const parts = [`ΔX ${ctx.formatLength(dx)}`, `ΔY ${ctx.formatLength(dy)}`]
  if (Math.abs(dz) > 1e-9) parts.push(`ΔZ ${ctx.formatLength(dz)}`)
  return parts.join('  ')
}

export function formatAngleDeg(rad: number, precision = 1): string {
  const deg = (rad * 180) / Math.PI
  const s = deg.toFixed(precision)
  return `${s.includes('.') ? s.replace(/\.?0+$/, '') : s}°`
}

export function formatArea(m2: number): string {
  const s = m2.toFixed(2)
  return `${s.replace(/\.?0+$/, '')} m²`
}
