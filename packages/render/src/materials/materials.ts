// MaterialCache — MaterialDef (+ node color tint) → three materials per render mode, with
// world-scale UV transforms, procedural/asset textures and shared mode materials (clay, x-ray,
// hidden-line, technical). Materials are owned here; meshes never dispose them.
import * as THREE from 'three'
import type { AnyNode, CadDocument, MaterialDef, RenderMode, TextureRef } from '@cadsandbox/doc'
import { BUILTIN_MATERIAL_MAP, TYPE_DEFAULT_MATERIAL } from '@cadsandbox/doc'
import type { MeshPart } from '@cadsandbox/geometry'
import type { EditorAssets } from '../api'
import type { ThemeColors } from '../util/css'
import type { ProceduralTextures } from './procedural'

export const IMAGE_MATERIAL_PREFIX = 'image:'

export interface MaterialCacheOptions {
  doc: CadDocument
  assets: EditorAssets
  procedural: ProceduralTextures
  theme: ThemeColors
  /** Called when an async texture arrived (request a render). */
  onReady: () => void
  anisotropy: number
}

export class MaterialCache {
  private doc: CadDocument
  private assets: EditorAssets
  private procedural: ProceduralTextures
  private theme: ThemeColors
  private onReady: () => void
  private anisotropy: number
  private shaded = new Map<string, THREE.MeshPhysicalMaterial>()
  private images = new Map<string, THREE.MeshBasicMaterial>()
  private imageTextures = new Map<string, Promise<THREE.Texture | null>>()
  private ghosts = new Map<THREE.Material, THREE.Material>()
  readonly clay: THREE.MeshStandardMaterial
  readonly xray: THREE.MeshBasicMaterial
  readonly hiddenLine: THREE.MeshBasicMaterial
  readonly technical: THREE.MeshBasicMaterial
  readonly edgeShaded: THREE.LineBasicMaterial
  readonly edgeHidden: THREE.LineBasicMaterial
  /** Wireframe mode: surfaces write depth only, so lines behind them can be drawn fainter. */
  readonly depthOnly: THREE.MeshBasicMaterial
  /** Wireframe-mode lines: crisp front pass, faint pass for lines behind surfaces, selection variants. */
  readonly wireFront: THREE.LineBasicMaterial
  readonly wireBack: THREE.LineBasicMaterial
  readonly wireSelFront: THREE.LineBasicMaterial
  readonly wireSelBack: THREE.LineBasicMaterial
  readonly edgeXray: THREE.LineBasicMaterial
  readonly edgeTechnical: THREE.LineBasicMaterial
  readonly capShaded: THREE.MeshStandardMaterial
  readonly capTechnical: THREE.MeshBasicMaterial
  readonly fallback: MaterialDef

  constructor(opts: MaterialCacheOptions) {
    this.doc = opts.doc
    this.assets = opts.assets
    this.procedural = opts.procedural
    this.theme = opts.theme
    this.onReady = opts.onReady
    this.anisotropy = opts.anisotropy
    this.fallback = BUILTIN_MATERIAL_MAP.get('mat-default')!
    this.clay = new THREE.MeshStandardMaterial({ color: 0xd9d2c8, roughness: 0.85, metalness: 0, side: THREE.DoubleSide })
    this.xray = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })
    // faces pushed back enough that their own edges (drawn as lines, rasterized differently) never
    // z-fight at grazing angles — factor 1 / unit 1 left the outlines dotted
    this.hiddenLine = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, toneMapped: false, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4 })
    this.technical = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, toneMapped: false, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4 })
    this.edgeShaded = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.35, toneMapped: false, depthWrite: false })
    this.edgeHidden = new THREE.LineBasicMaterial({ color: 0x111111, toneMapped: false })
    // surfaces pushed back a little so lines lying on them pass the depth test of the front pass
    this.depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4 })
    this.wireFront = new THREE.LineBasicMaterial({ toneMapped: false, depthWrite: false })
    this.wireBack = new THREE.LineBasicMaterial({ toneMapped: false, transparent: true, opacity: 0.22, depthWrite: false, depthFunc: THREE.GreaterDepth })
    this.wireSelFront = new THREE.LineBasicMaterial({ toneMapped: false, depthWrite: false })
    this.wireSelBack = new THREE.LineBasicMaterial({ toneMapped: false, transparent: true, opacity: 0.4, depthWrite: false, depthFunc: THREE.GreaterDepth })
    this.edgeXray = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.6, toneMapped: false, depthTest: false })
    this.edgeTechnical = new THREE.LineBasicMaterial({ color: 0x1a1a1a, toneMapped: false })
    this.capShaded = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.9, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
    this.capTechnical = new THREE.MeshBasicMaterial({ color: 0x2a2a2a, side: THREE.DoubleSide, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
    this.setTheme(opts.theme)
  }

  setTheme(theme: ThemeColors): void {
    this.theme = theme
    const text = theme.get('--cs-text').color
    const accent = theme.get('--cs-accent-2').color
    this.edgeShaded.color.copy(text)
    this.edgeShaded.opacity = theme.isDark ? 0.28 : 0.35
    this.wireFront.color.copy(text)
    this.wireBack.color.copy(text)
    this.wireBack.opacity = theme.isDark ? 0.26 : 0.2
    const selection = theme.get('--cs-selection').color
    this.wireSelFront.color.copy(selection)
    this.wireSelBack.color.copy(selection)
    this.edgeXray.color.copy(accent)
    this.xray.color.copy(accent).lerp(new THREE.Color(1, 1, 1), 0.4)
    this.clay.color.set(theme.isDark ? 0xcfc8be : 0xe2dbd1)
  }

  /** Effective material definition for a node part. */
  resolveDef(node: AnyNode, part: MeshPart): { def: MaterialDef; id: string; tint: string | null } {
    if (part.material !== 'node') {
      const id = part.material.id
      const def = this.doc.getMaterial(id) ?? this.fallback
      return { def, id, tint: null }
    }
    const id = node.material ?? TYPE_DEFAULT_MATERIAL[node.type] ?? 'mat-default'
    const def = this.doc.getMaterial(id) ?? this.fallback
    return { def, id, tint: node.color }
  }

  /** Material for a part in a render mode. */
  get(id: string, def: MaterialDef, tint: string | null, mode: RenderMode, opacity?: number): THREE.Material {
    switch (mode) {
      case 'clay':
        return this.clay
      case 'xray':
        return this.xray
      case 'hidden-line':
        return this.hiddenLine
      case 'technical':
        return this.technical
      case 'wireframe':
        return this.depthOnly
      default:
        break
    }
    if (id.startsWith(IMAGE_MATERIAL_PREFIX)) return this.image(id.slice(IMAGE_MATERIAL_PREFIX.length), opacity ?? 1)
    const key = `${id}|${tint ?? ''}`
    let m = this.shaded.get(key)
    if (!m) {
      m = this.buildPhysical(def, tint)
      this.shaded.set(key, m)
    }
    return m
  }

  edges(mode: RenderMode): THREE.LineBasicMaterial | null {
    switch (mode) {
      case 'shaded':
      case 'clay':
        return this.edgeShaded
      case 'wireframe':
        return null // wireframe mode draws the results' `wire` topology instead (see wire())
      case 'hidden-line':
        return this.edgeHidden
      case 'technical':
        return this.edgeTechnical
      case 'xray':
        return this.edgeXray
      case 'realistic':
        return null
    }
  }

  /** Wireframe-mode line materials: crisp front pass + faint pass for the parts behind surfaces. */
  wire(selected: boolean): { front: THREE.LineBasicMaterial; back: THREE.LineBasicMaterial } {
    return selected ? { front: this.wireSelFront, back: this.wireSelBack } : { front: this.wireFront, back: this.wireBack }
  }

  cap(mode: RenderMode): THREE.Material {
    if (mode === 'wireframe') return this.depthOnly
    return mode === 'technical' || mode === 'hidden-line' ? this.capTechnical : this.capShaded
  }

  /** Semi-transparent copy used by preview ghosts. */
  ghost(base: THREE.Material, opacity = 0.45): THREE.Material {
    let g = this.ghosts.get(base)
    if (!g) {
      g = base.clone()
      g.transparent = true
      g.opacity = opacity
      g.depthWrite = false
      const gm = g as THREE.MeshPhysicalMaterial
      if ('transmission' in gm) gm.transmission = 0
      this.ghosts.set(base, g)
    }
    return g
  }

  private buildPhysical(def: MaterialDef, tint: string | null): THREE.MeshPhysicalMaterial {
    const m = new THREE.MeshPhysicalMaterial()
    m.name = def.id
    m.color.set(tint ?? def.color)
    m.roughness = clamp(def.roughness, 0, 1)
    m.metalness = clamp(def.metalness, 0, 1)
    m.side = THREE.DoubleSide
    m.opacity = clamp(def.opacity, 0, 1)
    m.transparent = def.opacity < 1
    if (def.transmission > 0) {
      m.transmission = clamp(def.transmission, 0, 1)
      m.ior = def.ior || 1.5
      m.thickness = def.thickness ?? 0.01
      m.transparent = true
      m.depthWrite = def.transmission < 0.95
    }
    if (def.emissive) {
      m.emissive.set(def.emissive)
      m.emissiveIntensity = def.emissiveIntensity ?? 1
    }
    if (def.clearcoat) {
      m.clearcoat = def.clearcoat
      m.clearcoatRoughness = def.clearcoatRoughness ?? 0.1
    }
    if (def.sheen) {
      m.sheen = def.sheen
      if (def.sheenColor) m.sheenColor.set(def.sheenColor)
    }
    m.normalScale.setScalar(def.normalScale ?? 0.6)
    m.envMapIntensity = 1
    this.applyMaps(m, def)
    return m
  }

  private applyMaps(m: THREE.MeshPhysicalMaterial, def: MaterialDef): void {
    const maps = def.maps
    if (!maps) return
    const uv = def.uv ?? { size: [1, 1] as [number, number], rotation: 0, offset: [0, 0] as [number, number] }
    const assign = (slot: 'map' | 'normalMap' | 'roughnessMap' | 'metalnessMap' | 'aoMap' | 'bumpMap', tex: THREE.Texture) => {
      const t = tex.clone()
      this.applyUV(t, uv)
      m[slot] = t
      m.needsUpdate = true
      this.onReady()
    }
    const ref = (r: TextureRef | undefined, slot: 'map' | 'normalMap' | 'roughnessMap' | 'metalnessMap' | 'aoMap' | 'bumpMap', channel: 'color' | 'normal' | 'roughness') => {
      if (!r) return
      if ('procedural' in r) {
        const { kind, seed = 0, params } = r.procedural
        const ready = this.procedural.peek(kind, seed, params)
        const pick = (set: { color: THREE.Texture; normal: THREE.Texture; roughness: THREE.Texture }) => (channel === 'color' ? set.color : channel === 'normal' ? set.normal : set.roughness)
        if (ready) assign(slot, pick(ready))
        else void this.procedural.get(kind, seed, params).then((set) => assign(slot, pick(set)))
        // procedural color textures come with a matching normal map when none is specified
        if (channel === 'color' && !maps.normal) {
          if (ready) assign('normalMap', ready.normal)
          else void this.procedural.get(kind, seed, params).then((set) => assign('normalMap', set.normal))
        }
        if (channel === 'color' && !maps.roughness) {
          if (ready) assign('roughnessMap', ready.roughness)
          else void this.procedural.get(kind, seed, params).then((set) => assign('roughnessMap', set.roughness))
        }
      } else {
        void this.imageTexture(r.asset, channel === 'color').then((tex) => {
          if (tex) assign(slot, tex)
        })
      }
    }
    ref(maps.color, 'map', 'color')
    ref(maps.normal, 'normalMap', 'normal')
    ref(maps.roughness, 'roughnessMap', 'roughness')
    ref(maps.metalness, 'metalnessMap', 'roughness')
    ref(maps.ao, 'aoMap', 'roughness')
    ref(maps.bump, 'bumpMap', 'roughness')
  }

  /** World-scale UVs: geometry UVs are meters; one tile = uv.size meters. */
  private applyUV(t: THREE.Texture, uv: { size: [number, number]; rotation: number; offset: [number, number] }): void {
    const sx = Math.max(1e-4, uv.size[0])
    const sy = Math.max(1e-4, uv.size[1])
    t.wrapS = THREE.RepeatWrapping
    t.wrapT = THREE.RepeatWrapping
    t.repeat.set(1 / sx, 1 / sy)
    t.offset.set(-uv.offset[0] / sx, -uv.offset[1] / sy)
    t.center.set(0, 0)
    t.rotation = uv.rotation
    t.anisotropy = this.anisotropy
    t.needsUpdate = true
  }

  private imageTexture(hash: string, srgb: boolean): Promise<THREE.Texture | null> {
    const key = `${hash}|${srgb ? 's' : 'l'}`
    let p = this.imageTextures.get(key)
    if (!p) {
      p = this.assets
        .url(hash)
        .then(
          (url) =>
            new Promise<THREE.Texture | null>((resolve) => {
              if (!url) return resolve(null)
              new THREE.TextureLoader().load(
                url,
                (tex) => {
                  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
                  tex.anisotropy = this.anisotropy
                  tex.userData.shared = true
                  resolve(tex)
                },
                undefined,
                () => resolve(null),
              )
            }),
        )
        .catch(() => null)
      this.imageTextures.set(key, p)
    }
    return p
  }

  private image(hash: string, opacity: number): THREE.MeshBasicMaterial {
    const key = `${hash}|${opacity.toFixed(3)}`
    let m = this.images.get(key)
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity, side: THREE.DoubleSide, toneMapped: false, depthWrite: opacity >= 1 })
      m.polygonOffset = true
      m.polygonOffsetFactor = -1
      m.polygonOffsetUnits = -1
      this.images.set(key, m)
      const mat = m
      void this.imageTexture(hash, true).then((tex) => {
        if (!tex) return
        mat.map = tex
        mat.needsUpdate = true
        this.onReady()
      })
    }
    return m
  }

  /** Document material changed/removed: drop cached variants (meshes re-resolve on next sync). */
  invalidate(materialId: string): string[] {
    const dropped: string[] = []
    for (const [key, m] of this.shaded) {
      if (key.startsWith(`${materialId}|`)) {
        this.disposeMaterial(m)
        this.shaded.delete(key)
        dropped.push(key)
      }
    }
    return dropped
  }

  private disposeMaterial(m: THREE.Material): void {
    const ghost = this.ghosts.get(m)
    if (ghost) {
      ghost.dispose()
      this.ghosts.delete(m)
    }
    const rec = m as unknown as Record<string, unknown>
    for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'bumpMap']) {
      const t = rec[k]
      if (t instanceof THREE.Texture) t.dispose() // clone: disposes only this sampler variant
    }
    m.dispose()
  }

  dispose(): void {
    for (const m of this.shaded.values()) this.disposeMaterial(m)
    this.shaded.clear()
    for (const m of this.images.values()) {
      m.map?.dispose()
      m.dispose()
    }
    this.images.clear()
    for (const g of this.ghosts.values()) g.dispose()
    this.ghosts.clear()
    for (const m of [this.clay, this.xray, this.hiddenLine, this.technical, this.depthOnly, this.edgeShaded, this.edgeHidden, this.edgeXray, this.edgeTechnical, this.wireFront, this.wireBack, this.wireSelFront, this.wireSelBack, this.capShaded, this.capTechnical]) m.dispose()
  }
}

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo)
