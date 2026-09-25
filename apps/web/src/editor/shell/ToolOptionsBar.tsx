// Options bar under the top bar — rendered from ToolOptionSpec of the active tool.
import { useT } from '../../i18n'
import { LengthField, NumberField, Select, Switch, cx } from '../../ui'
import { useEditorCtx, useEditorState, useUnits, useDocSelector, onMaterials } from '../EditorContext'
import { TOOL_META, toolOptionSpecs, useToolRegistry } from '../engine/tools'
import { materialName } from '../inspector/MaterialPicker'
import styles from '../editor.module.css'

export function ToolOptionsBar() {
  const t = useT()
  const { editor, doc } = useEditorCtx()
  const tool = useEditorState((s) => s.tool)
  const options = useEditorState((s) => s.toolOptions)
  const registry = useToolRegistry()
  const units = useUnits()
  const materials = useDocSelector((d) => d.listMaterials(), onMaterials)
  const specs = toolOptionSpecs(tool, registry)
  if (specs.length === 0 || tool === 'place') return null
  const meta = TOOL_META[tool]
  const setOpt = (key: string, value: unknown) => editor.setTool(tool, { ...options, [key]: value })

  return (
    <div className={cx(styles.optionsBar)} role="toolbar" aria-label={t('editor.toolOptions', 'Tool options')}>
      <span className={styles.optionTitle}>
        {meta.icon}
        {t(meta.key, meta.fallback)}
      </span>
      {specs.map((s) => {
        const v = options[s.key] ?? s.default
        const label = t(`toolOption.${tool}.${s.key}`, s.label)
        return (
          <label key={s.key} className={styles.option}>
            <span className={styles.optionLabel}>{label}</span>
            {s.kind === 'length' && <LengthField className={styles.optionField} size="sm" unit={units.length} precision={units.precision} value={typeof v === 'number' ? v : 0} min={s.min} max={s.max} onChange={(n) => setOpt(s.key, n)} aria-label={label} />}
            {s.kind === 'number' && <NumberField className={styles.optionField} size="sm" value={typeof v === 'number' ? v : 0} min={s.min} max={s.max} onChange={(n) => setOpt(s.key, n)} aria-label={label} />}
            {s.kind === 'angle' && <NumberField className={styles.optionField} size="sm" value={typeof v === 'number' ? v : 0} min={s.min} max={s.max} unit="°" precision={1} onChange={(n) => setOpt(s.key, n)} aria-label={label} />}
            {s.kind === 'boolean' && <Switch size="sm" checked={!!v} onChange={(b) => setOpt(s.key, b)} aria-label={label} />}
            {s.kind === 'select' && <Select className={styles.optionSelect} size="sm" value={String(v ?? '')} options={(s.options ?? []).map((o) => ({ value: o.value, label: t(`toolOption.${tool}.${s.key}.${o.value}`, o.label) }))} onChange={(val) => setOpt(s.key, val)} aria-label={label} />}
            {s.kind === 'material' && (
              <Select
                className={styles.optionSelect}
                size="sm"
                value={typeof v === 'string' ? v : ''}
                options={materials.map((m) => ({ value: m.id, label: materialName(m, t), icon: <span style={{ width: 12, height: 12, borderRadius: 3, background: m.color, display: 'inline-block' }} /> }))}
                onChange={(val) => setOpt(s.key, val)}
                aria-label={label}
                placeholder={t('material.default', 'Default')}
              />
            )}
          </label>
        )
      })}
      {doc && null}
    </div>
  )
}
