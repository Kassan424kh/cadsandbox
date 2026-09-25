// Shader-based infinite grid on the active work plane (Z = level elevation): anti-aliased minor/major
// lines fading with distance, subtle X (red) / Y (green) axes. Colors come from the theme tokens.
import * as THREE from 'three'
import type { ThemeColors } from '../util/css'

const vertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

const fragment = /* glsl */ `
  precision highp float;
  varying vec3 vWorld;
  uniform vec3 uMinorColor;
  uniform float uMinorAlpha;
  uniform vec3 uMajorColor;
  uniform float uMajorAlpha;
  uniform vec3 uAxisX;
  uniform vec3 uAxisY;
  uniform float uMinor;
  uniform float uMajor;
  uniform float uFade;
  uniform vec3 uCamera;
  uniform float uOrtho;
  uniform float uOpacity;

  float gridLine(vec2 p, float step) {
    vec2 coord = p / step;
    vec2 d = fwidth(coord);
    vec2 g = abs(fract(coord - 0.5) - 0.5) / max(d, vec2(1e-6));
    float line = min(g.x, g.y);
    return 1.0 - min(line, 1.0);
  }

  void main() {
    vec2 p = vWorld.xy;
    float minor = gridLine(p, uMinor);
    float major = gridLine(p, uMajor);
    // hide minor lines when they get too dense on screen
    vec2 dens = fwidth(p) / uMinor;
    float density = max(dens.x, dens.y);
    float minorVis = 1.0 - smoothstep(0.25, 0.6, density);
    float dist = uOrtho > 0.5 ? 0.0 : length(vWorld - uCamera);
    float fade = uOrtho > 0.5 ? 1.0 : (1.0 - smoothstep(uFade * 0.35, uFade, dist));
    vec2 dAxis = fwidth(p);
    float ax = 1.0 - min(abs(p.y) / max(dAxis.y * 1.2, 1e-6), 1.0);
    float ay = 1.0 - min(abs(p.x) / max(dAxis.x * 1.2, 1e-6), 1.0);
    vec3 color = uMinorColor;
    float alpha = minor * uMinorAlpha * minorVis;
    float majA = major * uMajorAlpha;
    color = mix(color, uMajorColor, step(alpha, majA));
    alpha = max(alpha, majA);
    float axA = max(ax, ay) * 0.9;
    vec3 axisColor = ax >= ay ? uAxisX : uAxisY;
    color = mix(color, axisColor, step(alpha, axA));
    alpha = max(alpha, axA);
    alpha *= fade * uOpacity;
    if (alpha < 0.003) discard;
    gl_FragColor = vec4(color, alpha);
    #include <colorspace_fragment>
  }
`

export class InfiniteGrid {
  readonly mesh: THREE.Mesh
  readonly material: THREE.ShaderMaterial
  private size = 1
  private subdivisions = 10

  constructor(theme: ThemeColors) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      uniforms: {
        uMinorColor: { value: new THREE.Color(1, 1, 1) },
        uMinorAlpha: { value: 0.05 },
        uMajorColor: { value: new THREE.Color(1, 1, 1) },
        uMajorAlpha: { value: 0.1 },
        uAxisX: { value: new THREE.Color('#ff4d5e') },
        uAxisY: { value: new THREE.Color('#2fd67b') },
        uMinor: { value: 0.1 },
        uMajor: { value: 1 },
        uFade: { value: 200 },
        uCamera: { value: new THREE.Vector3() },
        uOrtho: { value: 0 },
        uOpacity: { value: 1 },
      },
    })
    this.material.toneMapped = false
    const geo = new THREE.PlaneGeometry(1, 1)
    this.mesh = new THREE.Mesh(geo, this.material)
    this.mesh.name = 'cs-grid'
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = -10
    this.mesh.matrixAutoUpdate = false
    this.mesh.userData.helper = true
    this.mesh.castShadow = false
    this.mesh.receiveShadow = false
    this.setTheme(theme)
  }

  setTheme(theme: ThemeColors): void {
    const minor = theme.get('--cs-grid-minor')
    const major = theme.get('--cs-grid-major')
    const u = this.material.uniforms
    ;(u.uMinorColor!.value as THREE.Color).copy(minor.color)
    u.uMinorAlpha!.value = minor.alpha * 1.6
    ;(u.uMajorColor!.value as THREE.Color).copy(major.color)
    u.uMajorAlpha!.value = major.alpha * 1.6
    ;(u.uAxisX!.value as THREE.Color).copy(theme.get('--cs-danger').color)
    ;(u.uAxisY!.value as THREE.Color).copy(theme.get('--cs-success').color)
  }

  setSettings(size: number, subdivisions: number): void {
    this.size = Math.max(1e-4, size)
    this.subdivisions = Math.max(1, Math.round(subdivisions))
    this.material.uniforms.uMajor!.value = this.size
    this.material.uniforms.uMinor!.value = this.size / this.subdivisions
  }

  /** Position the grid plane and adapt fade to the camera for a viewport render. */
  update(camera: THREE.Camera, elevation: number, ortho: boolean, opacity = 1): void {
    const pos = camera.getWorldPosition(_v)
    const height = Math.abs(pos.z - elevation)
    const extent = ortho ? 1e5 : Math.max(200, height * 60)
    // Center the plane under the camera so the "infinite" grid never runs out.
    _m.makeScale(extent, extent, 1)
    _m.setPosition(ortho ? 0 : pos.x, ortho ? 0 : pos.y, elevation)
    this.mesh.matrix.copy(_m)
    this.mesh.matrixWorld.copy(_m)
    const u = this.material.uniforms
    ;(u.uCamera!.value as THREE.Vector3).copy(pos)
    u.uOrtho!.value = ortho ? 1 : 0
    u.uFade!.value = Math.max(30, height * 25)
    u.uOpacity!.value = opacity
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    this.material.dispose()
  }
}

const _v = new THREE.Vector3()
const _m = new THREE.Matrix4()
