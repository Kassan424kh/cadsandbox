import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'
import styles from './Controls.module.css'
import { FieldLabelContext, useFieldLabelledBy } from './fieldLabel'
import { cx } from './utils'

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'> {
  size?: 'sm' | 'md' | 'lg'
  prefix?: ReactNode
  suffix?: ReactNode
  invalid?: boolean
  ghost?: boolean
  /** Class for the outer shell */
  wrapperClassName?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ size = 'md', prefix, suffix, invalid, ghost, className, wrapperClassName, disabled, ...rest }, ref) {
  const labelledBy = useFieldLabelledBy(rest)
  return (
    <span className={cx(styles.field, size === 'sm' && styles.fieldSm, size === 'lg' && styles.fieldLg, invalid && styles.fieldInvalid, ghost && styles.fieldGhost, disabled && styles.fieldDisabled, wrapperClassName)}>
      {prefix != null && <span className={styles.affix}>{prefix}</span>}
      <input ref={ref} className={cx(styles.input, className)} disabled={disabled} aria-invalid={invalid || undefined} aria-labelledby={labelledBy} {...rest} />
      {suffix != null && <span className={styles.affix}>{suffix}</span>}
    </span>
  )
})

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ className, invalid, ...rest }, ref) {
  const labelledBy = useFieldLabelledBy(rest)
  return <textarea ref={ref} className={cx(styles.textarea, className)} aria-invalid={invalid || undefined} aria-labelledby={labelledBy} {...rest} />
})

/** Inspector-style row: label on the left, control on the right. */
export interface FieldRowProps {
  label: ReactNode
  children: ReactNode
  hint?: ReactNode
  error?: ReactNode
  /** Stack label above the control */
  stack?: boolean
  className?: string
  /** id of the control to associate the label with */
  htmlFor?: string
}

export function FieldRow({ label, children, hint, error, stack, className, htmlFor }: FieldRowProps) {
  // The label names the row's controls via aria-labelledby (fieldLabel.ts); `for` only when the caller
  // passes the control id (an auto id here would point at nothing).
  const labelId = useId()
  return (
    <div className={cx(styles.row, stack && styles.rowStack, className)}>
      <label id={labelId} className={styles.rowLabel} htmlFor={htmlFor} title={typeof label === 'string' ? label : undefined}>
        {label}
      </label>
      <div className={styles.rowControl}>
        <FieldLabelContext.Provider value={labelId}>{children}</FieldLabelContext.Provider>
      </div>
      {hint && <div className={styles.hint} style={{ gridColumn: '1 / -1' }}>{hint}</div>}
      {error && (
        <div className={styles.error} style={{ gridColumn: '1 / -1' }} role="alert">
          {error}
        </div>
      )}
    </div>
  )
}
