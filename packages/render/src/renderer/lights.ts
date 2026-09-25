// Scene lighting: sun (NOAA position) or studio key light with a shadow camera fitted to the scene
// bounds, hemisphere fill and a ground shadow catcher for soft contact shadows.
import * as THREE from 'three'
import type { GeoLocation, RenderSettings } from '@cadsandbox/doc'
import type { Vec3 } from '@cadsandbox/doc'
import { sunColor, sunFromDoc } from './sun'

export interface SunOverride {
  /** Local clock hour (decimal). */
  hour: number
  /** ISO date; defaults to the document's sun date. */
  date?: string
}

export class SceneLighting {
  readonly group = new THREE.Group()
  readonly sun: THREE.DirectionalLight
  readonly fill: THREE.HemisphereLight
  readonly catcher: THREE.Mesh
  private catcherMaterial: THREE.ShadowMaterial
  /** Direction toward the sun (world), used by the environment sky. */
  sunDirection: Vec3 | null = null
  /** Editor-local sun time (sun study): read instead of the document's sun while set, never written back. */
  sunOverride: SunOverride | null = null
  private lastBoundsKey = ''

  constructor(shadowMapSize: number) {
    this.group.name = 'cs-lighting'
    this.sun = new THREE.DirectionalLight(0xffffff, 3)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(shadowMapSize, shadowMapSize)
    this.sun.shadow.bias = -0.0004
    this.sun.shadow.normalBias = 0.02
    this.sun.shadow.radius = 4
    this.sun.shadow.camera.near = 0.1
    this.sun.shadow.camera.far = 500
    this.sun.target.position.set(0, 0, 0)
    this.group.add(this.sun, this.sun.target)

    this.fill = new THREE.HemisphereLight(0xdfe6ff, 0x504a44, 0.35)
    this.fill.position.set(0, 0, 1)
    this.group.add(this.fill)

    this.catcherMaterial = new THREE.ShadowMaterial({ opacity: 0.28, transparent: true })
    this.catcherMaterial.polygonOffset = true
    this.catcherMaterial.polygonOffsetFactor = 1
    this.catcherMaterial.polygonOffsetUnits = 2
    this.catcher = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.catcherMaterial)
    this.catcher.name = 'cs-shadow-catcher'
    this.catcher.receiveShadow = true
    this.catcher.matrixAutoUpdate = false
    this.catcher.renderOrder = -5
    this.catcher.userData.helper = true
    this.group.add(this.catcher)
  }

  setShadowMapSize(size: number): void {
    if (this.sun.shadow.mapSize.x === size) return
    this.sun.shadow.mapSize.set(size, size)
    this.sun.shadow.map?.dispose()
    this.sun.shadow.map = null
  }

  /** Update light from document settings; `bounds` fits the shadow frustum and catcher plane. */
  update(settings: RenderSettings, geo: GeoLocation | null, bounds: THREE.Box3 | null, groundZ: number, isDark: boolean): void {
    let dir: Vec3
    let intensity: number
    let color: [number, number, number]
    const o = this.sunOverride
    const sun = o ? { ...settings.sun, enabled: true, hour: o.hour, date: o.date ?? settings.sun.date } : settings.sun
    if (sun.enabled) {
      const s = sunFromDoc(geo, sun.date, sun.hour)
      dir = s.direction
      const below = s.position.elevation <= 0
      intensity = below ? 0 : sun.intensity * Math.min(1, Math.max(0.05, Math.sin(s.position.elevation) * 1.5))
      color = sunColor(s.position.elevation)
      this.sunDirection = below ? null : dir
      if (below) dir = [0.3, -0.5, 0.8]
    } else {
      // studio key light: upper-left-front
      dir = [-0.45, -0.55, 0.7]
      intensity = 1.6
      color = [1, 0.98, 0.95]
      this.sunDirection = null
    }
    const len = Math.hypot(dir[0], dir[1], dir[2]) || 1
    const d = new THREE.Vector3(dir[0] / len, dir[1] / len, dir[2] / len)
    this.sun.color.setRGB(color[0], color[1], color[2])
    this.sun.intensity = intensity
    this.sun.castShadow = settings.shadows && intensity > 0
    this.sun.visible = intensity > 0
    this.fill.intensity = settings.environment === 'night' ? 0.08 : isDark ? 0.3 : 0.4
    this.catcher.visible = settings.shadows && intensity > 0

    const center = bounds && !bounds.isEmpty() ? bounds.getCenter(_c) : _c.set(0, 0, 0)
    const radius = bounds && !bounds.isEmpty() ? Math.max(1, bounds.getSize(_s).length() / 2) : 10
    this.sun.position.copy(center).addScaledVector(d, radius * 2 + 5)
    this.sun.target.position.copy(center)
    this.sun.target.updateMatrixWorld()
    const key = `${center.x.toFixed(2)},${center.y.toFixed(2)},${center.z.toFixed(2)},${radius.toFixed(2)}`
    if (key !== this.lastBoundsKey) {
      this.lastBoundsKey = key
      const cam = this.sun.shadow.camera
      const r = radius * 1.05
      cam.left = -r
      cam.right = r
      cam.top = r
      cam.bottom = -r
      cam.near = 0.1
      cam.far = radius * 4 + 10
      cam.updateProjectionMatrix()
      // fit catcher plane under the scene
      const size = Math.max(20, radius * 6)
      _m.makeScale(size, size, 1)
      _m.setPosition(center.x, center.y, groundZ - 0.0005)
      this.catcher.matrix.copy(_m)
      this.catcher.matrixWorld.copy(_m)
    } else if (Math.abs(this.catcher.matrix.elements[14]! - (groundZ - 0.0005)) > 1e-6) {
      this.catcher.matrix.elements[14] = groundZ - 0.0005
      this.catcher.matrixWorld.copy(this.catcher.matrix)
    }
    this.catcherMaterial.opacity = isDark ? 0.4 : 0.22
  }

  dispose(): void {
    this.sun.shadow.map?.dispose()
    this.catcher.geometry.dispose()
    this.catcherMaterial.dispose()
    this.sun.dispose()
    this.fill.dispose()
  }
}

const _c = new THREE.Vector3()
const _s = new THREE.Vector3()
const _m = new THREE.Matrix4()
