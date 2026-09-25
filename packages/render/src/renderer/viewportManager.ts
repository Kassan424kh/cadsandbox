// ViewportManager — layouts (single / split / quad) on the shared canvas, per-viewport overlay
// elements (pointer targets, labels, active highlight) and camera updates.
import * as THREE from 'three'
import type { ViewLayout, ViewPreset, ViewportState } from '../api'
import type { RenderContext } from './context'
import { Viewport, type Rect } from './viewport'
import { VIEWCUBE_SIZE } from './viewcube'
import type { ThemeColors } from '../util/css'

const GAP = 2

export class ViewportManager {
  readonly viewports: Viewport[] = []
  readonly root: HTMLDivElement
  layout: ViewLayout = 'single'
  active = 0
  private ctx: RenderContext
  private theme: ThemeColors
  private labels: HTMLDivElement[] = []
  private onChange: () => void
  private showLabels: boolean

  constructor(ctx: RenderContext, theme: ThemeColors, onChange: () => void, showLabels = true) {
    this.ctx = ctx
    this.theme = theme
    this.onChange = onChange
    this.showLabels = showLabels
    this.root = document.createElement('div')
    this.root.className = 'cs-viewports'
    this.root.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;'
    ctx.container.appendChild(this.root)
    this.ensureCount(1, ['perspective'])
    this.updateRects()
  }

  private presetsFor(layout: ViewLayout): (ViewPreset | 'custom')[] {
    switch (layout) {
      case 'single':
        return ['perspective']
      case 'split':
        return ['front', 'perspective']
      case 'quad':
        return ['top', 'front', 'right', 'perspective']
    }
  }

  private ensureCount(n: number, presets: (ViewPreset | 'custom')[]): void {
    while (this.viewports.length > n) {
      const vp = this.viewports.pop()!
      vp.dispose()
      this.labels.pop()?.remove()
    }
    while (this.viewports.length < n) {
      const index = this.viewports.length
      const vp = new Viewport(index, this.root, presets[index] ?? 'perspective')
      vp.el.style.pointerEvents = 'auto'
      this.viewports.push(vp)
      const label = document.createElement('div')
      label.className = 'cs-viewport-label'
      const cube = this.ctx.viewCubeOffset
      label.style.cssText = [
        'position:absolute',
        `left:${cube.left}px`,
        `top:${cube.top + VIEWCUBE_SIZE + 2}px`,
        `width:${VIEWCUBE_SIZE}px`,
        'text-align:center',
        'font: 500 11px/1.2 var(--cs-font-sans, Inter, system-ui, sans-serif)',
        'letter-spacing:0.02em',
        `color:${this.theme.css('--cs-text-2')}`,
        'pointer-events:none',
        'user-select:none',
        'white-space:nowrap',
        'overflow:hidden',
        'text-overflow:ellipsis',
      ].join(';')
      vp.el.appendChild(label)
      this.labels.push(label)
    }
  }

  setLayout(layout: ViewLayout, fitBounds: THREE.Box3 | null): void {
    if (layout === this.layout && this.viewports.length === this.presetsFor(layout).length) return
    const presets = this.presetsFor(layout)
    const prevCount = this.viewports.length
    this.layout = layout
    this.ensureCount(presets.length, presets)
    // viewports created just now get their presets; existing ones keep their cameras
    for (let i = prevCount; i < this.viewports.length; i++) this.viewports[i]!.applyPreset(presets[i]!, fitBounds, false)
    if (layout === 'split' && prevCount === 1) {
      // product default: left orthographic front view, right perspective — swap so the existing 3D view sits right
      const [a, b] = this.viewports as [Viewport, Viewport]
      if (!a.isOrtho) {
        b.applyPreset('front', fitBounds, false)
        a.preset = a.preset === 'custom' ? 'perspective' : a.preset
      }
    }
    if (this.active >= this.viewports.length) this.active = 0
    this.updateRects()
    this.onChange()
  }

  updateRects(): void {
    const W = this.ctx.width
    const H = this.ctx.height
    const rects: Rect[] = []
    switch (this.layout) {
      case 'single':
        rects.push({ x: 0, y: 0, w: W, h: H })
        break
      case 'split': {
        const half = Math.floor((W - GAP) / 2)
        rects.push({ x: 0, y: 0, w: half, h: H }, { x: half + GAP, y: 0, w: W - half - GAP, h: H })
        break
      }
      case 'quad': {
        const hw = Math.floor((W - GAP) / 2)
        const hh = Math.floor((H - GAP) / 2)
        rects.push({ x: 0, y: 0, w: hw, h: hh }, { x: hw + GAP, y: 0, w: W - hw - GAP, h: hh }, { x: 0, y: hh + GAP, w: hw, h: H - hh - GAP }, { x: hw + GAP, y: hh + GAP, w: W - hw - GAP, h: H - hh - GAP })
        break
      }
    }
    this.viewports.forEach((vp, i) => {
      const r = rects[i]
      if (r) vp.setRect(r)
    })
    this.refreshChrome()
  }

  /** Labels + active highlight (called when state changes). */
  refreshChrome(): void {
    const cube = this.ctx.viewCubeOffset
    this.viewports.forEach((vp, i) => {
      const label = this.labels[i]
      if (label) {
        label.textContent = vp.labelText
        label.style.display = this.showLabels ? 'block' : 'none'
        label.style.left = `${cube.left}px`
        label.style.top = `${cube.top + VIEWCUBE_SIZE + 2}px`
      }
      const activeRing = this.viewports.length > 1 && i === this.active
      vp.el.style.boxShadow = activeRing ? `inset 0 0 0 1.5px ${this.theme.css('--cs-accent')}` : 'none'
      vp.el.style.borderRadius = this.viewports.length > 1 ? '6px' : '0'
    })
  }

  setTheme(theme: ThemeColors): void {
    this.theme = theme
    for (const l of this.labels) l.style.color = theme.css('--cs-text-2')
    this.refreshChrome()
  }

  setActive(index: number): void {
    if (index < 0 || index >= this.viewports.length || index === this.active) return
    this.active = index
    this.refreshChrome()
    this.onChange()
  }

  get activeViewport(): Viewport {
    return this.viewports[this.active] ?? this.viewports[0]!
  }

  at(index?: number): Viewport {
    return index === undefined ? this.activeViewport : this.viewports[index] ?? this.activeViewport
  }

  /** Viewport under a client position (null outside the canvas). */
  hit(clientX: number, clientY: number): Viewport | null {
    const rect = this.ctx.container.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top
    for (const vp of this.viewports) if (vp.contains(x, y)) return vp
    return null
  }

  /** Advance camera-controls; true when any camera moved. */
  update(dt: number): boolean {
    let moved = false
    for (const vp of this.viewports) if (vp.update(dt)) moved = true
    return moved
  }

  states(): ViewportState[] {
    return this.viewports.map((v) => v.toState())
  }

  /** Label text including the plan level name, e.g. "Top · Ground Floor". */
  setLabel(vp: Viewport, levelName: string | null): void {
    const base = vp.labelText.split(' · ')[0] ?? vp.labelText
    vp.labelText = levelName && vp.isPlanView ? `${base} · ${levelName}` : base
    this.refreshChrome()
  }

  dispose(): void {
    for (const vp of this.viewports) vp.dispose()
    this.viewports.length = 0
    this.root.remove()
  }
}
