// "Upload to cloud": moves an on-device project to the signed-in account (keeps its id).
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { CloudUpload } from 'lucide-react'
import { Button, Dialog, DialogContent, Progress, toast } from '../../ui'
import { useT } from '../../i18n'
import { uploadLocalProject, type UploadProgress } from '../../data/create'
import { invalidateProjects } from '../../data/queries'
import type { ProjectItem } from '../../data/projects'
import { errorMessage } from '../components/Dialogs'
import c from '../components/components.module.css'

export default function UploadDialog({ project, onClose }: { project: ProjectItem; onClose(): void }) {
  const t = useT()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [progress, setProgress] = useState<UploadProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const busy = progress !== null && progress.step !== 'done' && !error

  const start = async () => {
    setError(null)
    setProgress({ step: 'create', done: 0, total: 1 })
    try {
      await uploadLocalProject(project.id, setProgress)
      await invalidateProjects(qc)
      toast.success(t('upload.done', '“{name}” is now in your cloud', { name: project.name }))
      onClose()
      // `reopen` makes an already-open editor re-acquire the (now cloud) session.
      navigate(`/p/${project.id}`, { state: { reopen: Date.now() } })
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const label =
    progress?.step === 'documents'
      ? t('upload.documents', 'Uploading documents ({done}/{total})', { done: progress.done, total: progress.total })
      : progress?.step === 'assets'
        ? t('upload.assets', 'Uploading files ({done}/{total})', { done: progress.done, total: progress.total })
        : t('upload.creating', 'Creating cloud project…')
  const value = progress && progress.total ? (progress.step === 'create' ? 0.05 : progress.step === 'documents' ? 0.1 + 0.5 * (progress.done / progress.total) : 0.6 + 0.4 * (progress.done / progress.total)) : undefined

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent
        size="sm"
        title={t('upload.title', 'Upload to cloud')}
        description={t('upload.desc', 'Sync “{name}” with your account so you can open it anywhere, share it and collaborate. A copy stays on this device for offline work.', { name: project.name })}
        closeLabel={t('common.close', 'Close')}
      >
        <div className={c.form}>
          {progress && !error && (
            <div className={c.label} aria-live="polite">
              {label}
              <Progress value={value} label={label} />
            </div>
          )}
          {error && (
            <p className={c.error} role="alert">
              {error}
            </p>
          )}
          <div className={c.footer}>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button variant="primary" icon={<CloudUpload size={16} />} loading={busy} onClick={start}>
              {error ? t('common.retry', 'Retry') : t('upload.start', 'Upload')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
