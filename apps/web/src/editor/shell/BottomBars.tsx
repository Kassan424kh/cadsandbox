// Bottom chrome: Undo/Redo (left), Snap + contextual object actions + Color (center), Walk/Render (right).
import { useMemo, useState } from 'react'
import { Combine, Component, Copy, Ellipsis, Eye, EyeOff, Focus, Footprints, Group, Lock, LockOpen, Magnet, Redo2, Sparkles, Trash, Undo2, Ungroup } from 'lucide-react'
import { QUICK_COLORS } from '@cadsandbox/doc'
import type { SnapSettings } from '@cadsandbox/render'
import { useT } from '../../i18n'
import { setPrefs, usePrefs } from '../../data/prefs'
import { Checkbox, ColorPicker, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, NumberField, Popover, PopoverContent, PopoverTrigger, RoundButton, Swatches, SwatchesMoreButton, Switch, ToolButton, ToolbarPill, ToolbarSeparator, cx } from '../../ui'
import { useEditorCtx, useEditorState, useSelectionNodes } from '../EditorContext'
import { useActions } from '../commands/actions'
import styles from '../editor.module.css'
import menu from './toolmenu.module.css'
import { usePhone, useStage } from './hooks'
import { PresentationMenu } from './PresentationMenu'

export function UndoRedoPill() {
  const t = useT()
  const actions = useActions()
  const canUndo = useEditorState((s) => s.canUndo)
  const canRedo = useEditorState((s) => s.canRedo)
  const { readOnly } = useEditorCtx()
  const { compact } = useStage()
  if (readOnly) return null
  return (
    <div className={cx(styles.bottomLeft, styles.enter)}>
      <ToolbarPill label={t('editor.history', 'History')}>
        <ToolButton icon={<Undo2 />} label={t('action.undo', 'Undo')} showLabel={!compact} shortcut="Mod+Z" disabled={!canUndo} onClick={() => actions.run('edit.undo')} tooltipSide="top" />
        <ToolButton icon={<Redo2 />} label={t('action.redo', 'Redo')} showLabel={!compact} shortcut="Mod+Shift+Z" disabled={!canRedo} onClick={() => actions.run('edit.redo')} tooltipSide="top" />
      </ToolbarPill>
    </div>
  )
}

const SNAP_KEYS: (keyof SnapSettings)[] = ['grid', 'endpoint', 'midpoint', 'center', 'intersection', 'perpendicular', 'parallel', 'nearest', 'extension', 'angle']

function SnapButton() {
  const t = useT()
  const { editor } = useEditorCtx()
  const snapping = useEditorState((s) => s.snapping)
  const prefs = usePrefs()
  const [open, setOpen] = useState(false)
  const labels: Record<string, string> = {
    grid: t('snap.grid', 'Grid'),
    endpoint: t('snap.endpoint', 'Endpoints'),
    midpoint: t('snap.midpoint', 'Midpoints'),
    center: t('snap.center', 'Centers'),
    intersection: t('snap.intersection', 'Intersections'),
    perpendicular: t('snap.perpendicular', 'Perpendicular'),
    parallel: t('snap.parallel', 'Parallel'),
    nearest: t('snap.nearest', 'Nearest'),
    extension: t('snap.extension', 'Extensions'),
    angle: t('snap.angle', 'Angle steps'),
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <RoundButton
          label={snapping.enabled ? t('snap.on', 'Snap on — right-click for settings') : t('snap.off', 'Snap off — right-click for settings')}
          icon={<Magnet />}
          active={snapping.enabled}
          tooltipSide="top"
          onClick={(e) => {
            e.preventDefault()
            editor.setSnapping({ enabled: !snapping.enabled })
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            setOpen(true)
          }}
          onPointerDown={(e) => {
            // long-press opens settings on touch
            if (e.pointerType === 'touch') {
              const timer = setTimeout(() => setOpen(true), 450)
              const clear = () => clearTimeout(timer)
              e.currentTarget.addEventListener('pointerup', clear, { once: true })
              e.currentTarget.addEventListener('pointerleave', clear, { once: true })
            }
          }}
        />
      </PopoverTrigger>
      <PopoverContent side="top" sideOffset={14} style={{ width: 300 }}>
        <div className={menu.snapHeader}>
          <span>{t('snap.title', 'Snapping')}</span>
          <Switch size="sm" checked={snapping.enabled} onChange={(v) => editor.setSnapping({ enabled: v })} aria-label={t('snap.enable', 'Enable snapping')} />
        </div>
        <div className={menu.snapGrid}>
          {SNAP_KEYS.map((k) => (
            <Checkbox key={k} label={labels[k]} checked={!!snapping[k]} onChange={(v) => editor.setSnapping({ [k]: v } as Partial<SnapSettings>)} />
          ))}
        </div>
        <div className={menu.snapRow}>
          <span>{t('snap.angleStep', 'Angle step')}</span>
          <NumberField size="sm" value={snapping.angleStepDeg} min={1} max={90} step={5} precision={0} unit="°" onChange={(v) => editor.setSnapping({ angleStepDeg: v })} style={{ width: 84 }} aria-label={t('snap.angleStep', 'Angle step')} />
        </div>
        <div className={menu.snapRow}>
          <span>{t('snap.radius', 'Snap radius')}</span>
          <NumberField size="sm" value={snapping.radiusPx} min={2} max={40} step={1} precision={0} unit="px" onChange={(v) => editor.setSnapping({ radiusPx: v })} style={{ width: 84 }} aria-label={t('snap.radius', 'Snap radius')} />
        </div>
        <div className={menu.snapRow}>
          <span>{t('snap.ortho', 'Ortho lock')}</span>
          <Switch size="sm" checked={snapping.ortho} onChange={(v) => editor.setSnapping({ ortho: v })} aria-label={t('snap.ortho', 'Ortho lock')} />
        </div>
        <div className={menu.snapHeader}>
          <span>{t('nav.title', 'Navigation')}</span>
        </div>
        <div className={menu.snapRow} title={t('nav.trackpadHint', 'Two-finger scroll pans (2D) / orbits (3D), pinch zooms. Off: the wheel always zooms to the cursor.')}>
          <span>{t('nav.trackpad', 'Trackpad gestures')}</span>
          <Switch size="sm" checked={prefs.trackpadGestures} onChange={(v) => setPrefs({ trackpadGestures: v })} aria-label={t('nav.trackpad', 'Trackpad gestures')} />
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function ContextPill() {
  const t = useT()
  const actions = useActions()
  const { editor, readOnly } = useEditorCtx()
  const selection = useEditorState((s) => s.selection)
  const isolated = useEditorState((s) => s.isolated)
  const nodes = useSelectionNodes()
  const phone = usePhone()
  const has = selection.length > 0
  const anyGroup = nodes.some((n) => n.type === 'group')
  const allLocked = has && nodes.every((n) => n.locked)
  const color = useMemo(() => {
    const colors = new Set(nodes.map((n) => n.color?.toLowerCase() ?? ''))
    return colors.size === 1 ? nodes[0]?.color ?? null : null
  }, [nodes])
  const [pickerOpen, setPickerOpen] = useState(false)
  const { compact, tight } = useStage()
  const L = !compact
  if (readOnly || phone) return null

  return (
    <div className={cx(styles.bottomCenter, styles.enter)}>
      <SnapButton />
      <ToolbarPill label={t('editor.objectActions', 'Object actions')}>
        <ToolButton icon={<Copy />} label={t('action.duplicate', 'Duplicate')} showLabel={L} shortcut="Mod+D" disabled={!has} onClick={() => actions.run('edit.duplicate')} tooltipSide="top" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <ToolButton icon={<Combine />} label={t('action.boolean', 'Boolean')} showLabel={L} disabled={selection.length < 2} hasMenu tooltip={t('action.booleanTip', 'Combine solids')} tooltipSide="top" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="center">
            <DropdownMenuItem onSelect={() => actions.run('boolean.union')}>{t('boolean.union', 'Union')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.run('boolean.subtract')}>{t('boolean.subtract', 'Subtract')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.run('boolean.intersect')}>{t('boolean.intersect', 'Intersect')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {anyGroup && selection.length === 1 ? (
          <ToolButton icon={<Ungroup />} label={t('action.ungroup', 'Ungroup')} showLabel={L} shortcut="Mod+Shift+G" onClick={() => actions.run('object.ungroup')} tooltipSide="top" />
        ) : (
          <ToolButton icon={<Group />} label={t('action.group', 'Group')} showLabel={L} shortcut="Mod+G" disabled={!has} onClick={() => actions.run('object.group')} tooltipSide="top" />
        )}
        <ToolButton icon={<Component />} label={t('action.component', 'Component')} showLabel={L} shortcut="Mod+Shift+K" disabled={!has} onClick={() => actions.run('object.makeComponent')} tooltipSide="top" />
        <ToolbarSeparator />
        <ToolButton icon={<EyeOff />} label={t('action.hide', 'Hide')} showLabel={L} shortcut="Shift+H" disabled={!has} onClick={() => actions.run('object.hide')} tooltipSide="top" />
        <ToolButton icon={isolated ? <Eye /> : <Focus />} label={isolated ? t('action.unisolate', 'Show all') : t('action.isolate', 'Isolate')} showLabel={L} shortcut="Shift+I" active={!!isolated} disabled={!has && !isolated} onClick={() => (isolated ? editor.isolate(null) : actions.run('object.isolate'))} tooltipSide="top" />
        <ToolButton icon={allLocked ? <LockOpen /> : <Lock />} label={allLocked ? t('action.unlock', 'Unlock') : t('action.lock', 'Lock')} showLabel={L} shortcut="Mod+L" disabled={!has} onClick={() => actions.run('object.lock')} tooltipSide="top" />
        <ToolButton icon={<Trash />} label={t('action.delete', 'Delete')} showLabel={L} shortcut="Delete" disabled={!has} onClick={() => actions.run('edit.delete')} tooltipSide="top" />
      </ToolbarPill>
      {!tight && (
      <ToolbarPill label={t('editor.colorBar', 'Quick colors')} className={menu.colorPill}>
        {!compact && <span className={menu.colorLabel}>{t('color.label', 'Color')}</span>}
        <Swatches
          colors={QUICK_COLORS.slice(0, 5)}
          value={color}
          onChange={(c) => actions.setColor(c)}
          trailing={
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <SwatchesMoreButton label={t('color.more', 'More colors')} />
              </PopoverTrigger>
              <PopoverContent side="top" sideOffset={14}>
                <ColorPicker value={color ?? '#7c5cff'} onChange={(c) => actions.setColor(c)} swatches={QUICK_COLORS} />
                <button type="button" style={{ marginTop: 10, fontSize: 'var(--cs-text-xs)', color: 'var(--cs-text-2)' }} onClick={() => actions.setColor(null)}>
                  {t('color.clear', 'Remove color override')}
                </button>
              </PopoverContent>
            </Popover>
          }
        />
        {!has && <Ellipsis style={{ display: 'none' }} />}
      </ToolbarPill>
      )}
    </div>
  )
}

export function WalkRenderPill() {
  const t = useT()
  const actions = useActions()
  const { editor } = useEditorCtx()
  const tool = useEditorState((s) => s.tool)
  const realistic = useEditorState((s) => s.realistic)
  const phone = usePhone()
  const { compact } = useStage()
  if (phone) return null
  return (
    <div className={cx(styles.bottomRight, styles.enter)}>
      <ToolbarPill label={t('editor.presentation', 'Presentation')}>
        <ToolButton icon={<Footprints />} label={t('action.walk', 'Walk')} showLabel={!compact} active={tool === 'walk'} onClick={() => (tool === 'walk' ? actions.setTool('select') : actions.setTool('walk'))} tooltip={t('action.walkTip', 'Walk through the model (WASD)')} tooltipSide="top" />
        <ToolbarSeparator />
        <PresentationMenu compact={compact} />
        <ToolbarSeparator />
        <ToolButton
          icon={<Sparkles />}
          label={t('action.render', 'Render')}
          showLabel={!compact}
          accent
          active={realistic.active}
          onClick={() => (realistic.active ? (editor.stopRealistic(), editor.setRenderMode('shaded')) : (editor.setRenderMode('realistic'), editor.startRealistic()))}
          tooltip={realistic.active ? t('action.renderStop', 'Stop realistic rendering · {s}/{n} samples', { s: realistic.samples, n: realistic.targetSamples }) : t('action.renderTip', 'Realistic path-traced preview')}
          tooltipSide="top"
        />
      </ToolbarPill>
    </div>
  )
}
