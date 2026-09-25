// Share dialog: invite people by email + role, general access (private/link/public), share links
// (role, expiry, password), organization sharing. Local projects are offered an upload first.
import { useQuery } from '@tanstack/react-query'
import { CloudUpload, HardDrive } from 'lucide-react'
import { can, type ProjectDTO, type ProjectRole } from '@cadsandbox/shared'
import { Button, Dialog, DialogContent, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '../../ui'
import { useT } from '../../i18n'
import type { ProjectSession } from '../../data/types'
import type { ProjectItem } from '../../data/projects'
import { api } from '../../data/api/endpoints'
import { qk } from '../../data/queries'
import { useAuth } from '../../data/auth/AuthProvider'
import { useServer } from '../../data/online'
import { useDashboardUI } from '../dashboard/store'
import { LinksPanel, OrgsPanel, PeoplePanel, VisibilityPanel } from './SharePanels'
import s from './dialogs.module.css'
import { LinkButton } from '../components/LinkButton'

export interface ShareDialogProps {
  session: ProjectSession
  open: boolean
  onOpenChange(open: boolean): void
}

interface BodyProps {
  projectId: string
  mode: 'local' | 'cloud'
  role: ProjectRole
  initial: ProjectDTO | null
  name: string
  onUpload?: () => void
}

function LocalNotice({ onUpload }: { onUpload?: () => void }) {
  const t = useT()
  const auth = useAuth()
  const { available } = useServer()
  return (
    <div className={s.callout}>
      <HardDrive size={20} />
      <strong>{t('share.localTitle', 'This project lives only on this device')}</strong>
      <span>{t('share.localBody', 'To share it or collaborate in real time, upload it to your cloud first. A copy stays on this device for offline work.')}</span>
      {auth.status !== 'signed-in' ? (
        <LinkButton to="/login" variant="primary">{t('share.signInToShare', 'Sign in to share')}</LinkButton>
      ) : (
        onUpload &&
        available !== false && (
          <Button variant="primary" icon={<CloudUpload size={16} />} onClick={onUpload}>
            {t('dashboard.upload', 'Upload to cloud')}
          </Button>
        )
      )}
    </div>
  )
}

function ShareBody({ projectId, mode, role, initial, onUpload }: BodyProps) {
  const t = useT()
  const project = useQuery({
    queryKey: qk.project(projectId),
    queryFn: () => api.projects.get(projectId),
    enabled: mode === 'cloud',
    initialData: initial ?? undefined,
  })
  if (mode === 'local') return <LocalNotice onUpload={onUpload} />
  if (!project.data) return <Skeleton height={180} />
  const p = project.data
  const effectiveRole = p.role ?? role
  return (
    <Tabs defaultValue="people">
      <TabsList>
        <TabsTrigger value="people">{t('share.tab.people', 'People')}</TabsTrigger>
        <TabsTrigger value="access">{t('share.tab.access', 'General access')}</TabsTrigger>
        <TabsTrigger value="links">{t('share.tab.links', 'Links')}</TabsTrigger>
        <TabsTrigger value="orgs">{t('share.tab.orgs', 'Organizations')}</TabsTrigger>
      </TabsList>
      <div style={{ paddingTop: 16 }}>
        <TabsContent value="people">
          <PeoplePanel projectId={projectId} role={effectiveRole} ownerName={p.ownerName} />
        </TabsContent>
        <TabsContent value="access">
          <VisibilityPanel project={p} />
        </TabsContent>
        <TabsContent value="links">
          {p.visibility === 'private' && <p style={{ fontSize: 12.5, color: 'var(--cs-text-3)', marginBottom: 12 }}>{t('share.linksPrivateHint', 'Creating a link switches general access from “Private” to “Link”. Switching back to “Private” disables all links.')}</p>}
          <LinksPanel projectId={projectId} role={effectiveRole} />
        </TabsContent>
        <TabsContent value="orgs">
          <OrgsPanel projectId={projectId} role={effectiveRole} />
        </TabsContent>
      </div>
    </Tabs>
  )
}

function ShareShell({ open, onOpenChange, body }: { open: boolean; onOpenChange(open: boolean): void; body: BodyProps }) {
  const t = useT()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="md"
        title={t('share.title', 'Share “{name}”', { name: body.name })}
        description={can(body.role, 'share') ? undefined : t('share.readOnlyHint', 'You can see who has access. Only editors and the owner can change sharing.')}
        closeLabel={t('common.close', 'Close')}
      >
        <ShareBody {...body} />
      </DialogContent>
    </Dialog>
  )
}

/** Contract component used by the editor. */
export function ShareDialog({ session, open, onOpenChange }: ShareDialogProps) {
  const setUpload = useDashboardUI((st) => st.setUpload)
  const name = session.project?.name ?? session.manifest.info.name
  return (
    <ShareShell
      open={open}
      onOpenChange={onOpenChange}
      body={{
        projectId: session.projectId,
        mode: session.mode,
        role: session.role,
        initial: session.project,
        name,
        onUpload:
          session.mode === 'local'
            ? () => {
                onOpenChange(false)
                setUpload({
                  id: session.projectId,
                  name,
                  description: '',
                  mode: 'local',
                  folderId: null,
                  orgId: null,
                  starred: false,
                  role: 'owner',
                  ownerName: null,
                  visibility: 'device',
                  thumbnailUrl: null,
                  sizeBytes: 0,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                  deletedAt: null,
                })
              }
            : undefined,
      }}
    />
  )
}

/** Dashboard variant (no open session needed). */
export function DashboardShareDialog({ project, onClose }: { project: ProjectItem; onClose(): void }) {
  const setUpload = useDashboardUI((st) => st.setUpload)
  return (
    <ShareShell
      open
      onOpenChange={(o) => !o && onClose()}
      body={{
        projectId: project.id,
        mode: project.mode,
        role: project.role,
        initial: null,
        name: project.name,
        onUpload: () => {
          onClose()
          setUpload(project)
        },
      }}
    />
  )
}
