import { makeNode, type DoorStyle, type WindowStyle } from '@cadsandbox/doc'
import { describe, expect, it } from 'vitest'
import { defaultContext } from '../context'
import { evaluateOpening } from './index'

const ident = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const host = { wall: makeNode({ type: 'wall', params: { a: [0, 0], b: [4, 0], thickness: 0.24, height: 2.75 } }).params, toLocal: ident, openingIndex: 0 }

describe('openings', () => {
  const doors: DoorStyle[] = ['single', 'double', 'sliding', 'double-sliding', 'folding', 'pocket', 'garage', 'revolving']
  for (const style of doors) {
    it(`door ${style} builds 3D + plan symbol placed on the wall`, () => {
      const n = makeNode({ type: 'opening', params: { kind: 'door', style, offset: 1.5, width: 0.885, height: 2.01 } })
      const r = evaluateOpening(n, defaultContext({ host }))
      expect(r.error).toBeUndefined()
      expect(r.parts.length).toBeGreaterThan(0)
      expect(r.plan!.lines.length).toBeGreaterThan(0)
      // centered at offset 1.5 along the wall axis, sitting on the wall base
      // (the pocket symbol extends into the wall pocket beside the opening)
      if (style !== 'pocket') expect((r.bounds.min[0] + r.bounds.max[0]) / 2).toBeCloseTo(1.5, 1)
      expect(r.bounds.min[2]).toBeGreaterThan(-0.1)
      expect(r.quantities!.area).toBeCloseTo(0.885 * 2.01, 6)
    })
  }
  const windows: WindowStyle[] = ['casement', 'double-casement', 'fixed', 'sliding', 'tilt-turn', 'awning', 'hung', 'bay', 'skylight']
  for (const style of windows) {
    it(`window ${style} has glass parts and a plan symbol`, () => {
      const n = makeNode({ type: 'opening', params: { kind: 'window', style, offset: 2, width: 1.01, height: 1.26, sill: 0.9, frameWidth: 0.07, frameDepth: 0.08 } })
      const r = evaluateOpening(n, defaultContext({ host }))
      expect(r.error).toBeUndefined()
      expect(r.parts.some((p) => p.material !== 'node' && (p.material as { id: string }).id === 'mat-glass')).toBe(true)
      expect(r.bounds.min[2]).toBeCloseTo(0.9, 1)
      expect(r.plan!.lines.length).toBeGreaterThan(0)
    })
  }
  it('plain opening yields bounds and a lintel line only', () => {
    const n = makeNode({ type: 'opening', params: { kind: 'opening', style: 'none', offset: 1, width: 1, height: 2.1, sill: 0, frameWidth: 0, frameDepth: 0 } })
    const r = evaluateOpening(n, defaultContext({ host }))
    expect(r.parts.length).toBe(0)
    expect(r.bounds.max[2]).toBeCloseTo(2.1, 6)
    expect(r.plan!.lines[0]!.style).toBe('overhead')
  })
  it('window above the cut plane is drawn as overhead outline', () => {
    const n = makeNode({ type: 'opening', params: { kind: 'window', style: 'fixed', offset: 1, width: 0.6, height: 0.6, sill: 1.8 } })
    const r = evaluateOpening(n, defaultContext({ host }))
    expect(r.plan!.lines.every((l) => l.style === 'overhead')).toBe(true)
  })
  it('free-standing opening uses the node frame', () => {
    const n = makeNode({ type: 'opening', params: { kind: 'door', style: 'single', offset: 0, width: 0.9, height: 2.0 } })
    const r = evaluateOpening(n, defaultContext())
    expect((r.bounds.min[0] + r.bounds.max[0]) / 2).toBeCloseTo(0, 1)
  })
})
