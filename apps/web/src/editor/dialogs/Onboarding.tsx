// First-run coach marks: spotlight on the mode pill, Library and inspector; persisted once seen.
import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { useT } from '../../i18n'
import { Button, Kbd, cx } from '../../ui'
import { useEditorCtx } from '../EditorContext'
import { usePhone } from '../shell/hooks'
import { useUiStore } from '../ui-store'
import styles from './onboarding.module.css'

const KEY = 'cs.onboarding.v1'

interface Step {
  selector: string | null
  title: string
  body: React.ReactNode
}

export function Onboarding() {
  const t = useT()
  const { readOnly, engineAvailable } = useEditorCtx()
  const phone = usePhone()
  const step = useUiStore((s) => s.onboardingStep)
  const setStep = useUiStore((s) => s.setOnboardingStep)
  const [rect, setRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    if (readOnly || phone) return
    try {
      if (localStorage.getItem(KEY)) return
    } catch {
      return
    }
    const timer = setTimeout(() => setStep(0), 900)
    return () => clearTimeout(timer)
  }, [readOnly, phone, setStep])

  const steps = useMemo<Step[]>(
    () => [
    { selector: '[data-mode="add"]', title: t('onboarding.add.title', 'Add anything in one click'), body: t('onboarding.add.body', 'Simple forms, 3D objects, lights — pick one and click on the canvas to place it. Drag to size, type a number for precision.') },
    { selector: '[data-mode="build"]', title: t('onboarding.build.title', 'Build like an architect'), body: t('onboarding.build.body', 'Walls join automatically, doors and windows snap into them, rooms compute their DIN 277 areas. Every level gets a plan view.') },
    { selector: '[aria-label="' + t('panel.library', 'Library') + '"]', title: t('onboarding.library.title', 'Drag from the Library'), body: t('onboarding.library.body', 'Furniture, materials and your own collections drop straight onto the canvas — materials onto objects.') },
    { selector: null, title: t('onboarding.palette.title', 'Everything is a keystroke away'), body: <span>{t('onboarding.palette.body', 'Press')} <Kbd shortcut="Mod+K" /> {t('onboarding.palette.body2', 'for the command palette and')} <Kbd shortcut="?" /> {t('onboarding.palette.body3', 'for all shortcuts.')}</span> },
    ],
    [t],
  )
  const current = step !== null ? steps[step] : undefined
  const selector = current?.selector ?? null

  useLayoutEffect(() => {
    if (step === null) return void setRect(null)
    const same = (a: DOMRect | null, b: DOMRect | null) => (!a && !b) || (!!a && !!b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height)
    const measure = () => {
      const el = selector ? document.querySelector(selector) : null
      const r = el ? el.getBoundingClientRect() : null
      setRect((prev) => (same(prev, r) ? prev : r))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [step, selector])

  if (step === null || !current) return null
  const finish = () => {
    try {
      localStorage.setItem(KEY, '1')
    } catch {
      /* ignore */
    }
    setStep(null)
  }
  const pad = 8
  const cardStyle: React.CSSProperties = rect
    ? { left: Math.min(Math.max(16, rect.left + rect.width / 2 - 180), window.innerWidth - 376), top: rect.bottom + 18 }
    : { left: '50%', top: '50%', translate: '-50% -50%' }

  return (
    <div className={styles.scrim} role="dialog" aria-modal="false" aria-label={current.title}>
      {rect ? <div className={styles.spot} style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} /> : <div className={styles.spot} style={{ left: '50%', top: '50%', width: 0, height: 0, boxShadow: '0 0 0 9999px var(--cs-scrim)' }} />}
      <div className={styles.card} style={cardStyle}>
        <div className={styles.step}>
          {t('onboarding.step', 'Tip {n} of {total}', { n: step + 1, total: steps.length })}
          {!engineAvailable && step === 0 ? ` · ${t('onboarding.engineUnavailable', '3D view unavailable')}` : ''}
        </div>
        <div className={styles.title}>{current.title}</div>
        <div className={styles.body}>{current.body}</div>
        <div className={styles.actions}>
          <span className={styles.dots}>
            {steps.map((_, i) => (
              <span key={i} className={cx(styles.dot, i === step && styles.dotActive)} />
            ))}
          </span>
          <span style={{ display: 'inline-flex', gap: 6 }}>
            <Button variant="ghost" size="sm" onClick={finish}>
              {t('onboarding.skip', 'Skip')}
            </Button>
            <Button variant="primary" size="sm" onClick={() => (step + 1 < steps.length ? setStep(step + 1) : finish())}>
              {step + 1 < steps.length ? t('onboarding.next', 'Next') : t('onboarding.done', 'Start designing')}
            </Button>
          </span>
        </div>
      </div>
    </div>
  )
}
