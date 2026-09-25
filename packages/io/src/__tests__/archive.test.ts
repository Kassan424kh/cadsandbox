import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync, zipSync } from 'fflate'
import { CadDocument, ProjectManifest } from '@cadsandbox/doc'
import { exportProjectArchive, importProjectArchive } from '../archive'
import { sha256Hex } from '../util/hash'
import { importFile } from '../import/index'

async function project() {
  const { manifest, mainFile } = ProjectManifest.create('Villa Sonnenhang', 'Test project')
  const folder = manifest.addFile({ name: 'Varianten', kind: 'folder' })
  const second = manifest.addFile({ name: 'Variante B', kind: 'design', parent: folder })
  const blob = new TextEncoder().encode('pretend this is a texture')
  const hash = await sha256Hex(blob)
  manifest.addFile({ name: 'notes.txt', kind: 'asset', mime: 'text/plain', size: blob.length, blob: hash })
  const a = CadDocument.create('Main', { withLevel: true })
  a.addNodes([{ type: 'primitive', name: 'Cube', params: { shape: 'box', width: 2 } }])
  const matId = a.addMaterial({ name: 'Textured', maps: { color: { asset: hash } } })
  a.addNodes([{ type: 'primitive', name: 'Textured cube', material: matId, params: { shape: 'box' } }])
  const b = CadDocument.create('Variante B')
  b.addNodes([{ type: 'wall', name: 'Wall', params: { a: [0, 0], b: [5, 0] } }])
  return { manifest, designs: new Map([[mainFile, a], [second, b]]), assets: [{ hash, bytes: blob, mime: 'text/plain' }], mainFile, second, hash }
}

describe('.csbx project archive', () => {
  it('round-trips the manifest, two designs and a blob', async () => {
    const p = await project()
    const blob = await exportProjectArchive(p)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const entries = unzipSync(bytes)
    expect(Object.keys(entries)).toEqual(expect.arrayContaining(['README.txt', 'archive.json', 'manifest/state.yjs', 'manifest/manifest.json', `blobs/${p.hash}`]))
    const index = JSON.parse(strFromU8(entries['archive.json']!))
    expect(index).toMatchObject({ format: 'cadsandbox/archive@1', version: 1, project: { name: 'Villa Sonnenhang' } })
    expect(index.designs).toHaveLength(2)
    expect(strFromU8(entries['README.txt']!)).toContain('archive version 1')

    const back = await importProjectArchive(bytes)
    expect(back.manifest.info.name).toBe('Villa Sonnenhang')
    expect(back.manifest.info.mainFile).toBe(p.mainFile)
    expect(back.manifest.listFiles().map((f) => f.name).sort()).toEqual(['Main', 'Variante B', 'Varianten', 'notes.txt'])
    expect([...back.designs.keys()].sort()).toEqual([p.mainFile, p.second].sort())
    const main = back.designs.get(p.mainFile)!
    expect(main.allNodes().map((n) => n.name).sort()).toEqual(['Cube', 'Ground Floor', 'Textured cube'])
    expect(main.toJSON()).toEqual(p.designs.get(p.mainFile)!.toJSON())
    expect(back.designs.get(p.second)!.nodesOfType('wall')).toHaveLength(1)
    expect(back.assets).toHaveLength(1)
    expect(new TextDecoder().decode(back.assets[0]!.bytes)).toBe('pretend this is a texture')
  })

  it('falls back to the JSON copies when a Yjs state is missing', async () => {
    const p = await project()
    const entries = unzipSync(new Uint8Array(await (await exportProjectArchive(p)).arrayBuffer()))
    const index = JSON.parse(strFromU8(entries['archive.json']!))
    delete entries[index.designs[0].state]
    delete entries['manifest/state.yjs']
    const back = await importProjectArchive(zipSync(entries))
    expect(back.designs.size).toBe(2)
    expect(back.manifest.listFiles()).toHaveLength(4)
  })

  it('rejects corrupted blobs and foreign files', async () => {
    const p = await project()
    const entries = unzipSync(new Uint8Array(await (await exportProjectArchive(p)).arrayBuffer()))
    entries[`blobs/${p.hash}`] = new TextEncoder().encode('tampered')
    await expect(importProjectArchive(zipSync(entries))).rejects.toThrow(/checksum/)
    await expect(importProjectArchive(zipSync({ 'a.txt': new Uint8Array([1]) }))).rejects.toThrow(/archive\.json/)
  })

  it('reads the interim web-app layout (cadsandbox.json)', async () => {
    const p = await project()
    const Y = await import('yjs')
    const files: Record<string, Uint8Array> = {
      'cadsandbox.json': new TextEncoder().encode(
        JSON.stringify({ format: 'cadsandbox/project-archive@1', project: { name: 'Villa Sonnenhang', mainFile: p.mainFile }, designs: [...p.designs.keys()].map((id) => ({ id, name: id })), assets: [{ hash: p.hash, mime: 'text/plain', size: 25 }] }),
      ),
      'manifest.yjs': Y.encodeStateAsUpdate(p.manifest.ydoc),
      [`assets/${p.hash}`]: p.assets[0]!.bytes,
    }
    for (const [id, doc] of p.designs) files[`designs/${id}.yjs`] = doc.encodeState()
    const back = await importProjectArchive(zipSync(files))
    expect(back.designs.size).toBe(2)
    expect(back.manifest.info.name).toBe('Villa Sonnenhang')
    expect(back.assets[0]!.hash).toBe(p.hash)
  })

  it('imports the main design of a .csbx through importFile', async () => {
    const p = await project()
    const res = await importFile({ name: 'villa.csbx', data: await exportProjectArchive(p) })
    expect(res.document?.meta.name).toBe('Main')
    expect(res.snapshot.nodes.some((n) => n.name === 'Textured cube')).toBe(true)
    expect(res.assets.map((a) => a.hash)).toEqual([p.hash])
    expect(res.warnings.join(' ')).toMatch(/2 designs/)
  })
})
