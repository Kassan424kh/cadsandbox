// STEP / IGES / BREP import via occt-import-js (OpenCASCADE, LGPL, lazily loaded in a worker).
// Keeps the product structure (assemblies → groups), one mesh per solid, split by face colors.
import type { ImportOptions, ImportResult } from '../api'
import { SnapshotBuilder } from '../builder'
import { stem, throwIfAborted } from '../util/bytes'
import { readOcct, type OcctMesh, type OcctNode, type OcctParams } from '../wasm'
import { addRawMesh, rgbHex, subMesh, type RawMesh } from './raw-mesh'
import { unitScale } from './units'

export async function importOcct(format: 'step' | 'iges' | 'brep', name: string, bytes: Uint8Array, opts: ImportOptions): Promise<ImportResult> {
  opts.onProgress?.(0.05, 'Loading CAD kernel')
  const params: OcctParams = {
    linearDeflectionType: 'bounding_box_ratio',
    linearDeflection: 0.0008,
    angularDeflection: 0.35,
    ...(format === 'brep' ? {} : { linearUnit: 'meter' as const }),
  }
  opts.onProgress?.(0.1, 'Tessellating solids')
  const result = await readOcct(format, bytes, params, opts.signal)
  throwIfAborted(opts.signal)
  if (!result?.success || !result.meshes) throw new Error(`The ${format.toUpperCase()} file could not be read.`)
  // BREP files are unitless (usually millimeters); STEP/IGES are converted to meters by OCCT.
  const scale = format === 'brep' ? unitScale(opts.units ?? 'mm') : 1
  const yUp = opts.upAxis === 'y'
  const b = new SnapshotBuilder()
  const root = b.add('group', { name: stem(name), parent: null, meta: { source: { format } } })
  const total = Math.max(1, result.meshes.length)
  let done = 0

  const toWorld = (m: OcctMesh): RawMesh => {
    const src = m.attributes.position.array
    const pos = new Float64Array(src.length)
    for (let i = 0; i < src.length; i += 3) {
      const x = src[i]! * scale,
        y = src[i + 1]! * scale,
        z = src[i + 2]! * scale
      if (yUp) {
        pos[i] = x
        pos[i + 1] = -z
        pos[i + 2] = y
      } else {
        pos[i] = x
        pos[i + 1] = y
        pos[i + 2] = z
      }
    }
    let nor: Float32Array | null = null
    const ns = m.attributes.normal?.array
    if (ns && ns.length === src.length) {
      nor = new Float32Array(ns.length)
      for (let i = 0; i < ns.length; i += 3) {
        if (yUp) {
          nor[i] = ns[i]!
          nor[i + 1] = -ns[i + 2]!
          nor[i + 2] = ns[i + 1]!
        } else nor.set([ns[i]!, ns[i + 1]!, ns[i + 2]!], i)
      }
    }
    return { positions: pos, normals: nor, indices: m.index.array }
  }

  const addMesh = async (m: OcctMesh, parent: string, fallbackName: string) => {
    const raw = toWorld(m)
    const tris = raw.indices!.length / 3
    const base = m.color ? rgbHex(...m.color) : null
    // group triangles by face color
    const groups = new Map<string | null, number[]>()
    const covered = new Uint8Array(tris)
    for (const f of m.brep_faces ?? []) {
      const key = f.color ? rgbHex(...f.color) : base
      const list = groups.get(key) ?? []
      for (let t = f.first; t <= f.last && t < tris; t++) {
        list.push(t)
        covered[t] = 1
      }
      groups.set(key, list)
    }
    const rest: number[] = []
    for (let t = 0; t < tris; t++) if (!covered[t]) rest.push(t)
    if (rest.length) groups.set(base, [...(groups.get(base) ?? []), ...rest])
    const label = m.name || fallbackName
    if (groups.size <= 1) {
      const color = groups.keys().next().value ?? base
      await addRawMesh(b, raw, { name: label, parent, color })
      return
    }
    const g = b.add('group', { name: label, parent })
    for (const [color, list] of groups) await addRawMesh(b, subMesh(raw, list), { name: `${label} · ${color ?? 'default'}`, parent: g.id, color })
  }

  const visit = async (n: OcctNode, parent: string, depth: number) => {
    throwIfAborted(opts.signal)
    const kids = n.children ?? []
    const meshes = n.meshes ?? []
    let target = parent
    // Assemblies become groups; single-mesh leaves become the mesh itself.
    if (depth > 0 && (kids.length || meshes.length > 1)) target = b.add('group', { name: n.name || 'Assembly', parent }).id
    for (const mi of meshes) {
      const m = result.meshes[mi]
      if (m) await addMesh(m, target, n.name || `Solid ${mi + 1}`)
      done++
      opts.onProgress?.(0.5 + (0.5 * done) / total, 'Converting solids')
    }
    for (const c of kids) await visit(c, target, depth + 1)
  }
  await visit(result.root, root.id, 0)
  if (!result.meshes.length) b.warn('The file contains no solids or surfaces that could be tessellated.')
  return b.result()
}
