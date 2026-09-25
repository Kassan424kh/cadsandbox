import { makeNode, type AnyNode } from '@cadsandbox/doc'
import { describe, expect, it } from 'vitest'
import { evaluateGridline, evaluateLevelmark, evaluateNorthArrow, evaluateScaleBar, formatElevation, sectionLevelmarkDrawing } from './annotation'
import { defaultContext } from './context'
import { evaluateDimension } from './dimension'
import { chainStations } from './dimensionChain'
import { evaluateNodeSync } from './index'

const units = { length: 'm' as const, precision: 2, angle: 'deg' as const, area: 'm2' as const }
const texts = (r: { drawing?: { texts: { text: string }[] } }) => (r.drawing?.texts ?? []).map((t) => t.text)
const segCount = (r: { drawing?: { lines: { segments: ArrayLike<number> }[] } }) => (r.drawing?.lines ?? []).reduce((n, l) => n + l.segments.length / 4, 0)

describe('gridline', () => {
  it('draws the axis, bubbles with the label and offers line snaps + a feature edge', () => {
    const r = evaluateGridline(makeNode({ type: 'gridline', params: { a: [0, 0], b: [0, 10], label: 'B', bubble: 'both' } }))
    expect(r.error).toBeUndefined()
    expect(texts(r)).toEqual(['B', 'B'])
    expect(r.snaps?.filter((s) => s.kind === 'center')).toHaveLength(2)
    expect(r.snaps?.some((s) => s.kind === 'midpoint' && Math.abs(s.p[1] - 5) < 1e-9)).toBe(true)
    expect(Array.from(r.edges ?? [])).toEqual([0, 0, 0, 0, 10, 0])
    expect(r.quantities?.length).toBeCloseTo(10)
    // bubbles extend the bounds beyond the line ends
    expect(r.bounds.min[1]).toBeLessThan(-0.6)
    expect(r.bounds.max[1]).toBeGreaterThan(10.6)
  })
  it('bubble "none" draws only the axis and reports zero-length lines as errors', () => {
    const r = evaluateGridline(makeNode({ type: 'gridline', params: { a: [0, 0], b: [8, 0], label: '1', bubble: 'none' } }))
    expect(texts(r)).toEqual([])
    expect(segCount(r)).toBe(1)
    expect(evaluateGridline(makeNode({ type: 'gridline', params: { a: [1, 1], b: [1, 1], label: 'A', bubble: 'start' } })).error).toBeTruthy()
  })
})

describe('levelmark', () => {
  it('formats signed elevations in doc units', () => {
    expect(formatElevation(2.75, units)).toBe('+2.75 m')
    expect(formatElevation(-1.2, units)).toBe('−1.20 m')
    expect(formatElevation(0, units)).toBe('±0.00 m')
    expect(formatElevation(0.3, { ...units, length: 'mm', precision: 0 })).toBe('+300 mm')
  })
  it('shows the world elevation relative to project zero, or absolute NN heights with a datum', () => {
    const node = makeNode({ type: 'levelmark', params: { variant: 'plan', prefix: 'OKFF' } })
    const rel = evaluateLevelmark(node, defaultContext({ units, elevation: 2.75 }))
    expect(texts(rel)).toEqual(['OKFF +2.75 m'])
    expect(rel.quantities?.elevation).toBeCloseTo(2.75)
    const abs = evaluateLevelmark(node, defaultContext({ units: { ...units, elevationDatum: 312.4, elevationDisplay: 'absolute' }, elevation: 2.75 }))
    expect(texts(abs)).toEqual(['OKFF +315.15 m'])
    // without a service context the node's own z is used
    const local = evaluateLevelmark(makeNode({ type: 'levelmark', t: { p: [0, 0, -1.2], r: [0, 0, 0, 1], s: [1, 1, 1] }, params: { variant: 'plan' } }), defaultContext({ units }))
    expect(texts(local)).toEqual(['−1.20 m'])
    expect(local.snaps?.[0]?.kind).toBe('insertion')
  })
  it('has a section-view flag drawing with the text and a filled half triangle', () => {
    const d = sectionLevelmarkDrawing('+2.75 m', 0.2)
    expect(d.texts[0]?.text).toBe('+2.75 m')
    expect(d.fills).toHaveLength(1)
    expect(d.lines.length).toBeGreaterThan(0)
  })
})

describe('north arrow & scale bar', () => {
  it('north arrow points along +Y rotated by angle and carries an N label', () => {
    const r = evaluateNorthArrow(makeNode({ type: 'northarrow', params: { size: 2, style: 'compass', angle: Math.PI / 2 } }))
    expect(texts(r)).toEqual(['N'])
    const tip = r.snaps?.find((s) => s.kind === 'endpoint')
    // north = +Y rotated 90° CCW = −X
    expect(tip?.p[0]).toBeLessThan(-0.8)
    expect(Math.abs(tip?.p[1] ?? 1)).toBeLessThan(1e-9)
    expect(r.drawing?.fills).toHaveLength(1)
    expect(r.quantities?.angleDeg).toBeCloseTo(90)
  })
  it('scale bar spans its real length with alternating filled blocks and labels', () => {
    const r = evaluateScaleBar(makeNode({ type: 'scalebar', params: { scale: 50, length: 5, segments: 5 } }), defaultContext({ units }))
    expect(r.bounds.max[0] - r.bounds.min[0]).toBeGreaterThanOrEqual(5)
    expect(r.drawing?.fills).toHaveLength(3)
    const t = texts(r)
    expect(t[0]).toBe('0')
    expect(t).toContain('5 m')
    expect(t).toContain('1:50')
    expect(r.quantities).toMatchObject({ length: 5, scale: 50 })
  })
  it('all symbol types evaluate synchronously through the dispatcher', () => {
    for (const type of ['gridline', 'levelmark', 'northarrow', 'scalebar'] as const) {
      const r = evaluateNodeSync(makeNode({ type }) as AnyNode)
      expect(r?.error, type).toBeUndefined()
      expect(r?.drawing?.lines.length, type).toBeGreaterThan(0)
    }
  })
})

describe('chain dimension', () => {
  it('sorts stations along the line and labels every interval', () => {
    expect(chainStations([[0, 0], [3, 0.1], [1, -0.1], [3, 0]], [1, 0])).toEqual([0, 1, 3])
    const node = makeNode({
      type: 'dimension',
      params: { kind: 'chain', points: [[0, 0, 0], [1.5, 0, 0], [4, 0, 0], [6, 0, 0]], offset: -1 },
    })
    const r = evaluateDimension(node, defaultContext({ units }))
    expect(r.error).toBeUndefined()
    expect(texts(r)).toEqual(['1.5 m', '2.5 m', '2 m'])
    expect(r.quantities).toMatchObject({ value: 6, segments: 3, segment1: 1.5, segment2: 2.5, segment3: 2 })
    // dimension line sits at offset −1 (below the points)
    expect(r.snaps?.filter((s) => s.kind === 'endpoint' && Math.abs(s.p[1] + 1) < 1e-9)).toHaveLength(4)
    expect(r.snaps?.filter((s) => s.kind === 'midpoint')).toHaveLength(3)
    expect(r.bounds.min[1]).toBeLessThan(-1)
  })
  it('forced axis projects skewed points, arrows only at the ends', () => {
    const node = makeNode({ type: 'dimension', meta: { terminator: 'arrow' }, params: { kind: 'chain', points: [[0, 0, 0], [2, 1, 0], [5, -0.5, 0]], offset: 0.8, axis: 'x' } })
    const r = evaluateDimension(node, defaultContext({ units }))
    expect(texts(r)).toEqual(['2 m', '3 m'])
    expect(r.drawing?.fills).toHaveLength(2)
    // fewer than two points → nothing drawn but no crash
    const empty = evaluateDimension(makeNode({ type: 'dimension', params: { kind: 'chain', points: [[0, 0, 0]], offset: 1 } }), defaultContext({ units }))
    expect(empty.drawing?.lines ?? []).toHaveLength(0)
  })
})
