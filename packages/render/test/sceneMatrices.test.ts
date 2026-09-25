// Placement invariant: every rendered copy of a node (group, standalone/picking meshes, batch
// instances of parts/edges/wire, standalone edge/wire objects) sits at doc.getWorldMatrix(id) —
// after load of nested rotated/scaled transforms, moves of leaves/groups/levels, previews + commits,
// pull-out/push-back of selected nodes, render-mode switches, visibility changes, undo/redo,
// re-parenting and remote (Yjs) updates. SceneSync.placementViolations is the one check shared with
// the dev assertion in the web app.
import { CadDocument, quatFromAxisAngle } from '@cadsandbox/doc'
import type { RenderMode } from '@cadsandbox/doc'
import { createGeometryService } from '@cadsandbox/geometry'
import * as THREE from 'three'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { describe, expect, it } from 'vitest'
import type { HatchTextures } from '../src/materials/hatch'
import type { MaterialCache } from '../src/materials/materials'
import type { LineStyleMaterials } from '../src/scene/drawing'
import { SceneSync } from '../src/scene/sceneSync'
import type { ThemeColors } from '../src/util/css'

const lineMat = new THREE.LineBasicMaterial()
const materials = {
  resolveDef: () => ({ def: {}, id: 'mat-default', tint: null }),
  get: () => new THREE.MeshBasicMaterial(),
  edges: () => lineMat,
  wire: () => ({ front: lineMat, back: lineMat }),
  edgeShaded: lineMat,
  fallback: {},
} as unknown as MaterialCache
const lineMaterials = { get: () => new LineMaterial(), setMonochrome: () => {} } as unknown as LineStyleMaterials
const hatches = { get: () => null } as unknown as HatchTextures
const theme = { get: () => ({ color: new THREE.Color(0x888888) }), css: () => '#888888', isDark: false } as unknown as ThemeColors

type V3 = [number, number, number]
const T = (p: V3, deg = 0, s: V3 = [1, 1, 1]) => ({ p, r: quatFromAxisAngle([0, 0, 1], (deg * Math.PI) / 180), s })
const box = { shape: 'box' as const, width: 1, depth: 1, height: 1 }
const MODES: RenderMode[] = ['shaded', 'realistic', 'clay', 'wireframe', 'xray', 'hidden-line', 'technical']

async function setup() {
  const doc = new CadDocument()
  // an elevated level with a rotated + scaled group hierarchy, plus walls with an opening
  const level = doc.addNode({ type: 'level', name: 'Upper', params: { height: 3, cutHeight: 1.1, number: 1 }, t: T([0, 0, 3.5]) })
  const g = doc.addNode({ type: 'group', name: 'G', parent: level, t: T([12, 2, 0], 30, [2, 1.5, 1]), params: {} })
  const c1 = doc.addNode({ type: 'primitive', name: 'C1', parent: g, t: T([0, 0, 0]), params: box })
  const c2 = doc.addNode({ type: 'primitive', name: 'C2', parent: g, t: T([2, 0, 0], -45), params: box })
  const g2 = doc.addNode({ type: 'group', name: 'G2', parent: g, t: T([0, 3, 0], 15, [0.5, 0.5, 2]), params: {} })
  const c3 = doc.addNode({ type: 'primitive', name: 'C3', parent: g2, t: T([1, 0, 0]), params: box })
  const free = doc.addNode({ type: 'primitive', name: 'Free', parent: level, t: T([-3, 0, 0]), params: box })
  const wall = doc.addNode({ type: 'wall', name: 'Wall', parent: level, params: { a: [0, 0], b: [6, 0], thickness: 0.3, height: 2.75 }, t: T([20, 0, 0], 20) })
  const wall2 = doc.addNode({ type: 'wall', name: 'Wall 2', parent: level, params: { a: [6, 0], b: [6, 4], thickness: 0.3, height: 2.75 }, t: T([20, 0, 0], 20) })
  const door = doc.addNode({ type: 'opening', name: 'Door', parent: wall, params: { kind: 'door', style: 'single', offset: 2, width: 0.9, height: 2.1, sill: 0, hinge: 'left', opensTo: 'left' } })
  const geometry = createGeometryService({ doc, assets: { get: async () => null }, workers: 0 })
  await geometry.idle()
  const sync = new SceneSync({ doc, geometry, materials, lineMaterials, hatches, theme, requestRender: () => {} })
  sync.flush()
  return { doc, geometry, sync, ids: { level, g, c1, c2, g2, c3, free, wall, wall2, door } }
}

/** Let re-evaluations triggered by a document change finish and reach the scene (as frames would). */
async function settle(geometry: { idle(): Promise<void> }): Promise<void> {
  await geometry.idle()
  await new Promise((r) => setTimeout(r, 0))
}

async function expectConsistent(sync: SceneSync, geometry: { idle(): Promise<void> }, label: string): Promise<void> {
  await settle(geometry)
  sync.flush()
  expect(sync.placementViolations(), label).toEqual([])
}

const move = (doc: CadDocument, id: string, dx: number, dy: number, dz: number) => {
  const n = doc.getNode(id)!
  doc.updateNodes([{ id, patch: { t: { p: [n.t.p[0] + dx, n.t.p[1] + dy, n.t.p[2] + dz], r: n.t.r, s: n.t.s } } }])
}

describe('SceneSync placement invariant', () => {
  it('holds through transforms, selection, modes, visibility, undo/redo, re-parenting and remote updates', async () => {
    const { doc, geometry, sync, ids } = await setup()
    try {
      await expectConsistent(sync, geometry, 'loaded with nested rotated/scaled transforms')
      const withParts = [...sync.views.values()].filter((v) => v.parts.length)
      expect(withParts.length).toBeGreaterThanOrEqual(7) // 4 boxes, 2 walls, door
      // the elevated level lifts everything
      expect(sync.views.get(ids.c1)!.group.matrixWorld.elements[14]).toBeCloseTo(3.5, 9)
      expect(sync.views.get(ids.door)!.group.matrixWorld.elements[14]).toBeCloseTo(3.5, 9)

      move(doc, ids.c1, 0.5, 0, 0) // leaf
      await expectConsistent(sync, geometry, 'leaf moved')
      move(doc, ids.g, 0, 1, 0) // rotated/scaled group → children and grandchildren follow
      await expectConsistent(sync, geometry, 'group moved')
      doc.updateNodes([{ id: ids.g2, patch: { t: T([0, 3, 0.5], 75, [1, 1, 1]) } }]) // rotate + rescale a nested group
      await expectConsistent(sync, geometry, 'nested group rotated/scaled')
      move(doc, ids.level, 0, 0, 0.7) // level → everything follows
      await expectConsistent(sync, geometry, 'level moved')
      move(doc, ids.wall, 0, 2, 0) // host wall → its opening follows
      await expectConsistent(sync, geometry, 'wall moved')

      // gizmo placement: bounds queried right after a doc write, before any frame flush
      move(doc, ids.free, 1, 0, 0)
      const b = sync.worldBounds([ids.free], new THREE.Box3())
      const w = doc.getWorldMatrix(ids.free)
      expect(b.min.x).toBeCloseTo(w[12]! - 0.5, 6)
      expect(b.min.z).toBeCloseTo(w[14]!, 6)
      await expectConsistent(sync, geometry, 'bounds query')

      // interactive drag: preview at frame rate, throttled writes, exact final write, preview cleared
      const local = sync.views.get(ids.g)!.group.matrix.clone()
      local.elements[12] += 2
      sync.setPreviewTransform(ids.g, local)
      await settle(geometry)
      sync.flush()
      expect(sync.views.get(ids.g)!.group.matrix.equals(local)).toBe(true)
      move(doc, ids.g, 1, 0, 0) // throttled intermediate write (preview still active)
      await settle(geometry)
      sync.flush()
      expect(sync.views.get(ids.g)!.group.matrix.equals(local)).toBe(true)
      move(doc, ids.g, 1, 0, 0) // final exact write
      sync.setPreviewTransform(ids.g, null)
      await expectConsistent(sync, geometry, 'preview committed')

      // selection pulls parts out of the batch; wireframe mode adds standalone wire objects
      sync.setActive(new Set([ids.c2]))
      await expectConsistent(sync, geometry, 'selected')
      expect(sync.views.get(ids.c2)!.pulled).toBe(true)
      for (const mode of MODES) {
        sync.applyMode(mode)
        await expectConsistent(sync, geometry, `mode ${mode} (selected)`)
      }
      sync.applyMode('wireframe')
      expect(sync.views.get(ids.c2)!.wire?.parent).toBe(sync.views.get(ids.c2)!.content)
      move(doc, ids.g, 0, 0.5, 0)
      await expectConsistent(sync, geometry, 'group moved with selected child (wireframe)')
      move(doc, ids.c2, 0, 0, 0.25)
      await expectConsistent(sync, geometry, 'selected node moved')
      sync.setActive(new Set())
      await expectConsistent(sync, geometry, 'deselected')
      sync.setActive(new Set([ids.c2, ids.c3, ids.wall]))
      await expectConsistent(sync, geometry, 'multi-selected')
      move(doc, ids.level, 1, 0, 0)
      await expectConsistent(sync, geometry, 'level moved with multi-selection')
      sync.setActive(new Set())
      sync.applyMode('shaded')
      await expectConsistent(sync, geometry, 'deselected again')

      // visibility toggles never move anything
      doc.updateNodes([{ id: ids.g, patch: { visible: false } }])
      await expectConsistent(sync, geometry, 'group hidden')
      doc.updateNodes([{ id: ids.g, patch: { visible: true } }])
      await expectConsistent(sync, geometry, 'group shown')

      // undo/redo of one move (a fresh undo step; the setup above is one merged capture)
      doc.stopCapturing()
      move(doc, ids.free, 0, 2, 0)
      await expectConsistent(sync, geometry, 'moved for undo')
      doc.undo()
      expect(doc.getNode(ids.free)!.t.p[1]).toBeCloseTo(0, 9)
      await expectConsistent(sync, geometry, 'undo')
      doc.redo()
      expect(doc.getNode(ids.free)!.t.p[1]).toBeCloseTo(2, 9)
      await expectConsistent(sync, geometry, 'redo')

      // re-parenting: world placement follows the new parent chain
      doc.updateNodes([{ id: ids.c2, patch: { parent: ids.level } }])
      await expectConsistent(sync, geometry, 'reparented')
      expect(sync.views.get(ids.c2)!.group.parent).toBe(sync.views.get(ids.level)!.group)

      // remote update: a collaborator moves the group and the level in another replica
      const remote = new CadDocument()
      remote.applyUpdate(doc.encodeState())
      const rg = remote.getNode(ids.g)!
      remote.updateNodes([
        { id: ids.g, patch: { t: { p: [rg.t.p[0] - 4, rg.t.p[1], rg.t.p[2] + 1], r: quatFromAxisAngle([0, 0, 1], 1.2), s: [1, 2, 1] } } },
        { id: ids.level, patch: { t: T([0, 0, 0.25]) } },
      ])
      doc.applyUpdate(remote.encodeState())
      expect(doc.getNode(ids.g)!.t.s[1]).toBe(2)
      await expectConsistent(sync, geometry, 'remote update')
    } finally {
      sync.dispose()
      geometry.dispose()
    }
  }, 60_000)
})
