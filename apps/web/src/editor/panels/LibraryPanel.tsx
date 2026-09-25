// Library: drag-and-drop catalog (shapes, solids, structure & lights, furniture by category,
// materials) plus the user's collections (optional LibraryStore).
import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react'
import { FolderPlus, Search, Trash } from 'lucide-react'
import { BUILTIN_MATERIALS, type MaterialDef } from '@cadsandbox/doc'
import type { CollectionDTO, CollectionItemDTO } from '@cadsandbox/shared'
import { useT } from '../../i18n'
import { Button, DropdownMenuItem, EmptyState, IconButton, Input, ScrollArea, Select, Tooltip, cx, toast } from '../../ui'
import type { DragPayload } from '../../data/types'
import { onMaterials, useDocSelector, useEditorCtx, useEditorState } from '../EditorContext'
import { useActions } from '../commands/actions'
import { PointMenu } from '../commands/PointMenu'
import { materialName } from '../inspector/MaterialPicker'
import { beginDrag, endDrag } from '../io/dnd'
import { FURNITURE_CATEGORIES, LIGHT_ITEMS, SHAPE_ITEMS, SOLID_ITEMS, STRUCTURE_ITEMS, furnitureItem, type CatalogItem } from '../library/catalog'
import { PanelFrame } from './LeftRail'
import styles from './panels.module.css'

type Tab = 'shapes' | 'furniture' | 'materials' | 'structure' | 'collections'

function LibItem({ item, query }: { item: CatalogItem; query: string }) {
  const t = useT()
  const actions = useActions()
  const label = t(item.key, item.fallback)
  if (query && !`${label} ${item.keywords?.join(' ') ?? ''}`.toLowerCase().includes(query)) return null
  const onDragStart = (e: DragEvent) => beginDrag(e, { kind: 'node', node: item.node }, label)
  return (
    <Tooltip content={t('library.itemTip', '{label} — click to place, or drag onto the canvas', { label })}>
      <button type="button" className={styles.libItem} draggable onDragStart={onDragStart} onDragEnd={endDrag} onClick={() => actions.place(item.node, item.id)}>
        {item.icon}
        <span className={styles.libItemLabel}>{label}</span>
      </button>
    </Tooltip>
  )
}

function MaterialItem({ m, query, onEdit }: { m: MaterialDef; query: string; onEdit?(): void }) {
  const t = useT()
  const actions = useActions()
  const hasSel = useEditorState((s) => s.selection.length > 0)
  if (query && !`${materialName(m, t)} ${m.name} ${m.category}`.toLowerCase().includes(query)) return null
  const payload: DragPayload = { kind: 'material', materialId: m.id, material: m.builtin ? undefined : m }
  return (
    <Tooltip content={hasSel ? t('material.applyTip', 'Apply {name} to the selection · drag onto an object', { name: materialName(m, t) }) : t('material.dragTip', 'Drag {name} onto an object', { name: m.name })}>
      <button
        type="button"
        className={styles.libItem}
        draggable
        onDragStart={(e) => beginDrag(e, payload, m.name)}
        onDragEnd={endDrag}
        onClick={() => (hasSel ? actions.setMaterial(m.id) : toast.info(t('material.selectFirst', 'Select an object first, or drag the material onto one')))}
        onDoubleClick={onEdit}
      >
        <span className={styles.libSwatch} style={{ background: m.color, opacity: m.transmission > 0.5 ? 0.6 : 1 }} />
        <span className={styles.libItemLabel}>{materialName(m, t)}</span>
      </button>
    </Tooltip>
  )
}

function Collections({ query }: { query: string }) {
  const t = useT()
  const { library, session, editor, doc, readOnly } = useEditorCtx()
  const [collections, setCollections] = useState<CollectionDTO[] | null>(null)
  const [current, setCurrent] = useState<string | null>(null)
  const [items, setItems] = useState<CollectionItemDTO[]>([])
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)

  const refresh = useCallback(async () => {
    if (!library) return
    const list = await library.listCollections()
    setCollections(list)
    setCurrent((c) => c ?? list[0]?.id ?? null)
  }, [library])
  useEffect(() => void refresh(), [refresh])
  useEffect(() => {
    if (!library || !current) return void setItems([])
    void library.listItems(current).then(setItems)
  }, [library, current])

  if (!library) return <EmptyState compact title={t('collections.unavailable', 'Collections need an account')} description={t('collections.unavailableHint', 'Sign in to save objects and materials into reusable collections.')} />

  const create = async () => {
    const name = window.prompt(t('collections.namePrompt', 'Collection name'), t('collections.defaultName', 'My collection'))
    if (!name) return
    const c = await library.createCollection(name)
    await refresh()
    setCurrent(c.id)
  }
  const insertItem = async (item: CollectionItemDTO) => {
    if (readOnly) return
    await library.materialize(item, session.assets)
    if (item.kind === 'material') {
      const m = item.payload as MaterialDef
      const id = doc.getMaterial(m.id) ? m.id : doc.addMaterial({ ...m, builtin: false })
      const sel = editor.getState().selection
      if (sel.length) doc.updateNodes(sel.map((n) => ({ id: n, patch: { material: id } })))
      else toast.info(t('dnd.materialAdded', 'Material "{name}" added to this document', { name: m.name }))
    } else {
      await editor.insert(item.payload as import('@cadsandbox/doc').DocSnapshot)
    }
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 6, padding: '6px 10px', alignItems: 'center' }}>
        <Select size="sm" value={current} options={(collections ?? []).map((c) => ({ value: c.id, label: `${c.name} (${c.itemCount})` }))} onChange={setCurrent} placeholder={t('collections.pick', 'Pick a collection')} aria-label={t('collections.pick', 'Pick a collection')} />
        <IconButton size="sm" label={t('collections.new', 'New collection')} icon={<FolderPlus />} onClick={() => void create()} />
        {current && (
          <IconButton
            size="sm"
            label={t('collections.delete', 'Delete collection')}
            icon={<Trash />}
            onClick={() => {
              if (window.confirm(t('collections.confirmDelete', 'Delete this collection and its items?'))) void library.deleteCollection(current).then(() => (setCurrent(null), refresh()))
            }}
          />
        )}
      </div>
      {collections && collections.length === 0 && <EmptyState compact title={t('collections.empty', 'No collections yet')} description={t('collections.emptyHint', 'Right-click objects → "Save to collection", or create one here.')} actions={<Button size="sm" onClick={() => void create()}>{t('collections.new', 'New collection')}</Button>} />}
      <div className={styles.libGrid}>
        {items
          .filter((i) => !query || i.name.toLowerCase().includes(query) || i.tags.some((x) => x.toLowerCase().includes(query)))
          .map((i) => (
            <button
              key={i.id}
              type="button"
              className={styles.libItem}
              draggable={!readOnly}
              onDragStart={(e) => beginDrag(e, { kind: 'collection-item', collectionId: i.collectionId, itemId: i.id }, i.name)}
              onDragEnd={endDrag}
              onClick={() => void insertItem(i)}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ x: e.clientX, y: e.clientY, id: i.id })
              }}
            >
              {i.thumbnail ? <img className={styles.libItemThumb} src={i.thumbnail} alt="" /> : i.kind === 'material' ? <span className={styles.libSwatch} style={{ background: (i.payload as MaterialDef).color }} /> : null}
              <span className={styles.libItemLabel}>{i.name}</span>
            </button>
          ))}
      </div>
      {current && items.length === 0 && <div className={styles.emptyPad} style={{ fontSize: 'var(--cs-text-xs)', color: 'var(--cs-text-3)' }}>{t('collections.noItems', 'Empty — select objects and use "Save to collection".')}</div>}
      <PointMenu anchor={menu} onClose={() => setMenu(null)}>
        {menu && current && (
          <DropdownMenuItem danger icon={<Trash />} onSelect={() => void library.removeItem(current, menu.id).then(() => library.listItems(current).then(setItems))}>
            {t('collections.removeItem', 'Remove from collection')}
          </DropdownMenuItem>
        )}
      </PointMenu>
    </>
  )
}

export function LibraryPanel() {
  const t = useT()
  const { readOnly } = useEditorCtx()
  const [tab, setTab] = useState<Tab>('shapes')
  const [query, setQuery] = useState('')
  const docMaterials = useDocSelector((d) => d.docMaterials(), onMaterials)
  const q = query.trim().toLowerCase()
  const tabs: { id: Tab; label: string }[] = [
    { id: 'shapes', label: t('library.tab.shapes', 'Shapes') },
    { id: 'furniture', label: t('library.tab.furniture', 'Furniture') },
    { id: 'structure', label: t('library.tab.structure', 'Structure') },
    { id: 'materials', label: t('library.tab.materials', 'Materials') },
    { id: 'collections', label: t('library.tab.collections', 'My collections') },
  ]
  const materialGroups = useMemo(() => {
    const groups = new Map<string, MaterialDef[]>()
    for (const m of BUILTIN_MATERIALS) groups.set(m.category, [...(groups.get(m.category) ?? []), m])
    return groups
  }, [])

  if (readOnly) return <PanelFrame title={t('panel.library', 'Library')}><EmptyState compact title={t('library.readOnly', 'View-only access')} description={t('library.readOnlyHint', 'Ask for edit rights to add objects.')} /></PanelFrame>

  return (
    <PanelFrame title={t('panel.library', 'Library')}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div className={styles.search}>
          <Input size="sm" prefix={<Search />} placeholder={t('library.search', 'Search library…')} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t('library.search', 'Search library…')} />
        </div>
        <div className={styles.libTabs} role="tablist">
          {tabs.map((x) => (
            <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} className={cx(styles.libTab, tab === x.id && styles.libTabActive)} onClick={() => setTab(x.id)}>
              {x.label}
            </button>
          ))}
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <ScrollArea>
            {tab === 'shapes' && (
              <>
                <div className={styles.libGroup}>{t('menu.add.simpleForms', 'Simple forms')}</div>
                <div className={styles.libGrid}>{SHAPE_ITEMS.map((i) => <LibItem key={i.id} item={i} query={q} />)}</div>
                <div className={styles.libGroup}>{t('menu.add.objects3d', '3D objects')}</div>
                <div className={styles.libGrid}>{SOLID_ITEMS.map((i) => <LibItem key={i.id} item={i} query={q} />)}</div>
              </>
            )}
            {tab === 'furniture' &&
              FURNITURE_CATEGORIES.map((c) => (
                <div key={c.id}>
                  <div className={styles.libGroup}>{t(c.key, c.fallback)}</div>
                  <div className={styles.libGrid}>{c.kinds.map((k) => <LibItem key={k} item={furnitureItem(k)} query={q} />)}</div>
                </div>
              ))}
            {tab === 'structure' && (
              <>
                <div className={styles.libGroup}>{t('library.group.structure', 'Structure & site')}</div>
                <div className={styles.libGrid}>{STRUCTURE_ITEMS.map((i) => <LibItem key={i.id} item={i} query={q} />)}</div>
                <div className={styles.libGroup}>{t('library.group.lights', 'Lights')}</div>
                <div className={styles.libGrid}>{LIGHT_ITEMS.map((i) => <LibItem key={i.id} item={i} query={q} />)}</div>
                <div className={styles.libGroup}>{t('library.group.archTools', 'Building elements')}</div>
                <div className={styles.emptyPad} style={{ fontSize: 'var(--cs-text-xs)', color: 'var(--cs-text-3)', paddingTop: 0 }}>{t('library.archToolsHint', 'Walls, doors, windows, slabs, roofs, stairs and rooms are drawn with the Build tools in the top bar.')}</div>
              </>
            )}
            {tab === 'materials' && (
              <>
                {docMaterials.length > 0 && (
                  <>
                    <div className={styles.libGroup}>{t('material.documentMaterials', 'This document')}</div>
                    <div className={styles.libGrid}>{docMaterials.map((m) => <MaterialItem key={m.id} m={m} query={q} />)}</div>
                  </>
                )}
                {[...materialGroups.entries()].map(([cat, list]) => (
                  <div key={cat}>
                    <div className={styles.libGroup}>{t(`material.category.${cat}`, cat.charAt(0).toUpperCase() + cat.slice(1))}</div>
                    <div className={styles.libGrid}>{list.map((m) => <MaterialItem key={m.id} m={m} query={q} />)}</div>
                  </div>
                ))}
              </>
            )}
            {tab === 'collections' && <Collections query={q} />}
          </ScrollArea>
        </div>
      </div>
    </PanelFrame>
  )
}
