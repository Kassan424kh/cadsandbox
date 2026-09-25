// Units. The document stores every length in METERS (float64), Z-up, right-handed.
// Display units are a per-document preference; convert only at the UI boundary.

export type LengthUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft'
export type AngleUnit = 'deg' | 'rad'
export type AreaUnit = 'm2' | 'ft2'

export const LENGTH_UNITS: readonly LengthUnit[] = ['mm', 'cm', 'm', 'in', 'ft']

export const METERS_PER_UNIT: Record<LengthUnit, number> = {
  mm: 0.001,
  cm: 0.01,
  m: 1,
  in: 0.0254,
  ft: 0.3048,
}

export const UNIT_LABEL: Record<LengthUnit, string> = { mm: 'mm', cm: 'cm', m: 'm', in: 'in', ft: 'ft' }

export const toMeters = (value: number, unit: LengthUnit): number => value * METERS_PER_UNIT[unit]
export const fromMeters = (meters: number, unit: LengthUnit): number => meters / METERS_PER_UNIT[unit]

export const DEG2RAD = Math.PI / 180
export const RAD2DEG = 180 / Math.PI

function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s
}

/** Format a length given in meters, e.g. formatLength(0.12, 'mm') → "120 mm". */
export function formatLength(
  meters: number,
  unit: LengthUnit,
  precision = unit === 'mm' ? 0 : unit === 'cm' ? 1 : 3,
  withUnit = true,
): string {
  if (!Number.isFinite(meters)) return '—'
  if (unit === 'ft') {
    // Architectural feet-inches: 3' 6 1/2"
    const totalIn = meters / METERS_PER_UNIT.in
    const sign = totalIn < 0 ? '-' : ''
    const abs = Math.abs(totalIn)
    let ft = Math.floor(abs / 12)
    let inch = abs - ft * 12
    const sixteenths = Math.round(inch * 16)
    inch = sixteenths / 16
    if (inch >= 12) {
      ft += 1
      inch -= 12
    }
    const whole = Math.floor(inch)
    const frac = Math.round((inch - whole) * 16)
    const fracStr = frac ? ` ${reduceFraction(frac, 16)}` : ''
    return `${sign}${ft}' ${whole}${fracStr}"`
  }
  const v = fromMeters(meters, unit)
  const s = trimZeros(v.toFixed(precision))
  return withUnit ? `${s} ${UNIT_LABEL[unit]}` : s
}

function reduceFraction(n: number, d: number): string {
  const g = (a: number, b: number): number => (b ? g(b, a % b) : a)
  const k = g(n, d)
  return `${n / k}/${d / k}`
}

export function formatArea(m2: number, unit: AreaUnit = 'm2', precision = 2): string {
  if (unit === 'ft2') return `${trimZeros((m2 / 0.09290304).toFixed(precision))} ft²`
  return `${trimZeros(m2.toFixed(precision))} m²`
}

export function formatVolume(m3: number, precision = 2): string {
  return `${trimZeros(m3.toFixed(precision))} m³`
}

export function formatAngle(rad: number, unit: AngleUnit = 'deg', precision = 1): string {
  return unit === 'deg' ? `${trimZeros((rad * RAD2DEG).toFixed(precision))}°` : `${trimZeros(rad.toFixed(4))} rad`
}

// ---------------------------------------------------------------------------
// Input parsing — users type "120", "1.2m", "3' 6\"", "2400/2", "=120*3 + 5cm".
// Safe recursive-descent evaluator (no eval). Bare numbers use `defaultUnit`.
// Returns meters, or null if the input is not a valid expression.
// ---------------------------------------------------------------------------

const UNIT_ALIASES: Record<string, LengthUnit> = {
  mm: 'mm',
  millimeter: 'mm',
  millimeters: 'mm',
  cm: 'cm',
  centimeter: 'cm',
  centimeters: 'cm',
  m: 'm',
  meter: 'm',
  meters: 'm',
  metre: 'm',
  metres: 'm',
  in: 'in',
  inch: 'in',
  inches: 'in',
  '"': 'in',
  ft: 'ft',
  foot: 'ft',
  feet: 'ft',
  "'": 'ft',
}

export function parseLength(input: string, defaultUnit: LengthUnit): number | null {
  const src = input.trim().replace(/^=/, '').replace(/,/g, '.')
  if (!src) return null
  let i = 0
  const peek = () => src[i]
  const skip = () => {
    while (i < src.length && /\s/.test(src[i]!)) i++
  }

  // Each value carries whether it had an explicit unit so "2*3m" behaves sensibly.
  type Val = { v: number; unit: boolean }

  const number = (): Val | null => {
    skip()
    const m = /^(\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i.exec(src.slice(i))
    if (!m) return null
    i += m[0].length
    let v = parseFloat(m[0])
    skip()
    // Fractions like 1/2" are handled by the division operator; units bind tightly.
    const um = /^(millimeters?|centimeters?|meters?|metres?|inches|inch|feet|foot|mm|cm|in|ft|m|"|')/i.exec(src.slice(i))
    if (um) {
      const unit = UNIT_ALIASES[um[0].toLowerCase()]!
      i += um[0].length
      return { v: v * METERS_PER_UNIT[unit], unit: true }
    }
    return { v, unit: false }
  }

  const primary = (): Val | null => {
    skip()
    if (peek() === '(') {
      i++
      const e = expr()
      skip()
      if (peek() !== ')') return null
      i++
      return e
    }
    if (peek() === '-') {
      i++
      const p = primary()
      return p ? { v: -p.v, unit: p.unit } : null
    }
    return number()
  }

  const term = (): Val | null => {
    let left = primary()
    if (!left) return null
    for (;;) {
      skip()
      const op = peek()
      if (op !== '*' && op !== '/' && op !== 'x' && op !== '×') break
      i++
      const right = primary()
      if (!right) return null
      if (op === '/') {
        if (right.v === 0) return null
        left = { v: left.v / right.v, unit: left.unit && !right.unit ? true : left.unit && right.unit ? false : left.unit }
      } else {
        left = { v: left.v * right.v, unit: left.unit || right.unit }
      }
    }
    return left
  }

  // Adjacent terms without operator are summed: 3' 6" → 3ft + 6in.
  const expr = (): Val | null => {
    const toM = (x: Val) => (x.unit ? x.v : x.v * METERS_PER_UNIT[defaultUnit])
    let left = term()
    if (!left) return null
    let total = toM(left)
    for (;;) {
      skip()
      const op = peek()
      if (op === '+' || op === '-') {
        i++
        const right = term()
        if (!right) return null
        total += op === '+' ? toM(right) : -toM(right)
      } else if (op !== undefined && op !== ')' && /[\d.(]/.test(op)) {
        const right = term()
        if (!right) return null
        total += toM(right)
      } else break
    }
    return { v: total, unit: true }
  }

  const result = expr()
  skip()
  if (!result || i < src.length || !Number.isFinite(result.v)) return null
  return result.v
}

/** Parse an angle in degrees (accepts "45", "45°", "0.5rad", "90/2"). Returns radians. */
export function parseAngle(input: string): number | null {
  const s = input.trim().replace(/°/g, '').replace(/,/g, '.')
  const rad = /rad$/i.test(s)
  const v = parseLength(s.replace(/rad$/i, ''), 'm')
  if (v === null) return null
  return rad ? v : v * DEG2RAD
}
