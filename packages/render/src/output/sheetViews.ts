// Sheet view sources → cameras and raster renders (plan / ceiling plan / section / elevation /
// saved view), plus vector linework via the tools module's vectorizeView with a graceful fallback.
import * as THREE from 'three'
import type { CadDocument, SheetViewSource, Vec2 } from '@cadsandbox/doc'
import type { Drawing2D, GeometryService, Lines2D } from '@cadsandbox/geometry'
import type { Pipeline } from '../renderer/pipeline'
import type { SceneSync } from '../scene/sceneSync'
import { targetToBlob } from './screenshot'

export type VectorResult = Drawing2D & { bounds: { min: [number, number]; max: [number, number] } }

interface ViewSetup {
  camera: THREE.Camera
  planLevel: string | null
  section: string | null
  mode: 'shaded' | 'realistic' | 'hidden-line'
}

/** Orthographic camera looking along `dir` at `center`, framing `halfW × halfH` (world). */
function ortho(center: THREE.Vector3, dir: THREE.Vector3, up: THREE.Vector3, halfW: number, halfH: number, depth: number): THREE.OrthographicCamera {
  const cam = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.01, depth * 2 + 1)
  cam.up.copy(up)
  cam.position.copy(center).addScaledVector(dir, -(depth + 0.5))
  cam.lookAt(center)
  cam.updateProjectionMatrix()
  cam.updateMatrixWorld(true)
  return cam
}

export function setupForSource(doc: CadDocument, sync: SceneSync, source: SheetViewSource, aspect: number, style: 'shaded' | 'realistic' | 'hidden-line'): ViewSetup | null {
  const bounds = sync.sceneBounds()
  const b = bounds.isEmpty() ? new THREE.Box3(new THREE.Vector3(-5, -5, 0), new THREE.Vector3(5, 5, 3)) : bounds.clone()
  const size = b.getSize(new THREE.Vector3())
  const center = b.getCenter(new THREE.Vector3())
  const pad = 1.08
  const mode = style
  const frame = (w: number, h: number): [number, number] => {
    let hw = (w / 2) * pad
    let hh = (h / 2) * pad
    if (hw / hh > aspect) hh = hw / aspect
    else hw = hh * aspect
    return [Math.max(0.5, hw), Math.max(0.5, hh)]
  }
  switch (source.kind) {
    case 'plan':
    case 'ceiling-plan': {
      const level = doc.getNode<'level'>(source.levelId)
      if (!level) return null
      const z = level.t.p[2]
      const cut = z + level.params.cutHeight
      const [hw, hh] = frame(size.x, size.y)
      if (source.kind === 'plan') {
        const c = new THREE.Vector3(center.x, center.y, cut)
        const cam = ortho(c, new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0), hw, hh, Math.max(size.z, 5))
        return { camera: cam, planLevel: level.id, section: null, mode }
      }
      // reflected ceiling plan: look up from the floor
      const c = new THREE.Vector3(center.x, center.y, z + 0.01)
      const cam = ortho(c, new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), hw, hh, Math.max(level.params.height, 3))
      return { camera: cam, planLevel: null, section: null, mode }
    }
    case 'section': {
      const s = doc.getNode<'section'>(source.sectionId)
      if (!s) return null
      const m = doc.getWorldMatrix(s.id)
      const point = new THREE.Vector3(m[12]!, m[13]!, m[14]!)
      const normal = new THREE.Vector3(m[8]!, m[9]!, m[10]!).normalize() // local +Z (clipped side)
      // extents across the view (along local X) and up
      const along = new THREE.Vector3(m[0]!, m[1]!, m[2]!).normalize()
      let hw = 0
      let hh = 0
      for (let i = 0; i < 8; i++) {
        const c = new THREE.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).sub(center)
        hw = Math.max(hw, Math.abs(c.dot(along)))
        hh = Math.max(hh, Math.abs(c.z))
      }
      const [fw, fh] = frame(hw * 2, hh * 2)
      const c = point.clone().setZ(center.z)
      const depth = s.params.depth > 0 ? s.params.depth : Math.max(size.x, size.y) + 2
      // the kept side is -normal; the camera sits there looking toward +normal
      const cam = ortho(c, normal.clone(), new THREE.Vector3(0, 0, 1), fw, fh, depth)
      return { camera: cam, planLevel: null, section: s.id, mode }
    }
    case 'elevation': {
      const dirs: Record<string, THREE.Vector3> = {
        north: new THREE.Vector3(0, -1, 0), // looking south at the north façade
        south: new THREE.Vector3(0, 1, 0),
        east: new THREE.Vector3(-1, 0, 0),
        west: new THREE.Vector3(1, 0, 0),
      }
      const dir = dirs[source.direction]!
      const horizontal = source.direction === 'north' || source.direction === 'south' ? size.x : size.y
      const [hw, hh] = frame(horizontal, size.z)
      const depth = Math.max(size.x, size.y) + 2
      const cam = ortho(center, dir, new THREE.Vector3(0, 0, 1), hw, hh, depth)
      return { camera: cam, planLevel: null, section: null, mode }
    }
    case 'view': {
      const v = doc.listViews().find((x) => x.id === source.viewId)
      if (!v) return null
      const cs = v.camera
      let cam: THREE.Camera
      if (cs.projection === 'orthographic') {
        const h = (cs.orthoHeight ?? 10) / 2
        const o = new THREE.OrthographicCamera(-h * aspect, h * aspect, h, -h, 0.01, 5000)
        cam = o
      } else cam = new THREE.PerspectiveCamera(cs.fov || 50, aspect, 0.05, 5000)
      cam.up.set(0, 0, 1)
      cam.position.set(cs.position[0], cs.position[1], cs.position[2])
      cam.lookAt(cs.target[0], cs.target[1], cs.target[2])
      ;(cam as THREE.PerspectiveCamera).updateProjectionMatrix()
      cam.updateMatrixWorld(true)
      return { camera: cam, planLevel: v.levelId ?? null, section: v.sectionId ?? null, mode: v.renderMode === 'hidden-line' ? 'hidden-line' : mode }
    }
    case 'schedule':
      return null
  }
}

export async function renderSheetView(pipeline: Pipeline, doc: CadDocument, sync: SceneSync, source: SheetViewSource, opts: { width: number; height: number; style: 'shaded' | 'realistic' | 'hidden-line' }): Promise<Blob> {
  const setup = setupForSource(doc, sync, source, opts.width / Math.max(1, opts.height), opts.style)
  if (!setup) throw new Error(`Cannot render sheet view of kind "${source.kind}"`)
  const mode = setup.mode === 'realistic' ? 'shaded' : setup.mode
  const target = pipeline.renderOffscreen(setup.camera, mode, Math.max(1, Math.round(opts.width)), Math.max(1, Math.round(opts.height)), { planLevel: setup.planLevel, section: setup.section })
  try {
    return await targetToBlob(pipeline.d.ctx.renderer, target, 'image/png')
  } finally {
    target.dispose()
    pipeline.d.ctx.requestRender()
  }
}

/** Vector linework: prefers the tools module implementation, falls back to node plan/drawing lines. */
export async function vectorize(doc: CadDocument, geometry: GeometryService, sync: SceneSync, source: SheetViewSource): Promise<VectorResult> {
  try {
    const mod = (await import('../tools/vectorize')) as { vectorizeView?: (deps: { doc: CadDocument; geometry: GeometryService }, source: SheetViewSource) => Promise<VectorResult> }
    if (typeof mod.vectorizeView === 'function') return await mod.vectorizeView({ doc, geometry }, source)
  } catch (err) {
    console.warn('[cadsandbox/render] vectorizeView unavailable, using fallback linework', err)
  }
  return vectorizeFallback(doc, sync, source)
}

/** Fallback: 2D plan symbology / drawings of the level projected onto the plan plane. */
export function vectorizeFallback(doc: CadDocument, sync: SceneSync, source: SheetViewSource): VectorResult {
  const lines: Lines2D[] = []
  const texts: Drawing2D['texts'] = []
  const fills: Drawing2D['fills'] = []
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  const extend = (p: Vec2) => {
    minX = Math.min(minX, p[0])
    maxX = Math.max(maxX, p[0])
    minY = Math.min(minY, p[1])
    maxY = Math.max(maxY, p[1])
  }
  if (source.kind === 'plan' || source.kind === 'ceiling-plan') {
    for (const view of sync.views.values()) {
      if (view.levelId !== source.levelId || !view.result) continue
      const d = view.result.plan ?? view.result.drawing
      if (!d) continue
      const m = doc.getWorldMatrix(view.id)
      const tx = (x: number, y: number): Vec2 => [m[0]! * x + m[4]! * y + m[12]!, m[1]! * x + m[5]! * y + m[13]!]
      for (const l of d.lines) {
        const seg = new Float32Array(l.segments.length)
        for (let i = 0; i + 3 < l.segments.length; i += 4) {
          const a = tx(l.segments[i]!, l.segments[i + 1]!)
          const b = tx(l.segments[i + 2]!, l.segments[i + 3]!)
          seg[i] = a[0]
          seg[i + 1] = a[1]
          seg[i + 2] = b[0]
          seg[i + 3] = b[1]
          extend(a)
          extend(b)
        }
        lines.push({ style: l.style, segments: seg })
      }
      for (const t of d.texts) {
        const p = tx(t.position[0], t.position[1])
        texts.push({ ...t, position: p })
        extend(p)
      }
      for (const f of d.fills) {
        const tris = new Float32Array(f.triangles.length)
        for (let i = 0; i + 1 < f.triangles.length; i += 2) {
          const p = tx(f.triangles[i]!, f.triangles[i + 1]!)
          tris[i] = p[0]
          tris[i + 1] = p[1]
        }
        fills.push({ ...f, triangles: tris, polygons: f.polygons.map((poly) => ({ outer: poly.outer.map((p) => tx(p[0], p[1])), holes: poly.holes.map((h) => h.map((p) => tx(p[0], p[1]))) })) })
      }
    }
  }
  if (minX === Infinity) {
    const b = sync.sceneBounds()
    if (!b.isEmpty()) {
      minX = b.min.x
      minY = b.min.y
      maxX = b.max.x
      maxY = b.max.y
    } else {
      minX = minY = 0
      maxX = maxY = 1
    }
  }
  return { lines, fills, texts, bounds: { min: [minX, minY], max: [maxX, maxY] } }
}
