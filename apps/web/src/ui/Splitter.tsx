// Resizable panel: a container with a drag handle on one edge. Controlled or uncontrolled size.
import { useCallback, useRef, useState, type HTMLAttributes, type KeyboardEvent, type PointerEvent } from 'react'
import styles from './Layout.module.css'
import { clamp, cx, useLocalStorage } from './utils'

export interface ResizablePanelProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onResize'> {
  /** Edge that carries the drag handle (the side facing the content it resizes against). */
  handle: 'left' | 'right' | 'top' | 'bottom'
  size?: number
  defaultSize?: number
  min?: number
  max?: number
  onResize?(size: number): void
  /** Persist size under this localStorage key (uncontrolled mode). */
  storageKey?: string
  /** Hide the panel entirely (keeps state). */
  collapsed?: boolean
  handleLabel?: string
}

export function ResizablePanel({ handle, size, defaultSize = 300, min = 160, max = 720, onResize, storageKey, collapsed, handleLabel = 'Resize panel', className, style, children, ...rest }: ResizablePanelProps) {
  const [stored, setStored] = useLocalStorage<number>(storageKey ?? '__cs_panel_unused__', defaultSize)
  const [local, setLocal] = useState(defaultSize)
  const current = size ?? (storageKey ? stored : local)
  const horizontal = handle === 'left' || handle === 'right'
  const [active, setActive] = useState(false)
  const drag = useRef<{ start: number; startSize: number } | null>(null)

  const setSize = useCallback(
    (v: number) => {
      const c = clamp(Math.round(v), min, max)
      if (storageKey) setStored(c)
      else setLocal(c)
      onResize?.(c)
    },
    [min, max, onResize, storageKey, setStored],
  )

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { start: horizontal ? e.clientX : e.clientY, startSize: current }
    setActive(true)
    document.body.style.cursor = horizontal ? 'col-resize' : 'row-resize'
  }
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const pos = horizontal ? e.clientX : e.clientY
    const delta = pos - d.start
    const sign = handle === 'right' || handle === 'bottom' ? 1 : -1
    setSize(d.startSize + sign * delta)
  }
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    drag.current = null
    setActive(false)
    document.body.style.cursor = ''
    e.currentTarget.releasePointerCapture(e.pointerId)
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 40 : 10
    const grow = handle === 'right' || handle === 'bottom'
    if ((horizontal && e.key === 'ArrowRight') || (!horizontal && e.key === 'ArrowDown')) {
      e.preventDefault()
      setSize(current + (grow ? step : -step))
    } else if ((horizontal && e.key === 'ArrowLeft') || (!horizontal && e.key === 'ArrowUp')) {
      e.preventDefault()
      setSize(current + (grow ? -step : step))
    }
  }

  if (collapsed) return null
  const handleClass = handle === 'left' ? styles.handleLeft : handle === 'right' ? styles.handleRight : handle === 'top' ? styles.handleTop : styles.handleBottom
  return (
    <div className={cx(styles.panel, className)} style={{ ...(horizontal ? { width: current } : { height: current }), ...style }} {...rest}>
      {children}
      <div
        role="separator"
        aria-label={handleLabel}
        aria-orientation={horizontal ? 'vertical' : 'horizontal'}
        aria-valuenow={current}
        aria-valuemin={min}
        aria-valuemax={max}
        tabIndex={0}
        className={cx(styles.handle, handleClass, active && styles.handleActive)}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onKeyDown={onKey}
        onDoubleClick={() => setSize(defaultSize)}
      />
    </div>
  )
}
