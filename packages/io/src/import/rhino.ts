// Rhino .3dm import (rhino3dm WASM, lazy): meshes, render meshes of Breps/Extrusions, SubD control
// nets, planar curves, blocks (instance definitions → components), layers and materials.
import type { MaterialDef, Quat, Vec2 } from '@cadsandbox/doc'
import type { ImportOptions, ImportResult } from '../api'
import { SnapshotBuilder, materialDef } from '../builder'
import { sniffImageMime, stem, throwIfAborted, tick } from '../util/bytes'
import { loadRhino, type RhinoModule } from '../wasm'
import { addRawMesh, rgbHex, type RawMesh } from './raw-mesh'
import { unitScale } from './units'

type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

function unitScaleOf(rhino: RhinoModule, unit: unknown): number | null {
  const U = rhino.UnitSystem as R
  const table: [string, number][] = [
    ['Millimeters', 0.001],
    ['Centimeters', 0.01],
    ['Meters', 1],
    ['Inches', 0.0254],
    ['Feet', 0.3048],
    ['Kilometers', 1000],
    ['Microns', 1e-6],
    ['Decimeters', 0.1],
    ['Yards', 0.9144],
    ['Miles', 1609.344],
  ]
  for (const [k, v] of table) {
    const e = U?.[k]
    if (e !== undefined && (e === unit || (e?.value !== undefined && e.value === (unit as R)?.value))) return v
  }
  return null
}

const is = (a: unknown, b: unknown) => a === b || ((a as R)?.value !== undefined && (a as R)?.value === (b as R)?.value)
const color255 = (c: R | undefined) => (c ? rgbHex((c.r ?? 0) / 255, (c.g ?? 0) / 255, (c.b ?? 0) / 255) : null)

function del(o: unknown) {
  try {
    ;(o as R | null)?.delete?.()
  } catch {
    /* already freed */
  }
}

/** rhino Mesh → raw arrays (via toThreejsJSON). */
function meshArrays(m: R): RawMesh | null {
  const json = m.toThreejsJSON() as R
  const data = (json?.data ?? json) as R
  const pos = data?.attributes?.position?.array as number[] | undefined
  if (!pos?.length) return null
  return {
    positions: pos,
    normals: (data.attributes.normal?.array as number[] | undefined) ?? null,
    uvs: (data.attributes.uv?.array as number[] | undefined) ?? null,
    indices: (data.index?.array as number[] | undefined) ?? null,
  }
}

function merge(parts: RawMesh[]): RawMesh | null {
  const ps = parts.filter(Boolean)
  if (!ps.length) return null
  if (ps.length === 1) return ps[0]!
  const pos: number[] = [],
    nor: number[] = [],
    idx: number[] = []
  let hasN = true
  for (const p of ps) {
    const base = pos.length / 3
    for (let i = 0; i < p.positions.length; i++) pos.push(p.positions[i]!)
    if (p.normals && p.normals.length === p.positions.length) for (let i = 0; i < p.normals.length; i++) nor.push(p.normals[i]!)
    else hasN = false
    const n = p.positions.length / 3
    if (p.indices) for (let i = 0; i < p.indices.length; i++) idx.push(p.indices[i]! + base)
    else for (let i = 0; i < n; i++) idx.push(base + i)
  }
  return { positions: pos, normals: hasN ? nor : null, indices: idx }
}

export async function importRhino(name: string, bytes: Uint8Array, opts: ImportOptions): Promise<ImportResult> {
  opts.onProgress?.(0.05, 'Loading Rhino kernel')
  const rhino = await loadRhino()
  const doc = rhino.File3dm.fromByteArray(bytes) as R | null
  if (!doc) throw new Error('Not a valid Rhino .3dm file (or a newer version than supported).')
  const b = new SnapshotBuilder()
  try {
    const settings = doc.settings() as R
    const fileScale = unitScaleOf(rhino, settings?.modelUnitSystem)
    const s = opts.units ? unitScale(opts.units) : (fileScale ?? 0.001)
    if (!opts.units && fileScale === null) b.warn('Unknown model units — imported as millimeters.')

    // layers
    const layers = doc.layers() as R
    const layerIds: (string | null)[] = []
    const layerMat: number[] = []
    for (let i = 0; i < layers.count; i++) {
      const l = layers.get(i) as R
      const path = String(l.fullPath || l.name || `Layer ${i}`).replace(/::/g, ' / ')
      layerIds[l.index ?? i] =
        path === 'Default' || path === '0'
          ? null
          : b.layer({ name: path, color: color255(l.color) ?? '#e6e6e6', visible: l.visible !== false, locked: !!l.locked, lineWeight: l.plotWeight > 0 ? l.plotWeight : 0.25 })
      layerMat[l.index ?? i] = l.renderMaterialIndex ?? -1
      del(l)
    }

    // materials
    const mats = doc.materials() as R
    const matIds: string[] = []
    for (let i = 0; i < mats.count; i++) {
      const m = mats.get(i) as R
      const def: MaterialDef = materialDef({ name: m.name || `Material ${i + 1}` })
      def.color = color255(m.diffuseColor) ?? def.color
      def.opacity = 1 - Math.min(1, Math.max(0, m.transparency ?? 0))
      def.roughness = Math.min(1, Math.max(0.03, Math.sqrt(2 / ((m.shine ?? 0) / 2.55 + 2))))
      const pbr = m.physicallyBased?.() as R | undefined
      if (pbr?.supported) {
        const bc = pbr.baseColor as R | undefined
        if (bc) def.color = rgbHex(bc.r, bc.g, bc.b)
        def.metalness = pbr.metallic ?? 0
        def.roughness = pbr.roughness ?? def.roughness
        def.opacity = pbr.opacity ?? def.opacity
        if (pbr.clearcoat) def.clearcoat = pbr.clearcoat
      }
      const tex = m.getTexture?.(rhino.TextureType?.Diffuse) ?? (pbr?.supported ? m.getTexture?.(rhino.TextureType?.PBR_BaseColor) : null)
      if (tex?.fileName) {
        const b64 = doc.getEmbeddedFileAsBase64?.(tex.fileName) as string | undefined
        if (b64) {
          const raw = atob(b64)
          const img = new Uint8Array(raw.length)
          for (let k = 0; k < raw.length; k++) img[k] = raw.charCodeAt(k)
          const mime = sniffImageMime(img)
          if (mime) {
            def.maps = { color: { asset: await b.asset(img, mime) } }
            def.uv = { size: [1, 1], rotation: 0, offset: [0, 0] }
          }
        } else b.warn('External textures referenced by the .3dm file are not embedded and were skipped.')
        del(tex)
      }
      def.category = def.opacity < 0.6 ? 'glass' : def.metalness > 0.5 ? 'metal' : 'generic'
      matIds[i] = b.material(def)
      del(m)
    }

    const root = b.add('group', { name: stem(name), parent: null, meta: { source: { format: '3dm' } } })
    const OT = rhino.ObjectType as R
    const skipped = new Map<string, number>()

    const objects = doc.objects() as R
    const byId = new Map<string, number>()
    for (let i = 0; i < objects.count; i++) {
      const o = objects.get(i) as R
      const a = o.attributes() as R
      byId.set(String(a.id), i)
      del(a)
      del(o)
    }

    const convert = async (index: number, parent: string, def: boolean, scale: number): Promise<void> => {
      const obj = objects.get(index) as R
      const g = obj.geometry() as R
      const a = obj.attributes() as R
      try {
        const layer = layerIds[a.layerIndex] ?? null
        const color = is(a.colorSource, rhino.ObjectColorSource?.ColorFromObject) ? color255(a.objectColor) : null
        let matIndex = -1
        if (is(a.materialSource, rhino.ObjectMaterialSource?.MaterialFromObject)) matIndex = a.materialIndex
        else matIndex = layerMat[a.layerIndex] ?? -1
        const material = matIndex >= 0 ? (matIds[matIndex] ?? null) : null
        const label = a.name || ''
        const meta = { rhino: { id: String(a.id) } }
        const type = g.objectType
        const scaled = (r: RawMesh | null): RawMesh | null => {
          if (!r) return null
          const p = Float64Array.from(r.positions, (v) => v * scale)
          return { ...r, positions: p }
        }
        let raw: RawMesh | null = null
        if (is(type, OT.Mesh)) raw = meshArrays(g)
        else if (is(type, OT.Brep)) {
          const faces = g.faces() as R
          const parts: RawMesh[] = []
          for (let f = 0; f < faces.count; f++) {
            const face = faces.get(f) as R
            const fm = face.getMesh(rhino.MeshType.Any) as R | null
            if (fm) {
              const r = meshArrays(fm)
              if (r) parts.push(r)
              del(fm)
            }
            del(face)
          }
          del(faces)
          raw = merge(parts)
          if (!raw) b.warn('Some Breps have no render mesh — save the .3dm with render meshes (not "Save Small") to import them.')
        } else if (is(type, OT.Extrusion)) {
          const em = g.getMesh(rhino.MeshType.Any) as R | null
          raw = em ? meshArrays(em) : null
          del(em)
          if (!raw) b.warn('Some extrusions have no render mesh and were skipped.')
        } else if (is(type, OT.SubD)) {
          const sm = rhino.Mesh.createFromSubDControlNet(g, false) as R | null
          raw = sm ? meshArrays(sm) : null
          del(sm)
        } else if (is(type, OT.Curve)) {
          const pts: number[][] = []
          const dom = g.domain as number[]
          if (g.pointCount !== undefined && typeof g.point === 'function') for (let k = 0; k < g.pointCount; k++) pts.push(g.point(k))
          else {
            const n = g.isLinear?.() ? 1 : 64
            for (let k = 0; k <= n; k++) pts.push(g.pointAt(dom[0]! + ((dom[1]! - dom[0]!) * k) / n))
          }
          if (pts.length >= 2) {
            const z = pts[0]![2]!
            if (pts.some((p) => Math.abs(p[2]! - z) > 1e-6)) b.warn('3D (non-planar) curves were skipped.')
            else {
              const closed = !!g.isClosed
              const points: Vec2[] = pts.map((p) => [p[0]! * scale, p[1]! * scale])
              if (closed && points.length > 2) points.pop()
              b.add('polyline', { name: label || 'Curve', parent, layer, color, meta, t: { p: [0, 0, z * scale], r: [0, 0, 0, 1], s: [1, 1, 1] }, params: { points, closed } }, def)
              if (!def) b.expand(points.map((p) => [p[0], p[1], z * scale]))
            }
          }
          return
        } else if (is(type, OT.InstanceReference)) {
          const comp = await component(String(g.parentIdefId))
          if (!comp) return
          const m = g.xform.toFloatArray(true) as number[] // row-major
          const col = [m[0], m[4], m[8], m[12], m[1], m[5], m[9], m[13], m[2], m[6], m[10], m[14], m[3], m[7], m[11], m[15]] as number[]
          const { p, r, s: sc } = decompose(col, scale)
          b.add('instance', { name: label || comp.name, parent, layer, color, meta, t: { p, r, s: sc }, params: { component: comp.id } }, def)
          if (!def) b.expand([p])
          return
        } else {
          const key = Object.keys(OT).find((k) => is(OT[k], type)) ?? 'object'
          skipped.set(key, (skipped.get(key) ?? 0) + 1)
          return
        }
        const r = scaled(raw)
        if (r) await addRawMesh(b, r, { name: label || 'Mesh', parent, material, color, layer, meta, visible: a.visible !== false, def })
      } finally {
        del(g)
        del(a)
        del(obj)
      }
    }

    // instance definitions → components (converted lazily when first referenced)
    const idefs = doc.instanceDefinitions() as R
    const idefById = new Map<string, number>()
    for (let i = 0; i < idefs.count; i++) {
      const d = idefs.get(i) as R
      idefById.set(String(d.id), i)
      del(d)
    }
    const comps = new Map<string, { id: string; name: string } | null>()
    const component = async (id: string): Promise<{ id: string; name: string } | null> => {
      if (comps.has(id)) return comps.get(id)!
      comps.set(id, null)
      const i = idefById.get(id)
      if (i === undefined) return null
      const d = idefs.get(i) as R
      const { def, root: defRoot } = b.component(d.name || 'Block', 'Rhino block')
      const ids = (d.getObjectIds() as string[]) ?? []
      del(d)
      for (const oid of ids) {
        const idx = byId.get(String(oid))
        if (idx !== undefined) await convert(idx, defRoot.id, true, s)
      }
      const out = { id: def.id, name: def.name }
      comps.set(id, out)
      return out
    }

    for (let i = 0; i < objects.count; i++) {
      throwIfAborted(opts.signal)
      const o = objects.get(i) as R
      const a = o.attributes() as R
      const inDef = !!a.isInstanceDefinitionObject
      del(a)
      del(o)
      if (!inDef) await convert(i, root.id, false, s)
      if (i % 50 === 49) {
        opts.onProgress?.(0.2 + (0.8 * i) / objects.count, 'Converting objects')
        await tick()
      }
    }
    for (const [k, n] of skipped) b.warn(`${n} ${k} object(s) were skipped (not supported).`)
    del(idefs)
    del(objects)
  } finally {
    del(doc)
  }
  return b.result()
}

/** Column-major 4×4 → TRS with translation scaled to meters. */
function decompose(m: number[], scale: number): { p: [number, number, number]; r: Quat; s: [number, number, number] } {
  let sx = Math.hypot(m[0]!, m[1]!, m[2]!)
  const sy = Math.hypot(m[4]!, m[5]!, m[6]!),
    sz = Math.hypot(m[8]!, m[9]!, m[10]!)
  const det = m[0]! * (m[5]! * m[10]! - m[9]! * m[6]!) - m[4]! * (m[1]! * m[10]! - m[9]! * m[2]!) + m[8]! * (m[1]! * m[6]! - m[5]! * m[2]!)
  if (det < 0) sx = -sx
  const r00 = m[0]! / sx,
    r10 = m[1]! / sx,
    r20 = m[2]! / sx,
    r01 = m[4]! / sy,
    r11 = m[5]! / sy,
    r21 = m[6]! / sy,
    r02 = m[8]! / sz,
    r12 = m[9]! / sz,
    r22 = m[10]! / sz
  const tr = r00 + r11 + r22
  let q: Quat
  if (tr > 0) {
    const k = 0.5 / Math.sqrt(tr + 1)
    q = [(r21 - r12) * k, (r02 - r20) * k, (r10 - r01) * k, 0.25 / k]
  } else if (r00 > r11 && r00 > r22) {
    const k = 2 * Math.sqrt(1 + r00 - r11 - r22)
    q = [0.25 * k, (r01 + r10) / k, (r02 + r20) / k, (r21 - r12) / k]
  } else if (r11 > r22) {
    const k = 2 * Math.sqrt(1 + r11 - r00 - r22)
    q = [(r01 + r10) / k, 0.25 * k, (r12 + r21) / k, (r02 - r20) / k]
  } else {
    const k = 2 * Math.sqrt(1 + r22 - r00 - r11)
    q = [(r02 + r20) / k, (r12 + r21) / k, 0.25 * k, (r10 - r01) / k]
  }
  const l = Math.hypot(...q) || 1
  return { p: [m[12]! * scale, m[13]! * scale, m[14]! * scale], r: q.map((v) => v / l) as Quat, s: [sx, sy, sz] }
}
