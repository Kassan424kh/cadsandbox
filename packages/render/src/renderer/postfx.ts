// Fullscreen passes: HDR → display tone mapping (AgX / ACES / Neutral + exposure) and the
// multi-color selection outline (mask edge detection). Both draw into the current scissor region.
import * as THREE from 'three'

export type ToneMode = 'agx' | 'aces' | 'neutral' | 'none'

const quadGeometry = new THREE.BufferGeometry()
quadGeometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3))
quadGeometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2))

const quadVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

class FullscreenPass {
  readonly mesh: THREE.Mesh
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  readonly scene = new THREE.Scene()
  constructor(material: THREE.ShaderMaterial) {
    this.mesh = new THREE.Mesh(quadGeometry, material)
    this.mesh.frustumCulled = false
    this.scene.add(this.mesh)
  }
  render(renderer: THREE.WebGLRenderer): void {
    const tm = renderer.toneMapping
    renderer.toneMapping = THREE.NoToneMapping
    renderer.render(this.scene, this.camera)
    renderer.toneMapping = tm
  }
  dispose(): void {
    ;(this.mesh.material as THREE.Material).dispose()
  }
}

const toneFragment = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tDiffuse;
  uniform float uExposure;
  uniform int uMode;
  uniform float uAlpha;
  #include <tonemapping_pars_fragment>
  vec3 linearToSRGB(vec3 c) {
    return mix(pow(c, vec3(1.0 / 2.4)) * 1.055 - 0.055, c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308))));
  }
  void main() {
    vec4 texel = texture2D(tDiffuse, vUv);
    vec3 c = texel.rgb;
    if (uMode == 1) c = AgXToneMapping(c);
    else if (uMode == 2) c = ACESFilmicToneMapping(c);
    else if (uMode == 3) c = NeutralToneMapping(c);
    else c = LinearToneMapping(c);
    gl_FragColor = vec4(linearToSRGB(clamp(c, 0.0, 1.0)), texel.a * uAlpha);
  }
`

export class ToneMapPass {
  private pass: FullscreenPass
  private material: THREE.ShaderMaterial
  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: quadVertex,
      fragmentShader: toneFragment,
      uniforms: {
        tDiffuse: { value: null },
        uExposure: { value: 1 },
        toneMappingExposure: { value: 1 },
        uMode: { value: 1 },
        uAlpha: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.NormalBlending,
      premultipliedAlpha: false,
    })
    this.material.toneMapped = false
    this.pass = new FullscreenPass(this.material)
  }

  render(renderer: THREE.WebGLRenderer, texture: THREE.Texture, mode: ToneMode, exposure: number): void {
    const u = this.material.uniforms
    u.tDiffuse!.value = texture
    u.toneMappingExposure!.value = exposure
    u.uExposure!.value = exposure
    u.uMode!.value = mode === 'agx' ? 1 : mode === 'aces' ? 2 : mode === 'neutral' ? 3 : 0
    this.pass.render(renderer)
  }

  dispose(): void {
    this.pass.dispose()
  }
}

const outlineFragment = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tMask;
  uniform vec2 uTexel;
  uniform float uThickness;
  uniform float uGlow;

  void main() {
    vec4 c = texture2D(tMask, vUv);
    float best = 0.0;
    vec3 color = vec3(0.0);
    float glowSum = 0.0;
    vec3 glowColor = vec3(0.0);
    // ring samples for crisp edges (thickness px) + wider soft glow
    for (int i = 0; i < 16; i++) {
      float a = float(i) * 0.392699; // 2π/16
      vec2 dir = vec2(cos(a), sin(a));
      vec4 s = texture2D(tMask, vUv + dir * uTexel * uThickness);
      if (s.a > best) { best = s.a; color = s.rgb; }
      vec4 g = texture2D(tMask, vUv + dir * uTexel * uThickness * 3.0);
      glowSum += g.a;
      glowColor += g.rgb * g.a;
    }
    float inside = c.a;
    float edge = max(best - inside, 0.0);
    float glow = (glowSum / 16.0) * (1.0 - inside) * uGlow;
    vec3 gc = glowSum > 0.0 ? glowColor / max(glowSum, 1e-4) : color;
    vec3 outColor = edge > 0.05 ? color : gc;
    float alpha = max(edge, glow * 0.6);
    // subtle inner rim for depth
    if (inside > 0.5 && best > 0.5) {
      vec4 inner = texture2D(tMask, vUv + vec2(uTexel.x, uTexel.y) * uThickness * 1.5);
      alpha = max(alpha, (1.0 - inner.a) * 0.35);
      outColor = color;
    }
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(outColor, alpha);
    #include <colorspace_fragment>
  }
`

/** Draws colored outlines from a mask texture where each object was rendered flat in its outline color. */
export class OutlinePass {
  private pass: FullscreenPass
  private material: THREE.ShaderMaterial
  readonly target: THREE.WebGLRenderTarget
  readonly maskMaterials = new Map<number, THREE.MeshBasicMaterial>()

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: quadVertex,
      fragmentShader: outlineFragment,
      uniforms: {
        tMask: { value: null },
        uTexel: { value: new THREE.Vector2(1 / 512, 1 / 512) },
        uThickness: { value: 1.5 },
        uGlow: { value: 0.5 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })
    this.material.toneMapped = false
    this.pass = new FullscreenPass(this.material)
    this.target = new THREE.WebGLRenderTarget(4, 4, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
    })
    this.target.texture.colorSpace = THREE.LinearSRGBColorSpace
  }

  setSize(w: number, h: number): void {
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h)
    ;(this.material.uniforms.uTexel!.value as THREE.Vector2).set(1 / Math.max(1, w), 1 / Math.max(1, h))
  }

  maskMaterial(color: THREE.Color): THREE.MeshBasicMaterial {
    const key = color.getHex()
    let m = this.maskMaterials.get(key)
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color: color.clone(), side: THREE.DoubleSide, toneMapped: false })
      m.fog = false
      this.maskMaterials.set(key, m)
    }
    return m
  }

  /** Composite the outline over the current render target region (device px thickness). */
  render(renderer: THREE.WebGLRenderer, thicknessPx: number, glow: number): void {
    this.material.uniforms.tMask!.value = this.target.texture
    this.material.uniforms.uThickness!.value = thicknessPx
    this.material.uniforms.uGlow!.value = glow
    this.pass.render(renderer)
  }

  dispose(): void {
    this.pass.dispose()
    this.target.dispose()
    for (const m of this.maskMaterials.values()) m.dispose()
    this.maskMaterials.clear()
  }
}

/** Simple textured blit (path tracer / screenshot compositing), optionally with alpha. */
export class BlitPass {
  private pass: FullscreenPass
  private material: THREE.ShaderMaterial
  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: quadVertex,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D tDiffuse;
        uniform float uOpacity;
        void main() {
          vec4 c = texture2D(tDiffuse, vUv);
          gl_FragColor = vec4(c.rgb, c.a * uOpacity);
        }
      `,
      uniforms: { tDiffuse: { value: null }, uOpacity: { value: 1 } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })
    this.material.toneMapped = false
    this.pass = new FullscreenPass(this.material)
  }
  render(renderer: THREE.WebGLRenderer, texture: THREE.Texture, opacity = 1): void {
    this.material.uniforms.tDiffuse!.value = texture
    this.material.uniforms.uOpacity!.value = opacity
    this.pass.render(renderer)
  }
  dispose(): void {
    this.pass.dispose()
  }
}

/** Vertical two-color gradient background drawn before the scene (background: 'gradient'). */
export class GradientPass {
  private pass: FullscreenPass
  private material: THREE.ShaderMaterial
  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: quadVertex,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec2 vUv;
        uniform vec3 uTop;
        uniform vec3 uBottom;
        void main() {
          float t = smoothstep(0.0, 1.0, vUv.y);
          vec3 c = mix(uBottom, uTop, t);
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }
      `,
      uniforms: { uTop: { value: new THREE.Color() }, uBottom: { value: new THREE.Color() } },
      depthTest: false,
      depthWrite: false,
    })
    this.material.toneMapped = false
    this.pass = new FullscreenPass(this.material)
  }
  render(renderer: THREE.WebGLRenderer, top: THREE.Color, bottom: THREE.Color): void {
    ;(this.material.uniforms.uTop!.value as THREE.Color).copy(top)
    ;(this.material.uniforms.uBottom!.value as THREE.Color).copy(bottom)
    this.pass.render(renderer)
  }
  dispose(): void {
    this.pass.dispose()
  }
}

export function createHdrTarget(w: number, h: number, samples: number): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
    stencilBuffer: false,
    samples,
  })
  rt.texture.colorSpace = THREE.LinearSRGBColorSpace
  return rt
}
