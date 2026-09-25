// Virtualized tree with keyboard navigation, inline rename and pointer drag (reorder / reparent).
// The caller flattens its hierarchy into `rows` (visible rows only) and owns expansion/selection.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import styles from './Layout.module.css'
import { cx, isModKey } from './utils'

export interface TreeRow {
  id: string
  depth: number
  label: string
  icon?: ReactNode
  hasChildren: boolean
  expanded: boolean
  selected?: boolean
  /** Dimmed (hidden objects, disabled) */
  muted?: boolean
  /** Controls shown at the right (visible on hover unless trailingAlways). */
  trailing?: ReactNode
  trailingAlways?: boolean
  draggable?: boolean
  /** Rows that accept children when dropping onto them (groups, folders, levels). */
  canDropInside?: boolean
  className?: string
  /** Extra data for the caller's handlers */
  data?: unknown
}

export type TreeDropPosition = 'before' | 'after' | 'inside'

export interface TreeProps {
  rows: TreeRow[]
  rowHeight?: number
  indent?: number
  onToggle?(id: string, expanded: boolean): void
  onSelect?(id: string, e: { shift: boolean; mod: boolean }): void
  /** Double-click / Enter */
  onActivate?(id: string): void
  onRename?(id: string, name: string): void
  onMove?(ids: string[], target: string, position: TreeDropPosition): void
  /** Can `ids` be dropped at `target`? (default: target not in ids) */
  canDrop?(ids: string[], target: string, position: TreeDropPosition): boolean
  onContextMenu?(id: string, e: MouseEvent): void
  /** id being renamed (controlled) */
  renamingId?: string | null
  onRenamingChange?(id: string | null): void
  emptyState?: ReactNode
  className?: string
  'aria-label'?: string
  /** Show vertical depth guides */
  guides?: boolean
}

interface DragState {
  ids: string[]
  target: string | null
  position: TreeDropPosition
  y: number
  depth: number
}

export function Tree({
  rows,
  rowHeight = 26,
  indent = 14,
  onToggle,
  onSelect,
  onActivate,
  onRename,
  onMove,
  canDrop,
  onContextMenu,
  renamingId,
  onRenamingChange,
  emptyState,
  className,
  guides = true,
  ...rest
}: TreeProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(400)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [internalRenaming, setInternalRenaming] = useState<string | null>(null)
  const renaming = renamingId !== undefined ? renamingId : internalRenaming
  const setRenaming = (id: string | null) => {
    setInternalRenaming(id)
    onRenamingChange?.(id)
  }
  const [drag, setDrag] = useState<DragState | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setHeight(el.clientHeight))
    ro.observe(el)
    setHeight(el.clientHeight)
    return () => ro.disconnect()
  }, [])

  const index = useMemo(() => new Map(rows.map((r, i) => [r.id, i])), [rows])
  const total = rows.length * rowHeight
  const overscan = 6
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const end = Math.min(rows.length, Math.ceil((scrollTop + height) / rowHeight) + overscan)

  const scrollIntoView = useCallback(
    (i: number) => {
      const el = containerRef.current
      if (!el) return
      const top = i * rowHeight
      if (top < el.scrollTop) el.scrollTop = top
      else if (top + rowHeight > el.scrollTop + el.clientHeight) el.scrollTop = top + rowHeight - el.clientHeight
    },
    [rowHeight],
  )

  // ---- keyboard
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (renaming) return
    const i = focusId ? (index.get(focusId) ?? -1) : -1
    const row = i >= 0 ? rows[i] : undefined
    const focusRow = (j: number, select = true) => {
      const r = rows[Math.max(0, Math.min(rows.length - 1, j))]
      if (!r) return
      setFocusId(r.id)
      scrollIntoView(index.get(r.id)!)
      if (select) onSelect?.(r.id, { shift: e.shiftKey, mod: false })
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        focusRow(i + 1)
        break
      case 'ArrowUp':
        e.preventDefault()
        focusRow(i - 1)
        break
      case 'ArrowRight':
        e.preventDefault()
        if (row?.hasChildren && !row.expanded) onToggle?.(row.id, true)
        else focusRow(i + 1)
        break
      case 'ArrowLeft':
        e.preventDefault()
        if (row?.hasChildren && row.expanded) onToggle?.(row.id, false)
        else if (row) {
          for (let j = i - 1; j >= 0; j--) if (rows[j]!.depth < row.depth) return focusRow(j)
        }
        break
      case 'Home':
        e.preventDefault()
        focusRow(0)
        break
      case 'End':
        e.preventDefault()
        focusRow(rows.length - 1)
        break
      case 'Enter':
        if (row) {
          e.preventDefault()
          onActivate?.(row.id)
        }
        break
      case 'F2':
        if (row && onRename) {
          e.preventDefault()
          setRenaming(row.id)
        }
        break
      case ' ':
        if (row) {
          e.preventDefault()
          onSelect?.(row.id, { shift: false, mod: true })
        }
        break
    }
  }

  // ---- drag & drop (pointer based)
  const pointer = useRef<{ id: string; x: number; y: number; started: boolean } | null>(null)
  const autoScroll = useRef<number | null>(null)

  const hitTest = (clientY: number, clientX: number, ids: string[]): Pick<DragState, 'target' | 'position' | 'y' | 'depth'> => {
    const el = containerRef.current!
    const rect = el.getBoundingClientRect()
    const y = clientY - rect.top + el.scrollTop
    let i = Math.floor(y / rowHeight)
    if (rows.length === 0) return { target: null, position: 'after', y: 0, depth: 0 }
    if (i >= rows.length) {
      const last = rows[rows.length - 1]!
      return { target: last.id, position: 'after', y: rows.length * rowHeight, depth: 0 }
    }
    i = Math.max(0, i)
    const row = rows[i]!
    const within = (y - i * rowHeight) / rowHeight
    let position: TreeDropPosition
    if (row.canDropInside && within > 0.25 && within < 0.75) position = 'inside'
    else position = within < 0.5 ? 'before' : 'after'
    // after an expanded parent = inside as first child visually; keep 'after' semantics but indent
    const depthGuess = position === 'inside' ? row.depth + 1 : row.depth
    void clientX
    const allowed = (canDrop ? canDrop(ids, row.id, position) : true) && !ids.includes(row.id)
    return { target: allowed ? row.id : null, position, y: position === 'before' ? i * rowHeight : position === 'after' ? (i + 1) * rowHeight : i * rowHeight, depth: depthGuess }
  }

  const onRowPointerDown = (e: PointerEvent<HTMLDivElement>, row: TreeRow) => {
    if (e.button !== 0 || renaming) return
    if ((e.target as HTMLElement).closest('[data-tree-noselect]')) return
    if (!onMove || row.draggable === false) return
    pointer.current = { id: row.id, x: e.clientX, y: e.clientY, started: false }
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const p = pointer.current
    if (!p) return
    if (!p.started) {
      if (Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y) < 5) return
      p.started = true
      containerRef.current?.setPointerCapture(e.pointerId)
      const startRow = rows[index.get(p.id)!]
      const ids = startRow?.selected ? rows.filter((r) => r.selected && r.draggable !== false).map((r) => r.id) : [p.id]
      setDrag({ ids, target: null, position: 'after', y: 0, depth: 0 })
    }
    setDrag((d) => (d ? { ...d, ...hitTest(e.clientY, e.clientX, d.ids) } : d))
    // auto-scroll near edges
    const el = containerRef.current!
    const rect = el.getBoundingClientRect()
    const edge = 28
    const dy = e.clientY < rect.top + edge ? -1 : e.clientY > rect.bottom - edge ? 1 : 0
    if (autoScroll.current) cancelAnimationFrame(autoScroll.current)
    if (dy) {
      const step = () => {
        el.scrollTop += dy * 6
        autoScroll.current = requestAnimationFrame(step)
      }
      autoScroll.current = requestAnimationFrame(step)
    }
  }
  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    const p = pointer.current
    pointer.current = null
    if (autoScroll.current) cancelAnimationFrame(autoScroll.current)
    autoScroll.current = null
    if (!p?.started) return
    containerRef.current?.releasePointerCapture(e.pointerId)
    // Side effects stay out of the state updater (React may run updaters during render / twice in
    // StrictMode — the move would then write the document twice). The drop target is re-hit-tested
    // at the release point; the dragged ids were fixed when the drag started.
    const d = drag
    setDrag(null)
    if (!d || !onMove) return
    const hit = hitTest(e.clientY, e.clientX, d.ids)
    if (hit.target) onMove(d.ids, hit.target, hit.position)
  }

  if (rows.length === 0 && emptyState) {
    return (
      <div ref={containerRef} className={cx(styles.tree, className)}>
        {emptyState}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      role="tree"
      aria-label={rest['aria-label']}
      tabIndex={0}
      className={cx(styles.tree, className)}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      onKeyDown={onKeyDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div className={styles.treeInner} style={{ height: total }}>
        {guides &&
          rows.slice(start, end).map((r, k) =>
            r.depth > 0 ? (
              <span
                key={`g${r.id}`}
                className={styles.treeGuide}
                style={{ left: 8 + (r.depth - 1) * indent + 9, top: (start + k) * rowHeight, height: rowHeight }}
                aria-hidden
              />
            ) : null,
          )}
        {rows.slice(start, end).map((r, k) => {
          const i = start + k
          const dragging = drag?.ids.includes(r.id)
          const dropInside = drag?.target === r.id && drag.position === 'inside'
          const isRenaming = renaming === r.id
          return (
            <div
              key={r.id}
              role="treeitem"
              aria-level={r.depth + 1}
              aria-expanded={r.hasChildren ? r.expanded : undefined}
              aria-selected={r.selected ?? false}
              data-id={r.id}
              className={cx(styles.treeRow, r.selected && styles.treeRowSelected, focusId === r.id && styles.treeRowFocused, r.muted && styles.treeRowMuted, dragging && styles.treeRowDragging, dropInside && styles.treeRowDropInside, r.className)}
              style={{ top: i * rowHeight, height: rowHeight, paddingLeft: 6 + r.depth * indent }}
              onPointerDown={(e) => onRowPointerDown(e, r)}
              onClick={(e) => {
                if (pointer.current?.started) return
                setFocusId(r.id)
                onSelect?.(r.id, { shift: e.shiftKey, mod: isModKey(e) })
              }}
              onDoubleClick={(e) => {
                if ((e.target as HTMLElement).closest('[data-tree-noselect]')) return
                if (onRename && (e.target as HTMLElement).closest(`.${styles.treeLabel}`)) setRenaming(r.id)
                else onActivate?.(r.id)
              }}
              onContextMenu={(e) => {
                if (onContextMenu) {
                  setFocusId(r.id)
                  onContextMenu(r.id, e)
                }
              }}
            >
              {r.hasChildren ? (
                <button
                  type="button"
                  tabIndex={-1}
                  data-tree-noselect
                  aria-label={r.expanded ? 'Collapse' : 'Expand'}
                  className={cx(styles.treeToggle, r.expanded && styles.treeToggleOpen)}
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggle?.(r.id, !r.expanded)
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <ChevronRight />
                </button>
              ) : (
                <span className={styles.treeToggle} />
              )}
              {r.icon && <span className={styles.treeIcon}>{r.icon}</span>}
              {isRenaming ? (
                <input
                  className={styles.treeInput}
                  data-tree-noselect
                  autoFocus
                  defaultValue={r.label}
                  onFocus={(e) => e.target.select()}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter') {
                      const v = e.currentTarget.value.trim()
                      if (v && v !== r.label) onRename?.(r.id, v)
                      setRenaming(null)
                    } else if (e.key === 'Escape') setRenaming(null)
                  }}
                  onBlur={(e) => {
                    const v = e.currentTarget.value.trim()
                    if (v && v !== r.label) onRename?.(r.id, v)
                    setRenaming(null)
                  }}
                />
              ) : (
                <span className={styles.treeLabel} title={r.label}>
                  {r.label}
                </span>
              )}
              {r.trailing && (
                <span className={cx(styles.treeTrailing, r.trailingAlways && styles.treeTrailingAlways)} data-tree-noselect onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                  {r.trailing}
                </span>
              )}
            </div>
          )
        })}
        {drag?.target && drag.position !== 'inside' && <div className={styles.treeDropLine} style={{ top: drag.y - 1, left: 8 + drag.depth * indent + 6 }} aria-hidden />}
      </div>
    </div>
  )
}
