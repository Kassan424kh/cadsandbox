// ProjectSession implementation shared by LOCAL (IndexedDB only) and CLOUD (IndexedDB cache +
// Hocuspocus) projects. The editor never branches on mode.
import * as Y from 'yjs'
import { CadDocument, LOCAL_ORIGIN, ProjectManifest, SILENT_ORIGIN, newId, type CommentAuthor } from '@cadsandbox/doc'
import { LIMITS, can, docNames, type ProjectDTO, type ProjectRole, type VersionDTO } from '@cadsandbox/shared'
import type { EditorUser } from '@cadsandbox/render'
import type { DesignHandle, ProjectComments, ProjectSession, SyncStatus } from '../types'
import { api } from '../api/endpoints'
import { persistDoc, restoreSnapshot, type PersistedDoc } from '../yjs'
import { seedDesign, type DesignInit } from '../seed'
import { patchLocalProject, putThumbnail } from '../local/projects'
import { sanitizeFileName, guessMime } from '../files'
import { ProjectAssets } from './assets'
import { CollabConnection, aggregateStatus, type CollabDoc } from './collab'
import { LocalVersionStore } from './versions'

/** Keep a released design open briefly (StrictMode remounts, quick file switches). */
const DESIGN_LINGER_MS = 2500
/** Without a local copy, wait this long for the first server sync before showing what we have. */
const FIRST_SYNC_TIMEOUT_MS = 20_000
const AUTO_VERSION_MS = 10 * 60_000
const THUMBNAIL_THROTTLE_MS = 30_000

export class AccessDeniedError extends Error {
  /** Server reason for refusing the collab connection, e.g. 'impersonation-content-blocked'. */
  readonly reason: string | null
  constructor(reason: string | null = null) {
    super(
      reason === 'impersonation-content-blocked'
        ? 'Project content is not available while impersonating a user without their support grant'
        : 'You no longer have access to this project',
    )
    this.name = 'AccessDeniedError'
    this.reason = reason
  }
}

interface DesignEntry {
  fileId: string
  docName: string
  ydoc: Y.Doc
  doc: CadDocument
  store: PersistedDoc
  collab: CollabDoc | null
  refs: number
  ready: Promise<void>
  linger: ReturnType<typeof setTimeout> | null
  dirty: boolean
  off: () => void
}

export interface SessionInit {
  projectId: string
  mode: 'local' | 'cloud'
  role: ProjectRole
  project: ProjectDTO | null
  user: EditorUser
  shareToken?: string | null
  onClose?: () => void
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const isOnline = () => typeof navigator === 'undefined' || navigator.onLine

export class ProjectSessionImpl implements ProjectSession {
  readonly projectId: string
  readonly mode: 'local' | 'cloud'
  readonly role: ProjectRole
  readonly readOnly: boolean
  readonly manifest: ProjectManifest
  readonly ready: Promise<void>
  readonly assets: ProjectAssets
  readonly user: EditorUser
  readonly project: ProjectDTO | null
  readonly versions: ProjectSession['versions']
  readonly comments: ProjectComments

  private readonly manifestDoc: Y.Doc
  private readonly manifestStore: PersistedDoc
  private readonly conn: CollabConnection | null
  private readonly manifestCollab: CollabDoc | null
  private readonly designs = new Map<string, DesignEntry>()
  private readonly statusListeners = new Set<(s: SyncStatus) => void>()
  private readonly localVersions: LocalVersionStore
  private readonly shareToken: string | null
  private readonly onClose?: () => void
  private lastStatus: SyncStatus
  private closed = false
  private touchTimer: ReturnType<typeof setTimeout> | null = null
  private renameTimer: ReturnType<typeof setTimeout> | null = null
  private autoTimer: ReturnType<typeof setInterval> | null = null
  private thumb: { pending: Blob | null; last: number; timer: ReturnType<typeof setTimeout> | null } = { pending: null, last: 0, timer: null }
  private disposers: (() => void)[] = []

  constructor(init: SessionInit) {
    this.projectId = init.projectId
    this.mode = init.mode
    this.role = init.role
    this.readOnly = !can(init.role, 'edit')
    this.project = init.project
    this.user = init.user
    this.shareToken = init.shareToken ?? null
    this.onClose = init.onClose
    this.assets = new ProjectAssets(this.projectId, this.mode, this.shareToken, !this.readOnly)
    this.localVersions = new LocalVersionStore(this.projectId, this.user)

    this.manifestDoc = new Y.Doc()
    this.manifest = new ProjectManifest(this.manifestDoc)
    const name = docNames.manifest(this.projectId)
    this.manifestStore = persistDoc(name, this.manifestDoc)
    this.conn = this.mode === 'cloud' ? new CollabConnection(this.shareToken, !this.readOnly) : null
    this.manifestCollab = this.conn?.open(name, this.manifestDoc) ?? null
    if (this.manifestCollab) this.disposers.push(this.manifestCollab.onStatus(() => this.emitStatus()))
    this.lastStatus = this.status()

    this.ready = this.whenReady(this.manifestStore.loaded, this.manifestCollab, this.manifestDoc).then(() => this.afterReady())
    this.ready.catch(() => undefined)

    this.watchManifest()
    if (this.mode === 'local' && !this.readOnly) this.autoTimer = setInterval(() => void this.autoVersionAll(), AUTO_VERSION_MS)

    this.versions = {
      list: (docName) => (this.mode === 'local' ? this.localVersions.list(docName) : api.versions.list(this.projectId, docName)),
      create: (docName, versionName) => this.createVersion(docName, versionName),
      restore: (versionId) => this.restoreVersion(versionId),
    }
    this.comments = this.createComments()
  }

  // ---------------------------------------------------------------- lifecycle

  private async whenReady(loaded: Promise<void>, collab: CollabDoc | null, ydoc: Y.Doc): Promise<void> {
    await loaded
    if (!collab) return
    // Local-first: with a cached copy we show it immediately and keep syncing in the background.
    if (ydoc.store.clients.size > 0 || !isOnline()) return
    const synced = await Promise.race([collab.firstSync, sleep(FIRST_SYNC_TIMEOUT_MS).then(() => null)])
    if (synced === false && collab.status() === 'error') throw new AccessDeniedError(collab.deniedReason())
  }

  private afterReady(): void {
    if (this.mode === 'local') {
      void patchLocalProject(this.projectId, { lastOpenedAt: Date.now() })
      return
    }
    // The dashboard renames through the REST API; bring the manifest title in line (owner only).
    const title = this.project?.name
    if (title && this.role === 'owner' && this.manifest.info.name !== title) {
      this.manifestDoc.transact(() => this.manifest.infoMap.set('name', title), SILENT_ORIGIN)
    }
  }

  private watchManifest(): void {
    const onUpdate = (_: Uint8Array, origin: unknown) => {
      if (origin === this.manifestStore.persistence) return
      if (this.mode === 'local') this.scheduleTouch()
    }
    this.manifestDoc.on('update', onUpdate)
    this.disposers.push(() => this.manifestDoc.off('update', onUpdate))
    this.disposers.push(
      this.manifest.onChange((c) => {
        if (!c.info || !c.local) return
        if (this.mode === 'local') this.scheduleTouch()
        else if (this.role === 'owner') this.scheduleRename()
      }),
    )
  }

  /** Local projects: keep the dashboard metadata (name, updatedAt) in sync with the documents. */
  private scheduleTouch(): void {
    if (this.touchTimer) return
    this.touchTimer = setTimeout(() => {
      this.touchTimer = null
      const info = this.manifest.info
      void patchLocalProject(this.projectId, { updatedAt: Date.now(), name: info.name, description: info.description })
    }, 2000)
  }

  private scheduleRename(): void {
    if (this.renameTimer) clearTimeout(this.renameTimer)
    this.renameTimer = setTimeout(() => {
      this.renameTimer = null
      const name = this.manifest.info.name.trim()
      if (name && name !== this.project?.name) api.projects.update(this.projectId, { name }).catch(() => undefined)
    }, 1500)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    if (this.touchTimer) {
      clearTimeout(this.touchTimer)
      const info = this.manifest.info
      void patchLocalProject(this.projectId, { updatedAt: Date.now(), name: info.name })
    }
    if (this.renameTimer) clearTimeout(this.renameTimer)
    if (this.autoTimer) clearInterval(this.autoTimer)
    if (this.thumb.timer) clearTimeout(this.thumb.timer)
    if (this.thumb.pending) void this.uploadThumbnail()
    for (const e of [...this.designs.values()]) this.destroyEntry(e)
    for (const d of this.disposers) d()
    this.disposers = []
    this.statusListeners.clear()
    this.manifestCollab?.destroy()
    this.conn?.destroy()
    void this.manifestStore.destroy()
    this.manifest.destroy()
    this.manifestDoc.destroy()
    this.assets.dispose()
    this.onClose?.()
  }

  get isClosed(): boolean {
    return this.closed
  }

  // ---------------------------------------------------------------- status

  status(): SyncStatus {
    if (this.mode === 'local') return 'local'
    const all: SyncStatus[] = [this.manifestCollab!.status()]
    for (const e of this.designs.values()) if (e.collab) all.push(e.collab.status())
    return aggregateStatus(all)
  }

  onStatus(cb: (s: SyncStatus) => void): () => void {
    this.statusListeners.add(cb)
    return () => this.statusListeners.delete(cb)
  }

  /** Cloud only: the server closed one of our documents because our access was revoked or changed. */
  onAccessChange(cb: (reason: string, denied: boolean) => void): () => void {
    if (!this.conn || this.closed) return () => undefined
    return this.conn.onAccessChange((reason, _doc, denied) => cb(reason, denied))
  }

  private emitStatus(): void {
    const s = this.status()
    if (s === this.lastStatus) return
    this.lastStatus = s
    for (const l of this.statusListeners) l(s)
  }

  // ---------------------------------------------------------------- designs

  docName(fileId: string): string {
    return docNames.file(this.projectId, fileId)
  }

  openDesign(fileId: string): DesignHandle {
    if (this.closed) throw new Error('Project session is closed')
    const e = this.designs.get(fileId) ?? this.createEntry(fileId)
    if (e.linger) {
      clearTimeout(e.linger)
      e.linger = null
    }
    e.refs++
    let released = false
    return {
      fileId,
      doc: e.doc,
      awareness: e.collab?.awareness ?? null,
      ready: e.ready,
      status: () => (e.collab ? e.collab.status() : 'local'),
      onStatus: (cb) => (e.collab ? e.collab.onStatus(cb) : () => undefined),
      release: () => {
        if (released) return
        released = true
        this.releaseEntry(e)
      },
    }
  }

  private createEntry(fileId: string): DesignEntry {
    const docName = this.docName(fileId)
    const ydoc = new Y.Doc()
    const doc = new CadDocument(ydoc)
    const store = persistDoc(docName, ydoc)
    const collab = this.conn?.open(docName, ydoc) ?? null
    const entry: DesignEntry = { fileId, docName, ydoc, doc, store, collab, refs: 0, ready: Promise.resolve(), linger: null, dirty: false, off: () => undefined }
    entry.ready = this.whenReady(store.loaded, collab, ydoc)
    entry.ready.catch(() => undefined)
    const offStatus = collab?.onStatus(() => this.emitStatus())
    const onUpdate = (_: Uint8Array, origin: unknown) => {
      if (origin === store.persistence || this.mode !== 'local') return
      entry.dirty = true
      this.scheduleTouch()
    }
    ydoc.on('update', onUpdate)
    entry.off = () => {
      offStatus?.()
      ydoc.off('update', onUpdate)
    }
    this.designs.set(fileId, entry)
    this.emitStatus()
    return entry
  }

  private releaseEntry(e: DesignEntry): void {
    e.refs = Math.max(0, e.refs - 1)
    if (e.refs > 0 || this.closed) return
    e.linger = setTimeout(() => this.destroyEntry(e), DESIGN_LINGER_MS)
  }

  private destroyEntry(e: DesignEntry): void {
    if (e.linger) clearTimeout(e.linger)
    if (this.designs.get(e.fileId) !== e) return
    this.designs.delete(e.fileId)
    if (e.dirty && !this.readOnly) void this.localVersions.create(e.docName, 'Auto-save', e.ydoc, true)
    e.off()
    e.collab?.destroy()
    e.doc.destroy()
    void e.store.destroy()
    e.ydoc.destroy()
    this.emitStatus()
  }

  private async autoVersionAll(): Promise<void> {
    for (const e of this.designs.values()) {
      if (!e.dirty) continue
      e.dirty = false
      await this.localVersions.create(e.docName, 'Auto-save', e.ydoc, true)
    }
  }

  /** Run `fn` with an open, loaded design (opened temporarily if needed). */
  private async withDesign<T>(fileId: string, fn: (doc: CadDocument) => T): Promise<T> {
    const h = this.openDesign(fileId)
    try {
      await h.ready
      return fn(h.doc)
    } finally {
      h.release()
    }
  }

  private assertWritable(): void {
    if (this.closed) throw new Error('Project session is closed')
    if (this.readOnly) throw new Error('This project is read-only for you')
  }

  async createDesign(name: string, parent: string | null = null, init?: DesignInit): Promise<string> {
    this.assertWritable()
    await this.ready
    const fileId = newId()
    const title = name.trim() || 'Untitled'
    await this.withDesign(fileId, (doc) => seedDesign(doc, title, init))
    this.manifest.addFile({ id: fileId, name: title, kind: 'design', parent, createdBy: this.user.id })
    if (!this.manifest.info.mainFile) this.manifest.setInfo({ mainFile: fileId })
    return fileId
  }

  async duplicateFile(fileId: string): Promise<string> {
    this.assertWritable()
    await this.ready
    const src = this.manifest.getFile(fileId)
    if (!src) throw new Error('File not found')
    return this.duplicateInto(fileId, src.parent)
  }

  private async duplicateInto(fileId: string, parent: string | null): Promise<string> {
    const src = this.manifest.getFile(fileId)!
    if (src.kind === 'folder') {
      const folderId = this.manifest.addFile({ name: src.name, kind: 'folder', parent, createdBy: this.user.id })
      for (const child of this.manifest.children(fileId)) await this.duplicateInto(child.id, folderId)
      return folderId
    }
    if (src.kind === 'asset') {
      return this.manifest.addFile({ name: src.name, kind: 'asset', parent, mime: src.mime, size: src.size, blob: src.blob, createdBy: this.user.id })
    }
    const state = await this.withDesign(fileId, (doc) => Y.encodeStateAsUpdate(doc.ydoc))
    const copyId = newId()
    const copyName = `${src.name} copy`
    await this.withDesign(copyId, (doc) => {
      Y.applyUpdate(doc.ydoc, state, SILENT_ORIGIN)
      doc.ydoc.transact(() => doc.metaMap.set('name', copyName), SILENT_ORIGIN)
      doc.undoManager.clear()
    })
    return this.manifest.addFile({ id: copyId, name: copyName, kind: 'design', parent, createdBy: this.user.id })
  }

  /** Removes the entry (undoable). Design content is kept so undo restores it; purged with the project. */
  async deleteFile(fileId: string): Promise<void> {
    this.assertWritable()
    this.manifest.remove(fileId)
  }

  async uploadFiles(files: File[], parent: string | null = null): Promise<string[]> {
    this.assertWritable()
    await this.ready
    const ids: string[] = []
    for (const file of files) {
      if (file.size > LIMITS.maxBlobBytes) throw new Error(`"${file.name}" is larger than ${Math.round(LIMITS.maxBlobBytes / 1048576)} MB`)
      const name = sanitizeFileName(file.name)
      const mime = file.type || guessMime(name)
      const hash = await this.assets.put(new Uint8Array(await file.arrayBuffer()), mime)
      ids.push(this.manifest.addFile({ name, kind: 'asset', parent, mime, size: file.size, blob: hash, createdBy: this.user.id }))
    }
    return ids
  }

  async readFile(fileId: string): Promise<Blob | null> {
    const entry = this.manifest.getFile(fileId)
    if (!entry?.blob) return null
    const buf = await this.assets.get(entry.blob)
    return buf ? new Blob([buf], { type: entry.mime ?? 'application/octet-stream' }) : null
  }

  // ---------------------------------------------------------------- thumbnails

  async saveThumbnail(image: Blob): Promise<void> {
    if (this.readOnly || this.closed) return
    if (image.size > LIMITS.maxThumbnailBytes) {
      console.warn('[session] thumbnail too large, skipped', image.size)
      return
    }
    await putThumbnail(this.projectId, image)
    if (this.mode !== 'cloud') return
    this.thumb.pending = image
    const wait = this.thumb.last + THUMBNAIL_THROTTLE_MS - Date.now()
    if (wait <= 0) await this.uploadThumbnail()
    else this.thumb.timer ??= setTimeout(() => void this.uploadThumbnail(), wait)
  }

  private async uploadThumbnail(): Promise<void> {
    if (this.thumb.timer) clearTimeout(this.thumb.timer)
    this.thumb.timer = null
    const image = this.thumb.pending
    if (!image) return
    this.thumb.pending = null
    this.thumb.last = Date.now()
    try {
      await api.projects.putThumbnail(this.projectId, image)
    } catch (err) {
      console.warn('[session] thumbnail upload failed', err)
    }
  }

  // ---------------------------------------------------------------- versions

  private async withDocByName<T>(docName: string, fn: (ydoc: Y.Doc) => T | Promise<T>): Promise<T> {
    const parsed = docNames.parse(docName)
    if (!parsed || parsed.projectId !== this.projectId) throw new Error('Unknown document')
    if (!parsed.fileId) {
      await this.ready
      return fn(this.manifestDoc)
    }
    const h = this.openDesign(parsed.fileId)
    try {
      await h.ready
      return await fn(h.doc.ydoc)
    } finally {
      h.release()
    }
  }

  private async createVersion(docName: string, name: string): Promise<VersionDTO> {
    if (this.mode === 'cloud') return api.versions.create(this.projectId, docName, name)
    this.assertWritable()
    const v = await this.withDocByName(docName, (ydoc) => this.localVersions.create(docName, name, ydoc, false))
    return v!
  }

  private async restoreVersion(versionId: string): Promise<void> {
    this.assertWritable()
    if (this.mode === 'cloud') return api.versions.restore(this.projectId, versionId)
    const rec = await this.localVersions.get(versionId)
    if (!rec) throw new Error('Version not found')
    await this.withDocByName(rec.docName, async (ydoc) => {
      await this.localVersions.create(rec.docName, 'Before restore', ydoc, true) // safety net
      restoreSnapshot(ydoc, rec.update, LOCAL_ORIGIN)
    })
  }

  // ---------------------------------------------------------------- comments

  private createComments(): ProjectComments {
    const viaRest = () => this.mode === 'cloud' && this.readOnly
    const author = (): CommentAuthor => ({ id: this.user.id, name: this.user.name, color: this.user.color })
    const guard = () => {
      if (!can(this.role, 'comment')) throw new Error('You cannot comment on this project')
    }
    return {
      canComment: can(this.role, 'comment'),
      add: async (fileId, text, anchor) => {
        guard()
        if (viaRest()) return (await api.comments.add(this.projectId, { docName: this.docName(fileId), text, anchor })).id
        return this.withDesign(fileId, (doc) => doc.addComment({ author: author(), text, anchor }))
      },
      reply: async (fileId, commentId, text) => {
        guard()
        if (viaRest()) {
          await api.comments.reply(this.projectId, commentId, { docName: this.docName(fileId), text })
          return
        }
        await this.withDesign(fileId, (doc) => doc.addReply(commentId, { author: author(), text }))
      },
      resolve: async (fileId, commentId, resolved) => {
        guard()
        if (viaRest()) return api.comments.resolve(this.projectId, commentId, { docName: this.docName(fileId), resolved })
        await this.withDesign(fileId, (doc) => doc.updateComment(commentId, { resolved }))
      },
    }
  }
}
