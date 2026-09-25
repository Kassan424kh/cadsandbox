// Dialogs that can be opened from anywhere (dashboard, editor): new project, share, upload, support.
import { lazy, Suspense } from 'react'
import { useDashboardUI } from '../dashboard/store'

const NewProjectDialog = lazy(() => import('../dashboard/NewProjectDialog'))
const DashboardShareDialog = lazy(() => import('../dialogs/ShareDialog').then((m) => ({ default: m.DashboardShareDialog })))
const UploadDialog = lazy(() => import('../dashboard/UploadDialog'))
const SupportDialog = lazy(() => import('../dialogs/SupportDialog').then((m) => ({ default: m.SupportDialog })))

export function GlobalDialogs() {
  const ui = useDashboardUI()
  return (
    <Suspense fallback={null}>
      {ui.newProject.open && <NewProjectDialog />}
      {ui.share && <DashboardShareDialog project={ui.share} onClose={() => ui.setShare(null)} />}
      {ui.upload && <UploadDialog project={ui.upload} onClose={() => ui.setUpload(null)} />}
      {ui.supportOpen && <SupportDialog open onOpenChange={ui.setSupportOpen} />}
    </Suspense>
  )
}
