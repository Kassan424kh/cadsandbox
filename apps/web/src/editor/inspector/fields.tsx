// Inspector building blocks: collapsible Section, Vec2/Vec3 length fields, wall layers editor.
import { useState, type ReactNode } from 'react'
import { ChevronRight, Plus, Trash } from 'lucide-react'
import type { WallLayer, WallLayerFunction } from '@cadsandbox/doc'
import type { LengthUnit } from '@cadsandbox/shared'
import { useT } from '../../i18n'
import { Button, IconButton, LengthField, Select, cx, useLocalStorage } from '../../ui'
import { MaterialPicker } from './MaterialPicker'
import styles from './inspector.module.css'

export function Section({ id, title, actions, defaultOpen = true, children }: { id: string; title: ReactNode; actions?: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useLocalStorage<boolean>(`cs.inspector.${id}`, defaultOpen)
  return (
    <div className={cx(styles.section, open && styles.sectionOpen)}>
      <button type="button" className={styles.sectionHead} onClick={() => setOpen(!open)} aria-expanded={open}>
        <ChevronRight className="chev" style={{ transform: open ? 'rotate(90deg)' : undefined }} />
        <span className={styles.sectionTitle}>{title}</span>
        {actions && (
          <span className={styles.sectionActions} onClick={(e) => e.stopPropagation()}>
            {actions}
          </span>
        )}
      </button>
      {open && <div className={styles.sectionBody}>{children}</div>}
    </div>
  )
}

/** Per-axis value; `null` (or a null component) = mixed across a multi-selection. */
export type VecValue = readonly (number | null)[] | null

interface VecProps {
  value: VecValue
  /** `axis` = the edited component. Mixed components in `next` are 0, so multi-selection callers
   *  must patch only `next[axis]` per node (never write the whole vector). */
  onChange(next: number[], axis: number): void
  unit: LengthUnit
  precision?: number
  disabled?: boolean
  min?: number
  onScrubStart?(): void
  onScrubEnd?(): void
  labels?: string[]
  /** Accessible name prefix, e.g. "Start" → "Start X". */
  name?: string
}

/** Common value per component across `vectors` (null where they differ). */
export function commonVec(vectors: readonly (readonly number[] | undefined)[], size: number): (number | null)[] {
  const first = vectors[0]
  return Array.from({ length: size }, (_, i) => {
    const v = first?.[i]
    return v !== undefined && vectors.every((x) => x !== undefined && Math.abs((x[i] ?? NaN) - v) < 1e-9) ? v : null
  })
}

function VecField({ value, onChange, unit, precision, disabled, min, onScrubStart, onScrubEnd, labels, name }: VecProps & { labels: string[] }) {
  const axes = (['x', 'y', 'z'] as const).slice(0, labels.length)
  return (
    <div className={cx(styles.vec, labels.length === 2 && styles.vec2)}>
      {axes.map((axis, i) => (
        <LengthField
          key={axis}
          size="sm"
          unit={unit}
          precision={precision}
          prefix={labels[i]}
          axis={axis}
          min={min}
          showUnit={false}
          value={value?.[i] ?? null}
          disabled={disabled}
          onScrubStart={onScrubStart}
          onScrubEnd={onScrubEnd}
          onChange={(v) => {
            const next = labels.map((_, j) => value?.[j] ?? 0)
            next[i] = v
            onChange(next, i)
          }}
          aria-label={name ? `${name} ${labels[i]}` : labels[i]}
        />
      ))}
    </div>
  )
}

export function Vec3Field({ labels = ['X', 'Y', 'Z'], ...props }: VecProps) {
  return <VecField {...props} labels={labels} />
}

export function Vec2Field({ labels = ['X', 'Y'], ...props }: VecProps) {
  return <VecField {...props} labels={labels} />
}

const FUNCTIONS: WallLayerFunction[] = ['structure', 'insulation', 'finish', 'membrane', 'air']

export function WallLayersEditor({ value, onChange, unit, precision, disabled, thickness }: { value: WallLayer[] | undefined; onChange(v: WallLayer[] | undefined): void; unit: LengthUnit; precision?: number; disabled?: boolean; thickness: number }) {
  const t = useT()
  const layers = value ?? []
  const total = layers.reduce((s, l) => s + l.thickness, 0)
  const [confirmClear, setConfirmClear] = useState(false)
  const set = (i: number, patch: Partial<WallLayer>) => onChange(layers.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const fnLabel: Record<WallLayerFunction, string> = {
    structure: t('wallLayer.structure', 'Structure'),
    insulation: t('wallLayer.insulation', 'Insulation'),
    finish: t('wallLayer.finish', 'Finish'),
    membrane: t('wallLayer.membrane', 'Membrane'),
    air: t('wallLayer.air', 'Air gap'),
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {layers.length === 0 && <div className={styles.summary}>{t('wallLayer.none', 'Single-layer wall. Add layers for a multi-layer build-up.')}</div>}
      {layers.map((l, i) => (
        <div key={i} className={styles.layerRow}>
          <MaterialPicker value={l.material} onChange={(m) => set(i, { material: m })} disabled={disabled} size="sm" />
          <LengthField size="sm" unit={unit} precision={precision} value={l.thickness} min={0.001} disabled={disabled} onChange={(v) => set(i, { thickness: v })} aria-label={t('wallLayer.thickness', 'Layer thickness')} />
          <Select size="sm" value={l.function} options={FUNCTIONS.map((f) => ({ value: f, label: fnLabel[f] }))} onChange={(f) => set(i, { function: f })} disabled={disabled} aria-label={t('wallLayer.function', 'Function')} />
          <IconButton size="sm" label={t('common.remove', 'Remove')} icon={<Trash />} disabled={disabled} onClick={() => onChange(layers.length === 1 ? undefined : layers.filter((_, j) => j !== i))} />
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span className={styles.qLabel} style={{ fontSize: 'var(--cs-text-xs)', color: layers.length && Math.abs(total - thickness) > 1e-6 ? 'var(--cs-warning)' : undefined }}>
          {layers.length ? t('wallLayer.total', 'Layers {total} of {thickness}', { total: `${(total * 1000).toFixed(0)} mm`, thickness: `${(thickness * 1000).toFixed(0)} mm` }) : ''}
        </span>
        <span style={{ display: 'inline-flex', gap: 4 }}>
          {layers.length > 0 && (
            <Button size="sm" variant="ghost" disabled={disabled} onClick={() => (confirmClear ? (onChange(undefined), setConfirmClear(false)) : setConfirmClear(true))}>
              {confirmClear ? t('wallLayer.confirmClear', 'Really clear?') : t('wallLayer.clear', 'Clear')}
            </Button>
          )}
          <Button size="sm" variant="secondary" icon={<Plus />} disabled={disabled} onClick={() => onChange([...layers, { material: layers.length ? 'mat-insulation' : 'mat-masonry-ks', thickness: layers.length ? Math.max(0.01, thickness - total) : thickness, function: layers.length ? 'insulation' : 'structure' }])}>
            {t('wallLayer.add', 'Add layer')}
          </Button>
        </span>
      </div>
    </div>
  )
}
