// PreviewLayer — temporary geometry for tools: ghosted nodes (evaluated via the geometry service),
// rubber-band lines, planar drawings, translucent polygons and snap markers.
import * as THREE from 'three'
import type { AnyNode, Vec3 } from '@cadsandbox/doc'
import type { Drawing2D, GeometryResult, GeometryService, LineStyle } from '@cadsandbox/geometry'
import type { PreviewLayer as PreviewLayerApi, SnapResultKind, WorkPlane } from '../tools/types'
import type { MaterialCache } from '../materials/materials'
import type { HatchTextures } from '../materials/hatch'
import type { ThemeColors } from '../util/css'
import { DrawingView, makeFatLines, type LineStyleMaterials, type LineStyleKey } from '../scene/drawing'
import { buildParts } from '../scene/nodeContent'
import { matrixFromTransform } from '../util/math'
import type { OverlayLayer } from './overlayLayer'

interface GhostEntry {
  group: THREE.Group
  node: AnyNode
  paramsKey: string
  opacity: number
  parentMatrix: THREE.Matrix4 | null
  token: number
}

export class PreviewLayer implements PreviewLayerApi {
  readonly root = new THREE.Group()
  private geometry: GeometryService
  private materials: MaterialCache
  private lineMaterials: LineStyleMaterials
  private hatches: HatchTextures
  private theme: ThemeColors
  private overlay: OverlayLayer
  private requestRender: () => void
  private objects = new Map<string, THREE.Object3D>()
  private ghosts = new Map<string, GhostEntry>()
  private markers = new Map<string, string>()
  private drawings = new Map<string, DrawingView>()
  private nextId = 1

  constructor(geometry: GeometryService, materials: MaterialCache, lineMaterials: LineStyleMaterials, hatches: HatchTextures, theme: ThemeColors, overlay: OverlayLayer, requestRender: () => void) {
    this.geometry = geometry
    this.materials = materials
    this.lineMaterials = lineMaterials
    this.hatches = hatches
    this.theme = theme
    this.overlay = overlay
    this.requestRender = requestRender
    this.root.name = 'cs-preview'
    this.root.matrixAutoUpdate = false
  }

  setTheme(theme: ThemeColors): void {
    this.theme = theme
  }

  private handle(prefix: string): string {
    return `${prefix}${this.nextId++}`
  }

  // ------------------------------------------------------------------ ghost nodes
  node(node: AnyNode, opts?: { opacity?: number; parentMatrix?: THREE.Matrix4 }): string {
    const h = this.handle('pn')
    const group = new THREE.Group()
    group.matrixAutoUpdate = false
    group.userData.preview = true
    this.root.add(group)
    const entry: GhostEntry = { group, node, paramsKey: JSON.stringify(node.params), opacity: opts?.opacity ?? 0.5, parentMatrix: opts?.parentMatrix ?? null, token: 0 }
    this.ghosts.set(h, entry)
    this.objects.set(h, group)
    this.placeGhost(entry)
    this.buildGhost(entry)
    return h
  }

  updateNode(handle: string, node: AnyNode): void {
    const entry = this.ghosts.get(handle)
    if (!entry) return
    entry.node = node
    this.placeGhost(entry)
    const key = JSON.stringify(node.params)
    if (key !== entry.paramsKey || node.material !== entry.node.material) {
      entry.paramsKey = key
      this.buildGhost(entry)
    }
    this.requestRender()
  }

  private placeGhost(entry: GhostEntry): void {
    matrixFromTransform(entry.node.t, entry.group.matrix)
    if (entry.parentMatrix) entry.group.matrix.premultiply(entry.parentMatrix)
    entry.group.matrixWorldNeedsUpdate = true
  }

  private buildGhost(entry: GhostEntry): void {
    const token = ++entry.token
    const sync = this.geometry.previewSync(entry.node)
    if (sync) {
      this.applyGhost(entry, sync)
      return
    }
    void this.geometry
      .preview(entry.node)
      .then((r) => {
        if (entry.token === token && this.ghosts.has(this.handleOf(entry))) this.applyGhost(entry, r)
      })
      .catch(() => {})
  }

  private handleOf(entry: GhostEntry): string {
    for (const [h, e] of this.ghosts) if (e === entry) return h
    return ''
  }

  private applyGhost(entry: GhostEntry, result: GeometryResult): void {
    this.disposeChildren(entry.group)
    for (const bp of buildParts(result, '')) {
      const { def, id, tint } = this.materials.resolveDef(entry.node, bp.part)
      const base = this.materials.get(id, def, tint, 'shaded')
      bp.mesh.material = this.materials.ghost(base, entry.opacity)
      bp.mesh.castShadow = false
      bp.mesh.receiveShadow = false
      bp.mesh.userData.preview = true
      bp.mesh.userData.noPathTrace = true
      bp.mesh.raycast = () => {}
      entry.group.add(bp.mesh)
    }
    if (result.edges && result.edges.length) {
      const edges = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(result.edges, 3)), this.materials.edgeShaded)
      edges.raycast = () => {}
      edges.userData.noPathTrace = true
      entry.group.add(edges)
    }
    const d = result.drawing ?? result.plan
    if (d) {
      const dv = new DrawingView(this.lineMaterials, this.hatches, this.theme, this.requestRender)
      dv.set(d, { opacity: entry.opacity })
      dv.group.traverse((o) => (o.raycast = () => {}))
      entry.group.add(dv.group)
    }
    this.requestRender()
  }

  // ------------------------------------------------------------------ primitives
  lines(points: Vec3[], opts?: { closed?: boolean; style?: LineStyle | 'guide' | 'rubber'; color?: string; dashed?: boolean }): string {
    const h = this.handle('pl')
    const flat: number[] = []
    for (let i = 0; i + 1 < points.length; i++) flat.push(...points[i]!, ...points[i + 1]!)
    if (opts?.closed && points.length > 2) flat.push(...points[points.length - 1]!, ...points[0]!)
    if (flat.length < 6) flat.push(0, 0, 0, 0, 0, 0)
    const style: LineStyleKey = opts?.style ?? 'rubber'
    const mat = this.lineMaterials.get(opts?.dashed && style !== 'guide' ? 'guide' : style, opts?.color ?? null, 1, 'overlay')
    const obj = makeFatLines(flat, mat)
    obj.raycast = () => {}
    this.root.add(obj)
    this.objects.set(h, obj)
    this.requestRender()
    return h
  }

  drawing(d: Drawing2D, plane: WorkPlane): string {
    const h = this.handle('pd')
    const dv = new DrawingView(this.lineMaterials, this.hatches, this.theme, this.requestRender)
    dv.set(d, { variant: 'overlay' })
    dv.group.matrix.copy(planeMatrix(plane))
    dv.group.matrixWorldNeedsUpdate = true
    dv.group.traverse((o) => (o.raycast = () => {}))
    this.root.add(dv.group)
    this.objects.set(h, dv.group)
    this.drawings.set(h, dv)
    this.requestRender()
    return h
  }

  polygon(points: Vec3[], opts?: { color?: string; opacity?: number }): string {
    const h = this.handle('pp')
    const group = new THREE.Group()
    if (points.length >= 3) {
      const pts = points.map((p) => new THREE.Vector3(p[0], p[1], p[2]))
      const n = polygonNormal(pts)
      const u = Math.abs(n.z) < 0.9 ? new THREE.Vector3(0, 0, 1).cross(n).normalize() : new THREE.Vector3(1, 0, 0)
      const v = new THREE.Vector3().crossVectors(n, u)
      const o = pts[0]!
      const flat = pts.map((p) => new THREE.Vector2(_t.copy(p).sub(o).dot(u), _t.copy(p).sub(o).dot(v)))
      let tris: number[][] = []
      try {
        tris = THREE.ShapeUtils.triangulateShape(flat, [])
      } catch {
        tris = []
      }
      const pos: number[] = []
      for (const t of tris) for (const i of t) pos.push(pts[i]!.x, pts[i]!.y, pts[i]!.z)
      if (pos.length) {
        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
        geo.computeVertexNormals()
        const color = opts?.color ? new THREE.Color(opts.color) : this.theme.get('--cs-accent').color
        const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: opts?.opacity ?? 0.2, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }))
        mesh.raycast = () => {}
        mesh.userData.noPathTrace = true
        mesh.renderOrder = 30
        group.add(mesh)
      }
      const outline = makeFatLines([...pts.flatMap((p, i) => [p.x, p.y, p.z, pts[(i + 1) % pts.length]!.x, pts[(i + 1) % pts.length]!.y, pts[(i + 1) % pts.length]!.z])], this.lineMaterials.get('rubber', opts?.color ?? null, 1, 'overlay'))
      outline.raycast = () => {}
      group.add(outline)
    }
    this.root.add(group)
    this.objects.set(h, group)
    this.requestRender()
    return h
  }

  marker(point: Vec3, kind: SnapResultKind): string {
    const h = this.handle('pm')
    this.markers.set(h, this.overlay.marker(point, kind))
    return h
  }

  remove(handle: string): void {
    const m = this.markers.get(handle)
    if (m) {
      this.overlay.remove(m)
      this.markers.delete(handle)
      return
    }
    const obj = this.objects.get(handle)
    if (obj) {
      this.root.remove(obj)
      const dv = this.drawings.get(handle)
      if (dv) {
        dv.dispose()
        this.drawings.delete(handle)
      } else this.disposeChildren(obj, true)
      this.objects.delete(handle)
    }
    this.ghosts.delete(handle)
    this.requestRender()
  }

  clear(): void {
    for (const h of [...this.objects.keys()]) this.remove(h)
    for (const h of [...this.markers.keys()]) this.remove(h)
  }

  private disposeChildren(group: THREE.Object3D, self = false): void {
    const targets = self ? [group] : [...group.children]
    for (const child of targets) {
      child.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.geometry && !(o as unknown as { isText?: boolean }).isText) m.geometry.dispose()
        const mat = m.material as THREE.Material | undefined
        if (mat && (o.userData.ownMaterial || (mat as THREE.MeshBasicMaterial).isMeshBasicMaterial) && !o.userData.lineStyle && !(o as unknown as { isText?: boolean }).isText && o.userData.preview !== true) mat.dispose()
        const t = o as unknown as { isText?: boolean; dispose?: () => void }
        if (t.isText && t.dispose) t.dispose()
      })
      if (!self) group.remove(child)
    }
  }

  dispose(): void {
    this.clear()
    this.root.parent?.remove(this.root)
  }
}

export function planeMatrix(plane: WorkPlane): THREE.Matrix4 {
  const m = new THREE.Matrix4()
  m.makeBasis(new THREE.Vector3(...plane.u), new THREE.Vector3(...plane.v), new THREE.Vector3(...plane.normal))
  m.setPosition(plane.origin[0], plane.origin[1], plane.origin[2])
  return m
}

function polygonNormal(pts: THREE.Vector3[]): THREE.Vector3 {
  const n = new THREE.Vector3()
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!
    const b = pts[(i + 1) % pts.length]!
    n.x += (a.y - b.y) * (a.z + b.z)
    n.y += (a.z - b.z) * (a.x + b.x)
    n.z += (a.x - b.x) * (a.y + b.y)
  }
  return n.lengthSq() < 1e-18 ? n.set(0, 0, 1) : n.normalize()
}

const _t = new THREE.Vector3()
