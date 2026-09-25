// Thin status bar: tool hint, VCB numeric input, cursor coordinates, snap/ortho/grid toggles,
// units, viewport info, sync status.
import { useEffect, useRef, useState } from 'react'
import { Grid3x3, Magnet, MoveHorizontal } from 'lucide-react'
import { formatLength, type LengthUnit } from '@cadsandbox/shared'
import { useT } from '../../i18n'
import { Kbd, Tooltip, cx } from '../../ui'
import { useEditorCtx, useEditorState, useUnits } from '../EditorContext'
import { TOOL_META } from '../engine/tools'
import styles from './statusbar.module.css'
import { SyncDot } from './TopBar'

function Vcb() {
  const t = useT()
  const { editor } = useEditorCtx()
  const input = useEditorState((s) => s.toolInput)
  const [text, setText] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  const typing = useRef(false)
  useEffect(() => {
    if (!typing.current) setText(input?.value ?? '')
  }, [input?.value, input?.label])
  useEffect(() => {
    // Tab focuses the VCB while a tool is active
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab' && input && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault()
        ref.current?.focus()
        ref.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [input])
  if (!input) return null
  return (
    <label className={styles.vcb} title={t('status.vcbTip', 'Type an exact value and press Enter')}>
      <span className={styles.vcbLabel}>{input.label}</span>
      <input
        ref={ref}
        className={styles.vcbInput}
        value={text}
        placeholder={input.placeholder}
        spellCheck={false}
        autoComplete="off"
        aria-label={input.label}
        onFocus={() => (typing.current = true)}
        onBlur={() => (typing.current = false)}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            editor.submitToolInput(text)
            typing.current = false
            setText('')
          } else if (e.key === 'Escape') {
            e.currentTarget.blur()
            setText(input.value)
          }
        }}
      />
      <Kbd shortcut="Enter" />
    </label>
  )
}

function coord(v: number, unit: LengthUnit, precision: number) {
  return formatLength(v, unit, precision, false)
}

export function StatusBar() {
  const t = useT()
  const { editor, engineAvailable } = useEditorCtx()
  const units = useUnits()
  const tool = useEditorState((s) => s.tool)
  const hint = useEditorState((s) => s.toolHint)
  const cursor = useEditorState((s) => s.cursorWorld)
  const snapping = useEditorState((s) => s.snapping)
  const grid = useEditorState((s) => s.gridVisible)
  const vp = useEditorState((s) => s.viewports[s.activeViewport])
  const measure = useEditorState((s) => s.measure)
  const stats = useEditorState((s) => s.stats)
  const meta = TOOL_META[tool]
  const defaultHint = tool === 'select' ? t('status.hintSelect', 'Click to select · drag to box-select · double-click to edit a group') : t('status.hintTool', '{tool} tool', { tool: t(meta.key, meta.fallback) })

  return (
    <footer className={cx(styles.statusRow, styles.statusBar)} role="status">
      <span className={styles.statusItem} style={{ color: 'var(--cs-text)' }}>
        {meta.icon}
        <span>{t(meta.key, meta.fallback)}</span>
      </span>
      <span className={styles.statusSep} />
      <span className={styles.statusHint}>{engineAvailable ? hint || defaultHint : t('status.engineLoading', 'Viewport engine not loaded — panels and document editing are available')}</span>
      {measure && (
        <span className={styles.statusItem} style={{ color: 'var(--cs-text)' }}>
          {measure.kind === 'distance' ? formatLength(measure.value, units.length, units.precision) : measure.kind === 'area' ? `${measure.value.toFixed(2)} m²` : `${((measure.value * 180) / Math.PI).toFixed(1)}°`}
        </span>
      )}
      <Vcb />
      <span className={cx(styles.statusItem, styles.coords)} aria-label={t('status.cursor', 'Cursor position')}>
        {cursor ? `X ${coord(cursor[0], units.length, units.precision)}  Y ${coord(cursor[1], units.length, units.precision)}  Z ${coord(cursor[2], units.length, units.precision)}` : '—'}
      </span>
      <span className={styles.statusSep} />
      <span className={styles.statusGroup}>
        <Tooltip content={t('status.snapToggle', 'Toggle snapping')} shortcut="Shift+S">
          <button type="button" className={cx(styles.statusItem, snapping.enabled && styles.statusOn)} onClick={() => editor.setSnapping({ enabled: !snapping.enabled })} aria-pressed={snapping.enabled}>
            <Magnet />
            {t('status.snap', 'Snap')}
          </button>
        </Tooltip>
        <Tooltip content={t('status.orthoToggle', 'Toggle ortho lock')} shortcut="F8">
          <button type="button" className={cx(styles.statusItem, snapping.ortho && styles.statusOn)} onClick={() => editor.setSnapping({ ortho: !snapping.ortho })} aria-pressed={snapping.ortho}>
            <MoveHorizontal />
            {t('status.ortho', 'Ortho')}
          </button>
        </Tooltip>
        <Tooltip content={t('status.gridToggle', 'Toggle grid')} shortcut="Shift+G">
          <button type="button" className={cx(styles.statusItem, grid && styles.statusOn)} onClick={() => void editor.commands.execute('view.toggleGrid')} aria-pressed={grid}>
            <Grid3x3 />
            {t('status.grid', 'Grid')}
          </button>
        </Tooltip>
      </span>
      <span className={cx(styles.statusSep, styles.statusSecondary)} />
      <span className={cx(styles.statusItem, styles.statusSecondary)} title={t('status.units', 'Document units')}>
        {units.length} · {units.angle}
      </span>
      {vp && (
        <span className={cx(styles.statusItem, styles.statusSecondary)} title={t('status.viewport', 'Active viewport')}>
          {vp.label} · {vp.projection === 'perspective' ? t('status.persp', 'Persp') : t('status.ortho', 'Ortho')}
        </span>
      )}
      {stats.fps > 0 && <span className={cx(styles.statusItem, styles.statusSecondary)}>{Math.round(stats.fps)} fps</span>}
      <span className={styles.statusItem}>
        <SyncDot />
      </span>
    </footer>
  )
}
