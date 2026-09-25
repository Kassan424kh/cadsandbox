// Numeric inputs for CAD: expressions ("=1200*2", "3' 6\""), arrow-key increments (Shift ×10,
// Alt ×0.1), drag-scrubbing on the prefix handle, and unit awareness (LengthField / AngleField).
import { forwardRef, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { METERS_PER_UNIT, formatLength, parseAngle, parseLength, type LengthUnit } from '@cadsandbox/shared'
import styles from './Controls.module.css'
import { useFieldLabelledBy } from './fieldLabel'
import { clamp, cx, mergeRefs, roundTo } from './utils'

export interface NumberFieldProps {
  /** null = mixed values (multi-selection) */
  value: number | null
  onChange(value: number): void
  /** Fired when a drag-scrub or keyboard step starts/ends (for undo grouping). */
  onScrubStart?(): void
  onScrubEnd?(): void
  min?: number
  max?: number
  /** Increment for arrow keys / scrub (Shift ×10, Alt ×0.1). */
  step?: number
  /** Decimals used for display + rounding. */
  precision?: number
  /** Suffix, e.g. "mm", "°", "%". */
  unit?: ReactNode
  /** Prefix (axis letter). Acts as the drag-scrub handle. */
  prefix?: ReactNode
  /** Axis coloring for the prefix */
  axis?: 'x' | 'y' | 'z'
  scrub?: boolean
  /** Value change per pixel when scrubbing (default: step / 2). */
  scrubScale?: number
  format?(value: number): string
  parse?(text: string): number | null
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  readOnly?: boolean
  invalid?: boolean
  placeholder?: string
  mixedLabel?: string
  className?: string
  style?: CSSProperties
  id?: string
  'aria-label'?: string
  /** Select all text on focus (default true) */
  selectOnFocus?: boolean
}

const defaultFormat = (precision: number) => (v: number) => {
  const s = roundTo(v, precision).toFixed(precision)
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s
}
/** Bare-number expressions: parseLength with 'm' as the unit gives a plain arithmetic evaluator. */
const defaultParse = (text: string) => parseLength(text, 'm')

export const NumberField = forwardRef<HTMLInputElement, NumberFieldProps>(function NumberField(
  {
    value,
    onChange,
    onScrubStart,
    onScrubEnd,
    min = -Infinity,
    max = Infinity,
    step = 1,
    precision = 2,
    unit,
    prefix,
    axis,
    scrub,
    scrubScale,
    format,
    parse,
    size = 'md',
    disabled,
    readOnly,
    invalid,
    placeholder,
    mixedLabel = 'Mixed',
    className,
    style,
    id,
    selectOnFocus = true,
    ...rest
  },
  ref,
) {
  const fmt = format ?? defaultFormat(precision)
  const prs = parse ?? defaultParse
  const labelledBy = useFieldLabelledBy(rest)
  const inputRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState<string>(value === null ? '' : fmt(value))
  const [focused, setFocused] = useState(false)
  const [bad, setBad] = useState(false)
  const [scrubbing, setScrubbing] = useState(false)

  // Sync display when the external value changes and we're not editing.
  useEffect(() => {
    if (!focused) {
      setText(value === null ? '' : fmt(value))
      setBad(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, focused, precision])

  const commit = (raw: string): boolean => {
    const trimmed = raw.trim()
    if (trimmed === '') {
      if (value !== null) setText(fmt(value))
      setBad(false)
      return true
    }
    const parsed = prs(trimmed)
    if (parsed === null || !Number.isFinite(parsed)) {
      setBad(true)
      return false
    }
    const next = clamp(roundTo(parsed, Math.max(precision, 6)), min, max)
    setBad(false)
    if (value === null || Math.abs(next - value) > 1e-12) onChange(next)
    setText(fmt(next))
    return true
  }

  const nudge = (dir: 1 | -1, e: { shiftKey: boolean; altKey: boolean }) => {
    const base = value ?? 0
    const s = step * (e.shiftKey ? 10 : e.altKey ? 0.1 : 1)
    const next = clamp(roundTo(base + dir * s, Math.max(precision, 6)), min, max)
    onChange(next)
    setText(fmt(next))
    setBad(false)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (commit(e.currentTarget.value)) e.currentTarget.select()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setText(value === null ? '' : fmt(value))
      setBad(false)
      e.currentTarget.blur()
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      if (readOnly || disabled) return
      onScrubStart?.()
      nudge(e.key === 'ArrowUp' ? 1 : -1, e)
      onScrubEnd?.()
    }
  }

  // ---- drag scrub on the prefix handle
  const scrubState = useRef<{ startX: number; startValue: number; moved: boolean } | null>(null)
  const canScrub = (scrub ?? prefix != null) && !disabled && !readOnly
  const onScrubDown = (e: PointerEvent<HTMLSpanElement>) => {
    if (!canScrub || e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    scrubState.current = { startX: e.clientX, startValue: value ?? 0, moved: false }
    setScrubbing(true)
    onScrubStart?.()
  }
  const onScrubMove = (e: PointerEvent<HTMLSpanElement>) => {
    const s = scrubState.current
    if (!s) return
    const dx = e.clientX - s.startX
    if (!s.moved && Math.abs(dx) < 2) return
    s.moved = true
    const scale = (scrubScale ?? step / 2) * (e.shiftKey ? 10 : e.altKey ? 0.1 : 1)
    const next = clamp(roundTo(s.startValue + dx * scale, Math.max(precision, 6)), min, max)
    onChange(next)
    setText(fmt(next))
  }
  const onScrubUp = (e: PointerEvent<HTMLSpanElement>) => {
    const s = scrubState.current
    if (!s) return
    scrubState.current = null
    setScrubbing(false)
    e.currentTarget.releasePointerCapture(e.pointerId)
    onScrubEnd?.()
    if (!s.moved) inputRef.current?.focus()
  }

  const mixed = value === null && !focused
  return (
    <span
      className={cx(
        styles.field,
        styles.numeric,
        size === 'sm' && styles.fieldSm,
        size === 'lg' && styles.fieldLg,
        (invalid || bad) && styles.fieldInvalid,
        disabled && styles.fieldDisabled,
        mixed && styles.fieldMixed,
        scrubbing && styles.scrubbing,
        className,
      )}
      style={style}
    >
      {prefix != null && (
        <span
          className={cx(styles.affix, canScrub && styles.scrub, axis === 'x' && styles.axisX, axis === 'y' && styles.axisY, axis === 'z' && styles.axisZ)}
          onPointerDown={onScrubDown}
          onPointerMove={onScrubMove}
          onPointerUp={onScrubUp}
          onPointerCancel={onScrubUp}
          aria-hidden
        >
          {prefix}
        </span>
      )}
      <input
        ref={mergeRefs(ref, inputRef)}
        id={id}
        className={styles.input}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        value={mixed ? '' : text}
        placeholder={mixed ? mixedLabel : placeholder}
        disabled={disabled}
        readOnly={readOnly}
        aria-invalid={invalid || bad || undefined}
        aria-labelledby={labelledBy}
        onChange={(e) => {
          setText(e.target.value)
          setBad(false)
        }}
        onFocus={(e) => {
          setFocused(true)
          if (selectOnFocus) requestAnimationFrame(() => e.target.select())
        }}
        onBlur={(e) => {
          setFocused(false)
          commit(e.target.value)
        }}
        onKeyDown={onKeyDown}
        {...rest}
      />
      {unit != null && <span className={styles.affix}>{unit}</span>}
    </span>
  )
})

// ------------------------------------------------------------------ LengthField (meters ⇄ doc units)
export interface LengthFieldProps extends Omit<NumberFieldProps, 'format' | 'parse' | 'unit' | 'step' | 'precision'> {
  /** Display unit (doc.meta.units.length). Value is always meters. */
  unit: LengthUnit
  /** Decimals in the display unit (doc.meta.units.precision). */
  precision?: number
  /** Increment in meters; default = one display unit (0.1 m for meters, 1" for feet). */
  step?: number
  showUnit?: boolean
}

export function defaultLengthStep(unit: LengthUnit): number {
  if (unit === 'm') return 0.1
  if (unit === 'ft') return METERS_PER_UNIT.in
  return METERS_PER_UNIT[unit]
}

export function defaultLengthPrecision(unit: LengthUnit): number {
  return unit === 'mm' ? 0 : unit === 'cm' ? 1 : unit === 'm' ? 3 : 2
}

export const LengthField = forwardRef<HTMLInputElement, LengthFieldProps>(function LengthField({ unit, precision, step, showUnit = true, ...rest }, ref) {
  const p = precision ?? defaultLengthPrecision(unit)
  return (
    <NumberField
      ref={ref}
      {...rest}
      step={step ?? defaultLengthStep(unit)}
      precision={Math.max(p + 3, 6)}
      format={(m) => formatLength(m, unit, p, false)}
      parse={(t) => parseLength(t, unit)}
      unit={showUnit && unit !== 'ft' ? unit : undefined}
    />
  )
})

// ------------------------------------------------------------------ AngleField (radians ⇄ degrees)
export interface AngleFieldProps extends Omit<NumberFieldProps, 'format' | 'parse' | 'unit' | 'step' | 'precision'> {
  precision?: number
  /** Increment in degrees (default 1) */
  stepDeg?: number
}

const RAD = Math.PI / 180

export const AngleField = forwardRef<HTMLInputElement, AngleFieldProps>(function AngleField({ precision = 1, stepDeg = 1, ...rest }, ref) {
  return (
    <NumberField
      ref={ref}
      {...rest}
      step={stepDeg * RAD}
      precision={8}
      format={(r) => defaultFormat(precision)(r / RAD)}
      parse={(t) => parseAngle(t)}
      unit="°"
    />
  )
})
