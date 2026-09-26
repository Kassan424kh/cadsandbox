// Dev-only preview of the editor chrome with an in-memory local ProjectSession and a seeded scene.
// Reach it at http://localhost:5173/src/editor/dev/index.html while the app router is not wired.
import { useMemo, useState } from 'react'
import { CadDocument, ProjectManifest, type DocSnapshot } from '@cadsandbox/doc'
import type { CollectionDTO, CollectionItemDTO } from '@cadsandbox/shared'
import type { DesignHandle, LibraryStore, ProjectSession, SyncStatus } from '../../data/types'
import { EditorPage } from '../EditorPage'

async function sha256(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function seed(doc: CadDocument): void {
  const level = doc.levels()[0]?.id ?? null
  doc.transact(() => {
    const walls = [
      [[0, 0], [8, 0]],
      [[8, 0], [8, 6]],
      [[8, 6], [0, 6]],
      [[0, 6], [0, 0]],
      [[4, 0], [4, 6]],
    ] as [[number, number], [number, number]][]
    const ids = walls.map(([a, b], i) => doc.addNode({ type: 'wall', name: `Wall ${i + 1}`, parent: level, params: { a, b, thickness: i === 4 ? 0.115 : 0.3, height: 2.75, exterior: i < 4 } }))
    doc.addNode({ type: 'opening', name: 'Entrance', parent: ids[0], params: { kind: 'door', style: 'single', offset: 2, width: 0.885, height: 2.01 } })
    doc.addNode({ type: 'opening', name: 'Window', parent: ids[2], params: { kind: 'window', style: 'casement', offset: 2.5, width: 1.26, height: 1.26, sill: 0.9 } })
    doc.addNode({ type: 'slab', name: 'Ground slab', parent: level, params: { kind: 'floor', outline: [[0, 0], [8, 0], [8, 6], [0, 6]], thickness: 0.2, offset: 0 } })
    doc.addNode({ type: 'room', name: 'Living', parent: level, params: { outline: [[0.15, 0.15], [3.94, 0.15], [3.94, 5.85], [0.15, 5.85]], number: '01', usage: 'NUF1', showLabel: true } })
    doc.addNode({ type: 'room', name: 'Kitchen', parent: level, params: { outline: [[4.06, 0.15], [7.85, 0.15], [7.85, 5.85], [4.06, 5.85]], number: '02', usage: 'NUF1', showLabel: true } })
    doc.addNode({ type: 'furniture', name: 'Sofa', parent: level, t: { p: [1.2, 4.6, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }, params: { kind: 'sofa', width: 2.2, depth: 0.9, height: 0.8 } })
    doc.addNode({ type: 'furniture', name: 'Dining table', parent: level, t: { p: [6, 3, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }, params: { kind: 'dining-table', width: 1.8, depth: 0.9, height: 0.75 }, material: 'mat-oak' })
    const g = doc.addNode({ type: 'group', name: 'Play objects', parent: level })
    doc.addNode({ type: 'shape', name: 'Star', parent: g, t: { p: [2, 1.5, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }, params: { profile: 'star', width: 0.6, height: 0.6, sides: 5, innerRatio: 0.5, depth: 0.12 }, color: '#ff3b30' })
    doc.addNode({ type: 'primitive', name: 'Sphere', parent: g, t: { p: [2.8, 1.5, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }, params: { shape: 'sphere', radius: 0.25 }, material: 'mat-chrome' })
    doc.addNode({ type: 'text', name: 'Label', parent: g, t: { p: [1, 0.6, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }, params: { text: 'Lucky Turtle', size: 0.25, font: 'display', align: 'left', depth: 0.05 }, color: '#0fb5ff' })
    doc.addNode({ type: 'light', name: 'Pendant', parent: level, t: { p: [6, 3, 2.4], r: [0, 0, 0, 1], s: [1, 1, 1] }, params: { kind: 'point', color: '#fff2d6', intensity: 80, castShadow: true } })
  })
  doc.addComment({ author: { id: 'u2', name: 'Mara Lindqvist', color: '#f97316' }, text: 'Can we widen the entrance to 1.01 m for accessibility?', anchor: { nodeId: doc.nodesOfType('opening')[0]?.id, point: [2, 0, 1] } })
  doc.undoManager.clear()
}

function createLocalSession(name: string): ProjectSession {
  const { manifest, mainFile } = ProjectManifest.create(name, 'Dev preview project')
  manifest.addFile({ name: 'Site plan', kind: 'design' })
  manifest.addFile({ name: 'References', kind: 'folder' })
  const docs = new Map<string, CadDocument>()
  const blobs = new Map<string, { bytes: Uint8Array; mime: string }>()
  const listeners = new Set<(s: SyncStatus) => void>()
  const getDoc = (fileId: string) => {
    let d = docs.get(fileId)
    if (!d) {
      d = CadDocument.create(manifest.getFile(fileId)?.name ?? 'Untitled', { withLevel: true })
      if (fileId === mainFile) {
        d.setMeta({ name: 'Lucky Turtle' })
        seed(d)
      }
      docs.set(fileId, d)
    }
    return d
  }
  const assets = {
    get: async (hash: string) => {
      const b = blobs.get(hash)
      if (!b) return null
      const out = new ArrayBuffer(b.bytes.byteLength)
      new Uint8Array(out).set(b.bytes)
      return out
    },
    url: async (hash: string) => {
      const b = blobs.get(hash)
      return b ? URL.createObjectURL(new Blob([b.bytes as BlobPart], { type: b.mime })) : null
    },
    put: async (bytes: Uint8Array, mime: string) => {
      const hash = await sha256(bytes)
      blobs.set(hash, { bytes, mime })
      return hash
    },
  }
  // ?role=viewer|commenter previews the read-only chrome (default: owner).
  const roleParam = new URLSearchParams(location.search).get('role')
  const role = roleParam === 'viewer' || roleParam === 'commenter' || roleParam === 'editor' ? roleParam : 'owner'
  const session: ProjectSession = {
    projectId: 'dev-project',
    mode: 'local',
    role,
    readOnly: role === 'viewer' || role === 'commenter',
    writeBlock: null,
    manifest,
    ready: Promise.resolve(),
    assets,
    user: { id: 'u1', name: 'Khalil', color: '#7c5cff' },
    project: null,
    openDesign(fileId): DesignHandle {
      const doc = getDoc(fileId)
      return { fileId, doc, awareness: null, ready: Promise.resolve(), status: () => 'local', onStatus: () => () => {}, release: () => {} }
    },
    async createDesign(n, parent, init) {
      const id = manifest.addFile({ name: n, kind: 'design', parent: parent ?? null })
      const d = CadDocument.create(n, { withLevel: true })
      if (typeof init === 'function') init(d)
      else if (init) d.insertSnapshot(init as DocSnapshot)
      docs.set(id, d)
      return id
    },
    async duplicateFile(fileId) {
      const f = manifest.getFile(fileId)!
      const id = manifest.addFile({ name: `${f.name} copy`, kind: f.kind, parent: f.parent })
      const src = getDoc(fileId)
      const d = new CadDocument()
      d.applyUpdate(src.encodeState())
      docs.set(id, d)
      return id
    },
    async deleteFile(fileId) {
      manifest.remove(fileId)
      docs.delete(fileId)
    },
    async uploadFiles(files, parent) {
      const ids: string[] = []
      for (const f of files) {
        const hash = await assets.put(new Uint8Array(await f.arrayBuffer()), f.type)
        ids.push(manifest.addFile({ name: f.name, kind: 'asset', parent: parent ?? null, mime: f.type, size: f.size, blob: hash }))
      }
      return ids
    },
    async readFile(fileId) {
      const f = manifest.getFile(fileId)
      const b = f?.blob ? blobs.get(f.blob) : undefined
      return b ? new Blob([b.bytes as BlobPart], { type: b.mime }) : null
    },
    status: () => 'local',
    onStatus(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    async saveThumbnail() {},
    versions: { list: async () => [], create: async () => ({ id: 'v', projectId: 'dev-project', docName: 'x', name: 'v', auto: false, sizeBytes: 0, createdBy: null, createdByName: null, createdAt: new Date().toISOString() }), restore: async () => {} },
    docName: (fileId) => `file:dev-project:${fileId}`,
    close() {},
  }
  return session
}

function createLocalLibrary(): LibraryStore {
  const collections: CollectionDTO[] = [{ id: 'c1', name: 'Favourites', orgId: null, itemCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }]
  const items = new Map<string, CollectionItemDTO[]>([['c1', []]])
  const now = () => new Date().toISOString()
  return {
    listCollections: async () => collections.map((c) => ({ ...c, itemCount: items.get(c.id)?.length ?? 0 })),
    async createCollection(name) {
      const c: CollectionDTO = { id: `c${collections.length + 1}`, name, orgId: null, itemCount: 0, createdAt: now(), updatedAt: now() }
      collections.push(c)
      items.set(c.id, [])
      return c
    },
    async renameCollection(id, name) {
      const c = collections.find((x) => x.id === id)
      if (c) c.name = name
    },
    async deleteCollection(id) {
      const i = collections.findIndex((x) => x.id === id)
      if (i >= 0) collections.splice(i, 1)
      items.delete(id)
    },
    listItems: async (id) => items.get(id) ?? [],
    async addItem(collectionId, item) {
      const dto: CollectionItemDTO = { id: `i${Math.random().toString(36).slice(2, 8)}`, collectionId, name: item.name, kind: item.kind, tags: item.tags ?? [], thumbnail: item.thumbnail, payload: item.payload, assets: [], createdAt: now() }
      items.get(collectionId)?.push(dto)
      return dto
    },
    async removeItem(collectionId, itemId) {
      const list = items.get(collectionId)
      if (list) items.set(collectionId, list.filter((x) => x.id !== itemId))
    },
    async materialize() {},
  }
}

export function DevPreview() {
  const session = useMemo(() => createLocalSession('Lucky Turtle'), [])
  const library = useMemo(() => createLocalLibrary(), [])
  const [fileId, setFileId] = useState<string | null>(null)
  return <EditorPage session={session} fileId={fileId} library={library} onOpenFile={setFileId} onExit={() => alert('Back to dashboard (dev preview)')} />
}
