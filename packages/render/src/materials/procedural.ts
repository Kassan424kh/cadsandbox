// Main-thread manager for procedural textures: one generation per (kind, seed, params, size),
// executed in a worker when available (OffscreenCanvas/ImageBitmap), otherwise inline.
import * as THREE from 'three'
import type { ProceduralTextureKind } from '@cadsandbox/doc'
import { generateProcedural, proceduralKey, type ProceduralParams } from './proceduralCore'
import type { ProceduralResponse } from './procedural.worker'

export interface ProceduralSet {
  color: THREE.Texture
  normal: THREE.Texture
  roughness: THREE.Texture
  roughnessScale: number
}

interface Pending {
  resolve: (set: ProceduralSet) => void
  reject: (err: unknown) => void
}

export class ProceduralTextures {
  private cache = new Map<string, Promise<ProceduralSet>>()
  private ready = new Map<string, ProceduralSet>()
  private worker: Worker | null = null
  private pending = new Map<number, Pending>()
  private nextId = 1
  readonly size: 512 | 1024
  private anisotropy: number

  constructor(size: 512 | 1024, anisotropy = 8) {
    this.size = size
    this.anisotropy = anisotropy
    this.worker = createWorker()
    if (this.worker) {
      this.worker.onmessage = (ev: MessageEvent<ProceduralResponse>) => this.onMessage(ev.data)
      this.worker.onerror = () => {
        console.warn('[cadsandbox/render] procedural texture worker failed; generating inline')
        this.worker?.terminate()
        this.worker = null
        for (const [id, p] of this.pending) {
          this.pending.delete(id)
          p.reject(new Error('worker failed'))
        }
      }
    }
  }

  /** Synchronously available set (undefined until generated). */
  peek(kind: ProceduralTextureKind, seed = 0, params?: Record<string, number | string>): ProceduralSet | undefined {
    return this.ready.get(proceduralKey(kind, seed, params, this.size))
  }

  get(kind: ProceduralTextureKind, seed = 0, params?: Record<string, number | string>): Promise<ProceduralSet> {
    const key = proceduralKey(kind, seed, params, this.size)
    let p = this.cache.get(key)
    if (!p) {
      const desc: ProceduralParams = { kind, seed, size: this.size, params: params ?? {} }
      p = this.generate(desc)
        .catch(() => this.generateInline(desc))
        .then((set) => {
          this.ready.set(key, set)
          return set
        })
      this.cache.set(key, p)
    }
    return p
  }

  private generate(desc: ProceduralParams): Promise<ProceduralSet> {
    if (!this.worker) return this.generateInline(desc)
    const id = this.nextId++
    return new Promise<ProceduralSet>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker!.postMessage({ id, ...desc })
    })
  }

  private onMessage(res: ProceduralResponse): void {
    const p = this.pending.get(res.id)
    if (!p) return
    this.pending.delete(res.id)
    if (res.error) {
      p.reject(new Error(res.error))
      return
    }
    p.resolve({
      color: this.texture(res.color, true),
      normal: this.texture(res.normal, false),
      roughness: this.texture(res.roughness, false),
      roughnessScale: res.roughnessScale,
    })
  }

  private async generateInline(desc: ProceduralParams): Promise<ProceduralSet> {
    const px = generateProcedural(desc)
    const make = (data: Uint8ClampedArray, srgb: boolean) => {
      const tex = new THREE.DataTexture(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), px.size, px.size, THREE.RGBAFormat, THREE.UnsignedByteType)
      this.configure(tex, srgb)
      tex.generateMipmaps = true
      tex.needsUpdate = true
      return tex
    }
    return { color: make(px.color, true), normal: make(px.normal, false), roughness: make(px.roughness, false), roughnessScale: px.roughnessScale }
  }

  private texture(bitmap: ImageBitmap, srgb: boolean): THREE.Texture {
    const tex = new THREE.Texture(bitmap)
    this.configure(tex, srgb)
    tex.needsUpdate = true
    return tex
  }

  private configure(tex: THREE.Texture, srgb: boolean): void {
    tex.wrapS = THREE.RepeatWrapping
    tex.wrapT = THREE.RepeatWrapping
    tex.minFilter = THREE.LinearMipmapLinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.anisotropy = this.anisotropy
    tex.flipY = false
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
    tex.userData.shared = true
  }

  dispose(): void {
    this.worker?.terminate()
    this.worker = null
    for (const set of this.ready.values()) {
      set.color.dispose()
      set.normal.dispose()
      set.roughness.dispose()
    }
    this.ready.clear()
    this.cache.clear()
    this.pending.clear()
  }
}

function createWorker(): Worker | null {
  if (typeof Worker === 'undefined' || typeof createImageBitmap === 'undefined') return null
  try {
    return new Worker(new URL('./procedural.worker.ts', import.meta.url), { type: 'module', name: 'cs-procedural' })
  } catch (err) {
    console.warn('[cadsandbox/render] could not start procedural worker', err)
    return null
  }
}
