import { describe, expect, it } from 'vitest'
import { boxMode, classifyBox, isClickDrag, normalizeRect, rectFromPoints } from '../src/picking/boxSelect'

describe('box selection', () => {
  const box = normalizeRect(100, 100, 300, 300)

  it('derives the mode from drag direction', () => {
    expect(boxMode(10, 200)).toBe('window')
    expect(boxMode(200, 10)).toBe('crossing')
    expect(boxMode(50, 50)).toBe('window')
  })

  it('window selects only fully contained objects', () => {
    expect(classifyBox(normalizeRect(120, 120, 200, 200), box, 'window')).toBe(true)
    expect(classifyBox(normalizeRect(50, 120, 200, 200), box, 'window')).toBe(false)
    expect(classifyBox(normalizeRect(400, 400, 500, 500), box, 'window')).toBe(false)
  })

  it('crossing selects any overlapping object', () => {
    expect(classifyBox(normalizeRect(50, 120, 200, 200), box, 'crossing')).toBe(true)
    expect(classifyBox(normalizeRect(0, 0, 100, 100), box, 'crossing')).toBe(true) // touching edge counts
    expect(classifyBox(normalizeRect(400, 400, 500, 500), box, 'crossing')).toBe(false)
    expect(classifyBox(normalizeRect(0, 0, 1000, 1000), box, 'crossing')).toBe(true) // object encloses box
  })

  it('treats tiny drags as clicks', () => {
    expect(isClickDrag(10, 10, 12, 13)).toBe(true)
    expect(isClickDrag(10, 10, 20, 13)).toBe(false)
  })

  it('builds screen rects from NDC points', () => {
    const r = rectFromPoints([-1, 1, 1, -1], 200, 100)!
    expect(r).toEqual({ minX: 0, minY: 0, maxX: 200, maxY: 100 })
    expect(rectFromPoints([NaN, NaN], 200, 100)).toBeNull()
  })
})
