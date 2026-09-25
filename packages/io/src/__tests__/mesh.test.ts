import { describe, expect, it } from 'vitest'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import type { AnyNode } from '@cadsandbox/doc'
import { exportFile } from '../export/index'
import { importFile, importFiles } from '../import/index'
import { decodeCSBM } from '../csbm'
import { buildingDoc, exportContext } from './helpers'

// walls ±0.15 m around a 6 × 4 m rectangle, 2.75 m high; a 1 m box on the upper storey (z 3…4)
const EXPECTED = { min: [-0.15, -0.15, 0], max: [6.15, 4.15, 4] }

function expectBounds(b: { min: number[]; max: number[] } | undefined, digits = 4) {
  expect(b).toBeDefined()
  for (let k = 0; k < 3; k++) {
    expect(b!.min[k]).toBeCloseTo(EXPECTED.min[k]!, digits)
    expect(b!.max[k]).toBeCloseTo(EXPECTED.max[k]!, digits)
  }
}

async function bytesOf(blob: Blob) {
  return new Uint8Array(await blob.arrayBuffer())
}

describe('mesh export → import round trips', () => {
  it('STL (binary, millimeters, Z-up)', async () => {
    const res = await exportFile(exportContext(buildingDoc()), 'stl')
    expect(res.fileName).toBe('Test House.stl')
    const bytes = await bytesOf(res.blob)
    const tris = new DataView(bytes.buffer).getUint32(80, true)
    expect(bytes.length).toBe(84 + tris * 50)
    // STL is unitless: the importer defaults to millimeters
    const back = await importFile({ name: res.fileName, data: bytes })
    expectBounds(back.snapshot.bounds, 3)
    const mesh = back.snapshot.nodes.find((n) => n.type === 'mesh') as AnyNode & { type: 'mesh' }
    const asset = back.assets.find((a) => a.hash === mesh.params.asset)!
    expect(decodeCSBM(asset.bytes).positions.length / 9).toBe(tris)
  })

  it('OBJ + MTL zip (meters, Y-up)', async () => {
    const res = await exportFile(exportContext(buildingDoc()), 'obj')
    const files = unzipSync(await bytesOf(res.blob))
    expect(Object.keys(files).sort()).toEqual(['Test House.mtl', 'Test House.obj'])
    const obj = strFromU8(files['Test House.obj']!)
    expect(obj).toContain('mtllib Test House.mtl')
    expect(obj).toMatch(/^usemtl Plaster/m)
    const back = await importFiles([
      { name: 'Test House.obj', data: files['Test House.obj']! },
      { name: 'Test House.mtl', data: files['Test House.mtl']! },
    ])
    expectBounds(back.snapshot.bounds)
    expect(back.snapshot.materials.map((m) => m.name)).toContain('Plaster')
  })

  it('OBJ export zip imports as is', async () => {
    const res = await exportFile(exportContext(buildingDoc()), 'obj')
    expect(res.fileName).toBe('Test House.obj.zip')
    const back = await importFile({ name: res.fileName, data: await bytesOf(res.blob) })
    expectBounds(back.snapshot.bounds)
    expect(back.snapshot.materials.map((m) => m.name)).toContain('Plaster')
  })

  it('PLY (binary, meters, Z-up)', async () => {
    const res = await exportFile(exportContext(buildingDoc()), 'ply')
    const bytes = await bytesOf(res.blob)
    expect(new TextDecoder().decode(bytes.subarray(0, 40))).toContain('binary_little_endian')
    const back = await importFile({ name: 'x.ply', data: bytes })
    expectBounds(back.snapshot.bounds)
  })
})

describe('3MF export', () => {
  it('writes a valid package: content types, relationships, millimeter model with colors', async () => {
    const res = await exportFile(exportContext(buildingDoc()), '3mf')
    const files = unzipSync(await bytesOf(res.blob))
    expect(Object.keys(files).sort()).toEqual(['3D/3dmodel.model', '[Content_Types].xml', '_rels/.rels'])
    expect(strFromU8(files['[Content_Types].xml']!)).toContain('application/vnd.ms-package.3dmanufacturing-3dmodel+xml')
    expect(strFromU8(files['_rels/.rels']!)).toContain('Target="/3D/3dmodel.model"')
    const model = strFromU8(files['3D/3dmodel.model']!)
    expect(model).toContain('unit="millimeter"')
    expect(model).toMatch(/<basematerials id="1">/)
    expect(model).toMatch(/displaycolor="#[0-9A-F]{8}"/)
    const objects = model.match(/<object /g)!.length
    expect(objects).toBe(7) // 4 walls, door, window, box
    expect(model.match(/<item objectid=/g)!.length).toBe(objects)
    // welded box: 8 vertices, 12 triangles; coordinates in mm
    expect(model).toContain('x="6150"')
    expect(model).not.toMatch(/v1="(\d+)" v2="\1"/)
  })
})

describe('zip containers', () => {
  // 1×1 PNG
  const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64'))

  it('OBJ + MTL + textures in folders keep their materials', async () => {
    const obj = 'mtllib model.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 0 1\nusemtl Wood\nf 1/1 2/2 3/3\n'
    const mtl = 'newmtl Wood\nKd 1 1 1\nmap_Kd textures/wood.png\n'
    const zip = zipSync({
      'model/model.obj': strToU8(obj),
      'model/model.mtl': strToU8(mtl),
      'model/textures/wood.png': PNG,
      '__MACOSX/model/._model.obj': strToU8('resource fork'),
    })
    const res = await importFile({ name: 'model.zip', data: zip })
    expect(res.snapshot.nodes.some((n) => n.type === 'mesh')).toBe(true)
    const wood = res.snapshot.materials.find((m) => m.name === 'Wood')!
    const color = wood.maps?.color as { asset: string } | undefined
    expect(color?.asset).toBeDefined()
    expect(res.assets.some((a) => a.hash === color!.asset)).toBe(true)
    expect(res.warnings.join(' ')).not.toMatch(/Missing texture/)
  })

  it('glTF + .bin', async () => {
    const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
    const gltf = {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: 'Tri', mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
      bufferViews: [{ buffer: 0, byteLength: 36 }],
      buffers: [{ byteLength: 36, uri: 'tri.bin' }],
    }
    const zip = zipSync({ 'scene/scene.gltf': strToU8(JSON.stringify(gltf)), 'scene/tri.bin': new Uint8Array(pos.buffer) })
    const res = await importFiles([{ name: 'scene.zip', data: zip }])
    expect(res.snapshot.nodes.find((n) => n.name === 'Tri')?.type).toBe('mesh')
    expect(res.snapshot.bounds!.max[2]).toBeCloseTo(1, 6) // Y-up → Z-up
  })

  it('reports a zip without a model', async () => {
    const zip = zipSync({ 'readme.txt': strToU8('hello') })
    await expect(importFile({ name: 'notes.zip', data: zip })).rejects.toThrow('No supported model file found in notes.zip.')
  })
})

describe('glTF import', () => {
  it('converts Y-up to Z-up and keeps names/hierarchy', async () => {
    // one triangle in a named child node, Y-up, with a data: URI buffer
    const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
    const b64 = Buffer.from(pos.buffer).toString('base64')
    const gltf = {
      asset: { version: '2.0', generator: 'test' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: 'Parent', translation: [1, 0, 0], children: [1] }, { name: 'Tri', mesh: 0 }],
      meshes: [{ name: 'TriMesh', primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
      materials: [{ name: 'Red', pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1], metallicFactor: 0, roughnessFactor: 0.4 } }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
      bufferViews: [{ buffer: 0, byteLength: 36 }],
      buffers: [{ byteLength: 36, uri: `data:application/octet-stream;base64,${b64}` }],
    }
    const res = await importFile({ name: 'tri.gltf', data: JSON.stringify(gltf) })
    const nodes = res.snapshot.nodes
    expect(nodes.find((n) => n.name === 'Parent')?.type).toBe('group')
    expect(nodes.find((n) => n.name === 'Tri')?.type).toBe('mesh')
    // y-up (0,1,0) becomes z-up (0,0,1); translation x=1 is kept
    expect(res.snapshot.bounds!.min).toEqual([1, 0, 0])
    expect(res.snapshot.bounds!.max[0]).toBeCloseTo(2, 6)
    expect(res.snapshot.bounds!.max[2]).toBeCloseTo(1, 6)
    const red = res.snapshot.materials.find((m) => m.name === 'Red')!
    expect(red.color).toBe('#ff0000')
    expect(red.roughness).toBeCloseTo(0.4, 6)
  })
})
