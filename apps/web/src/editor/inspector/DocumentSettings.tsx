// Nothing selected → document settings: units, grid, render environment, sun, geo location, schedules.
import { Table2 } from 'lucide-react'
import type { EnvironmentPreset, RenderSettings } from '@cadsandbox/doc'
import { LENGTH_UNITS } from '@cadsandbox/shared'
import { useT } from '../../i18n'
import { AngleField, Button, ColorField, FieldRow, Input, LengthField, NumberField, Select, Slider, Switch } from '../../ui'
import { onMeta, useDocSelector, useEditorCtx } from '../EditorContext'
import { useUiStore } from '../ui-store'
import { ElevationDatumRows } from './ElevationDatumRows'
import { Section } from './fields'
import styles from './inspector.module.css'

const ENVIRONMENTS: EnvironmentPreset[] = ['studio', 'daylight', 'sunset', 'overcast', 'night', 'city', 'custom']

export function DocumentSettings() {
  const t = useT()
  const { doc, readOnly } = useEditorCtx()
  const meta = useDocSelector((d) => d.meta, onMeta)
  const setLeftTab = useUiStore((s) => s.setLeftTab)
  const set = (patch: Partial<typeof meta>) => !readOnly && doc.setMeta(patch)
  const setRender = (patch: Partial<RenderSettings>) => set({ render: { ...meta.render, ...patch } })
  const units = meta.units

  return (
    <>
      <div className={styles.header}>
        <div className={styles.headMain}>
          <span className={styles.typeLabel}>{t('docSettings.kicker', 'Document')}</span>
          <input className={styles.nameInput} value={meta.name} disabled={readOnly} onChange={(e) => set({ name: e.target.value })} aria-label={t('docSettings.name', 'Document name')} />
        </div>
      </div>
      <Section id="units" title={t('docSettings.units', 'Units & precision')}>
        <FieldRow label={t('docSettings.length', 'Length')}>
          <Select size="sm" value={units.length} options={LENGTH_UNITS.map((u) => ({ value: u, label: t(`unit.${u}`, u) }))} disabled={readOnly} onChange={(v) => set({ units: { ...units, length: v } })} />
        </FieldRow>
        <FieldRow label={t('docSettings.precision', 'Decimals')}>
          <NumberField size="sm" value={units.precision} min={0} max={6} step={1} precision={0} disabled={readOnly} onChange={(v) => set({ units: { ...units, precision: Math.round(v) } })} />
        </FieldRow>
        <FieldRow label={t('docSettings.angle', 'Angles')}>
          <Select size="sm" value={units.angle} options={[{ value: 'deg', label: t('unit.deg', 'Degrees') }, { value: 'rad', label: t('unit.rad', 'Radians') }]} disabled={readOnly} onChange={(v) => set({ units: { ...units, angle: v } })} />
        </FieldRow>
        <FieldRow label={t('docSettings.area', 'Areas')}>
          <Select size="sm" value={units.area} options={[{ value: 'm2', label: 'm²' }, { value: 'ft2', label: 'ft²' }]} disabled={readOnly} onChange={(v) => set({ units: { ...units, area: v } })} />
        </FieldRow>
        <ElevationDatumRows />
      </Section>
      <Section id="grid" title={t('docSettings.grid', 'Grid')}>
        <FieldRow label={t('docSettings.gridSize', 'Major cell')}>
          <LengthField size="sm" unit={units.length} precision={units.precision} value={meta.grid.size} min={0.001} disabled={readOnly} onChange={(v) => set({ grid: { ...meta.grid, size: v } })} />
        </FieldRow>
        <FieldRow label={t('docSettings.gridSub', 'Subdivisions')}>
          <NumberField size="sm" value={meta.grid.subdivisions} min={1} max={100} step={1} precision={0} disabled={readOnly} onChange={(v) => set({ grid: { ...meta.grid, subdivisions: Math.round(v) } })} />
        </FieldRow>
        <FieldRow label={t('docSettings.gridVisible', 'Visible')}>
          <Switch size="sm" checked={meta.grid.visible} disabled={readOnly} onChange={(v) => set({ grid: { ...meta.grid, visible: v } })} />
        </FieldRow>
        <FieldRow label={t('docSettings.gridSnap', 'Snap to grid')}>
          <Switch size="sm" checked={meta.grid.snap} disabled={readOnly} onChange={(v) => set({ grid: { ...meta.grid, snap: v } })} />
        </FieldRow>
      </Section>
      <Section id="render" title={t('docSettings.render', 'Rendering')}>
        <FieldRow label={t('docSettings.environment', 'Environment')}>
          <Select size="sm" value={meta.render.environment} options={ENVIRONMENTS.map((e) => ({ value: e, label: t(`env.${e}`, e.charAt(0).toUpperCase() + e.slice(1)) }))} disabled={readOnly} onChange={(v) => setRender({ environment: v })} />
        </FieldRow>
        <FieldRow label={t('docSettings.envIntensity', 'Light intensity')}>
          <Slider value={meta.render.envIntensity} min={0} max={4} step={0.05} withField disabled={readOnly} onChange={(v) => setRender({ envIntensity: v })} />
        </FieldRow>
        <FieldRow label={t('docSettings.envRotation', 'Env. rotation')}>
          <AngleField size="sm" value={meta.render.envRotation} disabled={readOnly} onChange={(v) => setRender({ envRotation: v })} />
        </FieldRow>
        <FieldRow label={t('docSettings.exposure', 'Exposure')}>
          <Slider value={meta.render.exposure} min={0.1} max={3} step={0.05} withField disabled={readOnly} onChange={(v) => setRender({ exposure: v })} />
        </FieldRow>
        <FieldRow label={t('docSettings.toneMapping', 'Tone mapping')}>
          <Select size="sm" value={meta.render.toneMapping} options={[{ value: 'agx', label: 'AgX' }, { value: 'aces', label: 'ACES' }, { value: 'neutral', label: t('docSettings.neutral', 'Neutral') }]} disabled={readOnly} onChange={(v) => setRender({ toneMapping: v })} />
        </FieldRow>
        <FieldRow label={t('docSettings.background', 'Background')}>
          <Select size="sm" value={meta.render.background} options={[{ value: 'environment', label: t('bg.environment', 'Environment') }, { value: 'color', label: t('bg.color', 'Color') }, { value: 'gradient', label: t('bg.gradient', 'Gradient') }, { value: 'transparent', label: t('bg.transparent', 'Transparent') }]} disabled={readOnly} onChange={(v) => setRender({ background: v })} />
        </FieldRow>
        {(meta.render.background === 'color' || meta.render.background === 'gradient') && (
          <FieldRow label={t('docSettings.bgColor', 'Color')}>
            <ColorField size="sm" value={meta.render.backgroundColor} disabled={readOnly} onChange={(v) => v && setRender({ backgroundColor: v })} aria-label={t('docSettings.background', 'Background')} />
          </FieldRow>
        )}
        <FieldRow label={t('docSettings.shadows', 'Shadows')}>
          <Switch size="sm" checked={meta.render.shadows} disabled={readOnly} onChange={(v) => setRender({ shadows: v })} />
        </FieldRow>
        <FieldRow label={t('docSettings.ao', 'Ambient occlusion')}>
          <Switch size="sm" checked={meta.render.ambientOcclusion} disabled={readOnly} onChange={(v) => setRender({ ambientOcclusion: v })} />
        </FieldRow>
      </Section>
      <Section id="sun" title={t('docSettings.sun', 'Sun')}>
        <FieldRow label={t('docSettings.sunEnabled', 'Sun light')}>
          <Switch size="sm" checked={meta.render.sun.enabled} disabled={readOnly} onChange={(v) => setRender({ sun: { ...meta.render.sun, enabled: v } })} />
        </FieldRow>
        <FieldRow label={t('docSettings.sunDate', 'Date')}>
          <Input size="sm" type="date" value={meta.render.sun.date} disabled={readOnly} onChange={(e) => setRender({ sun: { ...meta.render.sun, date: e.target.value } })} />
        </FieldRow>
        <FieldRow label={t('docSettings.sunHour', 'Time')}>
          <Slider value={meta.render.sun.hour} min={0} max={24} step={0.25} withField precision={2} unit="h" disabled={readOnly} onChange={(v) => setRender({ sun: { ...meta.render.sun, hour: v } })} />
        </FieldRow>
        <FieldRow label={t('docSettings.sunIntensity', 'Intensity')}>
          <Slider value={meta.render.sun.intensity} min={0} max={10} step={0.1} withField disabled={readOnly} onChange={(v) => setRender({ sun: { ...meta.render.sun, intensity: v } })} />
        </FieldRow>
      </Section>
      <Section id="geo" title={t('docSettings.geo', 'Location')} defaultOpen={false}>
        <FieldRow label={t('docSettings.geoEnabled', 'Geo-located')}>
          <Switch size="sm" checked={!!meta.geo} disabled={readOnly} onChange={(v) => set({ geo: v ? { latitude: 52.52, longitude: 13.405, northAngle: 0, timezone: 'Europe/Berlin' } : null })} />
        </FieldRow>
        {meta.geo && (
          <>
            <FieldRow label={t('docSettings.latitude', 'Latitude')}>
              <NumberField size="sm" value={meta.geo.latitude} min={-90} max={90} step={0.01} precision={5} unit="°" disabled={readOnly} onChange={(v) => set({ geo: { ...meta.geo!, latitude: v } })} />
            </FieldRow>
            <FieldRow label={t('docSettings.longitude', 'Longitude')}>
              <NumberField size="sm" value={meta.geo.longitude} min={-180} max={180} step={0.01} precision={5} unit="°" disabled={readOnly} onChange={(v) => set({ geo: { ...meta.geo!, longitude: v } })} />
            </FieldRow>
            <FieldRow label={t('docSettings.north', 'True north')}>
              <AngleField size="sm" value={meta.geo.northAngle} disabled={readOnly} onChange={(v) => set({ geo: { ...meta.geo!, northAngle: v } })} />
            </FieldRow>
            <FieldRow label={t('docSettings.timezone', 'Time zone')}>
              <Input size="sm" value={meta.geo.timezone ?? ''} placeholder="Europe/Berlin" disabled={readOnly} onChange={(e) => set({ geo: { ...meta.geo!, timezone: e.target.value || undefined } })} />
            </FieldRow>
          </>
        )}
      </Section>
      <Section id="analysis" title={t('docSettings.analysis', 'Analysis')}>
        <Button size="sm" variant="secondary" icon={<Table2 />} onClick={() => setLeftTab('schedules')}>
          {t('docSettings.schedules', 'Schedules & quantities')}
        </Button>
      </Section>
    </>
  )
}
