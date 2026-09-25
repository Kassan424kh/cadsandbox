// Create / edit a document material (PBR values, hatch, texture maps via asset upload or procedural).
import { useEffect, useState } from 'react'
import { Upload, X } from 'lucide-react'
import { BUILTIN_MATERIALS, type HatchPattern, type MaterialCategory, type MaterialDef, type ProceduralTextureKind, type TextureRef } from '@cadsandbox/doc'
import { useT } from '../../i18n'
import { Button, ColorField, Dialog, DialogContent, FieldRow, IconButton, Input, NumberField, Select, Slider, Switch, toast } from '../../ui'
import { useEditorCtx } from '../EditorContext'
import { useUiStore } from '../ui-store'
import styles from './inspector.module.css'

const CATEGORIES: MaterialCategory[] = ['generic', 'paint', 'plastic', 'wood', 'stone', 'concrete', 'brick', 'metal', 'glass', 'fabric', 'ceramic', 'ground', 'light', 'custom']
const HATCHES: HatchPattern[] = ['none', 'solid', 'ansi31', 'ansi32', 'ansi37', 'concrete', 'reinforced-concrete', 'brick', 'masonry', 'insulation', 'earth', 'gravel', 'sand', 'wood', 'timber', 'steel', 'glass', 'tiles', 'grass', 'water', 'dots', 'grid']
const PROCEDURAL: ProceduralTextureKind[] = ['wood', 'parquet', 'brick', 'concrete', 'tiles', 'marble', 'stone', 'plaster', 'fabric', 'metal-brushed', 'grass', 'gravel', 'noise', 'checker']
type MapKey = 'color' | 'normal' | 'roughness'

const blank = (name: string): MaterialDef => ({ id: '', name, category: 'custom', color: '#c8c8cc', roughness: 0.5, metalness: 0, opacity: 1, transmission: 0, ior: 1.5, uv: { size: [1, 1], rotation: 0, offset: [0, 0] } })

export function MaterialEditorDialog() {
  const t = useT()
  const { doc, editor, session, readOnly } = useEditorCtx()
  const open = useUiStore((s) => s.dialog === 'materialEditor')
  const materialId = useUiStore((s) => s.editingMaterial)
  const close = useUiStore((s) => s.closeDialog)
  const [m, setM] = useState<MaterialDef>(() => blank(t('material.newName', 'New material')))
  const [isNew, setIsNew] = useState(true)
  const [applyToSelection, setApplyToSelection] = useState(true)
  const [thumbs, setThumbs] = useState<Partial<Record<MapKey, string>>>({})

  useEffect(() => {
    if (!open) return
    const src = materialId ? doc.getMaterial(materialId) ?? BUILTIN_MATERIALS.find((x) => x.id === materialId) : undefined
    if (src) {
      const dup = !!src.builtin
      setM({ ...structuredClone(src), id: dup ? '' : src.id, name: dup ? `${src.name} copy` : src.name, builtin: false })
      setIsNew(dup)
    } else {
      setM(blank(t('material.newName', 'New material')))
      setIsNew(true)
    }
    setThumbs({})
  }, [open, materialId, doc, t])

  useEffect(() => {
    // resolve uploaded texture thumbnails
    const keys: MapKey[] = ['color', 'normal', 'roughness']
    for (const k of keys) {
      const ref = m.maps?.[k]
      if (ref && 'asset' in ref) void session.assets.url(ref.asset).then((u) => u && setThumbs((s) => ({ ...s, [k]: u })))
    }
  }, [m.maps, session])

  const patch = (p: Partial<MaterialDef>) => setM((x) => ({ ...x, ...p }))
  const setMap = (k: MapKey, ref: TextureRef | undefined) =>
    setM((x) => {
      const maps = { ...(x.maps ?? {}) }
      if (ref) maps[k] = ref
      else delete maps[k]
      return { ...x, maps: Object.keys(maps).length ? maps : undefined }
    })
  const upload = (k: MapKey) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = async () => {
      const f = input.files?.[0]
      if (!f) return
      try {
        const hash = await session.assets.put(new Uint8Array(await f.arrayBuffer()), f.type || 'image/png')
        setMap(k, { asset: hash })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      }
    }
    input.click()
  }
  const save = () => {
    if (readOnly) return
    const { id, builtin: _b, ...rest } = m
    let saved = id
    if (isNew || !id) saved = doc.addMaterial({ ...rest, name: m.name.trim() || 'Material' })
    else doc.updateMaterial(id, { ...rest, name: m.name.trim() || 'Material' })
    if (applyToSelection) {
      const sel = editor.getState().selection
      if (sel.length) doc.updateNodes(sel.map((n) => ({ id: n, patch: { material: saved } })))
    }
    toast.success(isNew ? t('material.created', 'Material created') : t('material.saved', 'Material saved'))
    close()
  }

  const mapRow = (k: MapKey, label: string) => {
    const ref = m.maps?.[k]
    return (
      <FieldRow label={label} key={k}>
        <div className={styles.mapRow} style={{ flex: 1 }}>
          {ref && 'asset' in ref && (thumbs[k] ? <img className={styles.mapThumb} src={thumbs[k]} alt="" /> : <span className={styles.mapThumb} />)}
          <Select
            size="sm"
            value={ref ? ('asset' in ref ? 'asset' : ref.procedural.kind) : 'none'}
            options={[{ value: 'none', label: t('common.none', 'None') }, { value: 'asset', label: t('material.uploadedImage', 'Uploaded image') }, ...PROCEDURAL.map((p) => ({ value: p, label: t(`material.procedural.${p}`, p.replace('-', ' ')), group: t('material.proceduralGroup', 'Procedural') }))]}
            onChange={(v) => (v === 'none' ? setMap(k, undefined) : v === 'asset' ? upload(k) : setMap(k, { procedural: { kind: v as ProceduralTextureKind } }))}
            aria-label={label}
          />
          <IconButton size="sm" label={t('material.upload', 'Upload image')} icon={<Upload />} onClick={() => upload(k)} />
          {ref && <IconButton size="sm" label={t('common.clear', 'Clear')} icon={<X />} onClick={() => setMap(k, undefined)} />}
        </div>
      </FieldRow>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent
        title={isNew ? t('material.newTitle', 'New material') : t('material.editTitle', 'Edit material')}
        size="lg"
        footer={
          <>
            <Switch size="sm" checked={applyToSelection} onChange={setApplyToSelection} label={t('material.applySelection', 'Apply to selection')} />
            <span style={{ flex: 1 }} />
            <Button variant="ghost" onClick={close}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button variant="primary" onClick={save} disabled={readOnly}>
              {isNew ? t('common.create', 'Create') : t('common.save', 'Save')}
            </Button>
          </>
        }
      >
        <div className={styles.matEditor}>
          <div>
            <div className={styles.matPreview} style={{ ['--mat-color' as string]: m.emissive && (m.emissiveIntensity ?? 0) > 0 ? m.emissive : m.color, ['--hl' as string]: 0.15 + (1 - m.roughness) * 0.6, opacity: m.transmission > 0.5 ? 0.6 : 1 }} />
            <div style={{ marginTop: 10, fontSize: 'var(--cs-text-xs)', color: 'var(--cs-text-3)' }}>{t('material.previewHint', 'Preview is approximate; the viewport renders the full PBR material.')}</div>
          </div>
          <div className={styles.matForm}>
            <FieldRow label={t('material.name', 'Name')}>
              <Input size="sm" value={m.name} onChange={(e) => patch({ name: e.target.value })} />
            </FieldRow>
            <FieldRow label={t('material.category', 'Category')}>
              <Select size="sm" value={m.category} options={CATEGORIES.map((c) => ({ value: c, label: t(`material.category.${c}`, c.charAt(0).toUpperCase() + c.slice(1)) }))} onChange={(v) => patch({ category: v })} />
            </FieldRow>
            <FieldRow label={t('material.color', 'Base color')}>
              <ColorField size="sm" value={m.color} onChange={(v) => v && patch({ color: v })} />
            </FieldRow>
            <FieldRow label={t('material.roughness', 'Roughness')}>
              <Slider value={m.roughness} min={0} max={1} step={0.01} withField onChange={(v) => patch({ roughness: v })} />
            </FieldRow>
            <FieldRow label={t('material.metalness', 'Metalness')}>
              <Slider value={m.metalness} min={0} max={1} step={0.01} withField onChange={(v) => patch({ metalness: v })} />
            </FieldRow>
            <FieldRow label={t('material.opacity', 'Opacity')}>
              <Slider value={m.opacity} min={0} max={1} step={0.01} withField onChange={(v) => patch({ opacity: v })} />
            </FieldRow>
            <FieldRow label={t('material.transmission', 'Transmission')}>
              <Slider value={m.transmission} min={0} max={1} step={0.01} withField onChange={(v) => patch({ transmission: v })} />
            </FieldRow>
            {m.transmission > 0 && (
              <FieldRow label={t('material.ior', 'IOR')}>
                <NumberField size="sm" value={m.ior} min={1} max={2.5} step={0.01} precision={2} onChange={(v) => patch({ ior: v })} />
              </FieldRow>
            )}
            <FieldRow label={t('material.clearcoat', 'Clearcoat')}>
              <Slider value={m.clearcoat ?? 0} min={0} max={1} step={0.01} withField onChange={(v) => patch({ clearcoat: v })} />
            </FieldRow>
            <FieldRow label={t('material.sheen', 'Sheen')}>
              <Slider value={m.sheen ?? 0} min={0} max={1} step={0.01} withField onChange={(v) => patch({ sheen: v })} />
            </FieldRow>
            <FieldRow label={t('material.emissive', 'Emissive')}>
              <ColorField size="sm" value={m.emissive ?? null} allowClear onChange={(v) => patch({ emissive: v ?? undefined, emissiveIntensity: v ? (m.emissiveIntensity ?? 1) : 0 })} />
              {m.emissive && <NumberField size="sm" value={m.emissiveIntensity ?? 1} min={0} max={100} step={0.5} precision={1} onChange={(v) => patch({ emissiveIntensity: v })} style={{ width: 80 }} aria-label={t('material.emissiveIntensity', 'Emissive intensity')} />}
            </FieldRow>
            <FieldRow label={t('material.doubleSided', 'Double sided')}>
              <Switch size="sm" checked={!!m.doubleSided} onChange={(v) => patch({ doubleSided: v })} />
            </FieldRow>
            <FieldRow label={t('material.hatch', 'Plan hatch')}>
              <Select size="sm" value={m.hatch ?? 'none'} options={HATCHES.map((h) => ({ value: h, label: h }))} onChange={(v) => patch({ hatch: v })} />
            </FieldRow>
            {mapRow('color', t('material.mapColor', 'Color map'))}
            {mapRow('normal', t('material.mapNormal', 'Normal map'))}
            {mapRow('roughness', t('material.mapRoughness', 'Roughness map'))}
            {m.maps && (
              <FieldRow label={t('material.tile', 'Tile size')} hint={t('material.tileHint', 'World-space size of one texture repeat')}>
                <NumberField size="sm" value={m.uv?.size[0] ?? 1} min={0.01} step={0.1} precision={2} unit="m" onChange={(v) => patch({ uv: { size: [v, m.uv?.size[1] ?? v], rotation: m.uv?.rotation ?? 0, offset: m.uv?.offset ?? [0, 0] } })} aria-label={t('material.tileW', 'Tile width')} />
                <NumberField size="sm" value={m.uv?.size[1] ?? 1} min={0.01} step={0.1} precision={2} unit="m" onChange={(v) => patch({ uv: { size: [m.uv?.size[0] ?? v, v], rotation: m.uv?.rotation ?? 0, offset: m.uv?.offset ?? [0, 0] } })} aria-label={t('material.tileH', 'Tile height')} />
              </FieldRow>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
