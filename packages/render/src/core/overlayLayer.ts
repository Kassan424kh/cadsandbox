// OverlayLayer — HTML overlays projected onto the viewports every frame: labels (size pills, measure
// readouts, hints, dimensions), snap glyph markers, remote cursor pills, box-select rectangles and
// the inline text prompt. Styled through --cs-* tokens with fallbacks.
import * as THREE from 'three'
import type { Vec3 } from '@cadsandbox/doc'
import type { OverlayLayer as OverlayLayerApi, SnapResultKind } from '../tools/types'
import type { ViewportManager } from '../renderer/viewportManager'
import type { Viewport } from '../renderer/viewport'
import type { ThemeColors } from '../util/css'

type Variant = 'size' | 'measure' | 'hint' | 'dimension' | 'cursor' | 'marker' | 'tooltip'

interface Entry {
  world: THREE.Vector3
  variant: Variant
  offset: [number, number]
  text: string
  color: string | null
  kind: SnapResultKind | null
  /** viewport index or null for every viewport */
  viewport: number | null
  els: Map<number, HTMLDivElement>
  rotateDeg: number
}

const GLYPHS: Partial<Record<SnapResultKind, string>> = {
  endpoint: '<circle cx="8" cy="8" r="5" fill="currentColor"/>',
  vertex: '<path d="M8 2 L14 8 L8 14 L2 8 Z" fill="currentColor"/>',
  midpoint: '<path d="M8 2.5 L14 13.5 L2 13.5 Z" fill="currentColor"/>',
  center: '<circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="8" cy="8" r="1.8" fill="currentColor"/>',
  quadrant: '<path d="M8 2 L14 8 L8 14 L2 8 Z" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  insertion: '<rect x="3" y="3" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 3 V13 M3 8 H13" stroke="currentColor" stroke-width="1.4"/>',
  intersection: '<path d="M3 3 L13 13 M13 3 L3 13" stroke="currentColor" stroke-width="2.2"/>',
  nearest: '<rect x="3.5" y="3.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  perpendicular: '<path d="M3 13 H13 M8 13 V3" stroke="currentColor" stroke-width="2"/>',
  parallel: '<path d="M5 3 V13 M11 3 V13" stroke="currentColor" stroke-width="2"/>',
  extension: '<path d="M2 8 H14" stroke="currentColor" stroke-width="2" stroke-dasharray="3 2"/>',
  grid: '<path d="M8 3 V13 M3 8 H13" stroke="currentColor" stroke-width="1.6"/>',
  face: '<rect x="3" y="3" width="10" height="10" fill="currentColor" opacity="0.4"/><rect x="3" y="3" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  axis: '<path d="M2 8 H14" stroke="currentColor" stroke-width="2"/>',
}

export const SNAP_LABELS: Record<SnapResultKind, string> = {
  endpoint: 'Endpoint',
  midpoint: 'Midpoint',
  center: 'Center',
  quadrant: 'Quadrant',
  vertex: 'Vertex',
  insertion: 'Insertion',
  grid: 'Grid',
  free: '',
  intersection: 'Intersection',
  perpendicular: 'Perpendicular',
  parallel: 'Parallel',
  nearest: 'On Edge',
  extension: 'Extension',
  axis: 'On Axis',
  face: 'On Face',
}

export class OverlayLayer implements OverlayLayerApi {
  private viewports: ViewportManager
  private theme: ThemeColors
  private entries = new Map<string, Entry>()
  private containers = new Map<number, HTMLDivElement>()
  private rects = new Map<number, HTMLDivElement>()
  private nextId = 1
  private activePrompt: { el: HTMLElement; cancel: () => void } | null = null
  private dirty = true

  constructor(viewports: ViewportManager, theme: ThemeColors) {
    this.viewports = viewports
    this.theme = theme
  }

  setTheme(theme: ThemeColors): void {
    this.theme = theme
    for (const e of this.entries.values()) for (const el of e.els.values()) this.style(el, e)
  }

  private container(vp: Viewport): HTMLDivElement {
    let c = this.containers.get(vp.index)
    if (!c || c.parentElement !== vp.el) {
      c = document.createElement('div')
      c.className = 'cs-overlay'
      c.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;font-family:var(--cs-font-sans, Inter, system-ui, sans-serif);'
      vp.el.appendChild(c)
      this.containers.set(vp.index, c)
    }
    return c
  }

  private create(variant: Variant, world: Vec3, text: string, opts: { offsetPx?: [number, number]; color?: string | null; kind?: SnapResultKind | null; viewport?: number | null; rotateDeg?: number } = {}): string {
    const id = `ov${this.nextId++}`
    this.entries.set(id, {
      world: new THREE.Vector3(world[0], world[1], world[2]),
      variant,
      offset: opts.offsetPx ?? [0, 0],
      text,
      color: opts.color ?? null,
      kind: opts.kind ?? null,
      viewport: opts.viewport ?? null,
      els: new Map(),
      rotateDeg: opts.rotateDeg ?? 0,
    })
    this.dirty = true
    return id
  }

  label(world: Vec3, text: string, opts?: { variant?: 'size' | 'measure' | 'hint' | 'dimension'; offsetPx?: [number, number]; viewport?: number | null; rotateDeg?: number }): string {
    return this.create(opts?.variant ?? 'measure', world, text, { offsetPx: opts?.offsetPx, viewport: opts?.viewport, rotateDeg: opts?.rotateDeg })
  }

  updateLabel(handle: string, world: Vec3, text: string): void {
    const e = this.entries.get(handle)
    if (!e) return
    e.world.set(world[0], world[1], world[2])
    if (e.text !== text) {
      e.text = text
      for (const el of e.els.values()) el.textContent = text
    }
    this.dirty = true
  }

  /** Snap glyph (tool previews). */
  marker(world: Vec3, kind: SnapResultKind, viewport: number | null = null): string {
    return this.create('marker', world, '', { kind, viewport })
  }

  /** Snap tooltip (e.g. "Endpoint"). */
  tooltip(world: Vec3, text: string, viewport: number | null = null): string {
    return this.create('tooltip', world, text, { offsetPx: [14, 14], viewport })
  }

  /** Remote cursor pill with the user's color. */
  cursor(world: Vec3, name: string, color: string): string {
    return this.create('cursor', world, name, { color, offsetPx: [10, 10] })
  }

  updateCursor(handle: string, world: Vec3, name: string, color: string): void {
    const e = this.entries.get(handle)
    if (!e) return
    e.world.set(world[0], world[1], world[2])
    e.text = name
    if (e.color !== color) {
      e.color = color
      for (const el of e.els.values()) this.style(el, e)
    }
    for (const el of e.els.values()) if (el.textContent !== name) el.textContent = name
    this.dirty = true
  }

  remove(handle: string): void {
    const e = this.entries.get(handle)
    if (!e) return
    for (const el of e.els.values()) el.remove()
    this.entries.delete(handle)
  }

  clear(): void {
    for (const e of this.entries.values()) for (const el of e.els.values()) el.remove()
    this.entries.clear()
  }

  /** Rubber-band rectangle in viewport-local CSS px (null hides). */
  showRect(vp: Viewport, rect: { x0: number; y0: number; x1: number; y1: number } | null, mode: 'window' | 'crossing' = 'window'): void {
    let el = this.rects.get(vp.index)
    if (!rect) {
      if (el) el.style.display = 'none'
      return
    }
    if (!el) {
      el = document.createElement('div')
      el.className = 'cs-box-select'
      this.container(vp).appendChild(el)
      this.rects.set(vp.index, el)
    }
    const accent = this.theme.css('--cs-accent')
    el.style.cssText = [
      'position:absolute',
      `left:${Math.min(rect.x0, rect.x1)}px`,
      `top:${Math.min(rect.y0, rect.y1)}px`,
      `width:${Math.abs(rect.x1 - rect.x0)}px`,
      `height:${Math.abs(rect.y1 - rect.y0)}px`,
      `border:1px ${mode === 'window' ? 'solid' : 'dashed'} ${accent}`,
      `background:${this.theme.css('--cs-accent-soft')}`,
      'border-radius:2px',
      'pointer-events:none',
      'display:block',
    ].join(';')
  }

  private style(el: HTMLDivElement, e: Entry): void {
    const t = this.theme
    const base = 'position:absolute;left:0;top:0;pointer-events:none;white-space:nowrap;will-change:transform;'
    switch (e.variant) {
      case 'size':
        el.style.cssText = `${base}transform-origin:center;padding:2px 8px;border-radius:999px;background:${t.css('--cs-glass-strong')};border:1px solid ${t.css('--cs-border-strong')};color:${t.css('--cs-text')};font:500 11px/1.4 var(--cs-font-mono, ui-monospace, monospace);letter-spacing:0.02em;box-shadow:var(--cs-shadow-1, 0 1px 2px rgba(0,0,0,.3));backdrop-filter:blur(8px);`
        break
      case 'measure':
        el.style.cssText = `${base}padding:3px 9px;border-radius:999px;background:${t.css('--cs-accent')};color:${t.css('--cs-accent-contrast')};font:600 11px/1.4 var(--cs-font-mono, ui-monospace, monospace);box-shadow:var(--cs-shadow-2, 0 8px 24px rgba(0,0,0,.35));`
        break
      case 'hint':
        el.style.cssText = `${base}padding:2px 6px;border-radius:6px;background:${t.css('--cs-glass')};color:${t.css('--cs-text-2')};font:500 11px/1.4 var(--cs-font-sans, Inter, system-ui, sans-serif);`
        break
      case 'dimension':
        el.style.cssText = `${base}padding:1px 5px;border-radius:4px;background:${t.css('--cs-surface')};color:${t.css('--cs-text')};font:500 11px/1.3 var(--cs-font-mono, ui-monospace, monospace);border:1px solid ${t.css('--cs-border')};`
        break
      case 'cursor':
        el.style.cssText = `${base}padding:2px 8px;border-radius:999px 999px 999px 4px;background:${e.color ?? t.css('--cs-accent')};color:#fff;font:600 11px/1.4 var(--cs-font-sans, Inter, system-ui, sans-serif);box-shadow:var(--cs-shadow-1, 0 1px 2px rgba(0,0,0,.3));`
        break
      case 'tooltip':
        el.style.cssText = `${base}padding:2px 7px;border-radius:6px;background:${t.css('--cs-glass-strong')};color:${t.css('--cs-text')};font:500 11px/1.4 var(--cs-font-sans, Inter, system-ui, sans-serif);border:1px solid ${t.css('--cs-border')};`
        break
      case 'marker':
        el.style.cssText = `${base}width:16px;height:16px;margin:-8px 0 0 -8px;color:${e.color ?? t.css('--cs-accent')};filter:drop-shadow(0 0 2px rgba(0,0,0,.5));`
        el.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16">${GLYPHS[e.kind ?? 'free'] ?? ''}</svg>`
        break
    }
  }

  /** Project all entries into their viewports (called once per frame). */
  update(cameraMoved: boolean): void {
    if (!cameraMoved && !this.dirty) return
    this.dirty = false
    for (const vp of this.viewports.viewports) {
      const container = this.container(vp)
      for (const e of this.entries.values()) {
        if (e.viewport !== null && e.viewport !== vp.index) {
          e.els.get(vp.index)?.remove()
          e.els.delete(vp.index)
          continue
        }
        let el = e.els.get(vp.index)
        if (!el) {
          el = document.createElement('div')
          if (e.variant !== 'marker') el.textContent = e.text
          this.style(el, e)
          container.appendChild(el)
          e.els.set(vp.index, el)
        }
        const visible = vp.project(e.world, _p)
        if (!visible || _p.x < -50 || _p.y < -50 || _p.x > vp.rect.w + 50 || _p.y > vp.rect.h + 50) {
          el.style.display = 'none'
          continue
        }
        el.style.display = 'block'
        const cx = e.variant === 'marker' ? 0 : -50
        const cy = e.variant === 'marker' ? 0 : -50
        el.style.transform = `translate3d(${(_p.x + e.offset[0]).toFixed(1)}px, ${(_p.y + e.offset[1]).toFixed(1)}px, 0) translate(${cx}%, ${cy}%) rotate(${e.rotateDeg}deg)`
      }
    }
    // drop elements of removed viewports
    for (const [index, c] of this.containers) if (!this.viewports.viewports[index]) {
      c.remove()
      this.containers.delete(index)
    }
  }

  prompt(world: Vec3, initial: string, opts?: { multiline?: boolean; placeholder?: string }): Promise<string | null> {
    this.activePrompt?.cancel()
    const vp = this.viewports.activeViewport
    const container = this.container(vp)
    const el = document.createElement(opts?.multiline ? 'textarea' : 'input') as HTMLInputElement | HTMLTextAreaElement
    el.value = initial
    if (opts?.placeholder) el.placeholder = opts.placeholder
    const t = this.theme
    el.style.cssText = `position:absolute;left:0;top:0;min-width:120px;pointer-events:auto;padding:6px 10px;border-radius:10px;background:${t.css('--cs-surface')};color:${t.css('--cs-text')};border:1px solid ${t.css('--cs-accent')};font:500 13px/1.4 var(--cs-font-sans, Inter, system-ui, sans-serif);outline:none;box-shadow:var(--cs-shadow-2, 0 8px 24px rgba(0,0,0,.35));resize:none;`
    vp.project(new THREE.Vector3(world[0], world[1], world[2]), _p)
    el.style.transform = `translate3d(${_p.x.toFixed(1)}px, ${_p.y.toFixed(1)}px, 0) translate(-50%, -50%)`
    container.appendChild(el)
    return new Promise<string | null>((resolve) => {
      let done = false
      const finish = (v: string | null) => {
        if (done) return
        done = true
        el.remove()
        this.activePrompt = null
        resolve(v)
      }
      const target: HTMLElement = el
      target.addEventListener('keydown', (ev: KeyboardEvent) => {
        ev.stopPropagation()
        if (ev.key === 'Escape') finish(null)
        else if (ev.key === 'Enter' && (!opts?.multiline || ev.metaKey || ev.ctrlKey)) {
          ev.preventDefault()
          finish(el.value)
        }
      })
      el.addEventListener('pointerdown', (ev) => ev.stopPropagation())
      el.addEventListener('blur', () => finish(el.value))
      this.activePrompt = { el, cancel: () => finish(null) }
      requestAnimationFrame(() => {
        el.focus()
        el.select()
      })
    })
  }

  dispose(): void {
    this.activePrompt?.cancel()
    this.clear()
    for (const c of this.containers.values()) c.remove()
    this.containers.clear()
    this.rects.clear()
  }
}

const _p = new THREE.Vector2()
