// Slider, Switch, Checkbox (radix), with optional inline labels.
import { forwardRef, useId, type ReactNode } from 'react'
import { Check, Minus } from 'lucide-react'
import { Checkbox as RC, Slider as RSl, Switch as RSw } from 'radix-ui'
import styles from './Controls.module.css'
import { useFieldLabelledBy } from './fieldLabel'
import { NumberField } from './NumberField'
import { cx } from './utils'

// ------------------------------------------------------------------ Slider
export interface SliderProps {
  value: number
  onChange(value: number): void
  onCommit?(value: number): void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  /** Show an editable numeric field next to the slider. */
  withField?: boolean
  precision?: number
  unit?: ReactNode
  className?: string
  'aria-label'?: string
  id?: string
}

export const Slider = forwardRef<HTMLSpanElement, SliderProps>(function Slider(
  { value, onChange, onCommit, min = 0, max = 1, step = 0.01, disabled, withField, precision = 2, unit, className, id, ...rest },
  ref,
) {
  const slider = (
    <RSl.Root
      ref={ref}
      className={cx(styles.slider, !withField && className)}
      value={[value]}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onValueChange={(v) => onChange(v[0] ?? value)}
      onValueCommit={(v) => onCommit?.(v[0] ?? value)}
    >
      <RSl.Track className={styles.sliderTrack}>
        <RSl.Range className={styles.sliderRange} />
      </RSl.Track>
      <RSl.Thumb className={styles.sliderThumb} aria-label={rest['aria-label']} id={id} />
    </RSl.Root>
  )
  if (!withField) return slider
  return (
    <div className={cx(styles.sliderRow, className)}>
      {slider}
      <NumberField
        className={styles.sliderValue}
        size="sm"
        value={value}
        min={min}
        max={max}
        step={step}
        precision={precision}
        unit={unit}
        disabled={disabled}
        onChange={(v) => {
          onChange(v)
          onCommit?.(v)
        }}
        aria-label={rest['aria-label']}
      />
    </div>
  )
})

// ------------------------------------------------------------------ Switch
export interface SwitchProps {
  checked: boolean
  onChange(checked: boolean): void
  disabled?: boolean
  size?: 'sm' | 'md'
  label?: ReactNode
  /** Put the label left and the switch right, full width */
  between?: boolean
  className?: string
  id?: string
  'aria-label'?: string
}

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch({ checked, onChange, disabled, size = 'md', label, between, className, id, ...rest }, ref) {
  const auto = useId()
  const sid = id ?? auto
  const rowLabel = useFieldLabelledBy(rest)
  const sw = (
    <RSw.Root ref={ref} id={sid} className={cx(styles.switch, size === 'sm' && styles.switchSm, !label && className)} checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={rest['aria-label']} aria-labelledby={label ? undefined : rowLabel}>
      <RSw.Thumb className={styles.switchThumb} />
    </RSw.Root>
  )
  if (!label) return sw
  return (
    <label className={cx(styles.labelRow, between && styles.labelRowBetween, disabled && styles.labelRowDisabled, className)} htmlFor={sid}>
      {between ? (
        <>
          <span>{label}</span>
          {sw}
        </>
      ) : (
        <>
          {sw}
          <span>{label}</span>
        </>
      )}
    </label>
  )
})

// ------------------------------------------------------------------ Checkbox
export interface CheckboxProps {
  checked: boolean | 'indeterminate'
  onChange(checked: boolean): void
  disabled?: boolean
  label?: ReactNode
  className?: string
  id?: string
  'aria-label'?: string
}

export const Checkbox = forwardRef<HTMLButtonElement, CheckboxProps>(function Checkbox({ checked, onChange, disabled, label, className, id, ...rest }, ref) {
  const auto = useId()
  const cid = id ?? auto
  const box = (
    <RC.Root ref={ref} id={cid} className={cx(styles.checkbox, !label && className)} checked={checked} onCheckedChange={(v) => onChange(v === true)} disabled={disabled} aria-label={rest['aria-label']}>
      <RC.Indicator>{checked === 'indeterminate' ? <Minus /> : <Check />}</RC.Indicator>
    </RC.Root>
  )
  if (!label) return box
  return (
    <label className={cx(styles.labelRow, disabled && styles.labelRowDisabled, className)} htmlFor={cid}>
      {box}
      <span>{label}</span>
    </label>
  )
})
