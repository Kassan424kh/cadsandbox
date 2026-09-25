import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Dialog as RD } from 'radix-ui'
import { IconButton } from './Button'
import styles from './Overlay.module.css'
import { cx } from './utils'

export const Dialog = RD.Root
export const DialogTrigger = RD.Trigger
export const DialogClose = RD.Close

export type DialogSize = 'sm' | 'md' | 'lg' | 'xl' | 'full'

const SIZE: Record<DialogSize, string> = {
  sm: styles.dialogSm,
  md: styles.dialogMd,
  lg: styles.dialogLg,
  xl: styles.dialogXl,
  full: styles.dialogFull,
}

export interface DialogContentProps extends Omit<ComponentPropsWithoutRef<typeof RD.Content>, 'title'> {
  title: ReactNode
  description?: ReactNode
  size?: DialogSize
  footer?: ReactNode
  /** Extra header controls (left of the close button). */
  headerActions?: ReactNode
  /** Remove body padding (tables, canvases). */
  flush?: boolean
  hideClose?: boolean
  /** Visually hide the title (still announced). */
  hideTitle?: boolean
  bodyClassName?: string
  closeLabel?: string
}

export const DialogContent = forwardRef<ElementRef<typeof RD.Content>, DialogContentProps>(function DialogContent(
  { title, description, size = 'md', footer, headerActions, flush, hideClose, hideTitle, className, bodyClassName, closeLabel = 'Close', children, ...rest },
  ref,
) {
  return (
    <RD.Portal>
      <RD.Overlay className={styles.dialogOverlay} />
      <RD.Content ref={ref} className={cx(styles.dialog, SIZE[size], className)} {...rest}>
        <div className={styles.dialogHeader} style={hideTitle ? { padding: 0, height: 0 } : undefined}>
          <div className={cx(styles.dialogHeading, hideTitle && 'cs-sr-only')}>
            <RD.Title className={styles.dialogTitle}>{title}</RD.Title>
            {description ? <RD.Description className={styles.dialogDesc}>{description}</RD.Description> : <RD.Description className="cs-sr-only">{typeof title === 'string' ? title : 'Dialog'}</RD.Description>}
          </div>
          {!hideTitle && headerActions}
          {!hideClose && !hideTitle && (
            <RD.Close asChild>
              <IconButton label={closeLabel} icon={<X />} className={styles.dialogClose} tooltip={false} />
            </RD.Close>
          )}
        </div>
        <div className={cx(styles.dialogBody, flush && styles.dialogBodyFlush, bodyClassName)}>{children}</div>
        {footer && <div className={styles.dialogFooter}>{footer}</div>}
      </RD.Content>
    </RD.Portal>
  )
})

// ------------------------------------------------------------------ Sheet (drawer)
export const Sheet = RD.Root
export const SheetTrigger = RD.Trigger
export const SheetClose = RD.Close

export interface SheetContentProps extends Omit<ComponentPropsWithoutRef<typeof RD.Content>, 'title'> {
  title: ReactNode
  description?: ReactNode
  side?: 'left' | 'right' | 'bottom'
  width?: number
  footer?: ReactNode
  headerActions?: ReactNode
  flush?: boolean
  bodyClassName?: string
  closeLabel?: string
}

export const SheetContent = forwardRef<ElementRef<typeof RD.Content>, SheetContentProps>(function SheetContent(
  { title, description, side = 'right', width, footer, headerActions, flush, className, bodyClassName, closeLabel = 'Close', children, style, ...rest },
  ref,
) {
  const sideClass = side === 'right' ? styles.sheetRight : side === 'left' ? styles.sheetLeft : styles.sheetBottom
  return (
    <RD.Portal>
      <RD.Overlay className={styles.dialogOverlay} />
      <RD.Content ref={ref} className={cx(styles.sheet, sideClass, className)} style={{ ...(width ? ({ '--sheet-w': `${width}px` } as Record<string, string>) : {}), ...style }} {...rest}>
        <div className={styles.dialogHeader}>
          <div className={styles.dialogHeading}>
            <RD.Title className={styles.dialogTitle}>{title}</RD.Title>
            {description ? <RD.Description className={styles.dialogDesc}>{description}</RD.Description> : <RD.Description className="cs-sr-only">{typeof title === 'string' ? title : 'Panel'}</RD.Description>}
          </div>
          {headerActions}
          <RD.Close asChild>
            <IconButton label={closeLabel} icon={<X />} className={styles.dialogClose} tooltip={false} />
          </RD.Close>
        </div>
        <div className={cx(styles.dialogBody, flush && styles.dialogBodyFlush, bodyClassName)}>{children}</div>
        {footer && <div className={styles.dialogFooter}>{footer}</div>}
      </RD.Content>
    </RD.Portal>
  )
})
