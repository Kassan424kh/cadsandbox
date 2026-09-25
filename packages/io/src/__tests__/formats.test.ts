import { describe, expect, it } from 'vitest'
import { zipSync } from 'fflate'
import { EXPORT_FORMATS, IMPORT_FORMATS, detectFormat } from '../formats'
import { sha256Hex } from '../util/hash'
import { imageSize } from '../util/bytes'
import { orderKey } from '../builder'

const enc = (s: string) => new TextEncoder().encode(s)

describe('detectFormat', () => {
  it('uses extensions when no bytes are given', () => {
    expect(detectFormat('House.IFC')).toBe('ifc')
    expect(detectFormat('part.stp')).toBe('step')
    expect(detectFormat('part.igs')).toBe('iges')
    expect(detectFormat('photo.jpeg')).toBe('image')
    expect(detectFormat('model.glb')).toBe('glb')
    expect(detectFormat('plan.dwg')).toBeNull()
    expect(detectFormat('noext')).toBeNull()
  })

  it('sniffs content before trusting the extension', () => {
    expect(detectFormat('x.bin', enc('glTF\x02\x00\x00\x00'))).toBe('glb')
    expect(detectFormat('x.stp', enc("ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('IFC4'));"))).toBe('ifc')
    expect(detectFormat('x.ifc', enc("ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('AUTOMOTIVE_DESIGN'));"))).toBe('step')
    expect(detectFormat('x', enc('ply\nformat ascii 1.0\n'))).toBe('ply')
    expect(detectFormat('x', enc('solid cube\n facet normal 0 0 1\n'))).toBe('stl')
    expect(detectFormat('x', enc('  0\nSECTION\n  2\nHEADER\n'))).toBe('dxf')
    expect(detectFormat('x', enc('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe('svg')
    expect(detectFormat('x', enc('<?xml version="1.0"?><COLLADA version="1.4.1">'))).toBe('dae')
    expect(detectFormat('x', enc('Kaydara FBX Binary  \0'))).toBe('fbx')
    expect(detectFormat('x', enc('3D Geometry File Format 00000070'))).toBe('3dm')
    expect(detectFormat('x', enc('{"format":"cadsandbox/doc@1","meta":{}}'))).toBe('csb')
    expect(detectFormat('x', enc('{"asset":{"version":"2.0"}}'))).toBe('gltf')
    expect(detectFormat('x', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image')
    // binary STL: 80-byte header + count matching the size
    const stl = new Uint8Array(84 + 50)
    new DataView(stl.buffer).setUint32(80, 1, true)
    expect(detectFormat('x.dat', stl)).toBe('stl')
    // zips: 3MF vs project archive
    expect(detectFormat('x.zip', zipSync({ '3D/3dmodel.model': enc('<model/>'), '[Content_Types].xml': enc('') }))).toBe('3mf')
    expect(detectFormat('x.zip', zipSync({ 'archive.json': enc('{}') }))).toBe('csbx')
  })

  it('lists every format with an extension and MIME type', () => {
    for (const f of [...IMPORT_FORMATS, ...EXPORT_FORMATS]) {
      expect(f.extensions.length).toBeGreaterThan(0)
      expect(f.mime).toMatch(/\//)
    }
    expect(IMPORT_FORMATS.map((f) => f.id)).toEqual(expect.arrayContaining(['ifc', 'dxf', 'step', 'csbx']))
    expect(EXPORT_FORMATS.map((f) => f.id)).toEqual(expect.arrayContaining(['ifc', 'dxf', 'pdf', 'usdz', '3mf']))
  })
})

describe('helpers', () => {
  it('hashes with sha256 hex', async () => {
    expect(await sha256Hex(enc('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
  it('reads image sizes from headers', () => {
    const png = new Uint8Array(24)
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    new DataView(png.buffer).setUint32(16, 640)
    new DataView(png.buffer).setUint32(20, 480)
    expect(imageSize(png)).toEqual({ width: 640, height: 480 })
  })
  it('generates ordered fractional-index keys', () => {
    const keys = Array.from({ length: 5000 }, (_, i) => orderKey(i))
    expect(keys[0]).toBe('a0')
    expect(keys[62]).toBe('b00')
    expect([...keys].sort()).toEqual(keys)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
