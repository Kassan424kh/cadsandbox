// Auth pages layout: brand panel (left) + form (right).
import { Link, Outlet } from 'react-router'
import { Cloud, HardDrive, ShieldCheck, Users } from 'lucide-react'
import { Logo } from '../../ui'
import { useT } from '../../i18n'
import s from './auth.module.css'

export default function AuthLayout() {
  const t = useT()
  return (
    <div className={s.shell}>
      <aside className={s.brandPanel}>
        <Link to="/" aria-label={t('nav.home', 'Home')} style={{ color: 'inherit' }}>
          <Logo size={24} />
        </Link>
        <div className={s.pitch}>
          <h2>{t('auth.pitchTitle', 'CAD and architecture, right in your browser.')}</h2>
          <p>{t('auth.pitchBody', 'Model, draft and document — alone or together in real time. Your designs are computed on your device, not in someone else’s cloud.')}</p>
          <ul className={s.points}>
            <li>
              <HardDrive size={16} /> {t('auth.point.local', 'Works offline — no account required')}
            </li>
            <li>
              <Users size={16} /> {t('auth.point.collab', 'Real-time collaboration and sharing')}
            </li>
            <li>
              <Cloud size={16} /> {t('auth.point.sync', 'Sync across all your devices')}
            </li>
            <li>
              <ShieldCheck size={16} /> {t('auth.point.privacy', 'Hosted in the EU. No tracking, no ads.')}
            </li>
          </ul>
        </div>
        <nav className={s.legalLinks} aria-label={t('legal.nav', 'Legal')}>
          <Link to="/legal/imprint">{t('legal.imprint', 'Imprint')}</Link>
          <Link to="/legal/privacy">{t('legal.privacy', 'Privacy policy')}</Link>
          <Link to="/legal/terms">{t('legal.terms', 'Terms of service')}</Link>
        </nav>
      </aside>
      <main className={s.formSide}>
        <div className={s.card}>
          <Outlet />
        </div>
      </main>
    </div>
  )
}

/** Only allow same-app relative redirects (no open redirects). */
export function safeNext(next: string | null | undefined, fallback = '/'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback
  return next
}

/** 0–4 password strength estimate (length + character variety). */
export function passwordScore(pw: string): number {
  if (!pw) return 0
  let score = 0
  if (pw.length >= 8) score++
  if (pw.length >= 12) score++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++
  return Math.max(1, Math.min(4, score))
}

/** Must match the server (better-auth `minPasswordLength` in apps/server/src/auth/auth.ts, SECURITY.md). */
export const MIN_PASSWORD = 10
