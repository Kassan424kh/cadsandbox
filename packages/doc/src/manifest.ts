// ProjectManifest — the per-project CRDT holding the file tree (folders, design files, assets).
// Design files are separate CadDocuments (collab doc `file:{projectId}:{fileId}`); assets are
// content-addressed blobs (sha256) stored locally (IndexedDB) and/or on the server.
import * as Y from 'yjs'
import { generateKeyBetween } from 'fractional-indexing'
import { LOCAL_ORIGIN, SILENT_ORIGIN, newId } from './document'
import type { FileEntry, FileKind, ProjectInfo } from './types'

export interface ManifestChange {
  files: Set<string>
  info: boolean
  local: boolean
}

export class ProjectManifest {
  readonly ydoc: Y.Doc
  readonly infoMap: Y.Map<unknown>
  readonly filesMap: Y.Map<FileEntry>
  readonly undoManager: Y.UndoManager
  private listeners = new Set<(c: ManifestChange) => void>()
  private pending: ManifestChange = { files: new Set(), info: false, local: false }
  private off: () => void

  constructor(ydoc: Y.Doc = new Y.Doc()) {
    this.ydoc = ydoc
    this.infoMap = ydoc.getMap('project')
    this.filesMap = ydoc.getMap('files')
    this.undoManager = new Y.UndoManager([this.filesMap, this.infoMap], { trackedOrigins: new Set([LOCAL_ORIGIN]) })
    const onFiles = (e: Y.YMapEvent<FileEntry>) => e.keysChanged.forEach((k) => this.pending.files.add(k))
    const onInfo = () => (this.pending.info = true)
    const after = (tr: Y.Transaction) => {
      if (!this.pending.files.size && !this.pending.info) return
      const c = { ...this.pending, local: tr.local }
      this.pending = { files: new Set(), info: false, local: false }
      for (const l of this.listeners) l(c)
    }
    this.filesMap.observe(onFiles)
    this.infoMap.observe(onInfo)
    ydoc.on('afterTransaction', after)
    this.off = () => {
      this.filesMap.unobserve(onFiles)
      this.infoMap.unobserve(onInfo)
      ydoc.off('afterTransaction', after)
    }
  }

  /** New project with one empty design file. Returns the manifest and the main file id. */
  static create(name: string, description = ''): { manifest: ProjectManifest; mainFile: string } {
    const manifest = new ProjectManifest()
    let mainFile = ''
    manifest.ydoc.transact(() => {
      const info: ProjectInfo = { name, description, createdAt: Date.now(), mainFile: null }
      for (const [k, v] of Object.entries(info)) manifest.infoMap.set(k, v)
      mainFile = manifest.addFile({ name: 'Main', kind: 'design' })
      manifest.infoMap.set('mainFile', mainFile)
    }, SILENT_ORIGIN)
    return { manifest, mainFile }
  }

  onChange(l: (c: ManifestChange) => void): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  get info(): ProjectInfo {
    return { name: 'Untitled', description: '', createdAt: 0, mainFile: null, ...(this.infoMap.toJSON() as Partial<ProjectInfo>) }
  }

  setInfo(patch: Partial<ProjectInfo>): void {
    this.ydoc.transact(() => {
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) this.infoMap.set(k, v)
    }, LOCAL_ORIGIN)
  }

  getFile(id: string): FileEntry | undefined {
    return this.filesMap.get(id)
  }

  listFiles(): FileEntry[] {
    return [...this.filesMap.values()]
  }

  children(parent: string | null): FileEntry[] {
    return this.listFiles()
      .filter((f) => (f.parent ?? null) === parent)
      .sort((a, b) =>
        a.kind === 'folder' && b.kind !== 'folder' ? -1 : b.kind === 'folder' && a.kind !== 'folder' ? 1 : a.order < b.order ? -1 : a.order > b.order ? 1 : a.name.localeCompare(b.name),
      )
  }

  descendants(id: string): FileEntry[] {
    const out: FileEntry[] = []
    const stack = [id]
    while (stack.length) {
      const cur = stack.pop()!
      for (const c of this.children(cur)) {
        out.push(c)
        stack.push(c.id)
      }
    }
    return out
  }

  designFiles(): FileEntry[] {
    return this.listFiles().filter((f) => f.kind === 'design')
  }

  path(id: string): FileEntry[] {
    const out: FileEntry[] = []
    let cur = this.getFile(id)
    const guard = new Set<string>()
    while (cur && !guard.has(cur.id)) {
      guard.add(cur.id)
      out.unshift(cur)
      cur = cur.parent ? this.getFile(cur.parent) : undefined
    }
    return out
  }

  private uniqueName(name: string, parent: string | null, except?: string): string {
    const taken = new Set(this.children(parent).filter((f) => f.id !== except).map((f) => f.name.toLowerCase()))
    if (!taken.has(name.toLowerCase())) return name
    const m = /^(.*?)(\.[^.]+)?$/.exec(name)!
    const stem = m[1]!,
      ext = m[2] ?? ''
    for (let i = 2; ; i++) {
      const candidate = `${stem} ${i}${ext}`
      if (!taken.has(candidate.toLowerCase())) return candidate
    }
  }

  addFile(input: { name: string; kind: FileKind; parent?: string | null; mime?: string; size?: number; blob?: string; createdBy?: string | null; id?: string }): string {
    const id = input.id ?? newId()
    const parent = input.parent ?? null
    const siblings = this.children(parent)
    const last = siblings.length ? siblings[siblings.length - 1]!.order : null
    const now = Date.now()
    const entry: FileEntry = {
      id,
      name: this.uniqueName(input.name.trim() || 'Untitled', parent),
      kind: input.kind,
      parent,
      order: generateKeyBetween(last, null),
      createdAt: now,
      updatedAt: now,
      createdBy: input.createdBy ?? null,
    }
    if (input.mime) entry.mime = input.mime
    if (input.size !== undefined) entry.size = input.size
    if (input.blob) entry.blob = input.blob
    this.ydoc.transact(() => this.filesMap.set(id, entry), LOCAL_ORIGIN)
    return id
  }

  rename(id: string, name: string): void {
    const f = this.getFile(id)
    if (!f || !name.trim()) return
    this.ydoc.transact(() => this.filesMap.set(id, { ...f, name: this.uniqueName(name.trim(), f.parent, id), updatedAt: Date.now() }), LOCAL_ORIGIN)
  }

  move(id: string, parent: string | null): void {
    const f = this.getFile(id)
    if (!f || id === parent) return
    if (parent && this.path(parent).some((p) => p.id === id)) return // no cycles
    this.ydoc.transact(() => this.filesMap.set(id, { ...f, parent, name: this.uniqueName(f.name, parent, id), updatedAt: Date.now() }), LOCAL_ORIGIN)
  }

  touch(id: string, patch: Partial<Pick<FileEntry, 'size' | 'blob' | 'mime'>> = {}): void {
    const f = this.getFile(id)
    if (f) this.ydoc.transact(() => this.filesMap.set(id, { ...f, ...patch, updatedAt: Date.now() }), SILENT_ORIGIN)
  }

  /** Remove a file or folder (recursively). Returns removed entries so callers can drop design docs/blobs. */
  remove(id: string): FileEntry[] {
    const f = this.getFile(id)
    if (!f) return []
    const removed = [f, ...this.descendants(id)]
    this.ydoc.transact(() => {
      for (const r of removed) this.filesMap.delete(r.id)
      if (this.info.mainFile && removed.some((r) => r.id === this.info.mainFile)) {
        this.infoMap.set('mainFile', this.designFiles()[0]?.id ?? null)
      }
    }, LOCAL_ORIGIN)
    return removed
  }

  destroy(): void {
    this.off()
    this.listeners.clear()
    this.undoManager.destroy()
  }
}
