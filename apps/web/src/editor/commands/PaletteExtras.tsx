// Command-palette group for the drafting & presentation commands that are not engine commands:
// auto-dimension walls, video export, PDF underlay import, sun study.
import { Command } from 'cmdk'
import { FileText, Play, RulerDimensionLine, Square, Video } from 'lucide-react'
import { startSunStudy } from '@cadsandbox/render'
import { useT } from '../../i18n'
import { useEditorCtx } from '../EditorContext'
import { usePresentationStore } from '../presentation-store'
import { useAutoDimension } from './drafting'
import styles from './palette.module.css'

export function PaletteExtras({ run }: { run: (fn: () => void) => () => void }) {
  const t = useT()
  const { editor } = useEditorCtx()
  const autoDimension = useAutoDimension()
  const openVideo = usePresentationStore((s) => s.openVideoDialog)
  const openPdf = usePresentationStore((s) => s.openPdfImport)
  const sunStudy = usePresentationStore((s) => s.sunStudy)
  const setSunStudy = usePresentationStore((s) => s.setSunStudy)
  const sunSpeed = usePresentationStore((s) => s.sunSpeed)

  const pickPdf = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.pdf,application/pdf'
    input.onchange = () => {
      const f = input.files?.[0]
      if (f) openPdf(f)
    }
    input.click()
  }
  const toggleSun = () => {
    if (sunStudy) {
      sunStudy.stop()
      setSunStudy(null)
    } else setSunStudy(startSunStudy(editor, { hoursPerSecond: sunSpeed }))
  }

  return (
    <Command.Group heading={t('palette.drafting', 'Drafting & presentation')}>
      <Command.Item value="auto dimension walls chain massketten" className={styles.item} onSelect={run(() => autoDimension())}>
        <RulerDimensionLine />
        <span className={styles.itemLabel}>{t('autoDim.command', 'Auto-dimension walls')}</span>
      </Command.Item>
      <Command.Item value="import pdf underlay" className={styles.item} onSelect={run(pickPdf)}>
        <FileText />
        <span className={styles.itemLabel}>{t('pdfImport.command', 'Import PDF underlay…')}</span>
      </Command.Item>
      <Command.Item value="export video turntable walkthrough" className={styles.item} onSelect={run(openVideo)}>
        <Video />
        <span className={styles.itemLabel}>{t('present.video', 'Export video (turntable / walkthrough)…')}</span>
      </Command.Item>
      <Command.Item value="sun study animation" className={styles.item} onSelect={run(toggleSun)}>
        {sunStudy ? <Square /> : <Play />}
        <span className={styles.itemLabel}>{sunStudy ? t('present.sunStop', 'Stop animation') : t('present.sunPlay', 'Play the sun over the day')}</span>
      </Command.Item>
    </Command.Group>
  )
}
