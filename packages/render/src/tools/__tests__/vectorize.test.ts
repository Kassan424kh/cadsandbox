import { describe, expect, it } from 'vitest'
import type { GeometryResult } from '@cadsandbox/geometry'
import { boxMesh } from '../vectorize/mesh'
import { vectorizeView } from '../vectorize'
import { MockContext, addWallLoop } from './mockContext'

/** Result of a box (local, base at z0) as the geometry engine would produce it. */
function boxResult(w: number, d: number, h: number, z0 = 0): GeometryResult {
  const mesh = boxMesh(w, d, h, z0)
  return { parts: [{ mesh, material: 'node' }], bounds: { min: [-w / 2, -d / 2, z0], max: [w / 2, d / 2, z0 + h] } }
}

function segmentsOf(d: { lines: { style: string; segments: Float32Array }[] }, style: string): number {
  return d.lines.filter((l) => l.style === style).reduce((s, l) => s + l.segments.length / 4, 0)
}

describe('vectorizeView', () => {
  it('plan: cuts generic solids at the level cut height and draws drafting/arch fallbacks', async () => {
    const ctx = new MockContext()
    const levelId = ctx.levelId!
    // a 1×1×2 box crossing the 1.1 m cut plane, a low box below it, a wall (no result → footprint fallback)
    const tall = ctx.doc.addNode({ type: 'primitive', parent: levelId, t: { p: [2, 2, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }, params: { shape: 'box', width: 1, depth: 1, height: 2 } })
    const low = ctx.doc.addNode({ type: 'primitive', parent: levelId, t: { p: [5, 2, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }, params: { shape: 'box', width: 1, depth: 1, height: 0.5 } })
    ctx.geometry.results.set(tall, boxResult(1, 1, 2))
    ctx.geometry.results.set(low, boxResult(1, 1, 0.5))
    addWallLoop(ctx, 0, 0, 8, 6)
    ctx.doc.addNode({ type: 'line', parent: levelId, params: { a: [0, -1], b: [8, -1] } })
    const d = await vectorizeView({ doc: ctx.doc, geometry: ctx.geometry }, { kind: 'plan', levelId })
    expect(segmentsOf(d, 'cut')).toBeGreaterThanOrEqual(4 + 16) // tall box cut (4) + 4 wall outlines
    expect(segmentsOf(d, 'visible')).toBeGreaterThan(0) // low box edges below the cut
    expect(segmentsOf(d, 'drafting')).toBe(1)
    expect(d.bounds.min[0]).toBeLessThanOrEqual(-0.119)
    expect(d.bounds.max[0]).toBeGreaterThanOrEqual(8.119)
    // the tall box cut square is 1×1 around (2,2)
    const cut = d.lines.find((l) => l.style === 'cut')!.segments
    let found = false
    for (let i = 0; i < cut.length; i += 4) if (Math.abs(cut[i] - 1.5) < 1e-6 && Math.abs(cut[i + 2] - 1.5) < 1e-6) found = true
    expect(found).toBe(true)
  })

  it('section: cut polygons get material hatches, edges beyond the plane are hidden-line tested', async () => {
    const ctx = new MockContext()
    const levelId = ctx.levelId!
    const front = ctx.doc.addNode({ type: 'primitive', parent: levelId, t: { p: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }, material: 'mat-concrete', params: { shape: 'box', width: 2, depth: 2, height: 2 } })
    const behind = ctx.doc.addNode({ type: 'primitive', parent: levelId, t: { p: [0, 5, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }, params: { shape: 'box', width: 1, depth: 1, height: 1 } })
    ctx.geometry.results.set(front, boxResult(2, 2, 2))
    ctx.geometry.results.set(behind, boxResult(1, 1, 1))
    // vertical section plane y = 0 looking toward +Y: local Z (normal) = −Y, local X = +X
    const q: [number, number, number, number] = [Math.SQRT1_2, 0, 0, Math.SQRT1_2] // +90° about X: Z → −Y? (0,0,1) → (0,-1,0)
    const section = ctx.doc.addNode({ type: 'section', parent: null, t: { p: [0, 0, 0], r: q, s: [1, 1, 1] }, params: { enabled: true, showCaps: true, label: 'A', depth: 0 } })
    const d = await vectorizeView({ doc: ctx.doc, geometry: ctx.geometry }, { kind: 'section', sectionId: section })
    expect(d.fills).toHaveLength(1)
    expect(d.fills[0].pattern).toBe('concrete')
    const outer = d.fills[0].polygons[0].outer
    const xs = outer.map((p) => p[0]),
      ys = outer.map((p) => p[1])
    expect(Math.min(...xs)).toBeCloseTo(-1)
    expect(Math.max(...xs)).toBeCloseTo(1)
    expect(Math.min(...ys)).toBeCloseTo(0)
    expect(Math.max(...ys)).toBeCloseTo(2)
    // the small box behind is fully hidden by the front box's cut body → no visible edges from it
    // (its top at z=1 lies inside the 2 m tall silhouette)
    const visible = d.lines.find((l) => l.style === 'visible')
    const vis = visible ? visible.segments : new Float32Array(0)
    let leak = false
    for (let i = 0; i < vis.length; i += 4) if (Math.abs(vis[i]) < 0.49 && vis[i + 1] > 0.05 && vis[i + 1] < 0.95) leak = true
    expect(leak).toBe(false)
    expect(segmentsOf(d, 'cut')).toBeGreaterThanOrEqual(4)
  })

  it('elevation: projects feature edges with a ground line; north view mirrors X', async () => {
    const ctx = new MockContext()
    const levelId = ctx.levelId!
    const low = ctx.doc.addNode({ type: 'primitive', parent: levelId, t: { p: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }, params: { shape: 'box', width: 1, depth: 1, height: 1 } })
    const tall = ctx.doc.addNode({ type: 'primitive', parent: levelId, t: { p: [4, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }, params: { shape: 'box', width: 1, depth: 1, height: 3 } })
    ctx.geometry.results.set(low, boxResult(1, 1, 1))
    ctx.geometry.results.set(tall, boxResult(1, 1, 3))
    const d = await vectorizeView({ doc: ctx.doc, geometry: ctx.geometry }, { kind: 'elevation', direction: 'north' })
    expect(segmentsOf(d, 'visible')).toBeGreaterThanOrEqual(8)
    expect(segmentsOf(d, 'cut')).toBe(1) // ground line
    expect(d.bounds.max[1]).toBeCloseTo(3, 1)
    // viewed from the north, +X appears on the left: the tall box (x = 4) must be at negative u
    const vis = d.lines.find((l) => l.style === 'visible')!.segments
    for (let i = 0; i < vis.length; i += 4) if (vis[i + 1] > 2.5 && vis[i + 3] > 2.5) expect(vis[i]).toBeLessThan(0)
  })

  it('schedule: rooms table lists rooms with areas (local computation)', async () => {
    const ctx = new MockContext()
    ctx.doc.addNode({ type: 'room', parent: ctx.levelId, name: 'Kitchen', params: { outline: [[0, 0], [4, 0], [4, 3], [0, 3]], number: '0.01', usage: 'NUF1', showLabel: true } })
    const d = await vectorizeView({ doc: ctx.doc, geometry: ctx.geometry }, { kind: 'schedule', schedule: 'rooms' })
    const texts = d.texts.map((t) => t.text)
    expect(texts).toContain('Room schedule')
    expect(texts).toContain('0.01')
    expect(texts).toContain('Kitchen')
    expect(texts).toContain('12.00')
    expect(d.lines.length).toBeGreaterThan(0)
    expect(d.bounds.max[1]).toBe(0)
    expect(d.bounds.min[1]).toBeLessThan(-1.5)
  })
})
