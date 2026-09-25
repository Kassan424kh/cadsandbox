// Dashboard shell: sidebar (drawer on small screens), banners, routed page.
import { useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router'
import { Menu, Plus } from 'lucide-react'
import { IconButton, Logo, Sheet, SheetContent } from '../../ui'
import { useT } from '../../i18n'
import { AnnouncementBanner, DeletionBanner, OfflineBanner } from '../components/Banners'
import { useDashboardUI } from '../dashboard/store'
import { Sidebar } from './Sidebar'
import s from './layout.module.css'

export default function DashboardLayout() {
  const t = useT()
  const [drawer, setDrawer] = useState(false)
  const openNewProject = useDashboardUI((st) => st.openNewProject)
  const loc = useLocation()
  return (
    <div className={s.shell}>
      <Sidebar />
      <main className={s.main}>
        <div className={s.mobileBar}>
          <IconButton variant="ghost" label={t('nav.openMenu', 'Open menu')} icon={<Menu size={18} />} onClick={() => setDrawer(true)} />
          <Link to="/" aria-label={t('nav.home', 'Home')}>
            <Logo size={20} />
          </Link>
          <IconButton variant="primary" label={t('dashboard.newProject', 'New project')} icon={<Plus size={18} />} onClick={() => openNewProject()} />
        </div>
        <AnnouncementBanner />
        <DeletionBanner />
        <OfflineBanner />
        <div className={s.scroll} key={loc.pathname.split('/')[1] ?? ''}>
          <div className={s.content}>
            <Outlet />
          </div>
        </div>
      </main>
      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetContent side="left" width={288} title={t('nav.label', 'Main navigation')} flush closeLabel={t('common.close', 'Close')}>
          <div className={s.drawer}>
            <Sidebar onNavigate={() => setDrawer(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
