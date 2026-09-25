// Interactive view cube: a glassy rounded cube in a mini scissored scene at each viewport's top-left.
// Faces, edges and corners are hit-testable; the hovered region is highlighted.
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { ViewPreset } from '../api'
import type { ThemeColors } from '../util/css'

export const VIEWCUBE_SIZE = 84
export const VIEWCUBE_MARGIN = 12

export interface CubeHit {
  /** Unit direction (world) from the target toward the camera. */
  direction: THREE.Vector3
  kind: 'face' | 'edge' | 'corner'
  preset: ViewPreset | null
  /** Region box (cube space) for the highlight. */
  center: THREE.Vector3
  size: THREE.Vector3
}

const FACE_LABELS: { normal: [number, number, number]; text: string; preset: ViewPreset; up: [number, number, number] }[] = [
  { normal: [0, 0, 1], text: 'TOP', preset: 'top', up: [0, 1, 0] },
  { normal: [0, 0, -1], text: 'BOTTOM', preset: 'bottom', up: [0, 1, 0] },
  { normal: [0, -1, 0], text: 'FRONT', preset: 'front', up: [0, 0, 1] },
  { normal: [0, 1, 0], text: 'BACK', preset: 'back', up: [0, 0, 1] },
  { normal: [1, 0, 0], text: 'RIGHT', preset: 'right', up: [0, 0, 1] },
  { normal: [-1, 0, 0], text: 'LEFT', preset: 'left', up: [0, 0, 1] },
]

export class ViewCube {
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(32, 1, 0.5, 20)
  private cube: THREE.Mesh
  private cubeMaterial: THREE.MeshStandardMaterial
  private labels: THREE.Mesh[] = []
  private labelTextures: THREE.CanvasTexture[] = []
  private edges: THREE.LineSegments
  private highlight: THREE.Mesh
  private highlightMaterial: THREE.MeshBasicMaterial
  private triad: THREE.LineSegments
  private raycaster = new THREE.Raycaster()
  private theme: ThemeColors
  hovered: CubeHit | null = null

  constructor(theme: ThemeColors) {
    this.theme = theme
    this.camera.up.set(0, 0, 1)
    this.cubeMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.22,
      metalness: 0.05,
      transparent: true,
      opacity: 0.92,
      envMapIntensity: 0.9,
    })
    this.cube = new THREE.Mesh(new RoundedBoxGeometry(1, 1, 1, 3, 0.09), this.cubeMaterial)
    this.scene.add(this.cube)
    this.edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.001, 1.001, 1.001)), new THREE.LineBasicMaterial({ transparent: true, opacity: 0.45 }))
    this.scene.add(this.edges)
    this.highlightMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, depthTest: false })
    this.highlight = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.highlightMaterial)
    this.highlight.visible = false
    this.highlight.renderOrder = 5
    this.scene.add(this.highlight)
    for (const f of FACE_LABELS) {
      const tex = new THREE.CanvasTexture(document.createElement('canvas'))
      tex.colorSpace = THREE.SRGBColorSpace
      tex.anisotropy = 4
      this.labelTextures.push(tex)
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.86), mat)
      const n = new THREE.Vector3(...f.normal)
      plane.position.copy(n).multiplyScalar(0.508)
      const up = new THREE.Vector3(...f.up)
      _m.lookAt(_zero, n.clone().negate(), up)
      plane.quaternion.setFromRotationMatrix(_m)
      plane.renderOrder = 2
      this.labels.push(plane)
      this.scene.add(plane)
    }
    const triadGeo = new THREE.BufferGeometry()
    triadGeo.setAttribute('position', new THREE.Float32BufferAttribute([-0.75, -0.75, -0.75, -0.35, -0.75, -0.75, -0.75, -0.75, -0.75, -0.75, -0.35, -0.75, -0.75, -0.75, -0.75, -0.75, -0.75, -0.35], 3))
    triadGeo.setAttribute('color', new THREE.Float32BufferAttribute([1, 0.3, 0.37, 1, 0.3, 0.37, 0.18, 0.84, 0.48, 0.18, 0.84, 0.48, 0.25, 0.71, 1, 0.25, 0.71, 1], 3))
    this.triad = new THREE.LineSegments(triadGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 }))
    this.scene.add(this.triad)
    const hemi = new THREE.HemisphereLight(0xffffff, 0x8888aa, 0.7)
    hemi.position.set(0, 0, 1)
    this.scene.add(hemi)
    const key = new THREE.DirectionalLight(0xffffff, 1.2)
    key.position.set(1.5, -2, 2.5)
    this.scene.add(key)
    this.setTheme(theme)
  }

  setTheme(theme: ThemeColors): void {
    this.theme = theme
    const surface = theme.get('--cs-surface').color
    const text = theme.get('--cs-text-2').color
    const border = theme.get('--cs-border-strong').color
    this.cubeMaterial.color.copy(surface).lerp(new THREE.Color(0.5, 0.5, 0.55), theme.isDark ? 0.25 : 0.05)
    ;(this.edges.material as THREE.LineBasicMaterial).color.copy(border)
    ;(this.edges.material as THREE.LineBasicMaterial).opacity = theme.isDark ? 0.6 : 0.5
    this.highlightMaterial.color.copy(theme.get('--cs-accent').color)
    FACE_LABELS.forEach((f, i) => {
      const tex = this.labelTextures[i]!
      const canvas = tex.image as HTMLCanvasElement
      canvas.width = 256
      canvas.height = 256
      const ctx = canvas.getContext('2d')!
      ctx.clearRect(0, 0, 256, 256)
      ctx.fillStyle = `#${text.getHexString(THREE.SRGBColorSpace)}`
      ctx.font = '600 44px Inter, "Inter Variable", system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(f.text, 128, 132)
      tex.needsUpdate = true
    })
  }

  setEnvironment(env: THREE.Texture | null): void {
    this.scene.environment = env
  }

  /** Orient the mini camera like the viewport camera (world rotation only). */
  sync(viewCamera: THREE.Camera): void {
    viewCamera.getWorldDirection(_dir)
    this.camera.position.copy(_dir).multiplyScalar(-3.4)
    this.camera.quaternion.copy(viewCamera.getWorldQuaternion(_q))
    this.camera.updateMatrixWorld()
  }

  /** Hit-test local cube-region coordinates (0..size CSS px). */
  hitTest(localX: number, localY: number, size = VIEWCUBE_SIZE): CubeHit | null {
    _ndc.set((localX / size) * 2 - 1, -(localY / size) * 2 + 1)
    this.raycaster.setFromCamera(_ndc, this.camera)
    const hits = this.raycaster.intersectObject(this.cube, false)
    if (!hits.length) return null
    const p = hits[0]!.point
    const t = 0.34
    const sx = Math.abs(p.x) > t ? Math.sign(p.x) : 0
    const sy = Math.abs(p.y) > t ? Math.sign(p.y) : 0
    const sz = Math.abs(p.z) > t ? Math.sign(p.z) : 0
    const axes = Math.abs(sx) + Math.abs(sy) + Math.abs(sz)
    let dir: THREE.Vector3
    if (axes === 0) {
      // middle of a face (rounded box normal fallback)
      const n = hits[0]!.face?.normal ?? new THREE.Vector3(0, 0, 1)
      const ax = Math.abs(n.x) >= Math.abs(n.y) && Math.abs(n.x) >= Math.abs(n.z) ? 'x' : Math.abs(n.y) >= Math.abs(n.z) ? 'y' : 'z'
      dir = new THREE.Vector3(ax === 'x' ? Math.sign(n.x) : 0, ax === 'y' ? Math.sign(n.y) : 0, ax === 'z' ? Math.sign(n.z) : 0)
    } else dir = new THREE.Vector3(sx, sy, sz)
    const kind: CubeHit['kind'] = axes <= 1 ? 'face' : axes === 2 ? 'edge' : 'corner'
    const center = dir.clone().multiplyScalar(0.5)
    const sizeV = new THREE.Vector3(dir.x ? 0.06 : 0.66, dir.y ? 0.06 : 0.66, dir.z ? 0.06 : 0.66)
    if (kind === 'edge') sizeV.set(dir.x ? 0.16 : 0.66, dir.y ? 0.16 : 0.66, dir.z ? 0.16 : 0.66)
    if (kind === 'corner') sizeV.set(0.24, 0.24, 0.24)
    let preset: ViewPreset | null = null
    if (kind === 'face') {
      const f = FACE_LABELS.find((l) => l.normal[0] === dir.x && l.normal[1] === dir.y && l.normal[2] === dir.z)
      preset = f?.preset ?? null
    }
    return { direction: dir.normalize(), kind, preset, center, size: sizeV }
  }

  setHover(hit: CubeHit | null): void {
    this.hovered = hit
    this.highlight.visible = !!hit
    if (hit) {
      this.highlight.position.copy(hit.center)
      this.highlight.scale.copy(hit.size)
    }
  }

  render(renderer: THREE.WebGLRenderer): void {
    const tm = renderer.toneMapping
    renderer.toneMapping = THREE.NoToneMapping
    renderer.clearDepth()
    renderer.render(this.scene, this.camera)
    renderer.toneMapping = tm
  }

  dispose(): void {
    this.cube.geometry.dispose()
    this.cubeMaterial.dispose()
    this.edges.geometry.dispose()
    ;(this.edges.material as THREE.Material).dispose()
    this.highlight.geometry.dispose()
    this.highlightMaterial.dispose()
    this.triad.geometry.dispose()
    ;(this.triad.material as THREE.Material).dispose()
    for (const l of this.labels) {
      l.geometry.dispose()
      ;(l.material as THREE.Material).dispose()
    }
    for (const t of this.labelTextures) t.dispose()
  }
}

/** camera-controls spherical angles for a direction (from target toward camera), Z-up mapping. */
export function anglesForDirection(d: THREE.Vector3): { azimuth: number; polar: number } {
  const n = d.clone().normalize()
  const polar = Math.acos(Math.max(-1, Math.min(1, n.z)))
  const azimuth = Math.atan2(n.x, -n.y)
  return { azimuth, polar: Math.min(Math.PI - 1e-4, Math.max(1e-4, polar)) }
}

const _m = new THREE.Matrix4()
const _zero = new THREE.Vector3()
const _dir = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _ndc = new THREE.Vector2()
