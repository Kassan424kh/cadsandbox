// Parameter form generated from NODE_SCHEMAS for one node type (supports multi-selection: mixed values).
import type { AnyNode, NodeType, Vec2, Vec3, WallLayer } from '@cadsandbox/doc'
import { useT } from '../../i18n'
import { AngleField, ColorField, FieldRow, Input, LengthField, NumberField, Select, Switch, Textarea } from '../../ui'
import { useEditorCtx, useUnits } from '../EditorContext'
import { Vec2Field, Vec3Field, WallLayersEditor, commonVec } from './fields'
import { MaterialPicker } from './MaterialPicker'
import styles from './inspector.module.css'
import { NODE_SCHEMAS, type FieldDef } from './schema'

const MIXED = Symbol('mixed')

function common<T>(nodes: AnyNode[], key: string): T | typeof MIXED | undefined {
  let first: unknown
  let seen = false
  for (const n of nodes) {
    const v = (n.params as Record<string, unknown>)[key]
    if (!seen) {
      first = v
      seen = true
    } else if (JSON.stringify(v) !== JSON.stringify(first)) return MIXED
  }
  return first as T
}

export function ParamsForm({ nodes, type }: { nodes: AnyNode[]; type: NodeType }) {
  const t = useT()
  const { doc, readOnly } = useEditorCtx()
  const units = useUnits()
  const schema = NODE_SCHEMAS[type]
  if (schema.length === 0) return <div className={styles.summary}>{t('inspector.noParams', 'No parameters for this type.')}</div>
  const params = nodes[0]!.params as Record<string, unknown>
  const set = (key: string, value: unknown) => {
    if (readOnly) return
    doc.transact(() => {
      for (const n of nodes) doc.setParams(n.id, { [key]: value } as never)
    })
  }
  /** Patch one component of a vector param on every node (multi-selection keeps the other axes). */
  const setAxis = (key: string, axis: number, v: number, size: number) => {
    if (readOnly) return
    doc.transact(() => {
      for (const n of nodes) {
        const cur = (n.params as Record<string, unknown>)[key]
        const next = Array.from({ length: size }, (_, i) => (Array.isArray(cur) && typeof cur[i] === 'number' ? (cur[i] as number) : 0))
        next[axis] = v
        doc.setParams(n.id, { [key]: next } as never)
      }
    })
  }
  const stop = () => doc.stopCapturing()

  return (
    <>
      {schema.map((f: FieldDef) => {
        if (f.when && !f.when(params)) return null
        const raw = common<unknown>(nodes, f.key)
        const mixed = raw === MIXED
        const value = mixed ? undefined : raw
        const label = t(`param.${type}.${f.key}`, f.label)
        const hint = f.hint ? t(`param.${type}.${f.key}.hint`, f.hint) : undefined
        switch (f.kind) {
          case 'length':
            return (
              <FieldRow key={f.key} label={label} hint={hint}>
                <LengthField size="sm" unit={units.length} precision={units.precision} value={mixed ? null : typeof value === 'number' ? value : 0} min={f.min} max={f.max} disabled={readOnly} onScrubStart={stop} onScrubEnd={stop} onChange={(v) => set(f.key, v)} mixedLabel={t('common.mixed', 'Mixed')} aria-label={label} />
              </FieldRow>
            )
          case 'number':
            return (
              <FieldRow key={f.key} label={label} hint={hint}>
                <NumberField size="sm" value={mixed ? null : typeof value === 'number' ? value : 0} min={f.min} max={f.max} step={f.step ?? 0.1} precision={f.precision ?? 2} unit={f.unit} disabled={readOnly} onScrubStart={stop} onScrubEnd={stop} onChange={(v) => set(f.key, v)} mixedLabel={t('common.mixed', 'Mixed')} aria-label={label} />
              </FieldRow>
            )
          case 'angleDeg':
            return (
              <FieldRow key={f.key} label={label} hint={hint}>
                <NumberField size="sm" value={mixed ? null : typeof value === 'number' ? value : 0} min={f.min} max={f.max} step={1} precision={1} unit="°" disabled={readOnly} onChange={(v) => set(f.key, v)} mixedLabel={t('common.mixed', 'Mixed')} aria-label={label} />
              </FieldRow>
            )
          case 'angle':
            return (
              <FieldRow key={f.key} label={label} hint={hint}>
                <AngleField size="sm" value={mixed ? null : typeof value === 'number' ? value : 0} min={f.min} max={f.max} disabled={readOnly} onChange={(v) => set(f.key, v)} mixedLabel={t('common.mixed', 'Mixed')} aria-label={label} />
              </FieldRow>
            )
          case 'boolean':
            return (
              <FieldRow key={f.key} label={label} hint={hint}>
                <Switch size="sm" checked={!!value} disabled={readOnly} onChange={(v) => set(f.key, v)} aria-label={label} />
                {mixed && <span className={styles.qLabel} style={{ fontSize: 'var(--cs-text-xs)' }}>{t('common.mixed', 'Mixed')}</span>}
              </FieldRow>
            )
          case 'select': {
            const options = (typeof f.options === 'function' ? f.options(params) : f.options ?? []).map((o) => ({ value: o.value, label: t(`param.${type}.${f.key}.${o.value}`, o.label) }))
            return (
              <FieldRow key={f.key} label={label} hint={hint}>
                <Select size="sm" value={typeof value === 'string' ? value : null} mixed={mixed} options={options} disabled={readOnly} onChange={(v) => set(f.key, v)} aria-label={label} mixedLabel={t('common.mixed', 'Mixed')} />
              </FieldRow>
            )
          }
          case 'text':
            return (
              <FieldRow key={f.key} label={label} hint={hint}>
                <Input size="sm" value={mixed ? '' : String(value ?? '')} placeholder={mixed ? t('common.mixed', 'Mixed') : undefined} disabled={readOnly} onChange={(e) => set(f.key, e.target.value)} aria-label={label} />
              </FieldRow>
            )
          case 'textarea':
            return (
              <FieldRow key={f.key} label={label} stack hint={hint}>
                <Textarea rows={2} value={mixed ? '' : String(value ?? '')} placeholder={mixed ? t('common.mixed', 'Mixed') : undefined} disabled={readOnly} onChange={(e) => set(f.key, e.target.value)} aria-label={label} />
              </FieldRow>
            )
          case 'color':
            return (
              <FieldRow key={f.key} label={label} hint={hint}>
                <ColorField size="sm" value={typeof value === 'string' ? value : null} mixed={mixed} allowClear disabled={readOnly} onChange={(v) => set(f.key, v)} aria-label={label} mixedLabel={t('common.mixed', 'Mixed')} noneLabel={t('common.none', 'None')} clearLabel={t('common.clear', 'Clear')} />
              </FieldRow>
            )
          case 'material':
            return (
              <FieldRow key={f.key} label={label} hint={hint}>
                <MaterialPicker size="sm" value={typeof value === 'string' ? value : null} mixed={mixed} disabled={readOnly} onChange={(v) => set(f.key, v)} />
              </FieldRow>
            )
          case 'vec2':
            return (
              <FieldRow key={f.key} label={label} hint={hint}>
                <Vec2Field unit={units.length} precision={units.precision} value={commonVec(nodes.map((n) => (n.params as Record<string, unknown>)[f.key] as Vec2 | undefined), 2)} min={-Infinity} disabled={readOnly} onScrubStart={stop} onScrubEnd={stop} onChange={(v, axis) => setAxis(f.key, axis, v[axis]!, 2)} name={label} />
              </FieldRow>
            )
          case 'vec3':
            return (
              <FieldRow key={f.key} label={label} hint={hint}>
                <Vec3Field unit={units.length} precision={units.precision} value={commonVec(nodes.map((n) => (n.params as Record<string, unknown>)[f.key] as Vec3 | undefined), 3)} min={-Infinity} disabled={readOnly} onScrubStart={stop} onScrubEnd={stop} onChange={(v, axis) => setAxis(f.key, axis, v[axis]!, 3)} name={label} />
              </FieldRow>
            )
          case 'points': {
            const arr = Array.isArray(value) ? value : []
            return (
              <FieldRow key={f.key} label={label}>
                <div className={styles.summary} style={{ flex: 1 }}>
                  <span>{mixed ? t('common.mixed', 'Mixed') : t('inspector.pointsSummary', '{count} points', { count: arr.length })}</span>
                  <span style={{ color: 'var(--cs-text-3)' }}>{t('inspector.editOnCanvas', 'Edit on canvas')}</span>
                </div>
              </FieldRow>
            )
          }
          case 'path': {
            const p = value as { contours?: { points: unknown[]; closed: boolean }[] } | undefined
            const n = p?.contours?.reduce((s, c) => s + c.points.length, 0) ?? 0
            return (
              <FieldRow key={f.key} label={label}>
                <div className={styles.summary} style={{ flex: 1 }}>
                  <span>{mixed ? t('common.mixed', 'Mixed') : t('inspector.pathSummary', '{contours} contours · {points} points', { contours: p?.contours?.length ?? 0, points: n })}</span>
                  <span style={{ color: 'var(--cs-text-3)' }}>{t('inspector.editOnCanvas', 'Edit on canvas')}</span>
                </div>
              </FieldRow>
            )
          }
          case 'wallLayers':
            if (nodes.length !== 1) return null
            return (
              <FieldRow key={f.key} label={label} stack>
                <WallLayersEditor unit={units.length} precision={units.precision} value={value as WallLayer[] | undefined} thickness={(params.thickness as number) ?? 0} disabled={readOnly} onChange={(v) => set(f.key, v)} />
              </FieldRow>
            )
          case 'readonly':
            return (
              <FieldRow key={f.key} label={label}>
                <span className={styles.qValue} style={{ fontSize: 'var(--cs-text-xs)', color: 'var(--cs-text-3)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {mixed ? t('common.mixed', 'Mixed') : value ? String(value).slice(0, 18) : '—'}
                </span>
              </FieldRow>
            )
        }
      })}
    </>
  )
}
