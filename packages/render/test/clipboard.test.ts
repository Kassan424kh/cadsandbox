import { describe, expect, it } from 'vitest'
import type { DocSnapshot } from '@cadsandbox/doc'
import { CLIPBOARD_PREFIX, parseClipboard, serializeClipboard, validateSnapshot } from '../src/commands/clipboard'

const snapshot: DocSnapshot = {
  format: 'cadsandbox/nodes@1',
  nodes: [
    {
      id: 'a',
      type: 'primitive',
      name: 'Box',
      parent: null,
      order: 'a0',
      visible: true,
      locked: false,
      t: { p: [1, 2, 3], r: [0, 0, 0, 1], s: [1, 1, 1] },
      material: null,
      color: '#ff0000',
      layer: null,
      meta: {},
      params: { shape: 'box', width: 1, depth: 1, height: 1 },
    },
  ],
  materials: [],
  components: [],
  componentNodes: [],
  assets: [],
  bounds: { min: [0.5, 1.5, 3], max: [1.5, 2.5, 4] },
}

describe('clipboard serialization', () => {
  it('round-trips a snapshot with the cadsandbox prefix', () => {
    const text = serializeClipboard(snapshot)
    expect(text.startsWith(CLIPBOARD_PREFIX)).toBe(true)
    const back = parseClipboard(text)
    expect(back).toEqual(snapshot)
  })

  it('rejects foreign text, malformed JSON and wrong formats', () => {
    expect(parseClipboard('hello')).toBeNull()
    expect(parseClipboard(null)).toBeNull()
    expect(parseClipboard(CLIPBOARD_PREFIX + '{oops')).toBeNull()
    expect(parseClipboard(CLIPBOARD_PREFIX + JSON.stringify({ format: 'other', nodes: [] }))).toBeNull()
  })

  it('validates node shape and unique ids', () => {
    expect(validateSnapshot({ format: 'cadsandbox/nodes@1', nodes: [{ id: 'x' }] })).toBeNull()
    const dup = { ...snapshot, nodes: [snapshot.nodes[0], snapshot.nodes[0]] }
    expect(validateSnapshot(dup)).toBeNull()
    const noBounds = validateSnapshot({ ...snapshot, bounds: { min: [0, 0] } })
    expect(noBounds?.bounds).toBeUndefined()
    expect(noBounds?.nodes.length).toBe(1)
  })
})
