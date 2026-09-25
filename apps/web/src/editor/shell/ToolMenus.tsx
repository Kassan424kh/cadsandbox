// Popover bodies for the mode pill: Draw, Add (catalog grid like the product mock), Build,
// Annotate and Modify. Each renders icon-over-label buttons; the active item is highlighted.
import type { ReactNode } from 'react'
import type { ToolId } from '@cadsandbox/render'
import { useT } from '../../i18n'
import { Kbd, ToolButton } from '../../ui'
import { useEditorCtx, useEditorState } from '../EditorContext'
import { ANNOTATE_TOOLS, BUILD_TOOLS, DRAFTING_TOOLS, DRAW_TOOLS, MODIFY_TOOLS, TOOL_META } from '../engine/tools'
import { LIGHT_ITEMS, SHAPE_ITEMS, SOLID_ITEMS, STRUCTURE_ITEMS, type CatalogItem } from '../library/catalog'
import { IconLevelAdd } from '../library/icons'
import { useActions } from '../commands/actions'
import { AnnotateExtras } from './AnnotateExtras'
import styles from './toolmenu.module.css'

function Section({ title, cols, children }: { title?: string; cols?: number; children: ReactNode }) {
  return (
    <div className={styles.section}>
      {title && <div className={styles.sectionTitle}>{title}</div>}
      <div className={styles.grid} style={cols ? ({ '--cols': cols } as Record<string, number>) : undefined}>
        {children}
      </div>
    </div>
  )
}

function ToolGrid({ tools, onPick }: { tools: ToolId[]; onPick?(): void }) {
  const t = useT()
  const actions = useActions()
  const { readOnly, session } = useEditorCtx()
  const active = useEditorState((s) => s.tool)
  // Read-only roles keep navigation and measuring (+ commenting for commenters); every other tool
  // would only answer with the "view access" toast, so show it disabled like the symbol buttons.
  const canComment = session.role === 'commenter' || !!session.comments?.canComment
  const allowed = (id: ToolId) => !readOnly || id === 'select' || /nav|select/.test(TOOL_META[id]?.group ?? '') || id.startsWith('measure.') || (id === 'annotate.comment' && canComment)
  return (
    <>
      {tools.map((id) => {
        const m = TOOL_META[id]
        return (
          <ToolButton
            key={id}
            className={styles.gridItem}
            icon={m.icon}
            label={t(m.key, m.fallback)}
            shortcut={m.shortcut}
            active={active === id}
            disabled={!allowed(id)}
            tooltip={m.shortcut ? t(m.key, m.fallback) : false}
            onClick={() => {
              actions.setTool(id)
              onPick?.()
            }}
          />
        )
      })}
    </>
  )
}

export function DrawMenu({ onPick }: { onPick?(): void }) {
  const t = useT()
  return (
    <div className={styles.menu}>
      <Section title={t('menu.draw.sketch', 'Sketch')} cols={5}>
        <ToolGrid tools={DRAW_TOOLS} onPick={onPick} />
      </Section>
      <div className={styles.footer}>
        <span>{t('menu.draw.hint', 'Type exact lengths while drawing')}</span>
        <Kbd shortcut="Tab" />
      </div>
    </div>
  )
}

function CatalogGrid({ items, onPick }: { items: CatalogItem[]; onPick?(): void }) {
  const t = useT()
  const actions = useActions()
  const activeItem = useEditorState((s) => (s.tool === 'place' ? (s.toolOptions.itemId as string | undefined) : undefined))
  return (
    <>
      {items.map((it) => (
        <ToolButton
          key={it.id}
          className={styles.gridItem}
          icon={it.icon}
          label={t(it.key, it.fallback)}
          active={activeItem === it.id}
          tooltip={false}
          draggable
          onClick={() => {
            actions.place(it.node, it.id)
            onPick?.()
          }}
        />
      ))}
    </>
  )
}

export function AddMenu({ onPick }: { onPick?(): void }) {
  const t = useT()
  return (
    <div className={styles.menu}>
      <Section title={t('menu.add.simpleForms', 'Simple forms')} cols={5}>
        <CatalogGrid items={SHAPE_ITEMS} onPick={onPick} />
      </Section>
      <Section title={t('menu.add.objects3d', '3D objects')} cols={5}>
        <CatalogGrid items={SOLID_ITEMS} onPick={onPick} />
      </Section>
      <Section title={t('menu.add.lightsStructure', 'Lights & structure')} cols={5}>
        <CatalogGrid items={[...LIGHT_ITEMS, ...STRUCTURE_ITEMS]} onPick={onPick} />
      </Section>
      <div className={styles.footer}>
        <span>{t('menu.add.hint', 'Click to place · drag from the Library for more')}</span>
      </div>
    </div>
  )
}

export function BuildMenu({ onPick }: { onPick?(): void }) {
  const t = useT()
  const { doc, editor, readOnly } = useEditorCtx()
  const addLevel = () => {
    if (readOnly) return
    const levels = doc.levels().sort((a, b) => a.t.p[2] - b.t.p[2])
    const top = levels[levels.length - 1]
    const elevation = top ? top.t.p[2] + top.params.height : 0
    const id = doc.addNode({
      type: 'level',
      name: t('level.defaultName', 'Level {n}', { n: levels.length + 1 }),
      t: { p: [0, 0, elevation], r: [0, 0, 0, 1], s: [1, 1, 1] },
      params: { height: top?.params.height ?? 3, cutHeight: 1.1, number: levels.length },
    })
    editor.setActiveLevel(id)
    onPick?.()
  }
  return (
    <div className={styles.menu}>
      <Section title={t('menu.build.elements', 'Building elements')} cols={4}>
        <ToolGrid tools={BUILD_TOOLS} onPick={onPick} />
        <ToolButton className={styles.gridItem} icon={<IconLevelAdd />} label={t('menu.build.addLevel', '+ Level')} tooltip={t('menu.build.addLevelTip', 'Add a storey above the top level')} onClick={addLevel} disabled={readOnly} />
      </Section>
      <div className={styles.footer}>
        <span>{t('menu.build.hint', 'Doors and windows snap into walls')}</span>
      </div>
    </div>
  )
}

export function AnnotateMenu({ onPick }: { onPick?(): void }) {
  const t = useT()
  return (
    <div className={styles.menu}>
      <Section title={t('menu.annotate.measureAnnotate', 'Measure & annotate')} cols={4}>
        <ToolGrid tools={ANNOTATE_TOOLS} onPick={onPick} />
      </Section>
      <Section title={t('menu.annotate.drafting', 'Drafting symbols & review')} cols={4}>
        <ToolGrid tools={DRAFTING_TOOLS} onPick={onPick} />
        <AnnotateExtras onPick={onPick} />
      </Section>
    </div>
  )
}

export function ModifyMenu({ onPick }: { onPick?(): void }) {
  const t = useT()
  return (
    <div className={styles.menu}>
      <Section title={t('menu.modify.tools', 'Modify')} cols={4}>
        <ToolGrid tools={MODIFY_TOOLS} onPick={onPick} />
      </Section>
    </div>
  )
}
