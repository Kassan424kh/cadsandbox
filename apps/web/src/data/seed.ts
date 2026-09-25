// Building new project content (manifest + design docs) from a seed — used for templates, new
// projects (local and cloud) and `ProjectSession.createDesign`.
import * as Y from 'yjs'
import { CadDocument, ProjectManifest, SILENT_ORIGIN, newId, type DocSnapshot, type ProjectInfo } from '@cadsandbox/doc'
import type { LengthUnit } from '@cadsandbox/shared'
import { getPrefs } from './prefs'

export type DesignInit = DocSnapshot | ((doc: CadDocument) => void)

export interface ProjectSeed {
  description?: string
  /** First entry becomes the main file. At least one design. */
  designs: { name: string; init?: DesignInit }[]
  units?: LengthUnit
}

/** Display precision (decimals) that suits each length unit. */
const PRECISION: Record<LengthUnit, number> = { mm: 0, cm: 1, m: 2, in: 2, ft: 2 }

/** Fill a brand-new (empty) design doc. Never call on a doc loaded from storage/server. */
export function seedDesign(doc: CadDocument, name: string, init?: DesignInit, units: LengthUnit = getPrefs().units): void {
  doc.initialize(name)
  doc.ydoc.transact(() => {
    doc.metaMap.set('units', { ...doc.meta.units, length: units, precision: PRECISION[units] })
  }, SILENT_ORIGIN)
  if (typeof init === 'function') init(doc)
  else if (init) doc.insertSnapshot(init)
  doc.undoManager.clear()
}

export interface BuiltProject {
  manifest: Uint8Array
  designs: Map<string, Uint8Array>
  mainFile: string
}

/** Build the Yjs states of a new project (nothing persisted yet). */
export function buildProject(name: string, seed: ProjectSeed, createdBy: string | null = null): BuiltProject {
  const mydoc = new Y.Doc()
  const manifest = new ProjectManifest(mydoc)
  const designs = new Map<string, Uint8Array>()
  let mainFile = ''
  try {
    const defs = seed.designs.length ? seed.designs : [{ name: 'Main' }]
    for (const def of defs) {
      const fileId = newId()
      const ydoc = new Y.Doc()
      const doc = new CadDocument(ydoc)
      try {
        seedDesign(doc, def.name, def.init, seed.units)
        designs.set(fileId, Y.encodeStateAsUpdate(ydoc))
      } finally {
        doc.destroy()
        ydoc.destroy()
      }
      manifest.addFile({ id: fileId, name: def.name, kind: 'design', createdBy })
      mainFile ||= fileId
    }
    const info: ProjectInfo = { name: name.trim() || 'Untitled', description: seed.description ?? '', createdAt: Date.now(), mainFile }
    mydoc.transact(() => {
      for (const [k, v] of Object.entries(info)) manifest.infoMap.set(k, v)
    }, SILENT_ORIGIN)
    manifest.undoManager.clear()
    return { manifest: Y.encodeStateAsUpdate(mydoc), designs, mainFile }
  } finally {
    manifest.destroy()
    mydoc.destroy()
  }
}
