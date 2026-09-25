import { useEffect, useState, type ReactNode } from 'react'
import { Tooltip as RT } from 'radix-ui'
import styles from './Overlay.module.css'
import { Kbd } from './Primitives'

/** Mount once near the app root. */
export function TooltipProvider({ children, delayDuration = 500 }: { children: ReactNode; delayDuration?: number }) {
  return (
    <RT.Provider delayDuration={delayDuration} skipDelayDuration={300}>
      {children}
    </RT.Provider>
  )
}

export interface TooltipProps {
  content: ReactNode
  shortcut?: string
  side?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'start' | 'center' | 'end'
  sideOffset?: number
  /** Disable without unmounting children */
  disabled?: boolean
  children: ReactNode
  open?: boolean
}

// Safety net: any click, wheel, key or window blur closes every tooltip — a missed pointerleave (DOM
// swapped under the cursor, pointer capture, focus moves) must never leave a tooltip stuck on screen.
const closers = new Set<() => void>()
let globalCloseInstalled = false
function installGlobalClose(): void {
  if (globalCloseInstalled || typeof window === 'undefined') return
  globalCloseInstalled = true
  const closeAll = () => closers.forEach((close) => close())
  window.addEventListener('pointerdown', closeAll, true)
  window.addEventListener('wheel', closeAll, { capture: true, passive: true })
  window.addEventListener('keydown', closeAll, true)
  window.addEventListener('blur', closeAll)
}

export function Tooltip({ content, shortcut, side = 'top', align = 'center', sideOffset = 8, disabled, children, open }: TooltipProps) {
  const [hoverOpen, setHoverOpen] = useState(false)
  useEffect(() => {
    installGlobalClose()
    const close = () => setHoverOpen(false)
    closers.add(close)
    return () => {
      closers.delete(close)
    }
  }, [])
  if (disabled || content == null || content === '') return <>{children}</>
  return (
    <RT.Root open={open ?? hoverOpen} onOpenChange={setHoverOpen} disableHoverableContent>
      <RT.Trigger asChild>{children}</RT.Trigger>
      <RT.Portal>
        <RT.Content side={side} align={align} sideOffset={sideOffset} collisionPadding={8} className={styles.tooltip}>
          <span>{content}</span>
          {shortcut && <Kbd shortcut={shortcut} inverse className={styles.tooltipKbd} />}
        </RT.Content>
      </RT.Portal>
    </RT.Root>
  )
}
