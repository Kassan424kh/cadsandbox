import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import styles from './Toolbar.module.css'
import { Tooltip } from './Tooltip'
import { cx } from './utils'

// ------------------------------------------------------------------ ToolbarPill
export interface ToolbarPillProps extends HTMLAttributes<HTMLDivElement> {
  orientation?: 'horizontal' | 'vertical'
  size?: 'sm' | 'md'
  /** ARIA label for the toolbar group. */
  label?: string
}

export const ToolbarPill = forwardRef<HTMLDivElement, ToolbarPillProps>(function ToolbarPill({ orientation = 'horizontal', size = 'md', label, className, children, ...rest }, ref) {
  return (
    <div ref={ref} role="toolbar" aria-label={label} aria-orientation={orientation} className={cx(styles.pill, orientation === 'vertical' && styles.vertical, size === 'sm' && styles.pillSm, className)} {...rest}>
      {children}
    </div>
  )
})

export function ToolbarSeparator({ className }: { className?: string }) {
  return <div role="separator" className={cx(styles.separator, className)} />
}

// ------------------------------------------------------------------ ToolButton (icon over label)
export interface ToolButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: ReactNode
  label: string
  /** Show the label under the icon (default true). Icon-only buttons still get an aria-label. */
  showLabel?: boolean
  active?: boolean
  /** Accent (brand) highlight instead of inverse — used for "Render"/"Play" style actions. */
  accent?: boolean
  shortcut?: string
  /** Tooltip text; defaults to label (when label hidden) or none. */
  tooltip?: string | false
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right'
  /** Small chevron marking a button that opens a menu. */
  hasMenu?: boolean
  /** Small dot badge (e.g. options changed). */
  badge?: boolean
  compact?: boolean
}

export const ToolButton = forwardRef<HTMLButtonElement, ToolButtonProps>(function ToolButton(
  { icon, label, showLabel = true, active, accent, shortcut, tooltip, tooltipSide = 'bottom', hasMenu, badge, compact, className, type = 'button', ...rest },
  ref,
) {
  const tip = tooltip === false ? undefined : tooltip ?? (showLabel ? (shortcut ? label : undefined) : label)
  const btn = (
    <button
      ref={ref}
      type={type}
      aria-label={showLabel ? undefined : label}
      aria-pressed={active}
      aria-haspopup={hasMenu ? 'menu' : undefined}
      className={cx(styles.tool, active && (accent ? styles.toolAccent : styles.toolActive), compact && styles.toolCompact, !showLabel && styles.toolIconOnly, className)}
      {...rest}
    >
      {icon}
      {showLabel && <span className={styles.toolLabel}>{label}</span>}
      {hasMenu && <ChevronDown className={styles.toolChevron} aria-hidden />}
      {badge && <span className={styles.toolBadge} aria-hidden />}
    </button>
  )
  if (!tip && !shortcut) return btn
  return (
    <Tooltip content={tip ?? label} shortcut={shortcut} side={tooltipSide}>
      {btn}
    </Tooltip>
  )
})

// ------------------------------------------------------------------ RoundButton (Back, Snap, …)
export interface RoundButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  icon: ReactNode
  size?: 'sm' | 'md'
  active?: boolean
  shortcut?: string
  tooltip?: boolean
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right'
}

export const RoundButton = forwardRef<HTMLButtonElement, RoundButtonProps>(function RoundButton(
  { label, icon, size = 'md', active, shortcut, tooltip = true, tooltipSide = 'bottom', className, type = 'button', ...rest },
  ref,
) {
  const btn = (
    <button ref={ref} type={type} aria-label={label} aria-pressed={active} className={cx(styles.roundBtn, size === 'sm' && styles.roundBtnSm, active && styles.roundBtnActive, className)} {...rest}>
      {icon}
    </button>
  )
  if (!tooltip) return btn
  return (
    <Tooltip content={label} shortcut={shortcut} side={tooltipSide}>
      {btn}
    </Tooltip>
  )
})

// ------------------------------------------------------------------ Glass chip
export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode
  active?: boolean
  /** Render as a static span (no button semantics). */
  asLabel?: boolean
}

export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip({ icon, active, asLabel, className, children, type = 'button', ...rest }, ref) {
  if (asLabel) {
    return (
      <span className={cx(styles.chip, active && styles.chipActive, className)}>
        {icon}
        {children}
      </span>
    )
  }
  return (
    <button ref={ref} type={type} className={cx(styles.chip, active && styles.chipActive, className)} {...rest}>
      {icon}
      {children}
    </button>
  )
})
