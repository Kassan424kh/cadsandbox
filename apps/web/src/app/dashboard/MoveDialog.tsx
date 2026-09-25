// Pick a destination folder (projects or folders). Folders can't move into themselves/descendants.
import { useEffect, useMemo, useState } from 'react'
import { Folder, FolderRoot } from 'lucide-react'
import { Button, Dialog, DialogContent } from '../../ui'
import { useT } from '../../i18n'
import type { FolderItem } from '../../data/projects'
import s from './dashboard.module.css'
import c from '../components/components.module.css'

interface Props {
  open: boolean
  onOpenChange(open: boolean): void
  title: string
  folders: FolderItem[]
  current: string | null
  /** When moving a folder: it and its descendants are not valid targets. */
  movingFolderId?: string | null
  rootLabel?: string
  onMove(folderId: string | null): Promise<unknown> | unknown
}

export function MoveDialog({ open, onOpenChange, title, folders, current, movingFolderId, rootLabel, onMove }: Props) {
  const t = useT()
  const [target, setTarget] = useState<string | null>(current)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) setTarget(current)
  }, [open, current])

  const rows = useMemo(() => {
    const children = new Map<string | null, FolderItem[]>()
    for (const f of folders) {
      const list = children.get(f.parentId) ?? []
      list.push(f)
      children.set(f.parentId, list)
    }
    const out: { f: FolderItem; depth: number; blocked: boolean }[] = []
    const walk = (parent: string | null, depth: number, blocked: boolean) => {
      for (const f of (children.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name))) {
        const b = blocked || f.id === movingFolderId
        out.push({ f, depth, blocked: b })
        walk(f.id, depth + 1, b)
      }
    }
    walk(null, 0, false)
    return out
  }, [folders, movingFolderId])

  const submit = async () => {
    setBusy(true)
    try {
      await onMove(target)
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent size="sm" title={title} closeLabel={t('common.close', 'Close')}>
        <div className={c.form}>
          <div className={s.folderList} role="listbox" aria-label={t('dashboard.folders', 'Folders')}>
            <button type="button" className={s.folderOption} aria-pressed={target === null} onClick={() => setTarget(null)}>
              <FolderRoot size={15} />
              {rootLabel ?? t('nav.allProjects', 'All projects')}
            </button>
            {rows.map(({ f, depth, blocked }) => (
              <button
                key={f.id}
                type="button"
                className={s.folderOption}
                style={{ paddingLeft: 10 + (depth + 1) * 16 }}
                aria-pressed={target === f.id}
                disabled={blocked}
                onClick={() => setTarget(f.id)}
              >
                <Folder size={15} />
                {f.name}
              </button>
            ))}
          </div>
          <div className={c.footer}>
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button variant="primary" loading={busy} disabled={target === current} onClick={submit}>
              {t('dashboard.moveHere', 'Move here')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
