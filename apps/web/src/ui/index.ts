// @cadsandbox/web UI kit — stable public API. Import from '../ui' (never from component files).
// Styles: import 'src/styles/global.css' once (tokens + fonts + base). Theme via useTheme().

export { cx, mergeRefs, IS_MAC, isModKey, isEditableTarget, clamp, roundTo, shortcutParts, matchesShortcut, colorFromString, initials, downloadBlob, timeAgo } from './utils'
export { useMediaQuery, useCoarsePointer, useReducedMotion, useElementSize, useLatest, useDebouncedCallback, useLocalStorage } from './utils'

export { useTheme, initTheme, resolveTheme, getThemeSetting, setThemeSetting, subscribeTheme } from './theme'
export type { ThemeSetting, ResolvedTheme } from './theme'

export { Button, IconButton } from './Button'
export type { ButtonProps, ButtonVariant, ButtonSize, IconButtonProps } from './Button'

export { ToolbarPill, ToolbarSeparator, ToolButton, RoundButton, Chip } from './Toolbar'
export type { ToolbarPillProps, ToolButtonProps, RoundButtonProps, ChipProps } from './Toolbar'

export { Tooltip, TooltipProvider } from './Tooltip'
export type { TooltipProps } from './Tooltip'

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor, PopoverClose } from './Popover'
export type { PopoverContentProps } from './Popover'

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuGroup,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from './Menu'

export { Dialog, DialogTrigger, DialogClose, DialogContent, Sheet, SheetTrigger, SheetClose, SheetContent } from './Dialog'
export type { DialogContentProps, DialogSize, SheetContentProps } from './Dialog'

export { Tabs, TabsList, TabsTrigger, TabsContent, SegmentedControl } from './Tabs'
export type { SegmentedControlProps, SegmentOption } from './Tabs'

export { Input, Textarea, FieldRow } from './Input'
export type { InputProps, TextareaProps, FieldRowProps } from './Input'

export { NumberField, LengthField, AngleField, defaultLengthStep, defaultLengthPrecision } from './NumberField'
export type { NumberFieldProps, LengthFieldProps, AngleFieldProps } from './NumberField'

export { Slider, Switch, Checkbox } from './Controls'
export type { SliderProps, SwitchProps, CheckboxProps } from './Controls'

export { Select } from './Select'
export type { SelectProps, SelectOption } from './Select'

export { ColorPicker, ColorField, Swatches, SwatchesMoreButton, hexToRgb, rgbToHex, rgbToHsv, hsvToRgb, normalizeHex, contrastText } from './ColorPicker'
export type { ColorPickerProps, ColorFieldProps, SwatchesProps } from './ColorPicker'

export { Avatar, AvatarStack } from './Avatar'
export type { AvatarProps, AvatarStackProps, AvatarStackUser } from './Avatar'

export { Kbd, Badge, Card, EmptyState, Skeleton, Progress, PageHeader, SectionLabel } from './Primitives'
export type { KbdProps, BadgeProps, BadgeTone, CardProps, EmptyStateProps, SkeletonProps, ProgressProps, PageHeaderProps } from './Primitives'

export { Spinner } from './Spinner'

export { Toaster, toast } from './Toaster'

export { ScrollArea } from './ScrollArea'
export type { ScrollAreaProps } from './ScrollArea'

export { ResizablePanel } from './Splitter'
export type { ResizablePanelProps } from './Splitter'

export { Tree } from './Tree'
export type { TreeProps, TreeRow, TreeDropPosition } from './Tree'

export { Table } from './Table'
export type { TableProps, TableColumn } from './Table'

export { Logo, Logomark } from './Logo'
export type { LogoProps, LogomarkProps } from './Logo'
