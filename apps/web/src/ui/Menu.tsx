// DropdownMenu + ContextMenu, styled identically. Both expose the same sub-component set so a menu
// body (items/groups/separators) can be reused between the two.
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react'
import { Check, ChevronRight, Circle } from 'lucide-react'
import { ContextMenu as RC, DropdownMenu as RD } from 'radix-ui'
import styles from './Overlay.module.css'
import { Kbd } from './Primitives'
import { cx } from './utils'

interface ItemExtras {
  icon?: ReactNode
  shortcut?: string
  /** Secondary text at the right */
  hint?: ReactNode
  danger?: boolean
  /** Indent items without an icon to align with icon items */
  inset?: boolean
}

function ItemBody({ icon, shortcut, hint, children }: ItemExtras & { children?: ReactNode }) {
  return (
    <>
      {icon}
      <span className={styles.menuItemLabel}>{children}</span>
      {hint != null && <span className={styles.menuItemHint}>{hint}</span>}
      {shortcut && <Kbd shortcut={shortcut} className={styles.menuShortcut} />}
    </>
  )
}

// ------------------------------------------------------------------ Dropdown
/** Non-modal by default: menus live in floating toolbars that stay clickable, and a modal layer stops
 *  older layers from seeing outside clicks — opening menu B would leave menu A open. Non-modal menus
 *  close on any outside pointerdown (incl. another menu's trigger or the canvas). */
export function DropdownMenu(props: ComponentPropsWithoutRef<typeof RD.Root>) {
  return <RD.Root modal={false} {...props} />
}
export const DropdownMenuTrigger = RD.Trigger
export const DropdownMenuGroup = RD.Group
export const DropdownMenuRadioGroup = RD.RadioGroup
export const DropdownMenuSub = RD.Sub

export const DropdownMenuContent = forwardRef<ElementRef<typeof RD.Content>, ComponentPropsWithoutRef<typeof RD.Content>>(function DropdownMenuContent(
  { className, sideOffset = 8, collisionPadding = 12, ...rest },
  ref,
) {
  return (
    <RD.Portal>
      <RD.Content ref={ref} sideOffset={sideOffset} collisionPadding={collisionPadding} className={cx(styles.surface, styles.menu, className)} {...rest} />
    </RD.Portal>
  )
})

export const DropdownMenuSubContent = forwardRef<ElementRef<typeof RD.SubContent>, ComponentPropsWithoutRef<typeof RD.SubContent>>(function DropdownMenuSubContent(
  { className, sideOffset = 6, ...rest },
  ref,
) {
  return (
    <RD.Portal>
      <RD.SubContent ref={ref} sideOffset={sideOffset} collisionPadding={12} className={cx(styles.surface, styles.menu, className)} {...rest} />
    </RD.Portal>
  )
})

export const DropdownMenuItem = forwardRef<ElementRef<typeof RD.Item>, ComponentPropsWithoutRef<typeof RD.Item> & ItemExtras>(function DropdownMenuItem(
  { className, icon, shortcut, hint, danger, inset, children, ...rest },
  ref,
) {
  return (
    <RD.Item ref={ref} className={cx(styles.menuItem, danger && styles.menuItemDanger, inset && styles.menuInset, className)} {...rest}>
      <ItemBody icon={icon} shortcut={shortcut} hint={hint}>
        {children}
      </ItemBody>
    </RD.Item>
  )
})

export const DropdownMenuCheckboxItem = forwardRef<ElementRef<typeof RD.CheckboxItem>, ComponentPropsWithoutRef<typeof RD.CheckboxItem> & ItemExtras>(
  function DropdownMenuCheckboxItem({ className, icon, shortcut, hint, children, ...rest }, ref) {
    return (
      <RD.CheckboxItem ref={ref} className={cx(styles.menuItem, className)} {...rest}>
        <span className={styles.menuIndicator}>
          <RD.ItemIndicator>
            <Check />
          </RD.ItemIndicator>
        </span>
        <ItemBody icon={icon} shortcut={shortcut} hint={hint}>
          {children}
        </ItemBody>
      </RD.CheckboxItem>
    )
  },
)

export const DropdownMenuRadioItem = forwardRef<ElementRef<typeof RD.RadioItem>, ComponentPropsWithoutRef<typeof RD.RadioItem> & ItemExtras>(function DropdownMenuRadioItem(
  { className, icon, shortcut, hint, children, ...rest },
  ref,
) {
  return (
    <RD.RadioItem ref={ref} className={cx(styles.menuItem, className)} {...rest}>
      <span className={styles.menuIndicator}>
        <RD.ItemIndicator>
          <Circle fill="currentColor" style={{ width: 7, height: 7 }} />
        </RD.ItemIndicator>
      </span>
      <ItemBody icon={icon} shortcut={shortcut} hint={hint}>
        {children}
      </ItemBody>
    </RD.RadioItem>
  )
})

export const DropdownMenuSubTrigger = forwardRef<ElementRef<typeof RD.SubTrigger>, ComponentPropsWithoutRef<typeof RD.SubTrigger> & ItemExtras>(function DropdownMenuSubTrigger(
  { className, icon, inset, children, ...rest },
  ref,
) {
  return (
    <RD.SubTrigger ref={ref} className={cx(styles.menuItem, styles.menuSubTrigger, inset && styles.menuInset, className)} {...rest}>
      {icon}
      <span className={styles.menuItemLabel}>{children}</span>
      <ChevronRight className={styles.menuChevron} />
    </RD.SubTrigger>
  )
})

export const DropdownMenuSeparator = forwardRef<ElementRef<typeof RD.Separator>, ComponentPropsWithoutRef<typeof RD.Separator>>(function DropdownMenuSeparator({ className, ...rest }, ref) {
  return <RD.Separator ref={ref} className={cx(styles.menuSeparator, className)} {...rest} />
})

export const DropdownMenuLabel = forwardRef<ElementRef<typeof RD.Label>, ComponentPropsWithoutRef<typeof RD.Label>>(function DropdownMenuLabel({ className, ...rest }, ref) {
  return <RD.Label ref={ref} className={cx(styles.menuLabel, className)} {...rest} />
})

// ------------------------------------------------------------------ Context menu
export function ContextMenu(props: ComponentPropsWithoutRef<typeof RC.Root>) {
  return <RC.Root modal={false} {...props} />
}
export const ContextMenuTrigger = RC.Trigger
export const ContextMenuGroup = RC.Group
export const ContextMenuRadioGroup = RC.RadioGroup
export const ContextMenuSub = RC.Sub

export const ContextMenuContent = forwardRef<ElementRef<typeof RC.Content>, ComponentPropsWithoutRef<typeof RC.Content>>(function ContextMenuContent({ className, ...rest }, ref) {
  return (
    <RC.Portal>
      <RC.Content ref={ref} collisionPadding={12} className={cx(styles.surface, styles.menu, className)} {...rest} />
    </RC.Portal>
  )
})

export const ContextMenuSubContent = forwardRef<ElementRef<typeof RC.SubContent>, ComponentPropsWithoutRef<typeof RC.SubContent>>(function ContextMenuSubContent(
  { className, sideOffset = 6, ...rest },
  ref,
) {
  return (
    <RC.Portal>
      <RC.SubContent ref={ref} sideOffset={sideOffset} collisionPadding={12} className={cx(styles.surface, styles.menu, className)} {...rest} />
    </RC.Portal>
  )
})

export const ContextMenuItem = forwardRef<ElementRef<typeof RC.Item>, ComponentPropsWithoutRef<typeof RC.Item> & ItemExtras>(function ContextMenuItem(
  { className, icon, shortcut, hint, danger, inset, children, ...rest },
  ref,
) {
  return (
    <RC.Item ref={ref} className={cx(styles.menuItem, danger && styles.menuItemDanger, inset && styles.menuInset, className)} {...rest}>
      <ItemBody icon={icon} shortcut={shortcut} hint={hint}>
        {children}
      </ItemBody>
    </RC.Item>
  )
})

export const ContextMenuCheckboxItem = forwardRef<ElementRef<typeof RC.CheckboxItem>, ComponentPropsWithoutRef<typeof RC.CheckboxItem> & ItemExtras>(function ContextMenuCheckboxItem(
  { className, icon, shortcut, hint, children, ...rest },
  ref,
) {
  return (
    <RC.CheckboxItem ref={ref} className={cx(styles.menuItem, className)} {...rest}>
      <span className={styles.menuIndicator}>
        <RC.ItemIndicator>
          <Check />
        </RC.ItemIndicator>
      </span>
      <ItemBody icon={icon} shortcut={shortcut} hint={hint}>
        {children}
      </ItemBody>
    </RC.CheckboxItem>
  )
})

export const ContextMenuRadioItem = forwardRef<ElementRef<typeof RC.RadioItem>, ComponentPropsWithoutRef<typeof RC.RadioItem> & ItemExtras>(function ContextMenuRadioItem(
  { className, icon, shortcut, hint, children, ...rest },
  ref,
) {
  return (
    <RC.RadioItem ref={ref} className={cx(styles.menuItem, className)} {...rest}>
      <span className={styles.menuIndicator}>
        <RC.ItemIndicator>
          <Circle fill="currentColor" style={{ width: 7, height: 7 }} />
        </RC.ItemIndicator>
      </span>
      <ItemBody icon={icon} shortcut={shortcut} hint={hint}>
        {children}
      </ItemBody>
    </RC.RadioItem>
  )
})

export const ContextMenuSubTrigger = forwardRef<ElementRef<typeof RC.SubTrigger>, ComponentPropsWithoutRef<typeof RC.SubTrigger> & ItemExtras>(function ContextMenuSubTrigger(
  { className, icon, inset, children, ...rest },
  ref,
) {
  return (
    <RC.SubTrigger ref={ref} className={cx(styles.menuItem, styles.menuSubTrigger, inset && styles.menuInset, className)} {...rest}>
      {icon}
      <span className={styles.menuItemLabel}>{children}</span>
      <ChevronRight className={styles.menuChevron} />
    </RC.SubTrigger>
  )
})

export const ContextMenuSeparator = forwardRef<ElementRef<typeof RC.Separator>, ComponentPropsWithoutRef<typeof RC.Separator>>(function ContextMenuSeparator({ className, ...rest }, ref) {
  return <RC.Separator ref={ref} className={cx(styles.menuSeparator, className)} {...rest} />
})

export const ContextMenuLabel = forwardRef<ElementRef<typeof RC.Label>, ComponentPropsWithoutRef<typeof RC.Label>>(function ContextMenuLabel({ className, ...rest }, ref) {
  return <RC.Label ref={ref} className={cx(styles.menuLabel, className)} {...rest} />
})
