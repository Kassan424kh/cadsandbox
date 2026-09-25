// ToolBase: shared plumbing for every tool — option defaults, preview/overlay bookkeeping,
// hint/VCB helpers, snapping with markers and guides, local-space conversion and commit helpers.
import type { AnyNode, NewNode, Vec2, Vec3 } from '@cadsandbox/doc'
import type { Drawing2D, LineStyle } from '@cadsandbox/geometry'
import type { ToolId } from '../../api'
import type { SnapQuery, SnapResult, Tool, ToolContext, ToolOptionSpec, ToolPointerEvent, WorkPlane } from '../types'
import { bool, num, optionDefaults, str } from './nodes'
import { toPlane, v3 } from './vec'

export abstract class ToolBase implements Tool {
  abstract readonly id: ToolId
  /** Option specs (also exported to the registry). */
  readonly specs: ToolOptionSpec[] = []
  protected ctx!: ToolContext
  protected options: Record<string, unknown> = {}
  private previewHandles = new Set<string>()
  private overlayHandles = new Set<string>()
  private active = false

  activate(ctx: ToolContext, options: Record<string, unknown>): void {
    this.ctx = ctx
    this.active = true
    this.options = { ...optionDefaults(this.specs), ...options }
    this.start()
  }

  deactivate(): void {
    if (!this.active) return
    this.clearAll()
    this.ctx.setInput(null)
    this.stop()
    this.active = false
  }

  onOptions(options: Record<string, unknown>): void {
    Object.assign(this.options, options)
    this.optionsChanged()
  }

  onKeyDown(e: KeyboardEvent): boolean | void {
    if (e.key === 'Backspace' || e.key === 'Delete') return this.onBackspace()
    if (e.key === 'Enter') {
      this.onConfirm?.()
      return true
    }
    return this.onKey(e.key, e)
  }

  onCancel(): boolean | void {
    if (!this.isBusy()) return false
    this.reset()
    return true
  }

  onConfirm?(): void

  protected isActive(): boolean {
    return this.active
  }

  // ---- hooks for subclasses
  protected start(): void {}
  protected stop(): void {}
  protected optionsChanged(): void {}
  protected onBackspace(): boolean | void {
    return false
  }
  protected onKey(_key: string, _e: KeyboardEvent): boolean | void {
    return false
  }
  /** True while a multi-step operation is in progress (Esc then resets instead of exiting). */
  protected abstract isBusy(): boolean
  /** Abort the operation in progress and return to the tool's first step. */
  protected abstract reset(): void

  // ---- options
  protected optNum(key: string, fallback: number): number {
    return num(this.options[key], fallback)
  }
  protected optBool(key: string, fallback: boolean): boolean {
    return bool(this.options[key], fallback)
  }
  protected optStr<T extends string>(key: string, fallback: T, allowed?: readonly T[]): T {
    return str(this.options[key], fallback, allowed)
  }

  // ---- status bar / VCB
  protected hint(text: string): void {
    this.ctx.setHint(text)
  }
  protected input(label: string, value: string, placeholder?: string): void {
    this.ctx.setInput({ label, value, ...(placeholder ? { placeholder } : {}) })
  }
  protected clearInput(): void {
    this.ctx.setInput(null)
  }

  // ---- previews
  protected lines(points: Vec3[], opts?: { closed?: boolean; style?: LineStyle | 'guide' | 'rubber'; color?: string; dashed?: boolean }): string {
    const h = this.ctx.preview.lines(points, opts)
    this.previewHandles.add(h)
    return h
  }
  protected polygon(points: Vec3[], opts?: { color?: string; opacity?: number }): string {
    const h = this.ctx.preview.polygon(points, opts)
    this.previewHandles.add(h)
    return h
  }
  protected marker(point: Vec3, kind: SnapResult['kind']): string {
    const h = this.ctx.preview.marker(point, kind)
    this.previewHandles.add(h)
    return h
  }
  protected ghost(node: AnyNode, opts?: Parameters<ToolContext['preview']['node']>[1]): string {
    const h = this.ctx.preview.node(node, opts)
    this.previewHandles.add(h)
    return h
  }
  protected drawing(d: Drawing2D, plane: WorkPlane): string {
    const h = this.ctx.preview.drawing(d, plane)
    this.previewHandles.add(h)
    return h
  }
  protected label(world: Vec3, text: string, variant: 'size' | 'measure' | 'hint' | 'dimension' = 'measure', offsetPx?: [number, number]): string {
    const h = this.ctx.overlay.label(world, text, { variant, ...(offsetPx ? { offsetPx } : {}) })
    this.overlayHandles.add(h)
    return h
  }
  protected clearPreview(): void {
    for (const h of this.previewHandles) this.ctx.preview.remove(h)
    this.previewHandles.clear()
  }
  protected clearLabels(): void {
    for (const h of this.overlayHandles) this.ctx.overlay.remove(h)
    this.overlayHandles.clear()
  }
  protected clearAll(): void {
    this.clearPreview()
    this.clearLabels()
  }

  // ---- geometry helpers
  protected plane(): WorkPlane {
    return this.ctx.workPlane()
  }
  protected parent(): string | null {
    return this.ctx.defaultParent()
  }
  protected toLocal(world: Vec3, parent: string | null = this.parent()): Vec3 {
    return this.ctx.toLocal(parent, world)
  }
  protected toLocal2(world: Vec3, parent: string | null = this.parent()): Vec2 {
    const l = this.ctx.toLocal(parent, world)
    return [l[0], l[1]]
  }
  protected toWorld(local: Vec3, parent: string | null = this.parent()): Vec3 {
    return this.ctx.toWorld(parent, local)
  }
  protected toWorld2(local: Vec2, parent: string | null = this.parent()): Vec3 {
    return this.ctx.toWorld(parent, [local[0], local[1], 0])
  }
  /** In-plane (u,v) coordinates of a world point on the current work plane. */
  protected uv(world: Vec3): Vec2 {
    return toPlane(this.plane(), world)
  }
  protected levelHeight(): number {
    return this.ctx.activeLevel()?.height ?? 3
  }
  protected fmt(m: number): string {
    return this.ctx.formatLength(m)
  }

  /** Snap the pointer, drawing the snap marker and inference guide. */
  protected snap(e: ToolPointerEvent, from: Vec3 | null = null, query: SnapQuery = {}): SnapResult {
    const s = this.ctx.snap(e, { from, ...query })
    if (s.kind !== 'free') this.marker(s.point, s.kind)
    if (s.guide) this.lines([s.guide.from, s.guide.to], { style: 'guide', dashed: true })
    return s
  }

  /** World point on the work plane (ray hit) without snapping. */
  protected planeHit(e: ToolPointerEvent): Vec3 | null {
    return this.ctx.rayPlane(e, this.plane())
  }

  // ---- commits
  protected commitNodes(nodes: NewNode[], select = true): string[] {
    const ids = this.ctx.commitNodes(nodes, { select })
    if (ids.length) this.ctx.emit('created', { ids, tool: this.id })
    this.ctx.requestRender()
    return ids
  }

  protected distanceLabel(a: Vec3, b: Vec3, text?: string): void {
    this.label(v3.mid(a, b), text ?? this.fmt(v3.dist(a, b)), 'measure')
  }
}

export type PointerButton = 0 | 1 | 2
export const isPrimary = (e: ToolPointerEvent): boolean => e.button === 0
