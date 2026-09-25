// ToolHost — tool registry (core tools + createTools()), activation and input dispatch.
import type { StoreApi } from 'zustand/vanilla'
import type { EditorState, ToolId } from '../api'
import type { Tool, ToolContext, ToolPointerEvent, ToolRegistry } from '../tools/types'
import { createTools } from '../tools'

export interface InteractionLayer {
  onPointerDown(e: ToolPointerEvent): boolean
  onPointerMove(e: ToolPointerEvent): boolean
  onPointerUp(e: ToolPointerEvent): boolean
  onKeyDown?(ev: KeyboardEvent): boolean
  /** Active drag in progress (the camera must not react). */
  readonly dragging: boolean
}

export class ToolHost {
  readonly registry: ToolRegistry
  private store: StoreApi<EditorState>
  private ctx: ToolContext | null = null
  private active: Tool | null = null
  private activeId: ToolId = 'select'
  private options: Record<string, unknown> = {}
  private onCursor: (css: string) => void
  /** Layers consulted before the tool (gizmos, direct drag). */
  readonly layers: InteractionLayer[] = []
  onToolChanged: ((id: ToolId) => void) | null = null

  constructor(coreTools: ToolRegistry, store: StoreApi<EditorState>, onCursor: (css: string) => void) {
    this.store = store
    this.onCursor = onCursor
    const external = safeCreateTools()
    // core tools win on conflicts; everything else comes from the tools module
    this.registry = { ...external, ...coreTools }
  }

  attach(ctx: ToolContext): void {
    this.ctx = ctx
  }

  get current(): Tool | null {
    return this.active
  }

  get currentId(): ToolId {
    return this.activeId
  }

  has(id: ToolId): boolean {
    return !!this.registry[id]
  }

  setTool(id: ToolId, options: Record<string, unknown> = {}): void {
    if (!this.ctx) return
    const entry = this.registry[id]
    if (!entry) {
      console.warn(`[cadsandbox/render] unknown tool "${id}"`)
      return
    }
    const merged = { ...defaultOptions(entry), ...options }
    if (this.active && this.activeId === id) {
      this.options = merged
      this.active.onOptions?.(merged)
      this.store.setState({ toolOptions: merged })
      return
    }
    try {
      this.active?.deactivate()
    } catch (err) {
      console.error('[cadsandbox/render] tool deactivate failed', err)
    }
    this.onCursor('')
    this.store.setState({ tool: id, toolOptions: merged, toolHint: '', toolInput: null, measure: null })
    this.activeId = id
    this.options = merged
    const tool = entry.factory()
    this.active = tool
    try {
      tool.activate(this.ctx, merged)
    } catch (err) {
      console.error(`[cadsandbox/render] tool "${id}" failed to activate`, err)
    }
    this.onToolChanged?.(id)
  }

  pointerDown(e: ToolPointerEvent): boolean {
    for (const l of this.layers) if (l.onPointerDown(e)) return true
    return !!this.active?.onPointerDown?.(e)
  }

  pointerMove(e: ToolPointerEvent): void {
    for (const l of this.layers) if (l.onPointerMove(e)) return
    this.active?.onPointerMove?.(e)
  }

  pointerUp(e: ToolPointerEvent): boolean {
    for (const l of this.layers) if (l.onPointerUp(e)) return true
    return !!this.active?.onPointerUp?.(e)
  }

  doubleClick(e: ToolPointerEvent): boolean {
    return !!this.active?.onDoubleClick?.(e)
  }

  keyDown(ev: KeyboardEvent): boolean {
    for (const l of this.layers) if (l.onKeyDown?.(ev)) return true
    return !!this.active?.onKeyDown?.(ev)
  }

  input(text: string): void {
    this.active?.onInput?.(text)
  }

  /** Escape: tool aborts its step; returns true when the tool handled it. */
  cancel(): boolean {
    return !!this.active?.onCancel?.()
  }

  confirm(): void {
    this.active?.onConfirm?.()
  }

  get isDragging(): boolean {
    return this.layers.some((l) => l.dragging)
  }

  dispose(): void {
    try {
      this.active?.deactivate()
    } catch {
      /* ignore */
    }
    this.active = null
  }
}

function defaultOptions(entry: NonNullable<ToolRegistry[ToolId]>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const spec of entry.options ?? []) out[spec.key] = spec.default
  return out
}

function safeCreateTools(): ToolRegistry {
  try {
    return createTools() ?? {}
  } catch (err) {
    console.error('[cadsandbox/render] createTools() failed; only core tools are available', err)
    return {}
  }
}
