import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { docNames } from '@cadsandbox/shared'
import { loadDocState, mergeDocState } from '../src/collab/server'
import { createKeyRing } from '../src/lib/crypto'
import { testServer, type TestServer } from './helpers'

// During zero-downtime deploys two app containers overlap; each may store the same document with
// edits the other never saw. Storing must merge (CRDT union), never overwrite.
describe('collab persistence merges concurrent stores', () => {
  let s: TestServer
  beforeAll(async () => {
    s = await testServer()
  })
  afterAll(async () => {
    await s.close()
  })

  it('keeps edits that reached only one of two overlapping instances', async () => {
    const owner = await s.signup('merge-owner@example.com')
    const projectId = (await s.json('POST', '/api/projects', { cookie: owner.cookie, json: { name: 'Merge' } })).body.id as string
    const name = docNames.file(projectId, 'main')
    const ring = createKeyRing(randomBytes(32).toString('base64'))

    const base = new Y.Doc()
    base.getMap('nodes').set('a', 1)
    const instanceA = new Y.Doc()
    Y.applyUpdate(instanceA, Y.encodeStateAsUpdate(base))
    instanceA.getMap('nodes').set('b', 2)
    const instanceB = new Y.Doc()
    Y.applyUpdate(instanceB, Y.encodeStateAsUpdate(base))
    instanceB.getMap('nodes').set('c', 3)
    instanceB.getMap('nodes').delete('a')

    await mergeDocState(s.deps.db, ring, name, projectId, Y.encodeStateAsUpdate(instanceA))
    await mergeDocState(s.deps.db, ring, name, projectId, Y.encodeStateAsUpdate(instanceB))

    const out = new Y.Doc()
    Y.applyUpdate(out, (await loadDocState(s.deps.db, ring, name))!)
    expect(out.getMap('nodes').toJSON()).toEqual({ b: 2, c: 3 })
  })
})
