import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react'
import { Popover as RP } from 'radix-ui'
import styles from './Overlay.module.css'
import { cx } from './utils'

export const Popover = RP.Root
export const PopoverTrigger = RP.Trigger
export const PopoverAnchor = RP.Anchor
export const PopoverClose = RP.Close

export interface PopoverContentProps extends ComponentPropsWithoutRef<typeof RP.Content> {
  /** Reduced padding (menus / grids). */
  tight?: boolean
  /** Render an arrow. */
  arrow?: boolean
  /** Extra class for the surface. */
  className?: string
}

export const PopoverContent = forwardRef<ElementRef<typeof RP.Content>, PopoverContentProps>(function PopoverContent(
  { tight, arrow, className, sideOffset = 10, collisionPadding = 12, children, ...rest },
  ref,
) {
  return (
    <RP.Portal>
      <RP.Content ref={ref} sideOffset={sideOffset} collisionPadding={collisionPadding} className={cx(styles.surface, styles.popover, tight && styles.popoverTight, className)} {...rest}>
        {children}
        {arrow && <RP.Arrow className={styles.popoverArrow} width={14} height={7} />}
      </RP.Content>
    </RP.Portal>
  )
})
