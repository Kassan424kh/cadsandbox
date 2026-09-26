// Imprint · Privacy · Terms — § 5 DDG wants the imprint reachable from every page. Plain anchors, so
// this also works outside the router (full-page error states).
import { useT } from '../../i18n'
import { cx } from '../../ui'
import s from './components.module.css'

export function LegalLinks({ className }: { className?: string }) {
  const t = useT()
  return (
    <nav className={cx(s.legalLinks, className)} aria-label={t('legal.nav', 'Legal')}>
      <a href="/legal/imprint">{t('legal.imprint', 'Imprint')}</a>
      <a href="/legal/privacy">{t('legal.privacy', 'Privacy policy')}</a>
      <a href="/legal/terms">{t('legal.terms', 'Terms of service')}</a>
    </nav>
  )
}
