// Right inspector: selection properties (name, transform, type params, appearance, organisation,
// quantities) or document settings when nothing is selected. Resizable; a drawer on narrow screens.
import { useEffect, useMemo, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { QUICK_COLORS, decomposeMatrix, invertMatrix, multiplyMatrices, type AnyNode, type NodeType } from '@cadsandbox/doc'
import { formatAngle, formatArea, formatLength, formatVolume } from '@cadsandbox/shared'
import { useT } from '../../i18n'
import { ColorField, FieldRow, ResizablePanel, RoundButton, ScrollArea, Select, Sheet, SheetContent, Swatches } from '../../ui'
import { onLayers, onNodes, useDocSelector, useEditorCtx, useSelectionNodes, useUnits } from '../EditorContext'
import { useActions } from '../commands/actions'
import { NODE_TYPE_LABELS, nodeIcon, nodeTypeLabel } from '../library/nodeIcons'
import { useUiStore } from '../ui-store'
import { DocumentSettings } from './DocumentSettings'
import { Section } from './fields'
import styles from './inspector.module.css'
import { MaterialPicker } from './MaterialPicker'
import { ParamsForm } from './ParamsForm'
import { quantityInfo, type QuantityKind } from './schema'
import { TransformSection } from './TransformSection'

function Quantities({ nodes }: { nodes: AnyNode[] }) {
  const t = useT()
  const { editor } = useEditorCtx()
  const units = useUnits()
  const [geoVersion, tick] = useState(0)
  useEffect(() => editor.geometry.onUpdate((changed) => nodes.some((n) => changed.has(n.id)) && tick((x) => x + 1)), [editor, nodes])
  // Extensive quantities (length, area, volume, counts) add up over a multi-selection; intensive
  // ones (height, thickness, riser height, scale …) keep their [min, max] range instead.
  const totals = useMemo(() => {
    const acc = new Map<string, { sum: number; min: number; max: number; n: number }>()
    for (const n of nodes) {
      const q = editor.geometry.get(n.id)?.quantities
      if (!q) continue
      for (const [k, v] of Object.entries(q)) {
        if (!Number.isFinite(v)) continue
        const a = acc.get(k) ?? { sum: 0, min: Infinity, max: -Infinity, n: 0 }
        acc.set(k, { sum: a.sum + v, min: Math.min(a.min, v), max: Math.max(a.max, v), n: a.n + 1 })
      }
    }
    return acc.size ? acc : null
    // geoVersion: re-read results when the geometry service finishes (async, after the doc change)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, editor, geoVersion])
  if (!totals) return <div className={styles.summary}>{t('inspector.noQuantities', 'Quantities appear once geometry is evaluated.')}</div>
  // A dimension's measured value is an angle for angular dimensions.
  const angularValue = nodes.every((n) => n.type === 'dimension' && n.params.kind === 'angular')
  const fmt = (kind: QuantityKind, v: number) => {
    if (kind === 'length') return formatLength(v, units.length, units.precision)
    if (kind === 'area') return formatArea(v, units.area)
    if (kind === 'volume') return formatVolume(v)
    if (kind === 'angle') return formatAngle(v, units.angle)
    if (kind === 'deg') return `${Math.round(v * 10) / 10}°`
    if (kind === 'scale') return `1:${Math.round(v)}`
    if (kind === 'count') return String(Math.round(v))
    return String(Math.round(v * 1000) / 1000)
  }
  const rows = [...totals.entries()].flatMap(([k, a]) => {
    const info = quantityInfo(k)
    const kind: QuantityKind = k === 'value' && angularValue ? 'angle' : info.kind
    if (kind === 'hidden') return []
    const value = info.agg === 'sum' ? fmt(kind, a.sum) : fmt(kind, a.min) === fmt(kind, a.max) ? fmt(kind, a.min) : `${fmt(kind, a.min)} – ${fmt(kind, a.max)}`
    return [{ k, label: t(`quantity.${k.startsWith('segment') && info.vars ? 'segment' : k}`, info.label, info.vars), value }]
  })
  return (
    <div className={styles.quantities}>
      {rows.map((r) => (
        <div key={r.k} style={{ display: 'contents' }}>
          <span className={styles.qLabel}>{r.label}</span>
          <span className={styles.qValue}>{r.value}</span>
        </div>
      ))}
    </div>
  )
}

function SelectionInspector({ nodes }: { nodes: AnyNode[] }) {
  const t = useT()
  const { doc, readOnly } = useEditorCtx()
  const actions = useActions()
  const layers = useDocSelector((d) => d.listLayers(), onLayers)
  const levels = useDocSelector((d) => d.levels(), onNodes)
  const first = nodes[0]!
  const types = [...new Set(nodes.map((n) => n.type))]
  const single = types.length === 1 ? (types[0] as NodeType) : null
  const sameName = nodes.every((n) => n.name === first.name)
  const color = nodes.every((n) => (n.color ?? null) === (first.color ?? null)) ? first.color ?? null : null
  const colorMixed = !nodes.every((n) => (n.color ?? null) === (first.color ?? null))
  const material = nodes.every((n) => n.material === first.material) ? first.material : null
  const materialMixed = !nodes.every((n) => n.material === first.material)
  const layer = nodes.every((n) => (n.layer ?? 'layer-0') === (first.layer ?? 'layer-0')) ? first.layer ?? 'layer-0' : null
  const levelIds = nodes.map((n) => doc.getLevelOf(n.id))
  const level = levelIds.every((l) => l === levelIds[0]) ? levelIds[0] : null
  const isLevel = types.length === 1 && types[0] === 'level'
  const showAppearance = !isLevel && !nodes.some((n) => n.type === 'group' || n.type === 'section' || n.type === 'light' || n.type === 'dimension')

  return (
    <>
      <div className={styles.header}>
        <span className={styles.typeIcon}>{nodeIcon(first)}</span>
        <div className={styles.headMain}>
          <span className={styles.typeLabel}>{nodes.length === 1 ? nodeTypeLabel(first, t) : t('inspector.multi', '{count} objects · {types}', { count: nodes.length, types: types.map((x) => t(`nodeType.${x}`, NODE_TYPE_LABELS[x as NodeType] ?? x)).join(', ') })}</span>
          <input
            className={styles.nameInput}
            data-inspector-name
            defaultValue={sameName ? first.name : ''}
            key={nodes.map((n) => n.id).join(',')}
            placeholder={sameName ? undefined : t('common.mixed', 'Mixed')}
            disabled={readOnly}
            aria-label={t('inspector.name', 'Name')}
            onBlur={(e) => {
              const v = e.target.value.trim()
              if (v && (!sameName || v !== first.name)) doc.transact(() => nodes.forEach((n) => doc.updateNode(n.id, { name: v })))
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') {
                e.currentTarget.value = sameName ? first.name : ''
                e.currentTarget.blur()
              }
            }}
          />
        </div>
      </div>
      <Section id="transform" title={t('inspector.transform', 'Transform')}>
        <TransformSection nodes={nodes} />
      </Section>
      {single && (
        <Section id={`params-${single}`} title={t('inspector.params', '{type} parameters', { type: nodeTypeLabel(first, t) })}>
          <ParamsForm nodes={nodes} type={single} />
        </Section>
      )}
      {!single && <div className={styles.mixed}>{t('inspector.mixedTypes', 'Select objects of one type to edit their parameters together.')}</div>}
      {showAppearance && (
        <Section id="appearance" title={t('inspector.appearance', 'Appearance')}>
          <FieldRow label={t('inspector.material', 'Material')}>
            <MaterialPicker value={material} mixed={materialMixed} nodeType={single ?? undefined} disabled={readOnly} onChange={(m) => actions.setMaterial(m, nodes.map((n) => n.id))} />
          </FieldRow>
          <FieldRow label={t('inspector.color', 'Color tint')}>
            <ColorField size="sm" value={color} mixed={colorMixed} allowClear swatches={QUICK_COLORS} disabled={readOnly} onChange={(c) => actions.setColor(c, nodes.map((n) => n.id))} aria-label={t('inspector.color', 'Color tint')} mixedLabel={t('common.mixed', 'Mixed')} noneLabel={t('common.none', 'None')} clearLabel={t('color.clear', 'Remove color override')} />
          </FieldRow>
          <Swatches size="sm" colors={QUICK_COLORS} value={color} disabled={readOnly} onChange={(c) => actions.setColor(c, nodes.map((n) => n.id))} allowNone onNone={() => actions.setColor(null, nodes.map((n) => n.id))} noneLabel={t('color.none', 'No tint')} />
        </Section>
      )}
      {!isLevel && (
        <Section id="organization" title={t('inspector.organization', 'Organisation')} defaultOpen={false}>
          <FieldRow label={t('inspector.layer', 'Layer')}>
            <Select size="sm" value={layer} mixed={layer === null} options={layers.map((l) => ({ value: l.id, label: l.name, icon: <span style={{ width: 10, height: 10, borderRadius: 5, background: l.color, display: 'inline-block' }} /> }))} disabled={readOnly} onChange={(v) => actions.setLayer(v, nodes.map((n) => n.id))} aria-label={t('inspector.layer', 'Layer')} mixedLabel={t('common.mixed', 'Mixed')} />
          </FieldRow>
          {levels.length > 0 && !nodes.some((n) => n.type === 'opening') && (
            <FieldRow label={t('inspector.level', 'Level')}>
              <Select
                size="sm"
                value={level}
                mixed={level === null && levelIds.some((l) => l !== levelIds[0])}
                options={levels.map((l) => ({ value: l.id, label: l.name }))}
                placeholder={t('inspector.noLevel', 'Outside levels')}
                disabled={readOnly}
                onChange={(v) => {
                  if (readOnly) return
                  // Keep each object's placement relative to its storey, so it moves up/down with
                  // the level change (home-storey semantics) instead of hanging at its old height.
                  const ids = doc.topLevel(nodes.map((n) => n.id))
                  const locals = ids.map((id) => decomposeMatrix(multiplyMatrices(invertMatrix(doc.getWorldMatrix(doc.getLevelOf(id))), doc.getWorldMatrix(id))))
                  doc.transact(() => {
                    doc.moveNodes(ids, v, null, false)
                    ids.forEach((id, i) => doc.setTransform(id, locals[i]!))
                  })
                }}
                mixedLabel={t('common.mixed', 'Mixed')}
              />
            </FieldRow>
          )}
          <FieldRow label={t('inspector.id', 'Id')}>
            <span style={{ fontSize: 'var(--cs-text-xs)', color: 'var(--cs-text-3)', fontFamily: 'var(--cs-font-mono)' }}>{nodes.length === 1 ? first.id : '—'}</span>
          </FieldRow>
        </Section>
      )}
      <Section id="quantities" title={t('inspector.quantities', 'Quantities')} defaultOpen={false}>
        <Quantities nodes={nodes} />
      </Section>
    </>
  )
}

export function Inspector({ drawer }: { drawer: boolean }) {
  const t = useT()
  const nodes = useSelectionNodes()
  const open = useUiStore((s) => s.rightOpen)
  const setOpen = useUiStore((s) => s.setRightOpen)
  // Drawer mode opens only on demand (the floating toggle), independent of the docked state.
  const [drawerOpen, setDrawerOpen] = useState(false)
  const body = (
    <div className={styles.inspector} aria-label={t('inspector.title', 'Properties')}>
      <div className={styles.body}>
        <ScrollArea>{nodes.length ? <SelectionInspector nodes={nodes} /> : <DocumentSettings />}</ScrollArea>
      </div>
    </div>
  )
  if (drawer) {
    return (
      <>
        <RoundButton className={styles.floatToggle} size="sm" label={t('inspector.open', 'Properties')} icon={<SlidersHorizontal />} onClick={() => setDrawerOpen(true)} tooltipSide="left" />
        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetContent side="right" width={360} title={nodes.length ? t('inspector.title', 'Properties') : t('docSettings.title', 'Document settings')} flush>
            {body}
          </SheetContent>
        </Sheet>
      </>
    )
  }
  if (!open) return null
  return (
    <aside className={styles.right}>
      <ResizablePanel handle="left" defaultSize={300} min={240} max={520} storageKey="cs.editor.rightWidth" handleLabel={t('editor.resizePanel', 'Resize panel')}>
        {body}
      </ResizablePanel>
    </aside>
  )
}
