// Small presentational primitives: Kbd, Badge, Card, EmptyState, Skeleton, Progress, PageHeader.
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'
import styles from './Misc.module.css'
import { cx, shortcutParts } from './utils'

// ------------------------------------------------------------------ Kbd
export interface KbdProps {
  /** "Mod+K", "Shift+H", "Delete" — rendered platform-aware. */
  shortcut: string
  className?: string
  /** For use on inverse (dark tooltip) backgrounds. */
  inverse?: boolean
}

export function Kbd({ shortcut, className, inverse }: KbdProps) {
  const parts = shortcutParts(shortcut)
  return (
    <span className={cx(styles.kbd, inverse && styles.kbdInverse, className)} aria-label={shortcut}>
      {parts.map((p, i) => (
        <kbd key={i} className={styles.key}>
          {p}
        </kbd>
      ))}
    </span>
  )
}

// ------------------------------------------------------------------ Badge
export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'outline'
export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
  dot?: boolean
  icon?: ReactNode
}

const TONE: Record<BadgeTone, string | undefined> = {
  neutral: undefined,
  accent: styles.badgeAccent,
  success: styles.badgeSuccess,
  warning: styles.badgeWarning,
  danger: styles.badgeDanger,
  info: styles.badgeInfo,
  outline: styles.badgeOutline,
}

export function Badge({ tone = 'neutral', dot, icon, className, children, ...rest }: BadgeProps) {
  return (
    <span className={cx(styles.badge, TONE[tone], className)} {...rest}>
      {dot && <span className={styles.badgeDot} />}
      {icon}
      {children}
    </span>
  )
}

// ------------------------------------------------------------------ Card
export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padded?: boolean
  interactive?: boolean
  glass?: boolean
}

export function Card({ padded = true, interactive, glass, className, ...rest }: CardProps) {
  return <div className={cx(styles.card, padded && styles.cardPadded, interactive && styles.cardInteractive, glass && styles.cardGlass, className)} {...rest} />
}

// ------------------------------------------------------------------ EmptyState
export interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  actions?: ReactNode
  compact?: boolean
  className?: string
}

export function EmptyState({ icon, title, description, actions, compact, className }: EmptyStateProps) {
  return (
    <div className={cx(styles.empty, compact && styles.emptyCompact, className)} role="status">
      {icon && <div className={styles.emptyIcon}>{icon}</div>}
      <div className={styles.emptyTitle}>{title}</div>
      {description && <div className={styles.emptyDesc}>{description}</div>}
      {actions && <div className={styles.emptyActions}>{actions}</div>}
    </div>
  )
}

// ------------------------------------------------------------------ Skeleton
export interface SkeletonProps {
  width?: number | string
  height?: number | string
  radius?: number | string
  className?: string
  style?: CSSProperties
}

export function Skeleton({ width = '100%', height = 14, radius, className, style }: SkeletonProps) {
  return <span aria-hidden className={cx(styles.skeleton, className)} style={{ width, height, borderRadius: radius, ...style }} />
}

// ------------------------------------------------------------------ Progress
export interface ProgressProps {
  /** 0..1; undefined = indeterminate */
  value?: number
  className?: string
  label?: string
}

export function Progress({ value, className, label }: ProgressProps) {
  const pct = value === undefined ? undefined : Math.round(Math.min(1, Math.max(0, value)) * 100)
  return (
    <div className={cx(styles.progress, className)} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      {pct === undefined ? <div className={styles.progressIndeterminate} /> : <div className={styles.progressBar} style={{ width: `${pct}%` }} />}
    </div>
  )
}

// ------------------------------------------------------------------ PageHeader
export interface PageHeaderProps {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  breadcrumbs?: ReactNode
  className?: string
}

export function PageHeader({ title, description, actions, breadcrumbs, className }: PageHeaderProps) {
  return (
    <header className={cx(styles.pageHeader, className)}>
      <div>
        {breadcrumbs && <nav className={styles.pageCrumbs}>{breadcrumbs}</nav>}
        <h1 className={styles.pageTitle}>{title}</h1>
        {description && <p className={styles.pageDesc}>{description}</p>}
      </div>
      {actions && <div className={styles.pageActions}>{actions}</div>}
    </header>
  )
}

/** Uppercase small section label used in panels and forms. */
export function SectionLabel({ children, className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx(styles.sectionLabel, className)} {...rest}>
      {children}
    </div>
  )
}
