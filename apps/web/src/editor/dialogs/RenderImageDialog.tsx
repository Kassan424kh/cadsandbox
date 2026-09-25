// "Render image": size presets, samples (realistic), transparent background → PNG download.
import { useState } from 'react'
import { useT } from '../../i18n'
import { Button, Dialog, DialogContent, FieldRow, NumberField, Progress, Select, Slider, Switch, downloadBlob, toast } from '../../ui'
import { useEditorCtx, useEditorState } from '../EditorContext'
import { useUiStore } from '../ui-store'

const PRESETS = [
  { id: 'hd', w: 1920, h: 1080 },
  { id: 'qhd', w: 2560, h: 1440 },
  { id: '4k', w: 3840, h: 2160 },
  { id: 'square', w: 2048, h: 2048 },
  { id: 'a4', w: 3508, h: 2480 },
  { id: 'custom', w: 0, h: 0 },
]

export function RenderImageDialog() {
  const t = useT()
  const { editor, doc } = useEditorCtx()
  const open = useUiStore((s) => s.dialog === 'renderImage')
  const close = useUiStore((s) => s.closeDialog)
  const viewports = useEditorState((s) => s.viewports)
  const active = useEditorState((s) => s.activeViewport)
  const [preset, setPreset] = useState('hd')
  const [w, setW] = useState(1920)
  const [h, setH] = useState(1080)
  const [samples, setSamples] = useState(128)
  const [realistic, setRealistic] = useState(true)
  const [transparent, setTransparent] = useState(false)
  const [viewport, setViewport] = useState<string>(String(active))
  const [busy, setBusy] = useState(false)

  const pick = (id: string) => {
    setPreset(id)
    const p = PRESETS.find((x) => x.id === id)
    if (p && p.w) {
      setW(p.w)
      setH(p.h)
    }
  }
  const render = async () => {
    setBusy(true)
    try {
      const blob = await editor.screenshot({ width: w, height: h, viewport: Number(viewport), transparent, mime: 'image/png', samples: realistic ? samples : undefined })
      downloadBlob(blob, `${doc.meta.name.replace(/[^\w\-. ]+/g, '_')}-${w}x${h}.png`)
      toast.success(t('renderImage.done', 'Image saved'))
      close()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent
        title={t('renderImage.title', 'Render image')}
        description={t('renderImage.desc', 'Export a high-resolution PNG of a viewport. Realistic mode path-traces until the sample count is reached.')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={busy}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button variant="primary" onClick={() => void render()} loading={busy}>
              {t('renderImage.render', 'Render PNG')}
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <FieldRow label={t('renderImage.viewport', 'Viewport')}>
            <Select value={viewport} onChange={setViewport} options={viewports.map((v) => ({ value: String(v.index), label: v.label }))} aria-label={t('renderImage.viewport', 'Viewport')} />
          </FieldRow>
          <FieldRow label={t('renderImage.size', 'Size')}>
            <Select
              value={preset}
              onChange={pick}
              options={PRESETS.map((p) => ({ value: p.id, label: p.id === 'custom' ? t('renderImage.custom', 'Custom') : `${p.w} × ${p.h}` }))}
              aria-label={t('renderImage.size', 'Size')}
            />
          </FieldRow>
          <FieldRow label={t('renderImage.pixels', 'Pixels')}>
            <NumberField value={w} min={16} max={16384} precision={0} onChange={(v) => (setW(v), setPreset('custom'))} aria-label={t('renderImage.width', 'Width')} />
            <span style={{ color: 'var(--cs-text-3)' }}>×</span>
            <NumberField value={h} min={16} max={16384} precision={0} onChange={(v) => (setH(v), setPreset('custom'))} aria-label={t('renderImage.height', 'Height')} />
          </FieldRow>
          <FieldRow label={t('renderImage.realistic', 'Realistic')}>
            <Switch checked={realistic} onChange={setRealistic} aria-label={t('renderImage.realistic', 'Realistic')} />
          </FieldRow>
          {realistic && (
            <FieldRow label={t('renderImage.samples', 'Samples')} hint={t('renderImage.samplesHint', 'More samples → less noise, longer render.')}>
              <Slider value={samples} min={16} max={2048} step={16} precision={0} withField onChange={setSamples} aria-label={t('renderImage.samples', 'Samples')} />
            </FieldRow>
          )}
          <FieldRow label={t('renderImage.transparent', 'Transparent')}>
            <Switch checked={transparent} onChange={setTransparent} aria-label={t('renderImage.transparent', 'Transparent background')} />
          </FieldRow>
          {busy && <Progress label={t('renderImage.rendering', 'Rendering…')} />}
        </div>
      </DialogContent>
    </Dialog>
  )
}
