// Internal tool-plugin contract of @cadsandbox/render.
//
// The editor core implements ToolContext (snapping, work planes, previews, overlays, picking) and
// dispatches input to the active Tool. Tools are small state machines that read/write the
// CadDocument. Core-owned tools (select, pan, orbit, zoom-window, walk, place) live in the core;
// every other ToolId is provided by `createTools()` in ./index.ts.
import type * as THREE from 'three'
import type { AnyNode, CadDocument, NewNode, NodeBase, UnitsSettings, Vec2, Vec3 } from '@cadsandbox/doc'
import type { Drawing2D, GeometryResult, GeometryService, LineStyle, SnapKind } from '@cadsandbox/geometry'
import type { Editor, EditorEvents, SnapSettings, ToolId, ToolInput } from '../api'

// ------------------------------------------------------------------ input
export interface ToolPointerEvent {
  clientX: number
  clientY: number
  /** Normalized device coords within the viewport (-1..1) */
  ndc: [number, number]
  button: number // 0 left, 1 middle, 2 right
  buttons: number
  shift: boolean
  alt: boolean
  /** Ctrl on Windows/Linux, ⌘ on macOS */
  mod: boolean
  viewport: number
  ray: { origin: Vec3; direction: Vec3 }
  pointerType: 'mouse' | 'pen' | 'touch'
  /** Native event, for preventDefault etc. */
  native: PointerEvent | MouseEvent
}

// ------------------------------------------------------------------ work planes & snapping
/** Drawing plane in world space. u/v are orthonormal in-plane axes; normal = u × v. */
export interface WorkPlane {
  origin: Vec3
  normal: Vec3
  u: Vec3
  v: Vec3
  /** Level the plane belongs to (plan drawing), if any */
  levelId: string | null
}

export type SnapResultKind = SnapKind | 'grid' | 'free' | 'intersection' | 'perpendicular' | 'parallel' | 'nearest' | 'extension' | 'axis' | 'face'

export interface SnapResult {
  /** Snapped world point */
  point: Vec3
  kind: SnapResultKind
  nodeId: string | null
  /** Surface normal when snapped to a face */
  normal: Vec3 | null
  /** Inference guide to draw (dashed axis-colored line from → to) */
  guide: { from: Vec3; to: Vec3; axis: 'x' | 'y' | 'z' | 'custom' } | null
  /** The raw (unsnapped) point on the work plane / surface */
  raw: Vec3
}

export interface SnapQuery {
  /** Plane to project onto (default: ctx.workPlane()) */
  plane?: WorkPlane
  /** Reference point for polar/ortho/perpendicular/parallel inference (e.g. previous vertex) */
  from?: Vec3 | null
  /** Snap onto object surfaces in 3D (face snapping) instead of the plane */
  surfaces?: boolean
  /** Ignore these nodes (e.g. the one being edited) */
  exclude?: string[]
  /** Override settings for this query */
  settings?: Partial<SnapSettings>
}

export interface PickResult {
  nodeId: string
  point: Vec3
  normal: Vec3 | null
  /** For walls: distance along the wall axis from wall.a (m) and which side was hit */
  wallOffset?: number
  wallSide?: 'left' | 'right'
  /** Planar face info (push/pull): world plane of the hit face */
  face?: { normal: Vec3; point: Vec3 }
}

// ------------------------------------------------------------------ previews & overlays
export interface PreviewLayer {
  /** Show a temporary node rendered like a real one but ghosted (not in the doc). Returns a handle id. */
  node(node: AnyNode, opts?: { opacity?: number; parentMatrix?: THREE.Matrix4 }): string
  /** Update a previous preview node (same handle). */
  updateNode(handle: string, node: AnyNode): void
  /** Polyline/segments in world space (style picks color/dash/weight). */
  lines(points: Vec3[], opts?: { closed?: boolean; style?: LineStyle | 'guide' | 'rubber'; color?: string; dashed?: boolean }): string
  /** Arbitrary 2D drawing placed on a plane (e.g. dimension preview). */
  drawing(d: Drawing2D, plane: WorkPlane): string
  /** Translucent filled polygon on a plane (area measure, slab outline). */
  polygon(points: Vec3[], opts?: { color?: string; opacity?: number }): string
  /** Small marker (snap glyph) at a point. */
  marker(point: Vec3, kind: SnapResultKind): string
  remove(handle: string): void
  clear(): void
}

export interface OverlayLayer {
  /** Screen-space label anchored to a world point (auto-projected every frame). */
  label(world: Vec3, text: string, opts?: { variant?: 'size' | 'measure' | 'hint' | 'dimension'; offsetPx?: [number, number] }): string
  updateLabel(handle: string, world: Vec3, text: string): void
  /** Inline text editor at a world point (text tool, rename). Resolves null on cancel. */
  prompt(world: Vec3, initial: string, opts?: { multiline?: boolean; placeholder?: string }): Promise<string | null>
  remove(handle: string): void
  clear(): void
}

// ------------------------------------------------------------------ context
export interface LevelInfo {
  id: string
  name: string
  elevation: number
  height: number
  cutHeight: number
}

export interface ToolContext {
  readonly editor: Editor
  readonly doc: CadDocument
  readonly geometry: GeometryService
  readonly preview: PreviewLayer
  readonly overlay: OverlayLayer

  /** Current work plane for the viewport (plan views: active level plane; 3D: level plane or face). */
  workPlane(viewport?: number): WorkPlane
  /** Snap the pointer to geometry/grid/inference. Always returns a point (falls back to plane hit). */
  snap(e: ToolPointerEvent, query?: SnapQuery): SnapResult
  /** Pick the top node under the pointer (respects locks/visibility/levels). filter narrows types. */
  pick(e: ToolPointerEvent, filter?: (n: AnyNode) => boolean): PickResult | null
  /** Intersect the pointer ray with a plane. */
  rayPlane(e: ToolPointerEvent, plane: WorkPlane): Vec3 | null

  activeLevel(): LevelInfo | null
  units(): UnitsSettings
  /** Format meters with doc units; parse user input (VCB) into meters (null = invalid). */
  formatLength(meters: number): string
  parseLength(text: string): number | null
  parseAngle(text: string): number | null

  /** Status-bar hint and the numeric input box. */
  setHint(text: string): void
  setInput(input: ToolInput | null): void
  setCursor(css: string): void
  notify(level: EditorEvents['notify']['level'], message: string): void
  emit<K extends keyof EditorEvents>(event: K, payload: EditorEvents[K]): void

  /** Add nodes as ONE undo step and select them. Returns ids. */
  commitNodes(nodes: NewNode[], opts?: { select?: boolean }): string[]
  /** Run arbitrary doc edits as ONE undo step. */
  commit<R>(fn: () => R): R
  /** Parent for new nodes created by tools (active level, or the entered group). */
  defaultParent(): string | null
  /** Convert a world point into the local XY coordinates of a parent node (level/group). */
  toLocal(parent: string | null, world: Vec3): Vec3
  toWorld(parent: string | null, local: Vec3): Vec3
  /** Cached geometry of a node (undefined until evaluated). */
  result(nodeId: string): GeometryResult | undefined
  node<T extends AnyNode['type']>(id: string): NodeBase<T> | undefined

  /** Switch back to the select tool (after one-shot tools) or to another tool. */
  setTool(tool: ToolId, options?: Record<string, unknown>): void
  requestRender(): void
  /** Is the viewport an orthographic plan (top) view? */
  isPlanView(viewport?: number): boolean
  camera(viewport?: number): THREE.Camera
  /** World units per screen pixel at a point (for pixel tolerances and handle sizes). */
  worldPerPixel(point: Vec3, viewport?: number): number
}

// ------------------------------------------------------------------ tools
export interface Tool {
  readonly id: ToolId
  /** Called when the tool becomes active. `options` = setTool options (e.g. wall thickness, furniture kind). */
  activate(ctx: ToolContext, options: Record<string, unknown>): void
  deactivate(): void
  /** Return true when the event was consumed (the core then does not orbit/pan/box-select). */
  onPointerDown?(e: ToolPointerEvent): boolean | void
  onPointerMove?(e: ToolPointerEvent): void
  onPointerUp?(e: ToolPointerEvent): boolean | void
  onDoubleClick?(e: ToolPointerEvent): boolean | void
  onKeyDown?(e: KeyboardEvent): boolean | void
  /** Numeric input submitted (Enter in the input box / typed digits + Enter). */
  onInput?(text: string): void
  /** Escape / tool.cancel: abort the current operation (second Escape exits the tool via core). */
  onCancel?(): boolean | void
  /** tool.confirm (Enter with empty input / double click): finish the current operation. */
  onConfirm?(): void
  /** Options changed while active (from the UI's tool options bar). */
  onOptions?(options: Record<string, unknown>): void
}

export type ToolFactory = () => Tool

/** Default options per tool — the UI renders an options bar from these (and calls setTool again). */
export interface ToolOptionSpec {
  key: string
  label: string
  kind: 'length' | 'angle' | 'number' | 'boolean' | 'select' | 'material'
  default: unknown
  options?: { value: string; label: string }[]
  min?: number
  max?: number
}

export type ToolRegistry = Partial<Record<ToolId, { factory: ToolFactory; label: string; options?: ToolOptionSpec[] }>>

// Re-export for tool authors.
export type { Vec2, Vec3 }
