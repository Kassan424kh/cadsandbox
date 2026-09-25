// Portable project archives (.csbx) — "Download project", backups and importing on another device.
// Gathers a project's complete content through its session (cloud projects sync first) and encodes /
// decodes with @cadsandbox/io (loaded on demand, so the dashboard stays light).
import * as Y from 'yjs'
import { CadDocument, ProjectManifest, collectRefs } from '@cadsandbox/doc'
import { docNames } from '@cadsandbox/shared'
import type { EditorUser } from '@cadsandbox/render'
import type { ProjectArchive } from '@cadsandbox/io'
import { acquireSession } from './session/manager'
import { sanitizeFileName } from './files'
import { getBlob, isHash, linkBlob, putBlob } from './local/blobs'
import { newProjectId, putLocalProject } from './local/projects'
import { writeDocState } from './yjs'

export const ARCHIVE_EXT = '.csbx'
const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024

/** Loaded on first download/import only (the package also carries the heavy format converters). */
const io = () => import('@cadsandbox/io')

/** Asset hashes referenced by a design (nodes incl. component definitions, textures, environment). */
export function designAssetHashes(doc: CadDocument): string[] {
  const assets = new Set<string>()
  const materials = new Set<string>()
  const components = new Set<string>()
  for (const n of doc.allNodes()) collectRefs(n, materials, components, assets)
  for (const m of doc.docMaterials()) for (const ref of Object.values(m.maps ?? {})) if (ref && 'asset' in ref) assets.add(ref.asset)
  const env = doc.meta.render.envAsset
  if (env) assets.add(env)
  return [...assets].filter(isHash)
}

function cloneYDoc(src: Y.Doc): Y.Doc {
  const d = new Y.Doc()
  Y.applyUpdate(d, Y.encodeStateAsUpdate(src))
  return d
}

/** Collect a project's complete content (syncs cloud projects first). Dispose with disposeArchive. */
export async function collectProject(projectId: string, user: EditorUser): Promise<ProjectArchive> {
  const { session, release } = await acquireSession(projectId, { user })
  try {
    await session.ready
    const manifest = new ProjectManifest(cloneYDoc(session.manifest.ydoc))
    const designs = new Map<string, CadDocument>()
    const hashes = new Set<string>()
    for (const f of session.manifest.listFiles()) if (f.kind === 'asset' && f.blob) hashes.add(f.blob)
    for (const f of session.manifest.designFiles()) {
      const h = session.openDesign(f.id)
      try {
        await h.ready
        const copy = new CadDocument(cloneYDoc(h.doc.ydoc))
        designs.set(f.id, copy)
        for (const hash of designAssetHashes(copy)) hashes.add(hash)
      } finally {
        h.release()
      }
    }
    const assets: ProjectArchive['assets'] = []
    for (const hash of hashes) {
      const buf = await session.assets.get(hash)
      if (!buf) continue
      assets.push({ hash, bytes: new Uint8Array(buf), mime: (await getBlob(hash))?.mime ?? 'application/octet-stream' })
    }
    return { manifest, designs, assets }
  } finally {
    release()
  }
}

export function disposeArchive(archive: ProjectArchive): void {
  archive.manifest.destroy()
  archive.manifest.ydoc.destroy()
  for (const d of archive.designs.values()) {
    d.destroy()
    d.ydoc.destroy()
  }
}

/** "Download .csbx" for any project the user can view. */
export async function exportProjectFile(projectId: string, user: EditorUser): Promise<{ blob: Blob; fileName: string }> {
  const archive = await collectProject(projectId, user)
  try {
    const blob = await (await io()).exportProjectArchive(archive)
    return { blob, fileName: `${sanitizeFileName(archive.manifest.info.name, 'project')}${ARCHIVE_EXT}` }
  } finally {
    disposeArchive(archive)
  }
}

/** Import a .csbx as a NEW local project (fresh id; file ids are kept). Returns the project id. */
export async function importProjectFile(file: File): Promise<string> {
  if (file.size > MAX_ARCHIVE_BYTES) throw new Error('This archive is too large to import')
  const archive = await (await io()).importProjectArchive(new Uint8Array(await file.arrayBuffer()))
  try {
    const id = newProjectId()
    const info = archive.manifest.info
    const manifestState = Y.encodeStateAsUpdate(archive.manifest.ydoc)
    let size = manifestState.byteLength
    await writeDocState(docNames.manifest(id), manifestState)
    for (const [fileId, doc] of archive.designs) {
      const state = Y.encodeStateAsUpdate(doc.ydoc)
      size += state.byteLength
      await writeDocState(docNames.file(id, fileId), state)
    }
    for (const a of archive.assets) {
      if (!isHash(a.hash)) continue // integrity is verified by importProjectArchive
      await putBlob(a.bytes, a.mime, a.hash)
      await linkBlob(id, a.hash, false)
      size += a.bytes.byteLength
    }
    const t = Date.now()
    await putLocalProject({
      id,
      name: (info.name || file.name.replace(/\.csbx$/i, '') || 'Imported project').slice(0, 120),
      description: info.description ?? '',
      folderId: null,
      starred: false,
      createdAt: t,
      updatedAt: t,
      deletedAt: null,
      sizeBytes: size,
    })
    return id
  } finally {
    disposeArchive(archive)
  }
}
