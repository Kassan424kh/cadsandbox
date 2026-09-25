// Drawing2D → three objects: fat lines per LineStyle (LineSegments2), hatch/solid fills and troika
// texts, all in the owner's local XY plane. Line materials are shared per (style, theme) and their
// screen resolution is updated per viewport render.
import * as THREE from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import type { Drawing2D, Fill2D, LineStyle, Text2D } from '@cadsandbox/geometry'
import type { RenderMode } from '@cadsandbox/doc'
import type { ThemeColors } from '../util/css'
import { HatchTextures } from '../materials/hatch'
import { createText, applyText } from './text'
import type { Text } from 'troika-three-text'

export type LineStyleKey = LineStyle | 'guide' | 'rubber' | 'selection' | 'cap'
/** normal = depth-tested; overlay = always on top (plan symbology); faint = overlay at 30 % (underlay). */
export type LineVariant = 'normal' | 'overlay' | 'faint'

interface StyleSpec {
  widthPx: number
  dashed: boolean
  dash: number
  gap: number
  token: string
  alpha: number
}

/** Lineweights approximate ISO pen widths at 1:50 on screen (px at DPR 1). */
const STYLE_SPECS: Record<LineStyleKey, StyleSpec> = {
  cut: { widthPx: 2.4, dashed: false, dash: 1, gap: 1, token: '--cs-text', alpha: 1 },
  visible: { widthPx: 1.4, dashed: false, dash: 1, gap: 1, token: '--cs-text', alpha: 0.95 },
  overhead: { widthPx: 1.2, dashed: true, dash: 0.25, gap: 0.12, token: '--cs-text-2', alpha: 0.9 },
  hidden: { widthPx: 1.0, dashed: true, dash: 0.12, gap: 0.08, token: '--cs-text-3', alpha: 0.9 },
  thin: { widthPx: 1.0, dashed: false, dash: 1, gap: 1, token: '--cs-text-2', alpha: 0.9 },
  symbol: { widthPx: 1.1, dashed: false, dash: 1, gap: 1, token: '--cs-text-2', alpha: 0.95 },
  annotation: { widthPx: 1.1, dashed: false, dash: 1, gap: 1, token: '--cs-info', alpha: 1 },
  drafting: { widthPx: 1.3, dashed: false, dash: 1, gap: 1, token: '--cs-text', alpha: 1 },
  guide: { widthPx: 1.2, dashed: true, dash: 0.15, gap: 0.1, token: '--cs-accent', alpha: 0.9 },
  rubber: { widthPx: 1.6, dashed: false, dash: 1, gap: 1, token: '--cs-accent', alpha: 1 },
  selection: { widthPx: 1.6, dashed: false, dash: 1, gap: 1, token: '--cs-selection', alpha: 1 },
  cap: { widthPx: 2.2, dashed: false, dash: 1, gap: 1, token: '--cs-text', alpha: 1 },
}

export class LineStyleMaterials {
  private theme: ThemeColors
  private materials = new Map<string, LineMaterial>()
  private resolution = new THREE.Vector2(1, 1)
  private dpr = 1

  constructor(theme: ThemeColors) {
    this.theme = theme
  }

  private colorize(m: LineMaterial, style: LineStyleKey, override: string | null): void {
    const spec = STYLE_SPECS[style]
    if (override) {
      m.color.set(override)
      m.opacity = 1
    } else {
      const c = this.theme.get(spec.token)
      m.color.copy(c.color)
      m.opacity = c.alpha * spec.alpha
    }
  }

  setTheme(theme: ThemeColors): void {
    this.theme = theme
    for (const [key, m] of this.materials) {
      const [style, colorOverride, , variant] = key.split('|') as [LineStyleKey, string, string, LineVariant]
      this.colorize(m, style, colorOverride || null)
      if (variant === 'faint') m.opacity *= 0.3
    }
  }

  get(style: LineStyleKey, colorOverride: string | null = null, widthScale = 1, variant: LineVariant = 'normal'): LineMaterial {
    const key = `${style}|${colorOverride ?? ''}|${widthScale}|${variant}`
    let m = this.materials.get(key)
    if (!m) {
      const spec = STYLE_SPECS[style]
      m = new LineMaterial({
        linewidth: spec.widthPx * widthScale,
        worldUnits: false,
        dashed: spec.dashed,
        dashSize: spec.dash,
        gapSize: spec.gap,
        dashScale: 1,
        transparent: true,
        depthWrite: false,
        alphaToCoverage: false,
      })
      m.toneMapped = false
      m.polygonOffset = true
      m.polygonOffsetFactor = -3
      m.polygonOffsetUnits = -3
      m.resolution.copy(this.resolution)
      if (variant !== 'normal') m.depthTest = false
      this.colorize(m, style, colorOverride)
      if (variant === 'faint') m.opacity *= 0.3
      this.materials.set(key, m)
    }
    return m
  }

  /** Per-viewport: device-pixel resolution (fat lines are screen-space). */
  setResolution(widthPx: number, heightPx: number, dpr: number): void {
    if (this.resolution.x === widthPx && this.resolution.y === heightPx && this.dpr === dpr) return
    this.resolution.set(widthPx, heightPx)
    this.dpr = dpr
    for (const m of this.materials.values()) m.resolution.copy(this.resolution)
  }

  /** Technical drawings print black on paper; hidden-line uses the same palette. */
  setMonochrome(on: boolean): void {
    if (this.monochrome === on) return
    this.monochrome = on
    for (const [key, m] of this.materials) {
      const [style, override, , variant] = key.split('|') as [LineStyleKey, string, string, LineVariant]
      if (on) {
        m.color.set(style === 'annotation' ? 0x2266aa : 0x111111)
        m.opacity = variant === 'faint' ? 0.3 : 1
      } else {
        this.colorize(m, style, override || null)
        if (variant === 'faint') m.opacity *= 0.3
      }
    }
  }
  private monochrome = false

  dispose(): void {
    for (const m of this.materials.values()) m.dispose()
    this.materials.clear()
  }
}

export interface DrawingStyleOptions {
  /** Multiply line widths (technical mode: lineweights) */
  widthScale?: number
  opacity?: number
  colorOverride?: string | null
  /** overlay/faint variants render on top of geometry (plan symbology / underlays) */
  variant?: LineVariant
}

/** Objects for one Drawing2D (rebuilt when the drawing changes). */
export class DrawingView {
  readonly group = new THREE.Group()
  private lines: LineSegments2[] = []
  private fills: THREE.Mesh[] = []
  private texts: Text[] = []
  private hatches: HatchTextures
  private lineMaterials: LineStyleMaterials
  private theme: ThemeColors
  private onSync: () => void

  constructor(lineMaterials: LineStyleMaterials, hatches: HatchTextures, theme: ThemeColors, onSync: () => void) {
    this.lineMaterials = lineMaterials
    this.hatches = hatches
    this.theme = theme
    this.onSync = onSync
    this.group.name = 'cs-drawing'
    this.group.matrixAutoUpdate = false
  }

  private styles: { style: LineStyle; colorOverride: string | null; widthScale: number }[] = []
  private variant: LineVariant = 'normal'

  set(d: Drawing2D, opts: DrawingStyleOptions = {}): void {
    this.clear()
    const widthScale = opts.widthScale ?? 1
    this.variant = opts.variant ?? 'normal'
    for (const l of d.lines) {
      if (!l.segments.length) continue
      const geo = new LineSegmentsGeometry()
      const pos = new Float32Array((l.segments.length / 4) * 6)
      for (let i = 0, j = 0; i + 3 < l.segments.length; i += 4, j += 6) {
        pos[j] = l.segments[i]!
        pos[j + 1] = l.segments[i + 1]!
        pos[j + 2] = 0
        pos[j + 3] = l.segments[i + 2]!
        pos[j + 4] = l.segments[i + 3]!
        pos[j + 5] = 0
      }
      geo.setPositions(pos)
      const mesh = new LineSegments2(geo, this.lineMaterials.get(l.style, opts.colorOverride ?? null, widthScale, this.variant))
      mesh.computeLineDistances()
      mesh.renderOrder = this.variant === 'normal' ? 20 : 40
      mesh.userData.lineStyle = l.style
      mesh.userData.noPathTrace = true
      this.lines.push(mesh)
      this.styles.push({ style: l.style, colorOverride: opts.colorOverride ?? null, widthScale })
      this.group.add(mesh)
    }
    for (const f of d.fills) this.addFill(f, opts.opacity ?? 1)
    for (const t of d.texts) this.addText(t, opts.colorOverride ?? null)
    if (this.variant !== 'normal') this.applyVariant(this.variant)
  }

  /** Swap between normal / overlay / faint presentation (per viewport, cheap). */
  setVariant(variant: LineVariant): void {
    if (variant === this.variant) return
    this.variant = variant
    this.applyVariant(variant)
  }

  private applyVariant(variant: LineVariant): void {
    this.lines.forEach((l, i) => {
      const s = this.styles[i]!
      l.material = this.lineMaterials.get(s.style, s.colorOverride, s.widthScale, variant)
      l.renderOrder = variant === 'normal' ? 20 : 40
    })
    const alpha = variant === 'faint' ? 0.3 : 1
    for (const f of this.fills) {
      const m = f.material as THREE.MeshBasicMaterial
      m.opacity = (f.userData.baseOpacity as number) * alpha
      m.depthTest = variant === 'normal'
      f.renderOrder = variant === 'normal' ? 15 : 38
    }
    for (const t of this.texts) {
      t.fillOpacity = alpha
      t.material.depthTest = variant === 'normal'
      t.renderOrder = variant === 'normal' ? 25 : 42
    }
  }

  private addFill(f: Fill2D, opacity: number): void {
    if (!f.triangles.length || f.pattern === 'none') return
    const geo = new THREE.BufferGeometry()
    const n = f.triangles.length / 2
    const pos = new Float32Array(n * 3)
    const uv = new Float32Array(n * 2)
    const tile = HatchTextures.tileSize(f.pattern, f.scale ?? 1)
    const ca = Math.cos(f.angle ?? 0)
    const sa = Math.sin(f.angle ?? 0)
    for (let i = 0; i < n; i++) {
      const x = f.triangles[i * 2]!
      const y = f.triangles[i * 2 + 1]!
      pos[i * 3] = x
      pos[i * 3 + 1] = y
      pos[i * 3 + 2] = 0
      uv[i * 2] = (x * ca + y * sa) / tile
      uv[i * 2 + 1] = (-x * sa + y * ca) / tile
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    const color = f.color ? new THREE.Color(f.color) : this.theme.get('--cs-text-2').color
    const tex = this.hatches.get(f.pattern)
    const mat = new THREE.MeshBasicMaterial({
      color,
      map: tex ?? null,
      transparent: true,
      opacity: tex ? opacity : opacity * 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
      alphaTest: tex ? 0.05 : 0,
    })
    mat.polygonOffset = true
    mat.polygonOffsetFactor = -2
    mat.polygonOffsetUnits = -2
    const mesh = new THREE.Mesh(geo, mat)
    mesh.renderOrder = 15
    mesh.userData.noPathTrace = true
    mesh.userData.hatch = true
    mesh.userData.baseOpacity = mat.opacity
    this.fills.push(mesh)
    this.group.add(mesh)
  }

  private addText(t: Text2D, colorOverride: string | null): void {
    if (!t.text) return
    const color = colorOverride ? new THREE.Color(colorOverride) : this.theme.get(t.style === 'title' ? '--cs-text' : t.style === 'label' ? '--cs-text' : '--cs-info').color
    const text = createText({
      text: t.text,
      size: Math.max(1e-4, t.size),
      color,
      align: t.align,
      baseline: t.baseline,
      bold: t.style === 'title',
      onSync: this.onSync,
    })
    text.position.set(t.position[0], t.position[1], 0.0005)
    text.rotation.z = t.rotation
    text.renderOrder = 25
    text.userData.style = t.style ?? 'label'
    text.userData.align = t.align
    text.userData.baseline = t.baseline
    this.texts.push(text)
    this.group.add(text)
  }

  /** Re-tint texts for a theme change without rebuilding geometry. */
  retheme(theme: ThemeColors): void {
    this.theme = theme
    for (const t of this.texts) {
      const style = (t.userData.style as string | undefined) ?? 'label'
      applyText(t, {
        text: t.text,
        size: t.fontSize * 0.727,
        color: theme.get(style === 'annotation' ? '--cs-info' : '--cs-text').color,
        align: t.userData.align as 'left' | 'center' | 'right' | undefined,
        baseline: t.userData.baseline as 'top' | 'middle' | 'bottom' | undefined,
        bold: style === 'title',
        onSync: this.onSync,
      })
    }
    this.applyVariant(this.variant)
  }

  private mono = false

  /** Paper modes: dark fills/texts regardless of theme. */
  setMonochrome(on: boolean): void {
    if (on === this.mono) return
    this.mono = on
    for (const f of this.fills) {
      const m = f.material as THREE.MeshBasicMaterial
      if (on) {
        if (!f.userData.savedColor) f.userData.savedColor = m.color.getHex()
        m.color.set(0x2a2a2a)
      } else if (f.userData.savedColor !== undefined) m.color.setHex(f.userData.savedColor as number)
    }
    for (const t of this.texts) {
      if (on) {
        if (t.userData.savedColor === undefined) t.userData.savedColor = t.color
        t.color = 0x111111
      } else if (t.userData.savedColor !== undefined) t.color = t.userData.savedColor as THREE.Color
    }
  }

  /** Objects for picking (lines + fills + texts). */
  pickables(): THREE.Object3D[] {
    return [...this.lines, ...this.fills, ...this.texts]
  }

  private highlight: string | null = null

  /** Selection highlight: lines take the selection color (null restores the style colors). */
  setHighlight(color: string | null): void {
    if (color === this.highlight) return
    this.highlight = color
    this.lines.forEach((l, i) => {
      const s = this.styles[i]!
      l.material = color ? this.lineMaterials.get('selection', color, s.widthScale, this.variant === 'normal' ? 'overlay' : this.variant) : this.lineMaterials.get(s.style, s.colorOverride, s.widthScale, this.variant)
    })
  }

  get isEmpty(): boolean {
    return this.lines.length === 0 && this.fills.length === 0 && this.texts.length === 0
  }

  clear(): void {
    for (const l of this.lines) {
      this.group.remove(l)
      l.geometry.dispose()
    }
    for (const f of this.fills) {
      this.group.remove(f)
      f.geometry.dispose()
      ;(f.material as THREE.Material).dispose()
    }
    for (const t of this.texts) {
      this.group.remove(t)
      t.dispose()
    }
    this.lines = []
    this.fills = []
    this.texts = []
    this.styles = []
  }

  dispose(): void {
    this.clear()
    this.group.parent?.remove(this.group)
  }
}

/** Build a bare LineSegments2 for tool previews/guides. */
export function makeFatLines(points: ArrayLike<number>, material: LineMaterial): LineSegments2 {
  const geo = new LineSegmentsGeometry()
  geo.setPositions(Array.from(points))
  const l = new LineSegments2(geo, material)
  l.computeLineDistances()
  l.renderOrder = 30
  l.userData.noPathTrace = true
  return l
}

export const LINE_STYLE_WIDTH_PX: Record<LineStyleKey, number> = Object.fromEntries(Object.entries(STYLE_SPECS).map(([k, v]) => [k, v.widthPx])) as Record<LineStyleKey, number>

export function isDrawingMode(mode: RenderMode): boolean {
  return mode === 'technical' || mode === 'hidden-line'
}
