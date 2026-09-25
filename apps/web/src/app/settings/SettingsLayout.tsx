// /settings/* — sub-navigation for account settings.
import { Link, Outlet, useLocation } from 'react-router'
import { Palette, Shield, ShieldCheck, User } from 'lucide-react'
import { useT } from '../../i18n'
import l from '../layout/layout.module.css'

export default function SettingsLayout() {
  const t = useT()
  const { pathname } = useLocation()
  const path = pathname.replace(/\/$/, '')
  const items = [
    { to: '/settings/profile', icon: <User size={16} />, label: t('settings.profile', 'Profile'), index: true },
    { to: '/settings/security', icon: <ShieldCheck size={16} />, label: t('settings.security', 'Security') },
    { to: '/settings/appearance', icon: <Palette size={16} />, label: t('settings.appearance', 'Appearance') },
    { to: '/settings/privacy', icon: <Shield size={16} />, label: t('nav.privacy', 'Privacy center') },
  ]
  return (
    <div className={l.subShell}>
      <nav className={l.subNav} aria-label={t('nav.settings', 'Settings')}>
        <div className={l.subNavTitle}>{t('nav.settings', 'Settings')}</div>
        {items.map((it) => (
          <Link key={it.to} to={it.to} className={l.navLink} aria-current={path === it.to || (it.index && path === '/settings') ? 'page' : undefined}>
            {it.icon}
            <span>{it.label}</span>
          </Link>
        ))}
      </nav>
      <div>
        <Outlet />
      </div>
    </div>
  )
}
