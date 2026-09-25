# CadSandbox UI kit (`src/ui`)

Import everything from `'../ui'` (or `'@/ui'` if an alias exists). Never deep-import component files.

## Setup

```tsx
// main.tsx
import './styles/global.css' // tokens + self-hosted fonts + base styles (once)
import { Toaster, TooltipProvider, initTheme } from './ui'

initTheme() // applies [data-theme] before first paint (also auto-runs on import)

<TooltipProvider>
  <App />
  <Toaster />
</TooltipProvider>
```

- **Theme**: `const { theme, resolved, setTheme, toggle } = useTheme()` — `'dark' | 'light' | 'system'`, persisted in `localStorage['cs.theme']`, sets `<html data-theme>`.
- **Tokens**: only `--cs-*` variables from `src/styles/tokens.css` (`--cs-bg`, `--cs-surface[-2|-3]`, `--cs-glass`, `--cs-border`, `--cs-text[-2|-3]`, `--cs-accent`, radii, `--cs-z-*`, `--cs-ease`, `--cs-spring`).
- **Styling**: CSS Modules per component; use `cx()` (clsx) to combine classes. Utility class `.cs-glass` for ad-hoc glass surfaces.
- **i18n**: components take label strings as props (`label`, `mixedLabel`, `emptyLabel`, `closeLabel`, …) — pass `t('key', 'Fallback')` results in.

## Components

| Component | Notes |
|---|---|
| `Button` | `variant`: primary · secondary · ghost · danger · danger-solid · glass · inverse; `size` sm/md/lg; `icon`, `iconRight`, `loading`, `active`, `round`, `asChild` |
| `IconButton` | `label` (aria + tooltip), `icon`, `shortcut`, `shape` round/square |
| `ToolButton` | Icon over 11px label; `active`, `accent`, `shortcut`, `hasMenu`, `badge`, `compact`, `showLabel={false}` |
| `ToolbarPill` / `ToolbarSeparator` | Floating glass pill group (`orientation`, `size`) |
| `RoundButton` | 44px circular glass button (Back, Snap) |
| `Chip` | Small glass chip (viewport labels) |
| `Tooltip`, `TooltipProvider` | `content`, `shortcut` (renders `Kbd`), `side` |
| `Popover*` | radix Popover; `PopoverContent` has `tight`, `arrow` |
| `DropdownMenu*`, `ContextMenu*` | radix menus; `Item` has `icon`, `shortcut`, `hint`, `danger`, `inset`; Checkbox/Radio items, Sub menus, Label, Separator |
| `Dialog*` | `DialogContent` props: `title`, `description`, `size` sm/md/lg/xl/full, `footer`, `flush`, `headerActions` |
| `Sheet*` | Drawer: `SheetContent` `side` left/right/bottom, `width` |
| `Tabs*`, `SegmentedControl` | Underline tabs; pill single-choice control (`options` with `icon`/`iconOnly`) |
| `Input`, `Textarea`, `FieldRow` | Text inputs with `prefix`/`suffix`; `FieldRow` = label + control grid |
| `NumberField` | Expressions (`=1200*2`), arrow keys (Shift ×10, Alt ×0.1), drag-scrub on `prefix`, `value=null` = mixed |
| `LengthField` | `value` in **meters**, `unit` (doc units) + `precision`; parse/format via `@cadsandbox/shared` |
| `AngleField` | `value` in radians, shown in degrees |
| `Slider`, `Switch`, `Checkbox` | radix; `Slider withField`, `Switch label between` |
| `Select` | `options: {value,label,icon,group}`; `mixed` |
| `ColorPicker`, `ColorField`, `Swatches`, `SwatchesMoreButton` | HSV picker; round swatch row with selection ring |
| `Avatar`, `AvatarStack` | Presence; `AvatarStack onClick` → follow, `highlight` |
| `Badge`, `Kbd`, `Card`, `EmptyState`, `Skeleton`, `Spinner`, `Progress`, `PageHeader`, `SectionLabel` | Primitives |
| `Toaster`, `toast` | sonner, themed |
| `ScrollArea` | Overlay scrollbars; fills its parent |
| `ResizablePanel` | `handle` edge, `min/max`, `storageKey` persistence, keyboard resize |
| `Tree` | Virtualized; `rows` flattened by caller; keyboard nav, F2 rename, pointer drag → `onMove(ids, target, 'before'|'after'|'inside')` |
| `Table` | Sortable columns, `footer`, `dense` |
| `Logo`, `Logomark` | Original isometric "sandbox cube" mark (SVG); `mono` |

Helpers: `cx`, `mergeRefs`, `isModKey`, `isEditableTarget`, `matchesShortcut('Mod+K')`, `shortcutParts`, `downloadBlob`, `timeAgo`, `useLocalStorage`, `useMediaQuery`, `useCoarsePointer`, `useDebouncedCallback`.

Accessibility: every control has a focus ring (`--cs-focus-ring`), icon-only buttons need `label`, menus/dialogs are radix (focus trap, escape, typeahead). Motion respects `prefers-reduced-motion`. Coarse pointers get larger targets automatically.
