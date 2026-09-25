// Version history of a design file: named + automatic versions, create named, restore (confirmed).
import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { History, RotateCcw, X } from 'lucide-react'
import type { VersionDTO } from '@cadsandbox/shared'
import { Button, IconButton, Input, Skeleton, Tooltip, cx, toast } from '../../ui'
import { formatBytes, formatDateTime, formatRelative, useT } from '../../i18n'
import type { ProjectSession } from '../../data/types'
import { qk } from '../../data/queries'
import { ConfirmDialog, errorMessage } from '../components/Dialogs'
import s from './dialogs.module.css'

export interface VersionsPanelProps {
  session: ProjectSession
  fileId: string
  onClose(): void
}

function VersionRow({ v, canRestore, onRestore }: { v: VersionDTO; canRestore: boolean; onRestore(): void }) {
  const t = useT()
  return (
    <div className={s.version}>
      <span className={cx(s.dot, !v.auto && s.dotNamed)} aria-hidden="true" />
      <div className={s.versionText}>
        <Tooltip content={formatDateTime(v.createdAt)} side="left">
          <strong>{v.auto ? t('versions.auto', 'Automatic version') : v.name}</strong>
        </Tooltip>
        <span>
          {formatRelative(v.createdAt)}
          {v.createdByName ? ` · ${v.createdByName}` : ''}
          {v.sizeBytes ? ` · ${formatBytes(v.sizeBytes)}` : ''}
        </span>
      </div>
      {canRestore && <IconButton size="sm" variant="ghost" label={t('versions.restore', 'Restore this version')} icon={<RotateCcw size={14} />} onClick={onRestore} />}
    </div>
  )
}

export function VersionsPanel({ session, fileId, onClose }: VersionsPanelProps) {
  const t = useT()
  const qc = useQueryClient()
  const docName = session.docName(fileId)
  const key = qk.versions(session.projectId, docName)
  const versions = useQuery({ queryKey: key, queryFn: () => session.versions.list(docName), refetchInterval: 60_000 })
  const [name, setName] = useState('')
  const [restore, setRestore] = useState<VersionDTO | null>(null)
  const canWrite = !session.readOnly

  const create = useMutation({
    mutationFn: (n: string) => session.versions.create(docName, n),
    onSuccess: () => {
      setName('')
      toast.success(t('versions.created', 'Version saved'))
    },
    onError: (err) => toast.error(errorMessage(err)),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const n = name.trim()
    if (n) create.mutate(n)
  }

  const list = versions.data ?? []
  const named = list.filter((v) => !v.auto)
  const auto = list.filter((v) => v.auto)
  const fileName = session.manifest.getFile(fileId)?.name ?? ''

  return (
    <section className={s.panel} aria-label={t('versions.title', 'Version history')}>
      <header className={s.panelHead}>
        <h2>
          <History size={16} /> {t('versions.title', 'Version history')}
        </h2>
        <IconButton size="sm" variant="ghost" label={t('common.close', 'Close')} icon={<X size={15} />} onClick={onClose} />
      </header>
      <div className={s.panelBody}>
        {canWrite && (
          <form className={s.createRow} onSubmit={submit}>
            <Input
              size="sm"
              value={name}
              maxLength={120}
              placeholder={t('versions.namePlaceholder', 'Name this version…')}
              aria-label={t('versions.name', 'Version name')}
              onChange={(e) => setName(e.target.value)}
            />
            <Button type="submit" size="sm" variant="primary" loading={create.isPending} disabled={!name.trim()}>
              {t('versions.save', 'Save')}
            </Button>
          </form>
        )}
        {versions.isLoading && (
          <>
            <Skeleton height={40} />
            <Skeleton height={40} />
          </>
        )}
        {versions.isError && <p style={{ fontSize: 12.5, color: 'var(--cs-danger)' }}>{errorMessage(versions.error)}</p>}
        {!versions.isLoading && list.length === 0 && !versions.isError && (
          <p style={{ fontSize: 12.5, color: 'var(--cs-text-3)', lineHeight: 1.5 }}>
            {t('versions.empty', 'No versions yet. Versions are saved automatically while you work — name one to mark a milestone.')}
          </p>
        )}
        {named.length > 0 && (
          <div className={s.versionList}>
            <div className={s.groupLabel}>{t('versions.named', 'Named versions')}</div>
            {named.map((v) => (
              <VersionRow key={v.id} v={v} canRestore={canWrite} onRestore={() => setRestore(v)} />
            ))}
          </div>
        )}
        {auto.length > 0 && (
          <div className={s.versionList}>
            <div className={s.groupLabel}>{t('versions.automatic', 'Automatic')}</div>
            {auto.map((v) => (
              <VersionRow key={v.id} v={v} canRestore={canWrite} onRestore={() => setRestore(v)} />
            ))}
          </div>
        )}
      </div>
      <ConfirmDialog
        open={!!restore}
        onOpenChange={(o) => !o && setRestore(null)}
        title={t('versions.restoreTitle', 'Restore this version?')}
        description={t(
          'versions.restoreDesc',
          '“{file}” will be set back to “{name}” ({date}) for everyone working on it. The current state is kept in the history, so you can go back.',
          { file: fileName, name: restore?.auto ? t('versions.auto', 'Automatic version') : (restore?.name ?? ''), date: restore ? formatDateTime(restore.createdAt) : '' },
        )}
        confirmLabel={t('versions.restoreConfirm', 'Restore')}
        onConfirm={async () => {
          if (!restore) return
          await session.versions.restore(restore.id)
          toast.success(t('versions.restored', 'Version restored'))
          await qc.invalidateQueries({ queryKey: key })
        }}
      />
    </section>
  )
}
