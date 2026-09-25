// .csbx — portable project archive (zip). Used for "Download project", GDPR data export, backups and
// offline → cloud upload. Layout (version 1):
//
//   README.txt                  human-readable description of this layout
//   archive.json                index: format, version, project info, designs, assets (+ mime/size)
//   manifest/state.yjs          Yjs update of the project manifest (file tree, CRDT history-free)
//   manifest/manifest.json      the same manifest as plain JSON (info + files)
//   designs/<fileId>.yjs        Yjs update of each design document
//   designs/<fileId>.json       the same design as DocJSON (readable, fallback if the state is damaged)
//   blobs/<sha256>              content-addressed blobs (textures, meshes, images, files)
import * as Y from 'yjs'
import { CadDocument, ProjectManifest, SILENT_ORIGIN } from '@cadsandbox/doc'
import type { DocJSON, FileEntry, ProjectInfo } from '@cadsandbox/doc'
import type { ImportedAsset, ProjectArchive } from './api'
import { blobOf } from './util/bytes'
import { sha256Hex } from './util/hash'

export const ARCHIVE_FORMAT = 'cadsandbox/archive@1'
export const ARCHIVE_VERSION = 1
export const ARCHIVE_MIME = 'application/vnd.cadsandbox.project+zip'

export interface ArchiveIndex {
  format: typeof ARCHIVE_FORMAT
  version: number
  createdAt: string
  generator: string
  project: ProjectInfo
  manifest: { state: string; json: string }
  designs: { fileId: string; name: string; state: string; json: string }[]
  assets: { hash: string; mime: string; size: number; path: string }[]
}

const README = (index: ArchiveIndex) => `CadSandbox project archive (.csbx)
====================================

Project:   ${index.project.name}
Created:   ${index.createdAt}
Format:    ${index.format} (archive version ${index.version})

This is a standard ZIP file. Contents:

  archive.json             Index of this archive (designs, blobs, versions).
  manifest/manifest.json   Project file tree as JSON (folders, designs, files).
  manifest/state.yjs       The same file tree as a Yjs CRDT update.
  designs/<id>.json        Each design as readable JSON ("cadsandbox/doc@1"):
                           scene tree (recipes, not meshes), materials, layers,
                           views, sheets, components, comments. Units: meters, Z-up.
  designs/<id>.yjs         Each design as a Yjs CRDT update (used for re-import).
  blobs/<sha256>           Binary files referenced by the designs (textures,
                           imported meshes in CSBM format, images, attachments),
                           named by the SHA-256 of their content.

Open it again in CadSandbox via "Import project". No account is needed.
`

const COMPRESSED = /^(image\/(png|jpe?g|webp|avif|gif)|application\/(zip|gzip)|model\/(3mf|gltf-binary))/

/** Build a .csbx archive (zip) from a project. */
export async function exportProjectArchive(archive: ProjectArchive): Promise<Blob> {
  const { zipSync, strToU8 } = await import('fflate')
  const info = archive.manifest.info
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 | 6 }]> = {}
  const designs: ArchiveIndex['designs'] = []
  for (const [fileId, doc] of archive.designs) {
    const safe = fileId.replace(/[^A-Za-z0-9_-]/g, '_')
    const state = `designs/${safe}.yjs`,
      json = `designs/${safe}.json`
    files[state] = doc.encodeState()
    files[json] = strToU8(JSON.stringify(doc.toJSON()))
    designs.push({ fileId, name: archive.manifest.getFile(fileId)?.name ?? doc.meta.name, state, json })
  }
  const assets: ArchiveIndex['assets'] = []
  const seen = new Set<string>()
  for (const a of archive.assets) {
    if (seen.has(a.hash)) continue
    seen.add(a.hash)
    const path = `blobs/${a.hash}`
    files[path] = [a.bytes, { level: COMPRESSED.test(a.mime) ? 0 : 6 }]
    assets.push({ hash: a.hash, mime: a.mime, size: a.bytes.byteLength, path })
  }
  const index: ArchiveIndex = {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    createdAt: new Date().toISOString(),
    generator: 'CadSandbox',
    project: info,
    manifest: { state: 'manifest/state.yjs', json: 'manifest/manifest.json' },
    designs,
    assets,
  }
  files['manifest/state.yjs'] = Y.encodeStateAsUpdate(archive.manifest.ydoc)
  files['manifest/manifest.json'] = strToU8(JSON.stringify({ info, files: archive.manifest.listFiles() }, null, 1))
  files['archive.json'] = strToU8(JSON.stringify(index, null, 1))
  files['README.txt'] = strToU8(README(index))
  return blobOf([zipSync(files, { level: 6 })], ARCHIVE_MIME)
}

/** Interim layout written by the web app before io's writer existed ('cadsandbox.json' index). */
interface LegacyIndex {
  format: string
  exportedAt?: string
  project?: { name?: string; description?: string; mainFile?: string | null }
  designs?: { id: string; name: string }[]
  assets?: { hash: string; mime: string; size: number }[]
}

function fromLegacyIndex(li: LegacyIndex): ArchiveIndex {
  if (li.format !== 'cadsandbox/project-archive@1') throw new Error(`Unsupported archive format "${String(li.format)}".`)
  return {
    format: ARCHIVE_FORMAT,
    version: 1,
    createdAt: li.exportedAt ?? '',
    generator: 'CadSandbox',
    project: { name: li.project?.name ?? 'Project', description: li.project?.description ?? '', createdAt: 0, mainFile: li.project?.mainFile ?? null },
    manifest: { state: 'manifest.yjs', json: 'manifest.json' },
    designs: (li.designs ?? []).map((d) => ({ fileId: d.id, name: d.name, state: `designs/${d.id}.yjs`, json: `designs/${d.id}.json` })),
    assets: (li.assets ?? []).map((a) => ({ ...a, path: `assets/${a.hash}` })),
  }
}

function manifestFromJson(json: { info: ProjectInfo; files: FileEntry[] }): ProjectManifest {
  const m = new ProjectManifest(new Y.Doc())
  m.ydoc.transact(() => {
    for (const [k, v] of Object.entries(json.info)) m.infoMap.set(k, v)
    for (const f of json.files) m.filesMap.set(f.id, f)
  }, SILENT_ORIGIN)
  return m
}

/** Read a .csbx archive. Blobs are verified against their sha256 names. */
export async function importProjectArchive(bytes: Uint8Array | ArrayBuffer): Promise<ProjectArchive> {
  const { unzipSync, strFromU8 } = await import('fflate')
  const u8 = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(u8)
  } catch {
    throw new Error('Not a CadSandbox project archive (invalid zip).')
  }
  const raw = entries['archive.json']
  const legacy = entries['cadsandbox.json']
  let index: ArchiveIndex
  if (raw) index = JSON.parse(strFromU8(raw)) as ArchiveIndex
  else if (legacy) index = fromLegacyIndex(JSON.parse(strFromU8(legacy)) as LegacyIndex)
  else throw new Error('Not a CadSandbox project archive (archive.json missing).')
  if (index.format !== ARCHIVE_FORMAT) throw new Error(`Unsupported archive format "${String(index.format)}".`)
  if (index.version > ARCHIVE_VERSION) throw new Error('This project was exported by a newer CadSandbox version — please update.')

  let manifest: ProjectManifest | null = null
  const mState = entries[index.manifest.state]
  if (mState) {
    try {
      const m = new ProjectManifest(new Y.Doc())
      Y.applyUpdate(m.ydoc, mState, SILENT_ORIGIN)
      if (m.listFiles().length || !entries[index.manifest.json]) manifest = m
    } catch {
      manifest = null
    }
  }
  if (!manifest) {
    const mJson = entries[index.manifest.json]
    if (!mJson) throw new Error('Archive is damaged: project manifest missing.')
    manifest = manifestFromJson(JSON.parse(strFromU8(mJson)) as { info: ProjectInfo; files: FileEntry[] })
  }

  const designs = new Map<string, CadDocument>()
  for (const d of index.designs) {
    let doc: CadDocument | null = null
    const state = entries[d.state]
    if (state) {
      try {
        doc = new CadDocument(new Y.Doc())
        doc.applyUpdate(state, SILENT_ORIGIN)
        doc.undoManager.clear()
        if (!doc.nodeIds().length && !doc.meta.name && entries[d.json]) doc = null
      } catch {
        doc = null
      }
    }
    if (!doc) {
      const json = entries[d.json]
      if (!json) throw new Error(`Archive is damaged: design "${d.name}" is missing.`)
      doc = CadDocument.fromJSON(JSON.parse(strFromU8(json)) as DocJSON)
    }
    designs.set(d.fileId, doc)
  }

  const assets: ImportedAsset[] = []
  for (const a of index.assets) {
    const data = entries[a.path]
    if (!data) throw new Error(`Archive is damaged: blob ${a.hash} is missing.`)
    const actual = await sha256Hex(data)
    if (actual !== a.hash) throw new Error(`Archive is damaged: blob ${a.hash} does not match its checksum.`)
    assets.push({ hash: a.hash, bytes: data, mime: a.mime })
  }
  return { manifest, designs, assets }
}
