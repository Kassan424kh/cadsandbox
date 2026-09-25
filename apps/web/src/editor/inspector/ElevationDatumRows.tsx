// Height-marker settings inside Document settings ▸ Units: show elevations relative to project zero
// (±0.00) or as absolute NN heights with the datum of ±0.00 (meta.units.elevationDisplay / elevationDatum).
import { useT } from '../../i18n'
import { FieldRow, LengthField, Select } from '../../ui'
import { onMeta, useDocSelector, useEditorCtx } from '../EditorContext'

export function ElevationDatumRows() {
  const t = useT()
  const { doc, readOnly } = useEditorCtx()
  const units = useDocSelector((d) => d.meta.units, onMeta)
  const display = units.elevationDisplay ?? 'relative'
  const set = (patch: Partial<typeof units>) => !readOnly && doc.setMeta({ units: { ...units, ...patch } })
  return (
    <>
      <FieldRow label={t('docSettings.levelmarks', 'Height markers')}>
        <Select
          size="sm"
          value={display}
          options={[
            { value: 'relative', label: t('docSettings.levelmarksRelative', 'Relative to ±0.00') },
            { value: 'absolute', label: t('docSettings.levelmarksAbsolute', 'Absolute (NN height)') },
          ]}
          disabled={readOnly}
          onChange={(v) => set({ elevationDisplay: v as 'relative' | 'absolute' })}
        />
      </FieldRow>
      {display === 'absolute' && (
        <FieldRow label={t('docSettings.elevationDatum', 'NN height of ±0.00')} hint={t('docSettings.elevationDatumHint', 'Height above sea level of the project zero')}>
          <LengthField size="sm" unit="m" precision={2} value={units.elevationDatum ?? 0} min={-500} disabled={readOnly} onChange={(v) => set({ elevationDatum: v })} />
        </FieldRow>
      )}
    </>
  )
}
