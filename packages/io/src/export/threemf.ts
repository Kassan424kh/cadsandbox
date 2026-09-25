// 3MF writer (3D Manufacturing Format core spec 1.2): one object per mesh, welded vertices,
// millimeters, Z-up, per-object colors via a <basematerials> group.
import type { ExportContext, ExportOptions, ExportResult } from '../api'
import { blobOf, safeFileName } from '../util/bytes'
import { flattenScene, type FlatMesh } from './mesh'
import { buildScene } from './scene'

export const xmlEscape = (s: string): string => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!)

const hex2 = (v: number) =>
  Math.round(Math.min(1, Math.max(0, v)) * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase()

/** 1 µm resolution: plenty for printing and hides float32 noise (6.15 m → 6150.0000954 mm). */
const um = (v: number) => Math.round(v * 1e3)
const num = (v: number) => {
  const r = um(v) / 1e3
  return Object.is(r, -0) ? '0' : String(r)
}

/** Build the 3D model XML (millimeters). */
export function threeMfModelXml(meshes: FlatMesh[], title: string): string {
  const colors = new Map<string, number>()
  const baseXml: string[] = []
  const objects: string[] = []
  const items: string[] = []
  let nextId = 2
  for (const m of meshes) {
    const alpha = m.material?.transparent ? (m.material.opacity ?? 1) : 1
    const display = `#${m.color.map((c) => hex2(Math.pow(Math.max(0, c), 1 / 2.2))).join('')}${hex2(alpha)}`
    let pindex = colors.get(display)
    if (pindex === undefined) {
      pindex = colors.size
      colors.set(display, pindex)
      baseXml.push(`   <base name="${xmlEscape(m.material?.name || `Color ${pindex + 1}`)}" displaycolor="${display}"/>`)
    }
    // weld identical vertices (1 µm grid) so printable meshes are manifold
    const remap = new Map<string, number>()
    const verts: string[] = []
    const vi = new Uint32Array(m.positions.length / 3)
    for (let i = 0; i < vi.length; i++) {
      const x = m.positions[i * 3]!,
        y = m.positions[i * 3 + 1]!,
        z = m.positions[i * 3 + 2]!
      const key = `${um(x)},${um(y)},${um(z)}`
      let r = remap.get(key)
      if (r === undefined) {
        r = remap.size
        remap.set(key, r)
        verts.push(`     <vertex x="${num(x)}" y="${num(y)}" z="${num(z)}"/>`)
      }
      vi[i] = r
    }
    const tris: string[] = []
    for (let t = 0; t + 2 < m.indices.length; t += 3) {
      const a = vi[m.indices[t]!]!,
        b = vi[m.indices[t + 1]!]!,
        c = vi[m.indices[t + 2]!]!
      if (a === b || b === c || a === c) continue // degenerate triangles are invalid in 3MF
      tris.push(`     <triangle v1="${a}" v2="${b}" v3="${c}"/>`)
    }
    if (!tris.length) continue
    const id = nextId++
    objects.push(
      `  <object id="${id}" type="model" name="${xmlEscape(m.name)}" pid="1" pindex="${pindex}">\n   <mesh>\n    <vertices>\n${verts.join('\n')}\n    </vertices>\n    <triangles>\n${tris.join('\n')}\n    </triangles>\n   </mesh>\n  </object>`,
    )
    items.push(`  <item objectid="${id}"/>`)
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">',
    ` <metadata name="Title">${xmlEscape(title)}</metadata>`,
    ' <metadata name="Application">CadSandbox</metadata>',
    ` <metadata name="CreationDate">${new Date().toISOString().slice(0, 10)}</metadata>`,
    ' <resources>',
    '  <basematerials id="1">',
    ...baseXml,
    '  </basematerials>',
    ...objects,
    ' </resources>',
    ' <build>',
    ...items,
    ' </build>',
    '</model>',
    '',
  ].join('\n')
}

export const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n</Types>\n'
export const ROOT_RELS =
  '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n</Relationships>\n'

export async function write3mf(meshes: FlatMesh[], title: string): Promise<Uint8Array> {
  const { zipSync, strToU8 } = await import('fflate')
  return zipSync(
    {
      '[Content_Types].xml': strToU8(CONTENT_TYPES),
      '_rels/.rels': strToU8(ROOT_RELS),
      '3D/3dmodel.model': strToU8(threeMfModelXml(meshes, title)),
    },
    { level: 6 },
  )
}

export async function export3mf(ctx: ExportContext, opts: ExportOptions): Promise<ExportResult> {
  await ctx.geometry.idle()
  const scene = await buildScene(ctx, { selection: opts.selection, textures: false, yUp: false })
  const meshes = await flattenScene(scene, 1000) // meters → millimeters
  const bytes = await write3mf(meshes, ctx.doc.meta.name)
  return { blob: blobOf([bytes], 'model/3mf'), fileName: `${safeFileName(ctx.doc.meta.name, 'design')}.3mf` }
}
