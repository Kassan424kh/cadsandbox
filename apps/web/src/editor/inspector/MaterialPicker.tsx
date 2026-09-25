// Material picker: swatch trigger + popover grid of built-in and document materials, with
// create / edit / duplicate entry points into the material editor dialog.
import { useMemo, useState } from 'react'
import { PenLine, Plus, Search } from 'lucide-react'
import { BUILTIN_MATERIALS, TYPE_DEFAULT_MATERIAL, type MaterialDef, type NodeType } from '@cadsandbox/doc'
import { useT } from '../../i18n'
import { Button, Input, Popover, PopoverContent, PopoverTrigger, Tooltip, cx } from '../../ui'
import { onMaterials, useDocSelector, useEditorCtx } from '../EditorContext'
import { useUiStore } from '../ui-store'
import styles from './inspector.module.css'

export interface MaterialPickerProps {
  /** material id or null (= type default) */
  value: string | null | undefined
  onChange(id: string | null): void
  /** Node type for the "default" label */
  nodeType?: NodeType
  mixed?: boolean
  disabled?: boolean
  size?: 'sm' | 'md'
  allowDefault?: boolean
}

/** Built-in material names follow the UI language (`material.name.<id>`); document materials keep
 *  the name their author gave them. */
export function materialName(m: MaterialDef, t: (key: string, fallback: string) => string): string {
  return m.builtin ? t(`material.name.${m.id}`, m.name) : m.name
}

export function MaterialSwatch({ m, size = 20, className }: { m: MaterialDef | undefined; size?: number; className?: string }) {
  const bg = m ? (m.emissive && (m.emissiveIntensity ?? 0) > 0 ? m.emissive : m.color) : 'transparent'
  const style: React.CSSProperties = { width: size, height: size, background: bg, opacity: m && m.transmission > 0.5 ? 0.55 : 1 }
  if (m && m.metalness > 0.5) style.backgroundImage = `linear-gradient(135deg, rgba(255,255,255,0.5), transparent 40%, rgba(0,0,0,0.25))`
  return <span className={cx(styles.matSwatch, className)} style={style} />
}

export function MaterialPicker({ value, onChange, nodeType, mixed, disabled, size = 'md', allowDefault = true }: MaterialPickerProps) {
  const t = useT()
  const { doc, readOnly } = useEditorCtx()
  const openDialog = useUiStore((s) => s.openDialog)
  const docMaterials = useDocSelector((d) => d.docMaterials(), onMaterials)
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const current = value ? doc.getMaterial(value) : undefined
  const defaultId = nodeType ? TYPE_DEFAULT_MATERIAL[nodeType] : undefined
  const defaultMat = defaultId ? doc.getMaterial(defaultId) : undefined
  const groups = useMemo(() => {
    const map = new Map<string, MaterialDef[]>()
    const query = q.trim().toLowerCase()
    const push = (key: string, m: MaterialDef) => {
      if (query && !`${materialName(m, t)} ${m.name} ${m.category}`.toLowerCase().includes(query)) return
      map.set(key, [...(map.get(key) ?? []), m])
    }
    for (const m of docMaterials) push(t('material.documentMaterials', 'This document'), m)
    for (const m of BUILTIN_MATERIALS) push(t(`material.category.${m.category}`, m.category.charAt(0).toUpperCase() + m.category.slice(1)), m)
    return map
  }, [docMaterials, q, t])

  const label = mixed ? t('common.mixed', 'Mixed') : current ? materialName(current, t) : defaultMat ? t('material.defaultNamed', 'Default · {name}', { name: materialName(defaultMat, t) }) : t('material.default', 'Default')
  const pick = (id: string | null) => {
    onChange(id)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={styles.matTrigger} disabled={disabled} style={size === 'sm' ? { height: 'var(--cs-control-h-sm)', fontSize: 'var(--cs-text-xs)' } : undefined} aria-label={t('material.pick', 'Material: {name}', { name: label })}>
          <MaterialSwatch m={current ?? defaultMat} size={size === 'sm' ? 16 : 20} />
          <span className={styles.matName} style={mixed ? { color: 'var(--cs-text-3)', fontStyle: 'italic' } : undefined}>
            {label}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" style={{ width: 340, maxHeight: 460, display: 'flex', flexDirection: 'column' }}>
        <Input size="sm" prefix={<Search />} placeholder={t('material.search', 'Search materials…')} value={q} onChange={(e) => setQ(e.target.value)} autoFocus aria-label={t('material.search', 'Search materials…')} />
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', marginTop: 6 }}>
          {allowDefault && !q && (
            <button type="button" className={cx(styles.matCell, !value && !mixed && styles.matCellActive)} style={{ width: '100%', flexDirection: 'row', justifyContent: 'flex-start', gap: 8, padding: '6px 8px', fontSize: 'var(--cs-text-sm)' }} onClick={() => pick(null)}>
              <MaterialSwatch m={defaultMat} size={20} />
              <span>{defaultMat ? t('material.useDefault', 'Type default ({name})', { name: materialName(defaultMat, t) }) : t('material.useDefaultGeneric', 'Type default')}</span>
            </button>
          )}
          {[...groups.entries()].map(([group, list]) => (
            <div key={group}>
              <div className={styles.matGroup}>{group}</div>
              <div className={styles.matGrid}>
                {list.map((m) => (
                  <Tooltip key={m.id} content={materialName(m, t)}>
                    <button
                      type="button"
                      className={cx(styles.matCell, value === m.id && styles.matCellActive)}
                      onClick={() => pick(m.id)}
                      onDoubleClick={() => {
                        if (readOnly) return
                        setOpen(false)
                        openDialog('materialEditor', { materialId: m.id })
                      }}
                    >
                      <MaterialSwatch m={m} size={28} />
                      <span className={styles.matCellLabel}>{materialName(m, t)}</span>
                    </button>
                  </Tooltip>
                ))}
              </div>
            </div>
          ))}
        </div>
        {!readOnly && (
          <div className={styles.matFooter}>
            {current && (
              <Button
                size="sm"
                variant="ghost"
                icon={<PenLine />}
                onClick={() => {
                  setOpen(false)
                  openDialog('materialEditor', { materialId: current.id })
                }}
              >
                {current.builtin ? t('material.duplicateEdit', 'Duplicate & edit') : t('material.edit', 'Edit')}
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              icon={<Plus />}
              onClick={() => {
                setOpen(false)
                openDialog('materialEditor', { materialId: null })
              }}
            >
              {t('material.new', 'New material')}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
