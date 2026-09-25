// Minimal ambient typings for untyped runtime dependencies (troika-three-text, n8ao).
// Only the surface used by @cadsandbox/render is declared.

declare module 'troika-three-text' {
  import type { Material, Mesh, Color } from 'three'

  export class Text extends Mesh {
    constructor()
    text: string
    anchorX: number | string
    anchorY: number | string
    font: string | null
    unicodeFontsURL: string | null
    fontSize: number
    fontWeight: string | number
    fontStyle: string
    lang: string | null
    letterSpacing: number
    lineHeight: string | number
    maxWidth: number
    overflowWrap: string
    textAlign: string
    whiteSpace: string
    color: string | number | Color | null
    outlineWidth: number | string
    outlineColor: string | number | Color
    outlineOpacity: number
    fillOpacity: number
    depthOffset: number
    orientation: string
    sdfGlyphSize: number | null
    gpuAccelerateSDF: boolean
    material: Material
    textRenderInfo: { blockBounds: [number, number, number, number] } | null
    sync(callback?: () => void): void
    dispose(): void
  }

  export function configureTextBuilder(config: {
    defaultFontURL?: string | null
    unicodeFontsURL?: string | null
    sdfGlyphSize?: number
    sdfMargin?: number
    sdfExponent?: number
    textureWidth?: number
    useWorker?: boolean
  }): void

  export function preloadFont(
    options: { font: string; characters?: string | string[]; sdfGlyphSize?: number },
    callback: () => void,
  ): void
}

declare module 'n8ao' {
  import type { Camera, Color, Scene, WebGLRenderer, WebGLRenderTarget } from 'three'

  export interface N8AOConfiguration {
    aoSamples: number
    aoRadius: number
    denoiseSamples: number
    denoiseRadius: number
    distanceFalloff: number
    intensity: number
    denoiseIterations: number
    renderMode: number
    biasOffset: number
    biasMultiplier: number
    color: Color
    gammaCorrection: boolean
    logarithmicDepthBuffer: boolean
    screenSpaceRadius: boolean
    halfRes: boolean
    depthAwareUpsampling: boolean
    autoRenderBeauty: boolean
    colorMultiply: boolean
    transparencyAware: boolean
    accumulate: boolean
    neuralDenoise: boolean
  }

  export class N8AOPass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number)
    scene: Scene
    camera: Camera
    width: number
    height: number
    configuration: N8AOConfiguration
    beautyRenderTarget: WebGLRenderTarget
    renderToScreen: boolean
    enabled: boolean
    needsFrame: boolean
    setSize(width: number, height: number): void
    setQualityMode(mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'): void
    render(
      renderer: WebGLRenderer,
      writeBuffer: WebGLRenderTarget | null,
      readBuffer?: WebGLRenderTarget | null,
      deltaTime?: number,
      maskActive?: boolean,
    ): void
    dispose(): void
  }

  export class N8AOPostPass extends N8AOPass {}
}
