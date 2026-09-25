// Dashboard sidebar: navigation, organizations, library, account.
import { useState, type ReactNode } from 'react'
import { Link, NavLink } from 'react-router'
import { Building2, FolderKanban, Home, Layers, LifeBuoy, Plus, Settings, ShieldCheck, Star, Trash2, Users } from 'lucide-react'
import { Button, IconButton, Logo, Progress, cx, toast } from '../../ui'
import { formatBytes, useT } from '../../i18n'
import { useAuth } from '../../data/auth/AuthProvider'
import { useServer } from '../../data/online'
import { useProjectActions } from '../../data/queries'
import { userColor } from '../../data/session/user'
import { useDashboardUI } from '../dashboard/store'
import { useProjectDrop } from '../dashboard/dnd'
import { CreateOrgDialog } from '../org/CreateOrgDialog'
import { errorMessage } from '../components/Dialogs'
import { UserMenu } from './UserMenu'
import s from './layout.module.css'
import { LinkButton } from '../components/LinkButton'

function Item({ to, icon, label, end, className }: { to: string; icon: ReactNode; label: string; end?: boolean; className?: string }) {
  return (
    <NavLink to={to} end={end} className={cx(s.navLink, className)}>
      {icon}
      <span>{label}</span>
    </NavLink>
  )
}

/** "All projects" doubles as a drop target that moves a project to the root folder. */
function AllProjectsItem() {
  const t = useT()
  const actions = useProjectActions()
  const { over, dropProps } = useProjectDrop((p) =>
    actions.move.mutate(
      { id: p.id, mode: p.mode, folderId: null },
      { onSuccess: () => toast.success(t('dashboard.movedToRoot', 'Moved to All projects')), onError: (e) => toast.error(errorMessage(e)) },
    ),
  )
  return (
    <div {...dropProps}>
      <Item to="/projects" icon={<FolderKanban size={17} />} label={t('nav.allProjects', 'All projects')} className={over ? s.dropTarget : undefined} />
    </div>
  )
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const t = useT()
  const auth = useAuth()
  const { available } = useServer()
  const openNewProject = useDashboardUI((st) => st.openNewProject)
  const setSupportOpen = useDashboardUI((st) => st.setSupportOpen)
  const [createOrg, setCreateOrg] = useState(false)
  const signedIn = auth.status === 'signed-in'
  const orgs = auth.me?.orgs ?? []
  const storage = auth.me?.storage
  return (
    <aside className={s.sidebar} aria-label={t('nav.label', 'Main navigation')} onClickCapture={(e) => (e.target as HTMLElement).closest('a') && onNavigate?.()}>
      <div className={s.sidebarTop}>
        <Link to="/" className={s.brand} aria-label={t('nav.home', 'Home')}>
          <Logo size={22} />
        </Link>
        <Button variant="primary" icon={<Plus size={16} />} onClick={() => openNewProject()}>
          {t('dashboard.newProject', 'New project')}
        </Button>
      </div>

      <nav className={s.nav}>
        <Item to="/" end icon={<Home size={17} />} label={t('nav.home', 'Home')} />
        <AllProjectsItem />
        <Item to="/shared" icon={<Users size={17} />} label={t('nav.shared', 'Shared with me')} />
        <Item to="/starred" icon={<Star size={17} />} label={t('nav.starred', 'Starred')} />
        <Item to="/trash" icon={<Trash2 size={17} />} label={t('nav.trash', 'Trash')} />

        <div className={s.navSection}>
          <span>{t('nav.library', 'Library')}</span>
        </div>
        <Item to="/collections" icon={<Layers size={17} />} label={t('nav.collections', 'Collections')} />

        {signedIn && (
          <>
            <div className={s.navSection}>
              <span>{t('nav.organizations', 'Organizations')}</span>
              {available !== false && (
                <IconButton size="sm" variant="ghost" label={t('org.createTitle', 'New organization')} icon={<Plus size={14} />} onClick={() => setCreateOrg(true)} />
              )}
            </div>
            {orgs.length === 0 && (
              <button type="button" className={s.navLink} onClick={() => setCreateOrg(true)}>
                <Building2 size={17} />
                <span>{t('org.createShort', 'Create an organization')}</span>
              </button>
            )}
            {orgs.map((o) => (
              <NavLink key={o.id} to={`/org/${o.id}`} className={s.navLink}>
                <span className={s.orgDot} style={{ background: userColor(o.id) }} aria-hidden="true">
                  {o.name.slice(0, 1).toUpperCase()}
                </span>
                <span>{o.name}</span>
              </NavLink>
            ))}
          </>
        )}

        <div className={s.navSection}>
          <span>{t('nav.more', 'More')}</span>
        </div>
        {signedIn ? (
          <Item to="/support" icon={<LifeBuoy size={17} />} label={t('nav.support', 'Support')} />
        ) : (
          <button type="button" className={s.navLink} onClick={() => setSupportOpen(true)}>
            <LifeBuoy size={17} />
            <span>{t('nav.support', 'Support')}</span>
          </button>
        )}
        <Item to="/settings" icon={<Settings size={17} />} label={t('nav.settings', 'Settings')} />
        {auth.isStaff && <Item to="/admin" icon={<ShieldCheck size={17} />} label={t('nav.admin', 'Admin')} />}
      </nav>

      <div className={s.sidebarBottom}>
        {signedIn && storage && storage.quotaBytes > 0 && (
          <div className={s.storage}>
            <Progress value={Math.min(1, storage.usedBytes / storage.quotaBytes)} label={t('nav.storage', 'Storage')} />
            <span>
              {t('nav.storageUsed', '{used} of {quota} used', { used: formatBytes(storage.usedBytes), quota: formatBytes(storage.quotaBytes) })}
            </span>
          </div>
        )}
        {signedIn ? (
          <UserMenu />
        ) : (
          <div className={s.nudge}>
            <strong>{t('nudge.title', 'Sign in to sync & collaborate')}</strong>
            <p>{t('nudge.body', 'Everything works on this device without an account. Sign in to sync across devices, share and work together in real time.')}</p>
            <div className={s.nudgeActions}>
              <LinkButton to="/login" size="sm" variant="primary">{t('auth.signIn', 'Sign in')}</LinkButton>
              <LinkButton to="/signup" size="sm" variant="ghost">{t('auth.signUp', 'Sign up')}</LinkButton>
            </div>
          </div>
        )}
      </div>
      <CreateOrgDialog open={createOrg} onOpenChange={setCreateOrg} />
    </aside>
  )
}
