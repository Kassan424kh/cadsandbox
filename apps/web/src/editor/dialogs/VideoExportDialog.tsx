// "Export video": turntable orbit around the current target or a walkthrough through the saved views,
// recorded from the live viewport with MediaRecorder → WebM download.
import { useState } from 'react'
import { recordVideo, videoMimeType } from '@cadsandbox/render'
import { useT } from '../../i18n'
import { Button, Dialog, DialogContent, FieldRow, NumberField, Progress, Select, downloadBlob, toast } from '../../ui'
import { onViews, useDocSelector, useEditorCtx } from '../EditorContext'
import { usePresentationStore } from '../presentation-store'

export function VideoExportDialog() {
  const t = useT()
  const { editor, doc } = useEditorCtx()
  const open = usePresentationStore((s) => s.videoDialog)
  const close = usePresentationStore((s) => s.closeVideoDialog)
  const views = useDocSelector((d) => d.listViews(), onViews)
  const [kind, setKind] = useState<'turntable' | 'walkthrough'>('turntable')
  const [duration, setDuration] = useState(10)
  const [fps, setFps] = useState(30)
  const [turns, setTurns] = useState(1)
  const [progress, setProgress] = useState<number | null>(null)
  const supported = videoMimeType() !== null

  const record = async () => {
    setProgress(0)
    try {
      const blob = await recordVideo(editor, { kind, durationS: duration, fps, turns, views, onProgress: setProgress })
      const base = doc.meta.name.replace(/[^\w\-. ]+/g, '_') || 'design'
      downloadBlob(blob, `${base}-${kind}.webm`)
      toast.success(t('video.done', 'Video saved'))
      close()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setProgress(null)
    }
  }

  const busy = progress !== null
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && close()}>
      <DialogContent
        title={t('video.title', 'Export video')}
        description={t('video.desc', 'Records the active viewport while the camera moves: a turntable around the view target or a walkthrough along your saved views (WebM).')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={busy}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button variant="primary" onClick={() => void record()} loading={busy} disabled={!supported || (kind === 'walkthrough' && views.length < 2)}>
              {t('video.record', 'Record')}
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {!supported && <div style={{ color: 'var(--cs-text-3)' }}>{t('video.unsupported', 'This browser cannot record video (MediaRecorder / canvas capture missing).')}</div>}
          <FieldRow label={t('video.path', 'Camera path')}>
            <Select
              value={kind}
              onChange={(v) => setKind(v as 'turntable' | 'walkthrough')}
              options={[
                { value: 'turntable', label: t('video.turntable', 'Turntable (orbit)') },
                { value: 'walkthrough', label: t('video.walkthrough', 'Walkthrough (saved views)') },
              ]}
              aria-label={t('video.path', 'Camera path')}
            />
          </FieldRow>
          {kind === 'walkthrough' && (
            <div style={{ color: 'var(--cs-text-3)', fontSize: 12 }}>{views.length < 2 ? t('video.needViews', 'Save at least two views in the Views panel to record a walkthrough.') : t('video.viewCount', 'Through {n} saved views in order', { n: views.length })}</div>
          )}
          <FieldRow label={t('video.duration', 'Duration (s)')}>
            <NumberField value={duration} min={1} max={120} precision={0} onChange={setDuration} aria-label={t('video.duration', 'Duration (s)')} />
          </FieldRow>
          <FieldRow label={t('video.fps', 'Frames / s')}>
            <NumberField value={fps} min={10} max={60} precision={0} onChange={setFps} aria-label={t('video.fps', 'Frames / s')} />
          </FieldRow>
          {kind === 'turntable' && (
            <FieldRow label={t('video.turns', 'Revolutions')}>
              <NumberField value={turns} min={0.25} max={10} precision={2} onChange={setTurns} aria-label={t('video.turns', 'Revolutions')} />
            </FieldRow>
          )}
          {busy && <Progress value={progress ?? 0} label={t('video.recording', 'Recording… keep this tab visible')} />}
        </div>
      </DialogContent>
    </Dialog>
  )
}
