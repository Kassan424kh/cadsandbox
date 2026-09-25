// Helpers to insert an ImportResult into a design: merges imported layers (by id or name) and places
// planar content (DXF, SVG, images, meshes) on a level's plane. Blobs (result.assets) must be put
// into the asset store by the caller before or after inserting.
import type { AnyNode, CadDocument, DocSnapshot, Vec3 } from '@cadsandbox/doc'
import type { ImportResult } from './api'

/** Add the imported layers to `doc` (reusing existing layers with the same id or name) and return
 *  the snapshot with node layer ids remapped accordingly. */
export function mergeImportLayers(doc: CadDocument, result: ImportResult): DocSnapshot {
  const map = new Map<string, string>()
  const existing = doc.listLayers()
  for (const l of result.layers ?? []) {
    if (doc.getLayer(l.id)) {
      map.set(l.id, l.id)
      continue
    }
    const byName = existing.find((x) => x.name.trim().toLowerCase() === l.name.trim().toLowerCase())
    map.set(l.id, byName ? byName.id : doc.addLayer({ ...l }))
  }
  if (![...map].some(([a, b]) => a !== b)) return result.snapshot
  const remap = (n: AnyNode): AnyNode => (n.layer && map.has(n.layer) && map.get(n.layer) !== n.layer ? ({ ...n, layer: map.get(n.layer)! } as AnyNode) : n)
  return { ...result.snapshot, nodes: result.snapshot.nodes.map(remap), componentNodes: result.snapshot.componentNodes.map(remap) }
}

/**
 * Insert an import into the document. Content without its own storeys is placed on `levelId`
 * (lifted to the level's elevation); IFC-like content that brings its own levels goes to the root.
 * Returns the new root node ids.
 */
export function insertImportResult(doc: CadDocument, result: ImportResult, opts: { levelId?: string | null; offset?: Vec3 } = {}): string[] {
  const snapshot = mergeImportLayers(doc, result)
  const ownLevels = snapshot.nodes.some((n) => n.type === 'level' && n.parent === null)
  const parent = !ownLevels && opts.levelId && doc.hasNode(opts.levelId) ? opts.levelId : null
  const elevation = parent ? doc.getWorldPosition(parent)[2] : 0
  const off = opts.offset ?? [0, 0, 0]
  return doc.insertSnapshot(snapshot, { parent, offset: [off[0], off[1], off[2] + elevation] })
}
