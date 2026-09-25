// A dropdown menu opened at arbitrary screen coordinates (right-click menus for canvas & trees).
import type { ReactNode } from 'react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '../../ui'

export interface PointMenuProps {
  anchor: { x: number; y: number } | null
  onClose(): void
  children: ReactNode
  minWidth?: number
}

export function PointMenu({ anchor, onClose, children, minWidth = 220 }: PointMenuProps) {
  return (
    <DropdownMenu open={!!anchor} onOpenChange={(o) => !o && onClose()} modal={false}>
      <DropdownMenuTrigger asChild>
        <span aria-hidden style={{ position: 'fixed', left: anchor?.x ?? 0, top: anchor?.y ?? 0, width: 1, height: 1, pointerEvents: 'none' }} />
      </DropdownMenuTrigger>
      {anchor && (
        <DropdownMenuContent align="start" side="bottom" sideOffset={2} style={{ minWidth }} onCloseAutoFocus={(e) => e.preventDefault()}>
          {children}
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  )
}
