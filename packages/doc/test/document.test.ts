import { describe, expect, it } from 'vitest'
import { CadDocument, ProjectManifest, type DocChangeEvent } from '../src'

describe('CadDocument', () => {
  it('adds, orders and updates nodes with batched events', () => {
    const doc = CadDocument.create('T')
    const events: DocChangeEvent[] = []
    doc.onChange((e) => events.push(e))
    const [a, b] = doc.addNodes([{ type: 'primitive' }, { type: 'primitive', params: { shape: 'sphere' } }])
    expect(doc.getChildren(null)).toEqual([a, b])
    const c = doc.addNode({ type: 'primitive', before: a })
    expect(doc.getChildren(null)).toEqual([c, a, b])
    expect(events.length).toBe(2)
    doc.updateNode(a!, { params: { width: 2 } })
    const last = events.at(-1)!
    expect(last.nodes.updated.get(a!)?.has('params')).toBe(true)
    expect(last.nodes.params.get(a!)?.has('width')).toBe(true)
    expect(doc.getNode<'primitive'>(a)!.params.width).toBe(2)
    expect(doc.getNode<'primitive'>(b)!.params.shape).toBe('sphere')
  })

  it('undoes and redoes local edits', () => {
    const doc = CadDocument.create()
    const id = doc.addNode({ type: 'primitive' })
    doc.stopCapturing()
    doc.updateNode(id, { name: 'Renamed' })
    doc.undo()
    expect(doc.getNode(id)!.name).not.toBe('Renamed')
    doc.redo()
    expect(doc.getNode(id)!.name).toBe('Renamed')
  })

  it('reparents keeping world position; groups and ungroups', () => {
    const doc = CadDocument.create()
    const g = doc.addNode({ type: 'group', t: { p: [10, 0, 0], r: [0, 0, 0, 1], s: [2, 2, 2] } })
    const n = doc.addNode({ type: 'primitive', t: { p: [1, 2, 3], r: [0, 0, 0, 1], s: [1, 1, 1] } })
    doc.moveNodes([n], g)
    expect(doc.getParent(n)).toBe(g)
    const w = doc.getWorldPosition(n)
    expect(w[0]).toBeCloseTo(1)
    expect(w[1]).toBeCloseTo(2)
    expect(w[2]).toBeCloseTo(3)
    const grp = doc.groupNodes([g])!
    doc.ungroup(grp)
    expect(doc.getWorldPosition(n)[0]).toBeCloseTo(1)
  })

  it('duplicates subtrees and round-trips snapshots', () => {
    const doc = CadDocument.create('S', { withLevel: true })
    const level = doc.levels()[0]!.id
    const wall = doc.addNode({ type: 'wall', parent: level })
    doc.addNode({ type: 'opening', parent: wall, params: { kind: 'window' } })
    const [copy] = doc.duplicateNodes([wall], [0, 5, 0])
    expect(doc.getChildren(copy!).length).toBe(1)
    expect(doc.getWorldPosition(copy!)[1]).toBeCloseTo(5)
    const opening = doc.getNode<'opening'>(doc.getChildren(copy!)[0])!
    expect(opening.params.kind).toBe('window')
    expect(opening.params.sill).toBeCloseTo(0.9)

    const snap = doc.snapshot([wall])
    const other = CadDocument.create()
    const roots = other.insertSnapshot(snap, { offset: [1, 0, 0] })
    expect(other.getDescendants(roots[0]!).length).toBe(1)
  })

  it('creates components and instances', () => {
    const doc = CadDocument.create()
    const a = doc.addNode({ type: 'primitive', t: { p: [3, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] } })
    const res = doc.createComponent([a], 'Chair')!
    expect(doc.getNode(res.instanceId)!.type).toBe('instance')
    expect(doc.isDefinitionNode(a)).toBe(true)
    expect(doc.getWorldPosition(res.instanceId)[0]).toBeCloseTo(3)
    expect(doc.getChildren(null)).toEqual([res.instanceId])
  })

  it('syncs between two replicas', () => {
    const a = CadDocument.create()
    const b = new CadDocument()
    b.applyUpdate(a.encodeState())
    const id = a.addNode({ type: 'primitive' })
    b.applyUpdate(a.encodeState())
    expect(b.getNode(id)?.type).toBe('primitive')
    expect(b.getChildren(null)).toContain(id)
  })
})

describe('ProjectManifest', () => {
  it('manages a file tree with unique names', () => {
    const { manifest, mainFile } = ProjectManifest.create('P')
    expect(manifest.info.mainFile).toBe(mainFile)
    const folder = manifest.addFile({ name: 'Textures', kind: 'folder' })
    const f1 = manifest.addFile({ name: 'wood.png', kind: 'asset', parent: folder, mime: 'image/png', size: 10, blob: 'x' })
    const f2 = manifest.addFile({ name: 'wood.png', kind: 'asset', parent: folder })
    expect(manifest.getFile(f2)!.name).toBe('wood 2.png')
    expect(manifest.children(folder).map((f) => f.id)).toEqual([f1, f2])
    expect(manifest.remove(folder).length).toBe(3)
  })
})
