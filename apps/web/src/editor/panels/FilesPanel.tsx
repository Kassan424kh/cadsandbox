// Project files: manifest tree (folders / designs / assets) with create, rename, move, delete, upload.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { File, FileBox, FilePlus, Folder, FolderOpen, FolderPlus, Image, PenLine, Trash, Upload } from 'lucide-react'
import type { FileEntry } from '@cadsandbox/doc'
import { useT } from '../../i18n'
import { Badge, DropdownMenuItem, DropdownMenuSeparator, EmptyState, IconButton, Tree, toast, type TreeDropPosition, type TreeRow } from '../../ui'
import { useEditorCtx } from '../EditorContext'
import { PointMenu } from '../commands/PointMenu'
import { PanelFrame } from './LeftRail'
import styles from './panels.module.css'

function useManifestVersion(): number {
  const { session } = useEditorCtx()
  const [v, setV] = useState(0)
  useEffect(() => session.manifest.onChange(() => setV((n) => n + 1)), [session])
  return v
}

const fmtSize = (n?: number) => (n == null ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`)

export function FilesPanel() {
  const t = useT()
  const { session, fileId, onOpenFile, readOnly } = useEditorCtx()
  const manifest = session.manifest
  const version = useManifestVersion()
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)

  const rows = useMemo<TreeRow[]>(() => {
    void version
    const out: TreeRow[] = []
    const walk = (parent: string | null, depth: number) => {
      const children = [...manifest.children(parent)].sort((a, b) => (a.kind === 'folder' ? 0 : 1) - (b.kind === 'folder' ? 0 : 1) || a.order.localeCompare(b.order))
      for (const f of children) {
        const isFolder = f.kind === 'folder'
        const expanded = !collapsed.has(f.id)
        const kids = isFolder ? manifest.children(f.id) : []
        out.push({
          id: f.id,
          depth,
          label: f.name,
          icon: isFolder ? (expanded ? <FolderOpen /> : <Folder />) : f.kind === 'design' ? <FileBox /> : f.mime?.startsWith('image/') ? <Image /> : <File />,
          hasChildren: isFolder,
          expanded,
          selected: f.id === fileId,
          canDropInside: isFolder,
          draggable: !readOnly,
          trailing: f.kind === 'asset' ? <span className={styles.listRowMeta}>{fmtSize(f.size)}</span> : f.id === fileId ? <Badge tone="accent">{t('files.open', 'Open')}</Badge> : undefined,
          trailingAlways: true,
          data: f,
        })
        if (isFolder && expanded && kids.length) walk(f.id, depth + 1)
      }
    }
    walk(null, 0)
    return out
  }, [manifest, version, collapsed, fileId, readOnly, t])

  const open = useCallback(
    (id: string) => {
      const f = manifest.getFile(id)
      if (!f) return
      if (f.kind === 'design') onOpenFile(id)
      else if (f.kind === 'asset') {
        void session.readFile(id).then((blob) => {
          if (!blob) return
          const url = URL.createObjectURL(blob)
          window.open(url, '_blank', 'noopener')
          setTimeout(() => URL.revokeObjectURL(url), 30000)
        })
      }
    },
    [manifest, onOpenFile, session],
  )

  const createDesign = (parent: string | null) => void session.createDesign(t('files.newDesignName', 'Untitled design'), parent).then((id) => onOpenFile(id))
  const createFolder = (parent: string | null) => {
    const id = manifest.addFile({ name: t('files.newFolderName', 'New folder'), kind: 'folder', parent, createdBy: session.user.id })
    setRenaming(id)
  }
  const upload = (parent: string | null) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.onchange = () => {
      const files = Array.from(input.files ?? [])
      if (files.length) void session.uploadFiles(files, parent).then(() => toast.success(t('files.uploaded', '{count} file(s) uploaded', { count: files.length })))
    }
    input.click()
  }
  const remove = (id: string) => {
    const f = manifest.getFile(id)
    if (!f) return
    if (f.id === fileId) return void toast.warning(t('files.cannotDeleteOpen', 'Switch to another design before deleting this one'))
    if (f.kind === 'design' || f.kind === 'folder') {
      const count = manifest.descendants(id).length
      if (!window.confirm(t('files.confirmDelete', 'Delete "{name}"{extra}? It moves to the project trash.', { name: f.name, extra: count ? ` (${count} items)` : '' }))) return
    }
    void session.deleteFile(id)
  }

  const canDrop = (ids: string[], target: string, position: TreeDropPosition) => {
    const tf = manifest.getFile(target)
    if (!tf) return false
    const newParent = position === 'inside' ? target : tf.parent
    return ids.every((id) => id !== newParent && !manifest.descendants(id).some((d) => d.id === newParent))
  }
  const onMove = (ids: string[], target: string, position: TreeDropPosition) => {
    if (!canDrop(ids, target, position)) return
    const tf = manifest.getFile(target)!
    const parent = position === 'inside' ? target : tf.parent
    for (const id of ids) manifest.move(id, parent)
  }

  const menuFile: FileEntry | undefined = menu ? manifest.getFile(menu.id) : undefined

  return (
    <PanelFrame
      title={t('panel.files', 'Files')}
      actions={
        !readOnly && (
          <>
            <IconButton size="sm" label={t('files.newDesign', 'New design')} icon={<FilePlus />} onClick={() => createDesign(null)} />
            <IconButton size="sm" label={t('files.newFolder', 'New folder')} icon={<FolderPlus />} onClick={() => createFolder(null)} />
            <IconButton size="sm" label={t('files.upload', 'Upload files')} icon={<Upload />} onClick={() => upload(null)} />
          </>
        )
      }
    >
      <Tree
        rows={rows}
        aria-label={t('panel.files', 'Files')}
        renamingId={renaming}
        onRenamingChange={setRenaming}
        onToggle={(id, expanded) =>
          setCollapsed((s) => {
            const n = new Set(s)
            if (expanded) n.delete(id)
            else n.add(id)
            return n
          })
        }
        onSelect={() => {}}
        onActivate={open}
        onRename={readOnly ? undefined : (id, name) => manifest.rename(id, name)}
        onMove={readOnly ? undefined : onMove}
        canDrop={canDrop}
        onContextMenu={(id, e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY, id })
        }}
        emptyState={<EmptyState compact title={t('files.empty', 'No files')} description={t('files.emptyHint', 'Create a design or upload reference files.')} />}
      />
      <PointMenu anchor={menu} onClose={() => setMenu(null)}>
        {menuFile?.kind === 'design' && <DropdownMenuItem icon={<FileBox />} onSelect={() => open(menuFile.id)}>{t('files.openDesign', 'Open')}</DropdownMenuItem>}
        {menuFile?.kind === 'asset' && <DropdownMenuItem icon={<File />} onSelect={() => open(menuFile.id)}>{t('files.preview', 'Preview')}</DropdownMenuItem>}
        {menuFile?.kind === 'folder' && !readOnly && (
          <>
            <DropdownMenuItem icon={<FilePlus />} onSelect={() => createDesign(menuFile.id)}>{t('files.newDesignHere', 'New design here')}</DropdownMenuItem>
            <DropdownMenuItem icon={<FolderPlus />} onSelect={() => createFolder(menuFile.id)}>{t('files.newFolderHere', 'New folder here')}</DropdownMenuItem>
            <DropdownMenuItem icon={<Upload />} onSelect={() => upload(menuFile.id)}>{t('files.uploadHere', 'Upload here')}</DropdownMenuItem>
          </>
        )}
        {!readOnly && menuFile && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem icon={<PenLine />} shortcut="F2" onSelect={() => setRenaming(menuFile.id)}>{t('common.rename', 'Rename')}</DropdownMenuItem>
            {menuFile.kind === 'design' && <DropdownMenuItem icon={<FileBox />} onSelect={() => void session.duplicateFile(menuFile.id)}>{t('files.duplicate', 'Duplicate')}</DropdownMenuItem>}
            <DropdownMenuItem icon={<Trash />} danger onSelect={() => remove(menuFile.id)}>{t('common.delete', 'Delete')}</DropdownMenuItem>
          </>
        )}
      </PointMenu>
    </PanelFrame>
  )
}
