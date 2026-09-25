// Swatches row + ColorPicker (HSV area, hue bar, hex input, quick swatches) in a popover.
import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type PointerEvent, type ReactNode } from 'react'
import { Ellipsis } from 'lucide-react'
import styles from './Color.module.css'
import { useFieldLabelledBy } from './fieldLabel'
import { Input } from './Input'
import { Popover, PopoverContent, PopoverTrigger } from './Popover'
import { Tooltip } from './Tooltip'
import { clamp, cx } from './utils'

// ------------------------------------------------------------------ color math
export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  let h = m[1]!
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return [h, max === 0 ? 0 : d / max, max]
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let rgb: [number, number, number]
  if (h < 60) rgb = [c, x, 0]
  else if (h < 120) rgb = [x, c, 0]
  else if (h < 180) rgb = [0, c, x]
  else if (h < 240) rgb = [0, x, c]
  else if (h < 300) rgb = [x, 0, c]
  else rgb = [c, 0, x]
  return [(rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255]
}

export function normalizeHex(input: string): string | null {
  const rgb = hexToRgb(input)
  return rgb ? rgbToHex(...rgb) : null
}

/** Readable text color (black/white) on a background. */
export function contrastText(hex: string): '#000000' | '#ffffff' {
  const rgb = hexToRgb(hex)
  if (!rgb) return '#ffffff'
  const l = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255
  return l > 0.6 ? '#000000' : '#ffffff'
}

// ------------------------------------------------------------------ Swatches
export interface SwatchesProps {
  colors: readonly string[]
  /** Selected color (case-insensitive hex). null = none selected */
  value: string | null
  onChange(color: string): void
  size?: 'sm' | 'md' | 'lg'
  shape?: 'round' | 'square'
  /** Show a "no color" swatch that emits `null`. */
  allowNone?: boolean
  onNone?(): void
  /** Extra trailing control (e.g. the "…" more button). */
  trailing?: ReactNode
  className?: string
  labels?: Record<string, string>
  noneLabel?: string
  /** Read-only: swatches show the value but cannot be picked. */
  disabled?: boolean
}

export function Swatches({ colors, value, onChange, size = 'md', shape = 'round', allowNone, onNone, trailing, className, labels, noneLabel = 'No color', disabled }: SwatchesProps) {
  const v = value?.toLowerCase() ?? null
  return (
    <div className={cx(styles.swatches, className)} role="radiogroup" aria-disabled={disabled || undefined} style={disabled ? { opacity: 0.55 } : undefined}>
      {allowNone && (
        <Tooltip content={noneLabel}>
          <button type="button" role="radio" aria-checked={v === null} aria-label={noneLabel} disabled={disabled} className={cx(styles.swatch, styles.swatchNone, size === 'sm' && styles.swatchSm, size === 'lg' && styles.swatchLg, shape === 'square' && styles.swatchSquare, v === null && styles.swatchSelected)} onClick={() => onNone?.()} />
        </Tooltip>
      )}
      {colors.map((c) => {
        const selected = v === c.toLowerCase()
        const label = labels?.[c] ?? c
        return (
          <Tooltip key={c} content={label}>
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={label}
              disabled={disabled}
              className={cx(styles.swatch, size === 'sm' && styles.swatchSm, size === 'lg' && styles.swatchLg, shape === 'square' && styles.swatchSquare, selected && styles.swatchSelected)}
              style={{ ['--swatch' as string]: c }}
              onClick={() => onChange(c)}
            />
          </Tooltip>
        )
      })}
      {trailing}
    </div>
  )
}

/** Forwards ref + props so it can be a Radix `asChild` trigger (PopoverTrigger needs the ref to
 *  anchor its content and passes aria-expanded/aria-controls/data-state). */
export const SwatchesMoreButton = forwardRef<HTMLButtonElement, { label?: string } & ButtonHTMLAttributes<HTMLButtonElement>>(function SwatchesMoreButton(
  { label = 'More colors', className, ...rest },
  ref,
) {
  return (
    <Tooltip content={label}>
      <button ref={ref} type="button" aria-label={label} className={cx(styles.more, className)} {...rest}>
        <Ellipsis />
      </button>
    </Tooltip>
  )
})

// ------------------------------------------------------------------ ColorPicker (inline)
export interface ColorPickerProps {
  value: string
  onChange(hex: string): void
  swatches?: readonly string[]
  className?: string
  hexLabel?: string
}

export function ColorPicker({ value, onChange, swatches, className, hexLabel = 'Hex color' }: ColorPickerProps) {
  const rgb = hexToRgb(value) ?? [124, 92, 255]
  const [hsv, setHsv] = useState<[number, number, number]>(() => rgbToHsv(...rgb))
  const [hex, setHex] = useState(value)
  const lastEmitted = useRef(value.toLowerCase())

  // External changes → sync (keep hue when saturation is 0 to avoid jumping).
  useEffect(() => {
    if (value.toLowerCase() === lastEmitted.current) return
    const c = hexToRgb(value)
    if (!c) return
    const n = rgbToHsv(...c)
    setHsv((prev) => [n[1] === 0 || n[2] === 0 ? prev[0] : n[0], n[1], n[2]])
    setHex(value)
    lastEmitted.current = value.toLowerCase()
  }, [value])

  const emit = (h: number, s: number, v: number) => {
    setHsv([h, s, v])
    const out = rgbToHex(...hsvToRgb(h, s, v))
    setHex(out)
    lastEmitted.current = out
    onChange(out)
  }

  const areaRef = useRef<HTMLDivElement>(null)
  const hueRef = useRef<HTMLDivElement>(null)
  const dragArea = (e: PointerEvent<HTMLDivElement>) => {
    const r = areaRef.current!.getBoundingClientRect()
    const s = clamp((e.clientX - r.left) / r.width, 0, 1)
    const v = 1 - clamp((e.clientY - r.top) / r.height, 0, 1)
    emit(hsv[0], s, v)
  }
  const dragHue = (e: PointerEvent<HTMLDivElement>) => {
    const r = hueRef.current!.getBoundingClientRect()
    const h = clamp((e.clientX - r.left) / r.width, 0, 0.9999) * 360
    emit(h, hsv[1], hsv[2])
  }
  const drag = (handler: (e: PointerEvent<HTMLDivElement>) => void) => ({
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      handler(e)
    },
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) handler(e)
    },
    onPointerUp: (e: PointerEvent<HTMLDivElement>) => e.currentTarget.releasePointerCapture(e.pointerId),
  })

  const current = rgbToHex(...hsvToRgb(...hsv))
  return (
    <div className={cx(styles.picker, className)}>
      <div ref={areaRef} className={styles.area} style={{ ['--h' as string]: hsv[0] }} {...drag(dragArea)} role="slider" aria-label="Saturation and brightness" aria-valuenow={Math.round(hsv[2] * 100)}>
        <div className={styles.areaThumb} style={{ left: `${hsv[1] * 100}%`, top: `${(1 - hsv[2]) * 100}%`, background: current }} />
      </div>
      <div ref={hueRef} className={styles.hue} {...drag(dragHue)} role="slider" aria-label="Hue" aria-valuenow={Math.round(hsv[0])} aria-valuemin={0} aria-valuemax={360}>
        <div className={styles.hueThumb} style={{ left: `${(hsv[0] / 360) * 100}%`, background: `hsl(${hsv[0]} 100% 50%)` }} />
      </div>
      <div className={styles.pickerRow}>
        <span className={styles.preview} style={{ ['--swatch' as string]: current }} />
        <Input
          size="sm"
          value={hex}
          aria-label={hexLabel}
          spellCheck={false}
          onChange={(e) => {
            setHex(e.target.value)
            const n = normalizeHex(e.target.value)
            if (n) {
              const c = hexToRgb(n)!
              const nh = rgbToHsv(...c)
              setHsv((prev) => [nh[1] === 0 ? prev[0] : nh[0], nh[1], nh[2]])
              lastEmitted.current = n
              onChange(n)
            }
          }}
          onBlur={() => setHex(current)}
          style={{ fontFamily: 'var(--cs-font-mono)' }}
        />
      </div>
      {swatches && swatches.length > 0 && (
        <div className={styles.pickerSwatches} role="radiogroup">
          {swatches.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={current.toLowerCase() === c.toLowerCase()}
              aria-label={c}
              className={cx(styles.swatch, current.toLowerCase() === c.toLowerCase() && styles.swatchSelected)}
              style={{ ['--swatch' as string]: c }}
              onClick={() => {
                const rgbc = hexToRgb(c)!
                const n = rgbToHsv(...rgbc)
                emit(n[0], n[1], n[2])
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ ColorField (trigger + popover)
export interface ColorFieldProps {
  /** null = no color / mixed */
  value: string | null
  onChange(hex: string | null): void
  swatches?: readonly string[]
  size?: 'sm' | 'md'
  mixed?: boolean
  allowClear?: boolean
  className?: string
  'aria-label'?: string
  mixedLabel?: string
  noneLabel?: string
  clearLabel?: string
  /** Read-only: shows the color, the picker does not open. */
  disabled?: boolean
}

export function ColorField({ value, onChange, swatches, size = 'md', mixed, allowClear, className, mixedLabel = 'Mixed', noneLabel = 'None', clearLabel = 'Clear', disabled, ...rest }: ColorFieldProps) {
  const [open, setOpen] = useState(false)
  const labelledBy = useFieldLabelledBy(rest)
  return (
    <Popover open={open && !disabled} onOpenChange={(o) => setOpen(o && !disabled)}>
      <PopoverTrigger asChild>
        <button type="button" disabled={disabled} className={cx(styles.trigger, size === 'sm' && styles.triggerSm, className)} style={disabled ? { opacity: 0.55, cursor: 'default' } : undefined} aria-label={rest['aria-label']} aria-labelledby={labelledBy}>
          <span className={cx(styles.triggerSwatch, !value && styles.swatchNone)} style={value ? { ['--swatch' as string]: value } : undefined} />
          <span className={cx(styles.triggerText, (mixed || !value) && styles.triggerMixed)}>{mixed ? mixedLabel : value ? value.toUpperCase() : noneLabel}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start">
        <ColorPicker value={value ?? '#7c5cff'} onChange={onChange} swatches={swatches} />
        {allowClear && value && (
          <button type="button" style={{ marginTop: 10, fontSize: 'var(--cs-text-xs)', color: 'var(--cs-text-2)' }} onClick={() => onChange(null)}>
            {clearLabel}
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}
