import { describe, expect, it } from 'vitest'
import { CadDocument } from '@cadsandbox/doc'
import type { AnyNode } from '@cadsandbox/doc'
import { exportIfc } from '../export/ifc'
import { ifcGuid, isIfcGuid, R, S } from '../export/ifc-step'
import { importIfc } from '../import/ifc'
import { loadWebIfc } from '../wasm'
import { buildingDoc, exportContext } from './helpers'

async function exportBytes(): Promise<Uint8Array> {
  const doc = buildingDoc()
  const res = await exportIfc(exportContext(doc), {})
  expect(res.fileName).toBe('Test House.ifc')
  return new Uint8Array(await res.blob.arrayBuffer())
}

describe('IFC step primitives', () => {
  it('formats reals, strings and GlobalIds', () => {
    expect(R(1)).toBe('1.')
    expect(R(0.25)).toBe('0.25')
    expect(R(1e-7)).toBe('1.E-7')
    expect(S("it's Größe")).toBe("'it''s Gr\\X2\\00F6\\X0\\\\X2\\00DF\\X0\\e'")
    const g = ifcGuid(new Uint8Array(16).fill(255))
    expect(g).toHaveLength(22)
    expect(g[0]).toBe('3')
    expect(isIfcGuid(g)).toBe(true)
  })
})

async function guidsOf(bytes: Uint8Array, type: 'IFCWALL' | 'IFCSPACE' | 'IFCDOOR' | 'IFCBUILDINGELEMENTPROXY'): Promise<string[]> {
  const { api, mod: W } = await loadWebIfc()
  const id = api.OpenModel(bytes)
  try {
    const v = api.GetLineIDsWithType(id, W[type])
    const out: string[] = []
    for (let i = 0; i < v.size(); i++) out.push(api.GetLine(id, v.get(i)).GlobalId.value as string)
    return out.sort()
  } finally {
    api.CloseModel(id)
  }
}

describe('IFC export', () => {
  it('keeps GlobalIds and entity types through IFC → CadSandbox → IFC', async () => {
    const first = await exportBytes()
    const imported = await importIfc('house.ifc', first, {})
    const doc = CadDocument.create('Reimported')
    doc.insertSnapshot(imported.snapshot)
    const second = new Uint8Array(await (await exportIfc(exportContext(doc), {})).blob.arrayBuffer())
    for (const t of ['IFCWALL', 'IFCSPACE', 'IFCDOOR'] as const) expect(await guidsOf(second, t)).toEqual(await guidsOf(first, t))
  }, 60_000)

  it('re-opens in web-ifc with storeys, walls, openings and spaces', async () => {
    const bytes = await exportBytes()
    const { api, mod: W } = await loadWebIfc()
    const id = api.OpenModel(bytes)
    try {
      expect(api.GetModelSchema(id)).toBe('IFC4')
      const count = (t: number) => api.GetLineIDsWithType(id, t).size()
      expect(count(W.IFCBUILDINGSTOREY)).toBe(2)
      expect(count(W.IFCWALL)).toBe(4)
      expect(count(W.IFCSPACE)).toBe(1)
      expect(count(W.IFCSLAB)).toBe(1)
      expect(count(W.IFCOPENINGELEMENT)).toBe(2)
      expect(count(W.IFCDOOR)).toBe(1)
      expect(count(W.IFCWINDOW)).toBe(1)
      expect(count(W.IFCBUILDINGELEMENTPROXY)).toBe(1)
      expect(count(W.IFCRELVOIDSELEMENT)).toBe(2)
      expect(count(W.IFCRELFILLSELEMENT)).toBe(2)
      // every rooted entity has a valid, unique GlobalId
      const guids = new Set<string>()
      for (const t of [W.IFCWALL, W.IFCSPACE, W.IFCBUILDINGSTOREY, W.IFCDOOR]) {
        const v = api.GetLineIDsWithType(id, t)
        for (let i = 0; i < v.size(); i++) {
          const g = api.GetLine(id, v.get(i)).GlobalId.value as string
          expect(isIfcGuid(g)).toBe(true)
          guids.add(g)
        }
      }
      expect(guids.size).toBe(8)
      // geometry is generated for the swept solids
      let meshes = 0
      api.StreamAllMeshes(id, () => meshes++)
      expect(meshes).toBeGreaterThanOrEqual(8)
    } finally {
      api.CloseModel(id)
    }
  }, 30_000)

  it('imports its own export back into parametric walls, openings, rooms and levels', async () => {
    const bytes = await exportBytes()
    const res = await importIfc('house.ifc', bytes, {})
    const nodes = res.snapshot.nodes as AnyNode[]
    const levels = nodes.filter((n) => n.type === 'level')
    expect(levels.map((l) => l.t.p[2])).toEqual([0, 3])
    const walls = nodes.filter((n) => n.type === 'wall')
    expect(walls).toHaveLength(4)
    const south = walls.find((w) => w.name === 'Wall S')!
    expect(south.type === 'wall' && south.params.thickness).toBeCloseTo(0.3, 6)
    expect(south.type === 'wall' && south.params.height).toBeCloseTo(2.75, 6)
    if (south.type === 'wall') {
      expect(south.params.a[0]).toBeCloseTo(0, 6)
      expect(south.params.b[0]).toBeCloseTo(6, 6)
      expect(south.params.exterior).toBe(true)
    }
    const openings = nodes.filter((n) => n.type === 'opening')
    expect(openings).toHaveLength(2)
    const door = openings.find((o) => o.type === 'opening' && o.params.kind === 'door')
    expect(door?.type === 'opening' && door.params.offset).toBeCloseTo(1.5, 3)
    expect(door?.type === 'opening' && door.params.width).toBeCloseTo(1, 3)
    const win = openings.find((o) => o.type === 'opening' && o.params.kind === 'window')
    expect(win?.type === 'opening' && win.params.sill).toBeCloseTo(0.9, 3)
    const rooms = nodes.filter((n) => n.type === 'room')
    expect(rooms).toHaveLength(1)
    expect((rooms[0]!.meta.ifc as { globalId: string }).globalId).toMatch(/^[0-3]/)
    // the proxy box on the upper storey arrives as a mesh under the second level
    const box = nodes.find((n) => n.type === 'mesh' && n.name === 'Box')
    expect(box?.parent).toBe(levels[1]!.id)
    expect(res.assets.length).toBeGreaterThan(0)
  }, 30_000)
})
