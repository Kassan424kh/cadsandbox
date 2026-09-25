// Presentation menu (bottom-right pill): sun-study animation (play/stop + speed), video export
// (turntable / walkthrough) and "View in VR" (only when WebXR reports immersive-vr support).
import { useEffect, useState } from 'react'
import { Clapperboard, Glasses, Pause, Play, Sun, Video } from 'lucide-react'
import { startSunStudy, startVr, vrSupported } from '@cadsandbox/render'
import { useT } from '../../i18n'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, ToolButton, toast } from '../../ui'
import { useEditorCtx } from '../EditorContext'
import { usePresentationStore } from '../presentation-store'

const SPEEDS = [0.5, 1.5, 3, 6]

export function PresentationMenu({ compact }: { compact: boolean }) {
  const t = useT()
  const { editor } = useEditorCtx()
  const sunStudy = usePresentationStore((s) => s.sunStudy)
  const setSunStudy = usePresentationStore((s) => s.setSunStudy)
  const sunSpeed = usePresentationStore((s) => s.sunSpeed)
  const setSunSpeed = usePresentationStore((s) => s.setSunSpeed)
  const openVideo = usePresentationStore((s) => s.openVideoDialog)
  const [vr, setVr] = useState(false)
  const [inVr, setInVr] = useState(false)

  useEffect(() => {
    let alive = true
    void vrSupported().then((ok) => alive && setVr(ok))
    return () => {
      alive = false
    }
  }, [])
  // stop the animation when the editor goes away
  useEffect(() => () => sunStudy?.stop(), [sunStudy])

  const toggleSun = () => {
    if (sunStudy) {
      sunStudy.stop()
      setSunStudy(null)
      return
    }
    // A local render override (Editor.setSunOverride) — nothing is written to the shared document,
    // so viewers and commenters can play it too.
    const study = startSunStudy(editor, { hoursPerSecond: sunSpeed })
    setSunStudy(study)
  }

  const viewInVr = async () => {
    try {
      setInVr(true)
      const session = await startVr(editor)
      session.session.addEventListener('end', () => setInVr(false), { once: true })
    } catch (err) {
      setInVr(false)
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ToolButton icon={<Clapperboard />} label={t('present.menu', 'Present')} showLabel={!compact} hasMenu active={!!sunStudy} tooltip={t('present.menuTip', 'Sun study, video export, VR')} tooltipSide="top" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t('present.sunStudy', 'Sun study')}</DropdownMenuLabel>
        <DropdownMenuItem icon={sunStudy ? <Pause /> : <Play />} onSelect={toggleSun}>
          {sunStudy ? t('present.sunStop', 'Stop animation') : t('present.sunPlay', 'Play the sun over the day')}
        </DropdownMenuItem>
        {SPEEDS.map((s) => (
          <DropdownMenuItem key={s} icon={<Sun style={{ opacity: sunSpeed === s ? 1 : 0.35 }} />} hint={sunSpeed === s ? '●' : undefined} onSelect={() => setSunSpeed(s)}>
            {t('present.sunSpeed', '{h} h per second', { h: s })}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={<Video />} onSelect={openVideo} hint="WebM">
          {t('present.video', 'Export video (turntable / walkthrough)…')}
        </DropdownMenuItem>
        {vr && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem icon={<Glasses />} disabled={inVr} onSelect={() => void viewInVr()}>
              {inVr ? t('present.vrActive', 'VR session running…') : t('present.vr', 'View in VR')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
