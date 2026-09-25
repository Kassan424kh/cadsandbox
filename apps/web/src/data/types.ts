// Web data-layer contract between the app shell (routing, pages, stores, sync — src/app, src/data)
// and the editor chrome (src/editor, src/ui). The same interfaces serve LOCAL projects (IndexedDB,
// no account) and CLOUD projects (REST + Hocuspocus), so the editor never branches on mode.
import type { Awareness } from 'y-protocols/awareness'
import type { CadDocument, DocSnapshot, MaterialDef, ProjectManifest } from '@cadsandbox/doc'
import type { EditorAssets, EditorUser } from '@cadsandbox/render'
import type { CollectionDTO, CollectionItemDTO, CollectionItemKind, ProjectDTO, ProjectRole, VersionDTO } from '@cadsandbox/shared'

export type SyncStatus = 'local' | 'connecting' | 'syncing' | 'synced' | 'offline' | 'error'

export interface DesignHandle {
  fileId: string
  doc: CadDocument
  /** Presence for this design (null for local-only projects). */
  awareness: Awareness | null
  /** Resolves once local persistence and (cloud) the first server sync are loaded. */
  ready: Promise<void>
  status(): SyncStatus
  onStatus(cb: (s: SyncStatus) => void): () => void
  /** Ref-counted; the last release closes providers. */
  release(): void
}

export interface ProjectSession {
  projectId: string
  mode: 'local' | 'cloud'
  role: ProjectRole
  readOnly: boolean
  manifest: ProjectManifest
  /** Resolves when the manifest is loaded/synced. */
  ready: Promise<void>
  assets: EditorAssets
  user: EditorUser
  /** Cloud metadata (null for local projects). */
  project: ProjectDTO | null

  openDesign(fileId: string): DesignHandle
  /** New design file; `init` seeds content (template snapshot or builder). Returns file id. */
  createDesign(name: string, parent?: string | null, init?: DocSnapshot | ((doc: CadDocument) => void)): Promise<string>
  duplicateFile(fileId: string): Promise<string>
  deleteFile(fileId: string): Promise<void>
  /** Upload arbitrary files as project assets (images, PDFs, models, …) into the file tree. */
  uploadFiles(files: File[], parent?: string | null): Promise<string[]>
  /** Download an asset file entry as a Blob. */
  readFile(fileId: string): Promise<Blob | null>

  status(): SyncStatus
  onStatus(cb: (s: SyncStatus) => void): () => void
  /** Cloud sessions: the server closed a document because the caller's access was revoked or changed
   *  (member removed, role changed, link deleted, project trashed). The session keeps its role, so the
   *  app should reopen the project to pick up the new access (or show that it is gone). `denied` is
   *  true only when the server explicitly refused to authenticate a document; transport disconnects
   *  and server restarts are not access changes (the documents reconnect by themselves). */
  onAccessChange?(cb: (reason: string, denied: boolean) => void): () => void
  saveThumbnail(image: Blob): Promise<void>

  /** Version history (cloud only; local projects keep snapshots in IndexedDB too). */
  versions: {
    list(docName: string): Promise<VersionDTO[]>
    create(docName: string, name: string): Promise<VersionDTO>
    restore(versionId: string): Promise<void>
  }
  /** Collab doc name of a design file (for versions/comments). */
  docName(fileId: string): string
  close(): void
  /** Comment operations for every role that may comment (added by app-shell, additive). Commenters are
   *  read-only on the Yjs doc, so for them this goes through the REST API; other roles write directly. */
  comments?: ProjectComments
}

/** Added by app-shell (additive). Anchors mirror `CommentDef['anchor']` of @cadsandbox/doc. */
export interface ProjectComments {
  /** True when the current role may add/resolve comments. */
  readonly canComment: boolean
  add(fileId: string, text: string, anchor: { nodeId?: string; point?: [number, number, number]; viewId?: string }): Promise<string>
  reply(fileId: string, commentId: string, text: string): Promise<void>
  resolve(fileId: string, commentId: string, resolved: boolean): Promise<void>
}

/** The user's reusable object/material library ("My Collections"). Local when signed out. */
export interface LibraryStore {
  listCollections(): Promise<CollectionDTO[]>
  createCollection(name: string): Promise<CollectionDTO>
  renameCollection(id: string, name: string): Promise<void>
  deleteCollection(id: string): Promise<void>
  listItems(collectionId: string): Promise<CollectionItemDTO[]>
  addItem(
    collectionId: string,
    item: { name: string; kind: CollectionItemKind; payload: DocSnapshot | MaterialDef; thumbnail: string | null; tags?: string[] },
    /** Asset bytes referenced by the payload (textures, meshes) so the item works in any project. */
    assets: EditorAssets,
  ): Promise<CollectionItemDTO>
  removeItem(collectionId: string, itemId: string): Promise<void>
  /** Copy the item's referenced blobs into a project's asset store before inserting. */
  materialize(item: CollectionItemDTO, into: EditorAssets): Promise<void>
}

/** MIME type used when dragging library items / files onto the canvas. */
export const DND_MIME = 'application/x-cadsandbox-item'
export type DragPayload =
  | { kind: 'node'; node: import('@cadsandbox/doc').NewNode }
  | { kind: 'snapshot'; snapshot: DocSnapshot; name: string }
  | { kind: 'material'; materialId: string; material?: MaterialDef }
  | { kind: 'collection-item'; collectionId: string; itemId: string }
