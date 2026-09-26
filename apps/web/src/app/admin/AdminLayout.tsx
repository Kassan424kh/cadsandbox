// /admin/* — staff area (admin + support). Every privileged action is audit-logged server-side.
import { NavLink, Outlet } from 'react-router'
import { Building2, FolderKanban, Gauge, Inbox, Megaphone, Scale, ScrollText, Users } from 'lucide-react'
import { useT } from '../../i18n'
import { useAuth } from '../../data/auth/AuthProvider'
import { RequireStaff } from '../components/Guards'
import l from '../layout/layout.module.css'

export default function AdminLayout() {
  const t = useT()
  const auth = useAuth()
  const items = [
    { to: '/admin', end: true, icon: <Gauge size={16} />, label: t('admin.overview', 'Overview') },
    { to: '/admin/users', icon: <Users size={16} />, label: t('admin.users', 'Users') },
    { to: '/admin/orgs', icon: <Building2 size={16} />, label: t('admin.orgs', 'Organizations') },
    { to: '/admin/projects', icon: <FolderKanban size={16} />, label: t('admin.projects', 'Projects') },
    { to: '/admin/tickets', icon: <Inbox size={16} />, label: t('admin.tickets', 'Support inbox') },
    { to: '/admin/audit', icon: <ScrollText size={16} />, label: t('admin.audit', 'Audit log') },
    ...(auth.isAdmin
      ? [
          { to: '/admin/announcements', icon: <Megaphone size={16} />, label: t('admin.announcements', 'Announcements') },
          { to: '/admin/legal', icon: <Scale size={16} />, label: t('admin.legal', 'Legal details') },
        ]
      : []),
  ]
  return (
    <RequireStaff>
      <div className={l.subShell}>
        <nav className={l.subNav} aria-label={t('nav.admin', 'Admin')}>
          <div className={l.subNavTitle}>{t('nav.admin', 'Admin')}</div>
          {items.map((it) => (
            <NavLink key={it.to} to={it.to} end={it.end} className={l.navLink}>
              {it.icon}
              <span>{it.label}</span>
            </NavLink>
          ))}
        </nav>
        <div style={{ minWidth: 0 }}>
          <Outlet />
        </div>
      </div>
    </RequireStaff>
  )
}
