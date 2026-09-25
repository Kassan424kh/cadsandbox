import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react'
import { ScrollArea as RS } from 'radix-ui'
import styles from './Layout.module.css'
import { cx } from './utils'

export interface ScrollAreaProps extends ComponentPropsWithoutRef<typeof RS.Root> {
  orientation?: 'vertical' | 'horizontal' | 'both'
  viewportClassName?: string
  viewportRef?: React.Ref<HTMLDivElement>
}

/** Overlay scrollbars (thin, auto-hiding). Fills its parent; give the parent a size. */
export const ScrollArea = forwardRef<ElementRef<typeof RS.Root>, ScrollAreaProps>(function ScrollArea(
  { orientation = 'vertical', className, viewportClassName, viewportRef, children, type = 'hover', ...rest },
  ref,
) {
  return (
    <RS.Root ref={ref} type={type} scrollHideDelay={600} className={cx(styles.scrollRoot, className)} {...rest}>
      <RS.Viewport ref={viewportRef} className={cx(styles.scrollViewport, viewportClassName)}>
        {children}
      </RS.Viewport>
      {(orientation === 'vertical' || orientation === 'both') && (
        <RS.Scrollbar orientation="vertical" className={styles.scrollbar}>
          <RS.Thumb className={styles.scrollThumb} />
        </RS.Scrollbar>
      )}
      {(orientation === 'horizontal' || orientation === 'both') && (
        <RS.Scrollbar orientation="horizontal" className={styles.scrollbar}>
          <RS.Thumb className={styles.scrollThumb} />
        </RS.Scrollbar>
      )}
      {orientation === 'both' && <RS.Corner />}
    </RS.Root>
  )
})
