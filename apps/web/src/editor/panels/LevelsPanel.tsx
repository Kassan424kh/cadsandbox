// Levels (storeys): add, rename, elevation, height, cut height, active level, visibility.
import { useState } from 'react'
import { Eye, EyeOff, Plus, Trash } from 'lucide-react'
import { useT } from '../../i18n'
import { Button, DropdownMenuItem, DropdownMenuSeparator, EmptyState, FieldRow, IconButton, LengthField, ScrollArea, Tooltip, cx } from '../../ui'
import { onNodes, useDocSelector, useEditorCtx, useEditorState, useUnits } from '../EditorContext'
import { PointMenu } from '../commands/PointMenu'
import { PanelFrame } from './LeftRail'
import styles from './panels.module.css'

export function LevelsPanel() {
  const t = useT()
  const { doc, editor, readOnly } = useEditorCtx()
  const units = useUnits()
  const levels = useDocSelector((d) => [...d.levels()].sort((a, b) => b.t.p[2] - a.t.p[2]), onNodes)
  const active = useEditorState((s) => s.activeLevel)
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const counts = useDocSelector((d) => new Map(d.levels().map((l) => [l.id, d.getDescendants(l.id).length])), onNodes)

  const addAbove = () => {
    if (readOnly) return
    const top = [...levels].sort((a, b) => a.t.p[2] - b.t.p[2]).pop()
    const elevation = top ? top.t.p[2] + top.params.height : 0
    const id = doc.addNode({
      type: 'level',
      name: t('level.defaultName', 'Level {n}', { n: levels.length + 1 }),
      t: { p: [0, 0, elevation], r: [0, 0, 0, 1], s: [1, 1, 1] },
      params: { height: top?.params.height ?? 3, cutHeight: 1.1, number: levels.length },
    })
    editor.setActiveLevel(id)
    setRenaming(id)
  }
  const remove = (id: string) => {
    const n = counts.get(id) ?? 0
    if (n > 0 && !window.confirm(t('levels.confirmDelete', 'Delete this level and its {count} objects?', { count: n }))) return
    doc.deleteNodes([id])
  }

  return (
    <PanelFrame title={t('panel.levels', 'Levels')} actions={!readOnly && <IconButton size="sm" label={t('levels.add', 'Add level above')} icon={<Plus />} onClick={addAbove} />}>
      <ScrollArea>
        {levels.length === 0 ? (
          <EmptyState compact title={t('levels.empty', 'No levels')} description={t('levels.emptyHint', 'Levels organise a building into storeys. Plans are cut per level.')} actions={!readOnly && <Button size="sm" variant="primary" icon={<Plus />} onClick={addAbove}>{t('levels.addFirst', 'Add ground floor')}</Button>} />
        ) : (
          <div className={styles.list} role="list">
            {levels.map((l) => {
              const isActive = l.id === active
              const open = expanded === l.id
              return (
                <div key={l.id} role="listitem">
                  <div
                    className={cx(styles.listRow, isActive && styles.listRowActive)}
                    onClick={() => {
                      editor.setActiveLevel(l.id)
                      setExpanded(open ? null : l.id)
                    }}
                    onDoubleClick={() => !readOnly && setRenaming(l.id)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setMenu({ x: e.clientX, y: e.clientY, id: l.id })
                    }}
                  >
                    <div className={styles.listRowMain}>
                      {renaming === l.id ? (
                        <input
                          className={styles.inlineInput}
                          autoFocus
                          defaultValue={l.name}
                          onFocus={(e) => e.target.select()}
                          onClick={(e) => e.stopPropagation()}
                          onBlur={(e) => {
                            const v = e.target.value.trim()
                            if (v && v !== l.name) doc.updateNode(l.id, { name: v })
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
                        {t('levels.meta', '{elev} · h {height} · {count} objects', { elev: `${l.t.p[2] >= 0 ? '+' : ''}${(l.t.p[2]).toFixed(2)} m`, height: `${l.params.height.toFixed(2)} m`, count: counts.get(l.id) ?? 0 })}
                      </span>
                    </div>
                    {!readOnly && (
                      <Tooltip content={l.visible ? t('levels.hide', 'Hide level') : t('levels.show', 'Show level')}>
                        <button
                          type="button"
                          className={cx(styles.rowBtn, l.visible ? styles.rowBtnOn : styles.rowBtnOff)}
                          aria-pressed={!l.visible}
                          aria-label={l.visible ? t('levels.hide', 'Hide level') : t('levels.show', 'Show level')}
                          onClick={(e) => {
                            e.stopPropagation()
                            doc.updateNode(l.id, { visible: !l.visible })
                          }}
                        >
                          {l.visible ? <Eye /> : <EyeOff />}
                        </button>
                      </Tooltip>
                    )}
                  </div>
                  {open && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '4px 10px 10px 12px' }}>
                      <FieldRow label={t('levels.elevation', 'Elevation')}>
                        <LengthField size="sm" unit={units.length} precision={units.precision} value={l.t.p[2]} disabled={readOnly} onChange={(v) => doc.setTransform(l.id, { ...l.t, p: [0, 0, v] })} aria-label={t('levels.elevation', 'Elevation')} />
                      </FieldRow>
                      <FieldRow label={t('levels.height', 'Height')}>
                        <LengthField size="sm" unit={units.length} precision={units.precision} value={l.params.height} min={0.5} disabled={readOnly} onChange={(v) => doc.setParams(l.id, { height: v })} aria-label={t('levels.height', 'Height')} />
                      </FieldRow>
                      <FieldRow label={t('levels.cutHeight', 'Plan cut')}>
                        <LengthField size="sm" unit={units.length} precision={units.precision} value={l.params.cutHeight} min={0} max={l.params.height} disabled={readOnly} onChange={(v) => doc.setParams(l.id, { cutHeight: v })} aria-label={t('levels.cutHeight', 'Plan cut')} />
                      </FieldRow>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </ScrollArea>
      <PointMenu anchor={menu} onClose={() => setMenu(null)}>
        {menu && (
          <>
            <DropdownMenuItem onSelect={() => editor.setActiveLevel(menu.id)}>{t('levels.setActive', 'Set active')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => editor.zoomToFit([menu.id], true)}>{t('levels.zoom', 'Zoom to level')}</DropdownMenuItem>
            {!readOnly && (
              <>
                <DropdownMenuItem shortcut="F2" onSelect={() => setRenaming(menu.id)}>{t('common.rename', 'Rename')}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => editor.select(doc.duplicateNodes([menu.id], [0, 0, doc.getNode<'level'>(menu.id)?.params.height ?? 3]))}>{t('levels.duplicate', 'Duplicate level above')}</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem danger icon={<Trash />} onSelect={() => remove(menu.id)}>{t('common.delete', 'Delete')}</DropdownMenuItem>
              </>
            )}
          </>
        )}
      </PointMenu>
    </PanelFrame>
  )
}
