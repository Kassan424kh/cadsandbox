// Scene outliner: levels as top groups, visibility/lock toggles, rename, drag reorder/reparent,
// search, selection sync with the engine.
import { useCallback, useMemo, useState } from 'react'
import { Eye, EyeOff, Lock, LockOpen, Search } from 'lucide-react'
import { DEFS_ROOT, type AnyNode } from '@cadsandbox/doc'
import { useT } from '../../i18n'
import { EmptyState, Input, Tree, cx, type TreeDropPosition, type TreeRow } from '../../ui'
import { asAny, onStructure, useDocSelector, useEditorCtx, useEditorState } from '../EditorContext'
import { useActions } from '../commands/actions'
import { nodeIcon } from '../library/nodeIcons'
import { useUiStore } from '../ui-store'
import { PanelFrame } from './LeftRail'
import styles from './panels.module.css'

export function OutlinerPanel() {
  const t = useT()
  const { doc, editor, readOnly } = useEditorCtx()
  const actions = useActions()
  const selection = useEditorState((s) => s.selection)
  const activeLevel = useEditorState((s) => s.activeLevel)
  const setContextMenu = useUiStore((s) => s.setContextMenu)
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const version = useDocSelector(() => Date.now(), onStructure)

  const rows = useMemo<TreeRow[]>(() => {
    void version
    const sel = new Set(selection)
    const q = query.trim().toLowerCase()
    const out: TreeRow[] = []
    const matches = (n: AnyNode) => !q || n.name.toLowerCase().includes(q) || n.type.includes(q)
    // With a query, show matching nodes and their ancestors (expanded).
    const keep = new Set<string>()
    if (q) {
      for (const n of doc.allNodes()) {
        if (doc.isDefinitionNode(n.id)) continue
        if (matches(n)) {
          keep.add(n.id)
          for (const a of doc.getAncestors(n.id)) keep.add(a)
        }
      }
    }
    const walk = (parent: string | null, depth: number) => {
      const children = doc.getChildren(parent)
      for (const id of children) {
        if (id === DEFS_ROOT) continue
        const n = asAny(doc.getNode(id))
        if (!n) continue
        if (q && !keep.has(id)) continue
        const kids = doc.getChildren(id).filter((k) => k !== DEFS_ROOT && (!q || keep.has(k)))
        const hasChildren = kids.length > 0
        const expanded = q ? true : !collapsed.has(id)
        const isLevel = n.type === 'level'
        out.push({
          id,
          depth,
          label: n.name || n.type,
          icon: nodeIcon(n),
          hasChildren,
          expanded,
          selected: sel.has(id),
          muted: !n.visible,
          canDropInside: isLevel || n.type === 'group' || n.type === 'boolean' || n.type === 'wall',
          draggable: !readOnly,
          className: cx(isLevel && activeLevel === id && styles.listRowActive),
          trailing: readOnly ? undefined : (
            <>
              <button type="button" className={cx(styles.rowBtn, n.visible ? styles.rowBtnOn : styles.rowBtnOff)} aria-label={n.visible ? t('outliner.hide', 'Hide') : t('outliner.show', 'Show')} aria-pressed={!n.visible} onClick={() => actions.toggleVisible(id)}>
                {n.visible ? <Eye /> : <EyeOff />}
              </button>
              <button type="button" className={cx(styles.rowBtn, n.locked ? styles.rowBtnOn : styles.rowBtnOff)} aria-label={n.locked ? t('outliner.unlock', 'Unlock') : t('outliner.lock', 'Lock')} aria-pressed={n.locked} onClick={() => actions.toggleLocked(id)}>
                {n.locked ? <Lock /> : <LockOpen />}
              </button>
            </>
          ),
          trailingAlways: !n.visible || n.locked,
        })
        if (hasChildren && expanded) walk(id, depth + 1)
      }
    }
    walk(null, 0)
    return out
  }, [doc, version, selection, query, collapsed, activeLevel, readOnly, actions, t])

  const onSelect = useCallback(
    (id: string, e: { shift: boolean; mod: boolean }) => {
      const n = doc.getNode(id)
      if (!n) return
      if (n.type === 'level' && !e.mod && !e.shift) {
        editor.setActiveLevel(id)
        editor.select([id])
        return
      }
      if (e.shift && selection.length) {
        const ids = rows.map((r) => r.id)
        const a = ids.indexOf(selection[selection.length - 1]!)
        const b = ids.indexOf(id)
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a]
          editor.select(ids.slice(lo, hi + 1).filter((x) => doc.getNode(x)?.type !== 'level'), 'add')
          return
        }
      }
      editor.select([id], e.mod ? 'toggle' : 'replace')
    },
    [doc, editor, rows, selection],
  )

  const canDrop = useCallback(
    (ids: string[], target: string, position: TreeDropPosition) => {
      const tn = doc.getNode(target)
      if (!tn) return false
      const newParent = position === 'inside' ? target : tn.parent
      for (const id of ids) {
        const n = doc.getNode(id)
        if (!n) return false
        if (newParent && (id === newParent || doc.isAncestor(id, newParent))) return false
        if (n.type === 'level' && newParent !== null) return false
        if (n.type === 'opening' && doc.getNode(newParent ?? '')?.type !== 'wall') return false
        if (n.type !== 'opening' && doc.getNode(newParent ?? '')?.type === 'wall') return false
      }
      return true
    },
    [doc],
  )

  const onMove = useCallback(
    (ids: string[], target: string, position: TreeDropPosition) => {
      if (!canDrop(ids, target, position)) return
      const tn = doc.getNode(target)!
      if (position === 'inside') {
        doc.moveNodes(ids, target, null)
        setCollapsed((s) => {
          const n = new Set(s)
          n.delete(target)
          return n
        })
        return
      }
      const siblings = doc.getChildren(tn.parent)
      const before = position === 'before' ? target : (siblings[siblings.indexOf(target) + 1] ?? null)
      doc.moveNodes(ids, tn.parent, before)
    },
    [doc, canDrop],
  )

  return (
    <PanelFrame title={t('panel.scene', 'Scene')}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div className={styles.search}>
          <Input size="sm" prefix={<Search />} placeholder={t('outliner.search', 'Search objects…')} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t('outliner.search', 'Search objects…')} />
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <Tree
            rows={rows}
            aria-label={t('panel.scene', 'Scene')}
            onToggle={(id, expanded) =>
              setCollapsed((s) => {
                const n = new Set(s)
                if (expanded) n.delete(id)
                else n.add(id)
                return n
              })
            }
            onSelect={onSelect}
            onActivate={(id) => editor.zoomToFit([id], true)}
            onRename={readOnly ? undefined : (id, name) => actions.rename(id, name)}
            onMove={readOnly ? undefined : onMove}
            canDrop={canDrop}
            onContextMenu={(id, e) => {
              e.preventDefault()
              if (!selection.includes(id)) editor.select([id])
              setContextMenu({ x: e.clientX, y: e.clientY, nodeId: id })
            }}
            emptyState={<EmptyState compact title={query ? t('outliner.noMatches', 'No objects match') : t('outliner.empty', 'Nothing here yet')} description={query ? undefined : t('outliner.emptyHint', 'Add shapes, draw walls or drop items from the Library.')} />}
          />
        </div>
      </div>
    </PanelFrame>
  )
}
