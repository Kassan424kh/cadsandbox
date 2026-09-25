// Classic worker that runs the UNMODIFIED occt-import-js (LGPL-2.1) build. The library script and
// its .wasm are self-hosted assets whose URLs are passed in with each request (no CDN).
/* eslint-disable no-restricted-globals */
let occtPromise = null

self.onmessage = async (ev) => {
  const { id, scriptUrl, wasmUrl, format, bytes, params } = ev.data
  try {
    if (!occtPromise) {
      self.importScripts(scriptUrl)
      occtPromise = self.occtimportjs({ locateFile: (p) => (p.endsWith('.wasm') ? wasmUrl : p) })
    }
    const occt = await occtPromise
    const read = format === 'step' ? occt.ReadStepFile : format === 'iges' ? occt.ReadIgesFile : occt.ReadBrepFile
    const r = read(bytes, params)
    if (!r || !r.success) throw new Error('The file could not be read (unsupported or corrupt ' + String(format).toUpperCase() + ').')
    const transfer = []
    const meshes = r.meshes.map((m) => {
      const position = new Float32Array(m.attributes.position.array)
      const normal = m.attributes.normal ? new Float32Array(m.attributes.normal.array) : null
      const index = new Uint32Array(m.index.array)
      transfer.push(position.buffer, index.buffer)
      if (normal) transfer.push(normal.buffer)
      return {
        name: m.name,
        color: m.color,
        brep_faces: m.brep_faces || [],
        attributes: { position: { array: position }, normal: normal ? { array: normal } : undefined },
        index: { array: index },
      }
    })
    self.postMessage({ id, ok: true, result: { success: true, root: r.root, meshes } }, transfer)
  } catch (e) {
    self.postMessage({ id, ok: false, error: String((e && e.message) || e) })
  }
}
