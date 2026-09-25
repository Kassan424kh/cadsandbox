import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react'
import { Tabs as RT, ToggleGroup } from 'radix-ui'
import styles from './Tabs.module.css'
import { Tooltip } from './Tooltip'
import { cx } from './utils'

// ------------------------------------------------------------------ Tabs (underline)
export const Tabs = RT.Root

export const TabsList = forwardRef<ElementRef<typeof RT.List>, ComponentPropsWithoutRef<typeof RT.List>>(function TabsList({ className, ...rest }, ref) {
  return <RT.List ref={ref} className={cx(styles.tabsList, className)} {...rest} />
})

export const TabsTrigger = forwardRef<ElementRef<typeof RT.Trigger>, ComponentPropsWithoutRef<typeof RT.Trigger> & { icon?: ReactNode }>(function TabsTrigger({ className, icon, children, ...rest }, ref) {
  return (
    <RT.Trigger ref={ref} className={cx(styles.tabsTrigger, className)} {...rest}>
      {icon}
      {children}
    </RT.Trigger>
  )
})

export const TabsContent = forwardRef<ElementRef<typeof RT.Content>, ComponentPropsWithoutRef<typeof RT.Content>>(function TabsContent({ className, ...rest }, ref) {
  return <RT.Content ref={ref} className={cx(styles.tabsContent, className)} {...rest} />
})

// ------------------------------------------------------------------ SegmentedControl (single choice)
export interface SegmentOption<V extends string = string> {
  value: V
  label: string
  icon?: ReactNode
  /** Icon-only (label becomes tooltip + aria-label) */
  iconOnly?: boolean
  disabled?: boolean
}

export interface SegmentedControlProps<V extends string = string> {
  value: V
  onChange(value: V): void
  options: readonly SegmentOption<V>[]
  size?: 'sm' | 'md'
  /** Stretch to container width */
  full?: boolean
  className?: string
  'aria-label'?: string
  disabled?: boolean
}

export function SegmentedControl<V extends string = string>({ value, onChange, options, size = 'md', full, className, disabled, ...rest }: SegmentedControlProps<V>) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(v) => {
        if (v) onChange(v as V)
      }}
      disabled={disabled}
      aria-label={rest['aria-label']}
      className={cx(styles.segmented, size === 'sm' && styles.segmentedSm, full && styles.segmentedFull, className)}
    >
      {options.map((o) => {
        const item = (
          <ToggleGroup.Item key={o.value} value={o.value} disabled={o.disabled} aria-label={o.iconOnly ? o.label : undefined} className={cx(styles.segment, o.iconOnly && styles.segmentIconOnly)}>
            {o.icon}
            {!o.iconOnly && o.label}
          </ToggleGroup.Item>
        )
        return o.iconOnly ? (
          <Tooltip key={o.value} content={o.label}>
            {item}
          </Tooltip>
        ) : (
          item
        )
      })}
    </ToggleGroup.Root>
  )
}
