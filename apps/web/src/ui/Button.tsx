import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Slot } from 'radix-ui'
import styles from './Button.module.css'
import { Spinner } from './Spinner'
import { Tooltip } from './Tooltip'
import { cx } from './utils'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-solid' | 'glass' | 'inverse'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Leading icon (lucide element). */
  icon?: ReactNode
  iconRight?: ReactNode
  loading?: boolean
  /** Pressed/selected look (inverse). */
  active?: boolean
  /** Render the child element instead of a <button> (radix Slot). */
  asChild?: boolean
  /** Circle button (icon only). */
  round?: boolean
}

const VARIANT: Record<ButtonVariant, string> = {
  primary: styles.primary,
  secondary: styles.secondary,
  ghost: styles.ghost,
  danger: styles.danger,
  'danger-solid': styles.dangerSolid,
  glass: styles.glass,
  inverse: styles.inverse,
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, iconRight, loading, active, asChild, round, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  const classes = cx(
    styles.button,
    VARIANT[variant],
    size === 'sm' && styles.sm,
    size === 'lg' && styles.lg,
    round && styles.round,
    active && styles.active,
    loading && styles.loading,
    className,
  )
  if (asChild) {
    // Slot needs exactly one element: the child (e.g. a router Link) becomes the button and the
    // icons are placed inside it via Slottable.
    return (
      <Slot.Root ref={ref} className={classes} aria-busy={loading || undefined} aria-pressed={active} {...rest}>
        {icon}
        <Slot.Slottable>{children}</Slot.Slottable>
        {iconRight}
      </Slot.Root>
    )
  }
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        styles.button,
        VARIANT[variant],
        size === 'sm' && styles.sm,
        size === 'lg' && styles.lg,
        round && styles.round,
        active && styles.active,
        loading && styles.loading,
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-pressed={active}
      {...rest}
    >
      {icon}
      {children != null && <span className={styles.label}>{children}</span>}
      {iconRight}
      {loading && (
        <span className={styles.spinner}>
          <Spinner size={size === 'sm' ? 12 : 14} />
        </span>
      )}
    </button>
  )
})

export interface IconButtonProps extends Omit<ButtonProps, 'icon' | 'children' | 'round'> {
  /** Accessible name; also used as tooltip. */
  label: string
  icon: ReactNode
  /** Shortcut shown in the tooltip, e.g. "Mod+Z". */
  shortcut?: string
  /** Disable the tooltip (label still applied as aria-label). */
  tooltip?: boolean
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right'
  shape?: 'round' | 'square'
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, shortcut, tooltip = true, tooltipSide, shape = 'round', variant = 'ghost', className, ...rest },
  ref,
) {
  const btn = (
    <Button ref={ref} variant={variant} aria-label={label} className={cx(shape === 'round' ? styles.round : styles.square, className)} {...rest}>
      {icon}
    </Button>
  )
  if (!tooltip) return btn
  return (
    <Tooltip content={label} shortcut={shortcut} side={tooltipSide}>
      {btn}
    </Tooltip>
  )
})
