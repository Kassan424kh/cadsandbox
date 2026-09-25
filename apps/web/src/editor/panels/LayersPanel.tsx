// Drafting layers: visibility, lock, print, color, line weight/type, add/rename/delete, assign selection.
import { useState } from 'react'
import { Eye, EyeOff, Lock, LockOpen, Plus, Printer, Trash } from 'lucide-react'
import type { LayerDef, LineType } from '@cadsandbox/doc'
import { DEFAULT_LAYER_ID } from '@cadsandbox/doc'
import { useT } from '../../i18n'
import { ColorField, DropdownMenuItem, DropdownMenuSeparator, IconButton, NumberField, ScrollArea, Select, Tooltip, cx } from '../../ui'
import { onLayers, useDocSelector, useEditorCtx, useEditorState } from '../EditorContext'
import { useActions } from '../commands/actions'
import { PointMenu } from '../commands/PointMenu'
import { PanelFrame } from './LeftRail'
import styles from './panels.module.css'

const LINE_TYPES: LineType[] = ['continuous', 'dashed', 'dotted', 'dashdot', 'hidden', 'center']

export function LayersPanel() {
  const t = useT()
  const { doc, editor, readOnly } = useEditorCtx()
  const actions = useActions()
  const layers = useDocSelector((d) => [...d.listLayers()].sort((a, b) => a.order - b.order), onLayers)
  const selection = useEditorState((s) => s.selection)
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const counts = useDocSelector((d) => {
    const m = new Map<string, number>()
    for (const n of d.allNodes()) {
      const k = n.layer ?? DEFAULT_LAYER_ID
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    return m
  })

  const patch = (id: string, p: Partial<LayerDef>) => !readOnly && doc.updateLayer(id, p)
  const add = () => {
    if (readOnly) return
    const id = doc.addLayer({ name: t('layers.newName', 'Layer {n}', { n: layers.length }), color: '#a1a1aa' })
    setRenaming(id)
  }
  const remove = (id: string) => {
    if (id === DEFAULT_LAYER_ID) return
    doc.removeLayer(id)
  }
  const lineTypeLabel: Record<LineType, string> = {
    continuous: t('lineType.continuous', 'Continuous'),
    dashed: t('lineType.dashed', 'Dashed'),
    dotted: t('lineType.dotted', 'Dotted'),
    dashdot: t('lineType.dashdot', 'Dash-dot'),
    hidden: t('lineType.hidden', 'Hidden'),
    center: t('lineType.center', 'Center'),
  }

  return (
    <PanelFrame title={t('panel.layers', 'Layers')} actions={!readOnly && <IconButton size="sm" label={t('layers.add', 'Add layer')} icon={<Plus />} onClick={add} />}>
      <ScrollArea>
        <div className={styles.list} role="list">
          {layers.map((l) => {
            const open = expanded === l.id
            return (
              <div key={l.id} role="listitem">
                <div
                  className={cx(styles.listRow)}
                  onDoubleClick={() => !readOnly && setRenaming(l.id)}
                  onClick={() => setExpanded(open ? null : l.id)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setMenu({ x: e.clientX, y: e.clientY, id: l.id })
                  }}
                >
                  <span className={styles.dot} style={{ background: l.color }} />
                  <div className={styles.listRowMain}>
                    {renaming === l.id ? (
                      <input
                        className={styles.inlineInput}
                        autoFocus
                        defaultValue={l.name}
                        onFocus={(e) => e.target.select()}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={(e) => {
                          patch(l.id, { name: e.target.value.trim() || l.name })
                          setRenaming(null)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur()
                          if (e.key === 'Escape') setRenaming(null)
                        }}
                      />
                    ) : (
                      <span className={styles.listRowTitle}>{l.name}</span>
                    )}
                    <span className={styles.listRowMeta}>
                      {t('layers.meta', '{count} objects · {weight} mm · {type}', { count: counts.get(l.id) ?? 0, weight: l.lineWeight, type: lineTypeLabel[l.lineType] })}
                    </span>
                  </div>
                  <Tooltip content={l.visible ? t('layers.hide', 'Hide layer') : t('layers.show', 'Show layer')}>
                    <button
                      type="button"
                      className={cx(styles.rowBtn, l.visible ? styles.rowBtnOn : styles.rowBtnOff)}
                      aria-pressed={!l.visible}
                      disabled={readOnly}
                      aria-label={l.visible ? t('layers.hide', 'Hide layer') : t('layers.show', 'Show layer')}
                      onClick={(e) => {
                        e.stopPropagation()
                        patch(l.id, { visible: !l.visible })
                      }}
                    >
                      {l.visible ? <Eye /> : <EyeOff />}
                    </button>
                  </Tooltip>
                  <Tooltip content={l.locked ? t('layers.unlock', 'Unlock layer') : t('layers.lock', 'Lock layer')}>
                    <button
                      type="button"
                      className={cx(styles.rowBtn, l.locked ? styles.rowBtnOn : styles.rowBtnOff)}
                      aria-pressed={l.locked}
                      disabled={readOnly}
                      aria-label={l.locked ? t('layers.unlock', 'Unlock layer') : t('layers.lock', 'Lock layer')}
                      onClick={(e) => {
                        e.stopPropagation()
                        patch(l.id, { locked: !l.locked })
                      }}
                    >
                      {l.locked ? <Lock /> : <LockOpen />}
                    </button>
                  </Tooltip>
                  <Tooltip content={l.printable ? t('layers.noPrint', 'Exclude from print') : t('layers.print', 'Include in print')}>
                    <button
                      type="button"
                      className={cx(styles.rowBtn, l.printable ? styles.rowBtnOn : styles.rowBtnOff)}
                      aria-pressed={l.printable}
                      disabled={readOnly}
                      aria-label={t('layers.printable', 'Printable')}
                      onClick={(e) => {
                        e.stopPropagation()
                        patch(l.id, { printable: !l.printable })
                      }}
                    >
                      <Printer />
                    </button>
                  </Tooltip>
                </div>
                {open && !readOnly && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, padding: '4px 10px 10px 26px' }}>
                    <ColorField size="sm" value={l.color} onChange={(c) => c && patch(l.id, { color: c })} aria-label={t('layers.color', 'Layer color')} />
                    <NumberField size="sm" value={l.lineWeight} min={0.05} max={2} step={0.05} precision={2} unit="mm" onChange={(v) => patch(l.id, { lineWeight: v })} aria-label={t('layers.lineWeight', 'Line weight')} />
                    <Select size="sm" value={l.lineType} options={LINE_TYPES.map((v) => ({ value: v, label: lineTypeLabel[v] }))} onChange={(v) => patch(l.id, { lineType: v })} aria-label={t('layers.lineType', 'Line type')} />
                    <button type="button" className={styles.libTab} style={{ justifySelf: 'start' }} disabled={selection.length === 0} onClick={() => actions.setLayer(l.id)}>
                      {t('layers.assignSelection', 'Assign selection')}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </ScrollArea>
      <PointMenu anchor={menu} onClose={() => setMenu(null)}>
        {menu && (
          <>
            <DropdownMenuItem onSelect={() => setRenaming(menu.id)} shortcut="F2">{t('common.rename', 'Rename')}</DropdownMenuItem>
            <DropdownMenuItem disabled={selection.length === 0} onSelect={() => actions.setLayer(menu.id)}>{t('layers.assignSelection', 'Assign selection')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => editor.select(doc.allNodes().filter((n) => (n.layer ?? DEFAULT_LAYER_ID) === menu.id && n.type !== 'level').map((n) => n.id))}>{t('layers.selectObjects', 'Select objects on layer')}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem danger icon={<Trash />} disabled={menu.id === DEFAULT_LAYER_ID} onSelect={() => remove(menu.id)}>{t('common.delete', 'Delete')}</DropdownMenuItem>
          </>
        )}
      </PointMenu>
    </PanelFrame>
  )
}
