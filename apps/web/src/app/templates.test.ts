import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { CadDocument, ProjectManifest } from '@cadsandbox/doc'
import { buildProject } from '../data/seed'
import { TEMPLATES, getTemplate } from './templates'

function open(state: Uint8Array): CadDocument {
  const ydoc = new Y.Doc()
  Y.applyUpdate(ydoc, state)
  return new CadDocument(ydoc)
}

function countTypes(doc: CadDocument): Record<string, number> {
  const out: Record<string, number> = {}
  for (const n of doc.allNodes()) out[n.type] = (out[n.type] ?? 0) + 1
  return out
}

describe('project templates', () => {
  it.each(TEMPLATES.map((t) => [t.id]))('%s builds a valid project', (id) => {
    const tpl = getTemplate(id)
    const built = buildProject('Test', tpl.seed())
    const mdoc = new Y.Doc()
    Y.applyUpdate(mdoc, built.manifest)
    const manifest = new ProjectManifest(mdoc)
    expect(manifest.info.name).toBe('Test')
    expect(manifest.info.mainFile).toBe(built.mainFile)
    expect(manifest.designFiles().map((f) => f.id)).toEqual([...built.designs.keys()])
    const doc = open(built.designs.get(built.mainFile)!)
    expect(doc.meta.units.length).toBe(tpl.units)
    expect(doc.canUndo()).toBe(false) // templates must not be undoable
  })

  it('floor plan contains a furnished, closed two-room house', () => {
    const built = buildProject('House', getTemplate('floorplan').seed())
    const doc = open(built.designs.get(built.mainFile)!)
    const types = countTypes(doc)
    expect(types).toMatchObject({ level: 1, wall: 5, slab: 1, roof: 1, room: 2 })
    expect(types.opening).toBeGreaterThanOrEqual(6)
    expect(types.furniture).toBeGreaterThanOrEqual(10)
    const level = doc.levels()[0]!
    expect(doc.meta.activeLevel).toBe(level.id)
    // every architectural element sits on the level; openings are hosted by walls
    for (const n of doc.allNodes()) {
      if (n.type === 'opening') expect(doc.getNode(n.parent!)?.type).toBe('wall')
      else if (n.type !== 'level') expect(n.parent).toBe(level.id)
    }
  })

  it('2D drawing uses custom layers for its entities', () => {
    const built = buildProject('Drawing', getTemplate('drawing').seed())
    const doc = open(built.designs.get(built.mainFile)!)
    const layerIds = new Set(doc.listLayers().map((l) => l.id))
    expect(doc.listLayers().some((l) => l.name === 'Center Lines')).toBe(true)
    for (const n of doc.allNodes()) expect(n.layer === null || layerIds.has(n.layer)).toBe(true)
    expect(countTypes(doc)).toMatchObject({ dimension: 3, hatch: 1, leader: 1 })
  })
})
