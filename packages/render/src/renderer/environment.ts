// Procedural environments (PMREM) for every EnvironmentPreset, custom HDR/EXR env assets and
// backgrounds. Everything is generated on the client — no downloads.
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js'
import type { EnvironmentPreset, RenderSettings } from '@cadsandbox/doc'
import type { AssetResolver } from '@cadsandbox/geometry'
import type { Vec3 } from '@cadsandbox/doc'

export interface SkyPalette {
  zenith: [number, number, number]
  horizon: [number, number, number]
  ground: [number, number, number]
  /** Sun disc/glow multiplier (0 = none) */
  sun: number
  /** Overall radiance scale */
  intensity: number
}

export const SKY_PALETTES: Record<Exclude<EnvironmentPreset, 'studio' | 'custom'>, SkyPalette> = {
  daylight: { zenith: [0.22, 0.42, 0.85], horizon: [0.75, 0.82, 0.92], ground: [0.32, 0.3, 0.27], sun: 1, intensity: 1.2 },
  sunset: { zenith: [0.18, 0.2, 0.42], horizon: [1.0, 0.55, 0.3], ground: [0.22, 0.16, 0.13], sun: 1.6, intensity: 0.9 },
  overcast: { zenith: [0.55, 0.58, 0.62], horizon: [0.7, 0.72, 0.74], ground: [0.3, 0.3, 0.3], sun: 0, intensity: 0.8 },
  night: { zenith: [0.01, 0.015, 0.04], horizon: [0.05, 0.06, 0.1], ground: [0.02, 0.02, 0.025], sun: 0.15, intensity: 0.35 },
  city: { zenith: [0.06, 0.07, 0.12], horizon: [0.45, 0.32, 0.22], ground: [0.12, 0.1, 0.09], sun: 0.2, intensity: 0.6 },
}

/** Build an equirectangular HDR sky (float RGBA) for a palette and sun direction. */
export function generateSkyTexture(palette: SkyPalette, sunDir: Vec3 | null, width = 256, height = 128): THREE.DataTexture {
  const data = new Float32Array(width * height * 4)
  const sx = sunDir?.[0] ?? 0
  const sy = sunDir?.[1] ?? 0
  const sz = sunDir?.[2] ?? 1
  for (let j = 0; j < height; j++) {
    const v = 1 - (j + 0.5) / height // 1 = up
    const elev = (v - 0.5) * Math.PI // -π/2..π/2
    const ce = Math.cos(elev)
    const se = Math.sin(elev)
    for (let i = 0; i < width; i++) {
      // equirect u → azimuth; three maps +X at u=0.5 for Y-up; we treat direction in Z-up frame
      const az = ((i + 0.5) / width) * Math.PI * 2 - Math.PI
      const dx = Math.cos(az) * ce
      const dy = Math.sin(az) * ce
      const dz = se
      let r: number, g: number, b: number
      if (dz >= 0) {
        const t = Math.pow(dz, 0.45)
        r = palette.horizon[0] + (palette.zenith[0] - palette.horizon[0]) * t
        g = palette.horizon[1] + (palette.zenith[1] - palette.horizon[1]) * t
        b = palette.horizon[2] + (palette.zenith[2] - palette.horizon[2]) * t
      } else {
        const t = Math.pow(-dz, 0.6)
        r = palette.horizon[0] + (palette.ground[0] - palette.horizon[0]) * t
        g = palette.horizon[1] + (palette.ground[1] - palette.horizon[1]) * t
        b = palette.horizon[2] + (palette.ground[2] - palette.horizon[2]) * t
      }
      if (palette.sun > 0 && sunDir) {
        const cos = dx * sx + dy * sy + dz * sz
        const glow = Math.exp((cos - 1) * 120) * 6 + Math.exp((cos - 1) * 12) * 0.6
        const warm = palette.sun
        r += glow * warm * 1.0
        g += glow * warm * 0.85
        b += glow * warm * 0.6
      }
      const o = (j * width + i) * 4
      data[o] = r * palette.intensity
      data[o + 1] = g * palette.intensity
      data[o + 2] = b * palette.intensity
      data[o + 3] = 1
    }
  }
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType)
  tex.mapping = THREE.EquirectangularReflectionMapping
  tex.colorSpace = THREE.LinearSRGBColorSpace
  tex.needsUpdate = true
  return tex
}

/** Neutral studio dome used as the path tracer's environment (RoomEnvironment has no equirect source). */
const STUDIO_PALETTE: SkyPalette = { zenith: [1.35, 1.35, 1.4], horizon: [0.55, 0.55, 0.58], ground: [0.22, 0.22, 0.24], sun: 0, intensity: 1 }

export class EnvironmentManager {
  private renderer: THREE.WebGLRenderer
  private pmrem: THREE.PMREMGenerator | null = null
  private cache = new Map<string, THREE.Texture>()
  /** Source equirect textures (CPU data) for the path tracer, keyed like `cache`. */
  private equirects = new Map<string, THREE.Texture>()
  private customAsset: { hash: string; texture: THREE.Texture | null; equirect: THREE.Texture | null; loading: Promise<void> | null } | null = null
  private assets: AssetResolver
  onCustomLoaded: (() => void) | null = null

  constructor(renderer: THREE.WebGLRenderer, assets: AssetResolver) {
    this.renderer = renderer
    this.assets = assets
  }

  private generator(): THREE.PMREMGenerator {
    if (!this.pmrem) {
      this.pmrem = new THREE.PMREMGenerator(this.renderer)
      this.pmrem.compileEquirectangularShader()
    }
    return this.pmrem
  }

  /** PMREM texture for the current render settings (sun direction shapes sky presets). */
  environment(settings: RenderSettings, sunDir: Vec3 | null): THREE.Texture | null {
    if (settings.environment === 'custom') {
      return this.custom(settings.envAsset) ?? this.preset('studio', null)
    }
    return this.preset(settings.environment, sunDir)
  }

  private presetKey(preset: Exclude<EnvironmentPreset, 'custom'>, sunDir: Vec3 | null): string {
    const quant = sunDir ? sunDir.map((c) => Math.round(c * 20) / 20).join(',') : 'none'
    return `${preset}:${SKY_PALETTES[preset as keyof typeof SKY_PALETTES]?.sun ? quant : 'x'}`
  }

  private preset(preset: Exclude<EnvironmentPreset, 'custom'>, sunDir: Vec3 | null): THREE.Texture {
    const key = this.presetKey(preset, sunDir)
    let tex = this.cache.get(key)
    if (tex) return tex
    const gen = this.generator()
    if (preset === 'studio') {
      const room = new RoomEnvironment()
      // Z-up: RoomEnvironment is authored Y-up → rotate so its ceiling lights come from +Z.
      room.rotation.x = Math.PI / 2
      room.updateMatrixWorld(true)
      tex = gen.fromScene(room, 0.04).texture
      room.dispose()
      this.equirects.set(key, generateSkyTexture(STUDIO_PALETTE, null))
    } else {
      const sky = generateSkyTexture(SKY_PALETTES[preset], sunDir)
      tex = gen.fromEquirectangular(sky).texture
      this.equirects.set(key, sky)
    }
    tex.userData.shared = true
    // keep the cache bounded (sun moves during time-of-day scrubbing)
    if (this.cache.size > 12) {
      const first = this.cache.keys().next().value
      if (first) {
        this.cache.get(first)?.dispose()
        this.cache.delete(first)
        this.equirects.get(first)?.dispose()
        this.equirects.delete(first)
      }
    }
    this.cache.set(key, tex)
    return tex
  }

  /** Equirectangular source texture (CPU-readable) matching `environment()` — for the path tracer. */
  equirect(settings: RenderSettings, sunDir: Vec3 | null): THREE.Texture | null {
    if (settings.environment === 'custom') {
      if (this.customAsset?.equirect) return this.customAsset.equirect
      this.preset('studio', null)
      return this.equirects.get(this.presetKey('studio', null)) ?? null
    }
    this.preset(settings.environment, sunDir)
    return this.equirects.get(this.presetKey(settings.environment, sunDir)) ?? null
  }

  private custom(hash: string | undefined): THREE.Texture | null {
    if (!hash) return null
    if (this.customAsset?.hash === hash) return this.customAsset.texture
    const entry = { hash, texture: null as THREE.Texture | null, equirect: null as THREE.Texture | null, loading: null as Promise<void> | null }
    this.customAsset = entry
    entry.loading = this.assets
      .get(hash)
      .then((buf) => {
        if (!buf || this.customAsset !== entry) return
        const bytes = new Uint8Array(buf)
        const isEXR = bytes[0] === 0x76 && bytes[1] === 0x2f && bytes[2] === 0x31 && bytes[3] === 0x01
        let equirect: THREE.DataTexture
        if (isEXR) {
          const r = new EXRLoader().parse(buf)
          equirect = new THREE.DataTexture(r.data, r.width, r.height, r.format, r.type)
        } else {
          const r = new RGBELoader().parse(buf)
          equirect = new THREE.DataTexture(r.data, r.width, r.height, r.format, r.type)
        }
        equirect.mapping = THREE.EquirectangularReflectionMapping
        equirect.needsUpdate = true
        const tex = this.generator().fromEquirectangular(equirect).texture
        tex.userData.shared = true
        entry.equirect = equirect
        entry.texture = tex
        this.onCustomLoaded?.()
      })
      .catch((err) => console.warn('[cadsandbox/render] environment asset failed', err))
    return null
  }

  /** Recreate GPU resources after a context restore. */
  reset(): void {
    for (const t of this.cache.values()) t.dispose()
    this.cache.clear()
    for (const t of this.equirects.values()) t.dispose()
    this.equirects.clear()
    this.pmrem?.dispose()
    this.pmrem = null
    if (this.customAsset) {
      this.customAsset.texture?.dispose()
      this.customAsset.equirect?.dispose()
      this.customAsset = null
    }
  }

  dispose(): void {
    this.reset()
  }
}

/** Background colors per preset when background === 'environment' but drawn as a flat color (technical, plans). */
export function environmentTint(preset: EnvironmentPreset): THREE.Color {
  const p = SKY_PALETTES[preset as keyof typeof SKY_PALETTES]
  if (!p) return new THREE.Color(0.16, 0.16, 0.18)
  return new THREE.Color(p.horizon[0], p.horizon[1], p.horizon[2])
}
