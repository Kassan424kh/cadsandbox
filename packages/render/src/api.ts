// @cadsandbox/render — public contract of the Editor (viewport engine + interaction).
//
// The Editor owns: WebGL2 renderer (one context, several viewports via scissor), scene sync from
// CadDocument + GeometryService, materials & procedural textures, render modes (incl. progressive
// path-traced "realistic"), camera navigation + view cube, picking (BVH), selection & hover,
// transform gizmos, snapping, all interactive tools, on-canvas overlays (dimension labels, handles,
// tool previews, remote cursors) and the command registry. The React UI (apps/web) only renders
// chrome around it and talks to it through THIS interface.
import type { StoreApi } from 'zustand/vanilla'
import type { Awareness } from 'y-protocols/awareness'
import type { AnyNode, CadDocument, CameraState, DocSnapshot, NewNode, RenderMode, SheetViewSource, Vec3 } from '@cadsandbox/doc'
import type { AssetResolver, Bounds3, Drawing2D, GeometryService } from '@cadsandbox/geometry'

export type Theme = 'dark' | 'light'
export type Quality = 'auto' | 'low' | 'medium' | 'high' | 'ultra'

export interface EditorUser {
  id: string
  name: string
  color: string
}

export interface EditorAssets extends AssetResolver {
  /** Object URL / URL for an image blob (textures, underlays). */
  url(hash: string): Promise<string | null>
  /** Store bytes, returns sha256 hex (used when the editor itself creates assets, e.g. paste image). */
  put(bytes: Uint8Array, mime: string): Promise<string>
}

export interface EditorOptions {
  container: HTMLElement
  doc: CadDocument
  assets: EditorAssets
  user: EditorUser
  /** Created internally when omitted. */
  geometry?: GeometryService
  /** Yjs awareness of the design doc's provider → remote cursors, selections, follow mode. */
  awareness?: Awareness | null
  theme: Theme
  readOnly?: boolean
  quality?: Quality
  /** Draw the engine's built-in viewport label under the view cube (default true; the UI may render its own chips). */
  showViewportLabels?: boolean
  /** CSS px offset of the view cube from the viewport's top-left corner (default 12/12); see Editor.setViewCubeOffset. */
  viewCubeOffset?: { top: number; left: number }
}

// ------------------------------------------------------------------ views
export type ViewPreset = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right' | 'iso' | 'perspective'
/** single = one viewport; split = 2D/ortho left + 3D right (product default for plans); quad = 4 views */
export type ViewLayout = 'single' | 'split' | 'quad'

export interface ViewportState {
  index: number
  preset: ViewPreset | 'custom'
  projection: 'perspective' | 'orthographic'
  renderMode: RenderMode
  /** Human label shown on the viewport, e.g. "Front", "Top · Ground Floor", "Perspective" */
  label: string
  /** Plan views show the active level cut at its cut height with architectural symbology. */
  planLevel: string | null
  /** Section node id driving this view (section views) */
  section: string | null
}

// ------------------------------------------------------------------ tools
export type ToolId =
  | 'select'
  | 'pan'
  | 'orbit'
  | 'zoom-window'
  | 'walk'
  | 'place' // options: { node: NewNode } | { snapshot: DocSnapshot } — hover to preview, click to drop
  | 'draw.line'
  | 'draw.polyline'
  | 'draw.rect'
  | 'draw.circle'
  | 'draw.arc'
  | 'draw.ellipse'
  | 'draw.spline'
  | 'draw.pen' // Bézier pen → closed path becomes an extruded 'shape' (Spline-style Draw)
  | 'draw.hatch'
  | 'draw.text'
  | 'arch.wall'
  | 'arch.door'
  | 'arch.window'
  | 'arch.opening'
  | 'arch.slab'
  | 'arch.roof'
  | 'arch.stair'
  | 'arch.column'
  | 'arch.beam'
  | 'arch.railing'
  | 'arch.room'
  | 'measure.distance'
  | 'measure.area'
  | 'measure.angle'
  | 'annotate.dimension'
  | 'annotate.leader'
  | 'annotate.comment'
  | 'annotate.chain' // Maßkette: N stations on one dimension line
  | 'annotate.grid' // structural grid axes (Achsraster) with label bubbles
  | 'annotate.levelmark' // height markers (Höhenkoten)
  | 'annotate.cloud' // revision cloud on the red Markup layer
  | 'annotate.markup' // freehand redline pen
  | 'annotate.calibrate' // scale an image underlay by a known distance
  | 'modify.pushpull'
  | 'modify.offset'
  | 'modify.trim'
  | 'modify.extend'
  | 'modify.fillet'
  | 'modify.mirror'
  | 'modify.array'
  | 'section'

export type GizmoMode = 'translate' | 'rotate' | 'scale' | 'none'

export interface SnapSettings {
  enabled: boolean
  grid: boolean
  endpoint: boolean
  midpoint: boolean
  center: boolean
  intersection: boolean
  perpendicular: boolean
  parallel: boolean
  nearest: boolean
  extension: boolean
  /** Polar/angle snapping for directions */
  angle: boolean
  angleStepDeg: number
  /** Ortho lock (Shift-like) */
  ortho: boolean
  /** Pixel radius for object snaps */
  radiusPx: number
}

/** Camera navigation preferences (device-level, persisted by the app). */
export interface NavigationSettings {
  /**
   * Trackpad mapping: two-finger scroll pans (ortho) / orbits (perspective) and only pinch zooms.
   * Off (default): the wheel always zooms to the cursor — mouse wheels on macOS emit small,
   * irregular deltas that cannot be told apart from a trackpad reliably.
   */
  trackpadGestures: boolean
  /**
   * View-only navigation (phones): every pointer/touch gesture moves the camera — one finger orbits
   * (pans in orthographic views), two fingers pan + pinch-zoom. No marquee, no picking, no tools.
   */
  viewOnly: boolean
}

export interface MeasureResult {
  kind: 'distance' | 'area' | 'angle'
  /** meters, m², or radians */
  value: number
  /** Component deltas for distance */
  delta?: Vec3
  points: Vec3[]
}

/** Numeric input box (SketchUp-style VCB): while a tool is active the user can type exact values. */
export interface ToolInput {
  label: string // e.g. "Length", "Width;Depth", "Angle"
  value: string // current text (live measured value until the user types)
  placeholder?: string
}

export interface RemoteUser {
  clientId: number
  user: EditorUser
  selection: string[]
  tool: ToolId | null
  cursor: Vec3 | null
  camera: CameraState | null
  /** File id they are looking at (presence across files) */
  fileId?: string | null
}

export interface EditorStats {
  fps: number
  frameMs: number
  triangles: number
  drawCalls: number
  nodes: number
  geometryPending: number
  gpu: string
  backend: 'webgl2' | 'webgpu'
  quality: Exclude<Quality, 'auto'>
}

export interface EditorState {
  ready: boolean
  selection: string[]
  hover: string | null
  /** World bounds + size of the selection (drives the "120 MM" size labels and the properties panel). */
  selectionBounds: Bounds3 | null
  tool: ToolId
  toolOptions: Record<string, unknown>
  /** Status bar hint for the active tool step, e.g. "Click the wall's start point · Tab: type length" */
  toolHint: string
  toolInput: ToolInput | null
  gizmo: GizmoMode
  transformSpace: 'world' | 'local'
  layout: ViewLayout
  viewports: ViewportState[]
  activeViewport: number
  snapping: SnapSettings
  navigation: NavigationSettings
  gridVisible: boolean
  activeLevel: string | null
  /** Isolation mode: only these nodes are visible */
  isolated: string[] | null
  /** Group/component currently entered for editing (double-click) */
  editingContext: string | null
  cursorWorld: Vec3 | null
  measure: MeasureResult | null
  realistic: { active: boolean; samples: number; targetSamples: number }
  canUndo: boolean
  canRedo: boolean
  clipboard: boolean
  remoteUsers: RemoteUser[]
  /** Following another user's camera (clientId) */
  following: number | null
  stats: EditorStats
  theme: Theme
  readOnly: boolean
}

// ------------------------------------------------------------------ commands
export type CommandId =
  | 'edit.undo'
  | 'edit.redo'
  | 'edit.cut'
  | 'edit.copy'
  | 'edit.paste'
  | 'edit.pasteInPlace'
  | 'edit.duplicate'
  | 'edit.delete'
  | 'edit.selectAll'
  | 'edit.selectNone'
  | 'edit.selectInvert'
  | 'edit.selectSimilar'
  | 'object.group'
  | 'object.ungroup'
  | 'object.hide'
  | 'object.unhideAll'
  | 'object.isolate'
  | 'object.lock'
  | 'object.unlockAll'
  | 'object.makeComponent'
  | 'object.explode'
  | 'object.bake' // parametric → mesh
  | 'object.enter' // enter group/component editing
  | 'object.exit'
  | 'boolean.union'
  | 'boolean.subtract'
  | 'boolean.intersect'
  | 'transform.reset'
  | 'transform.mirrorX'
  | 'transform.mirrorY'
  | 'transform.mirrorZ'
  | 'transform.dropToFloor'
  | 'transform.rotate90'
  | 'align.minX'
  | 'align.centerX'
  | 'align.maxX'
  | 'align.minY'
  | 'align.centerY'
  | 'align.maxY'
  | 'align.minZ'
  | 'align.centerZ'
  | 'align.maxZ'
  | 'distribute.x'
  | 'distribute.y'
  | 'distribute.z'
  | 'gizmo.translate'
  | 'gizmo.rotate'
  | 'gizmo.scale'
  | 'gizmo.toggleSpace'
  | 'view.zoomExtents'
  | 'view.zoomSelection'
  | 'view.top'
  | 'view.bottom'
  | 'view.front'
  | 'view.back'
  | 'view.left'
  | 'view.right'
  | 'view.iso'
  | 'view.perspective'
  | 'view.toggleProjection'
  | 'view.layoutSingle'
  | 'view.layoutSplit'
  | 'view.layoutQuad'
  | 'view.toggleGrid'
  | 'view.toggleSnap'
  | 'view.toggleOrtho'
  | 'view.saveView'
  | 'render.shaded'
  | 'render.realistic'
  | 'render.clay'
  | 'render.wireframe'
  | 'render.xray'
  | 'render.hiddenLine'
  | 'render.technical'
  | 'level.up'
  | 'level.down'
  | 'tool.cancel'
  | 'tool.confirm'

export interface CommandInfo {
  id: CommandId
  label: string
  category: 'Edit' | 'Object' | 'Boolean' | 'Transform' | 'Align' | 'View' | 'Render' | 'Level' | 'Tool'
  /** Display form, platform-neutral: "Mod+D", "Shift+H", "Delete" (Mod = ⌘ on macOS, Ctrl elsewhere) */
  shortcut?: string
  /** lucide icon name hint for the UI */
  icon?: string
}

export interface CommandRegistry {
  list(): CommandInfo[]
  get(id: CommandId): CommandInfo | undefined
  canExecute(id: CommandId): boolean
  execute(id: CommandId, args?: unknown): void | Promise<void>
}

/** Default tool shortcuts (single keys, no modifiers). The UI binds them globally. */
export const TOOL_SHORTCUTS: Partial<Record<ToolId, string>> = {
  select: 'V',
  pan: 'H',
  'draw.line': 'L',
  'draw.polyline': 'P',
  'draw.rect': 'R',
  'draw.circle': 'C',
  'draw.arc': 'A',
  'draw.pen': 'N',
  'draw.text': 'T',
  'arch.wall': 'W',
  'arch.door': 'D',
  'arch.window': 'I',
  'arch.slab': 'F',
  'arch.room': 'O',
  'arch.stair': 'S',
  'measure.distance': 'M',
  'annotate.dimension': 'K',
  'modify.pushpull': 'U',
  'modify.offset': 'Shift+O',
  section: 'X',
}

// ------------------------------------------------------------------ events
export interface EditorEvents {
  /** Right click on canvas: UI shows its context menu. nodeId = picked node (already selected). */
  contextmenu: { clientX: number; clientY: number; nodeId: string | null }
  /** Double click on a node (UI may open inline rename or focus a property). */
  dblclick: { nodeId: string | null }
  /** User-facing message (UI shows a toast). */
  notify: { level: 'info' | 'success' | 'warning' | 'error'; message: string }
  /** A tool finished and created nodes. */
  created: { ids: string[]; tool: ToolId }
  /** Comment tool: user clicked a point to anchor a new comment. */
  commentRequest: { point: Vec3; nodeId: string | null; clientX: number; clientY: number }
}

export type Unsubscribe = () => void

// ------------------------------------------------------------------ editor
export interface Editor {
  readonly doc: CadDocument
  readonly geometry: GeometryService
  /** zustand vanilla store — use `useStore(editor.store, selector)` in React. */
  readonly store: StoreApi<EditorState>
  readonly commands: CommandRegistry

  getState(): EditorState
  on<K extends keyof EditorEvents>(event: K, listener: (e: EditorEvents[K]) => void): Unsubscribe

  // tools
  setTool(tool: ToolId, options?: Record<string, unknown>): void
  /** Submit the numeric input box (Enter). */
  submitToolInput(value: string): void
  cancel(): void

  // selection
  select(ids: string[], mode?: 'replace' | 'add' | 'toggle' | 'remove'): void
  setHover(id: string | null): void

  // view
  setLayout(layout: ViewLayout): void
  setViewPreset(preset: ViewPreset, viewport?: number): void
  setRenderMode(mode: RenderMode, viewport?: number): void
  setActiveViewport(index: number): void
  setActiveLevel(levelId: string | null): void
  setSnapping(patch: Partial<SnapSettings>): void
  /** Navigation preferences (device-level; the app persists them). */
  setNavigation(patch: Partial<NavigationSettings>): void
  /** Move the view cube (CSS px from the viewport's top-left) so UI chrome never covers it. */
  setViewCubeOffset(offset: { top: number; left: number }): void
  setGizmo(mode: GizmoMode): void
  setTheme(theme: Theme): void
  setQuality(q: Quality): void
  zoomToFit(ids?: string[], animate?: boolean): void
  getCamera(viewport?: number): CameraState
  setCamera(state: CameraState, animate?: boolean, viewport?: number): void
  follow(clientId: number | null): void
  isolate(ids: string[] | null): void

  // insertion & picking (drag-and-drop from library / files)
  /** Insert nodes/snapshot. `at` = drop position in client px (raycast onto objects/work plane) or world point. */
  insert(content: DocSnapshot | NewNode[], at?: { clientX: number; clientY: number } | { world: Vec3 }): Promise<string[]>
  /** Show a drop preview ghost while dragging over the canvas; null clears it. */
  dragPreview(content: DocSnapshot | NewNode[] | null, clientX?: number, clientY?: number): void
  pick(clientX: number, clientY: number): { nodeId: string | null; point: Vec3; normal: Vec3 | null } | null
  /** Client-pixel position of a world point in a viewport (comment pins, HTML anchors). null when the viewport does not exist. */
  project(world: Vec3, viewport?: number): { x: number; y: number; visible: boolean } | null

  // output
  /** PNG/WebP of a viewport (thumbnails, renders). Realistic mode renders progressively until `samples`. */
  screenshot(opts?: { width?: number; height?: number; viewport?: number; transparent?: boolean; mime?: 'image/png' | 'image/webp'; samples?: number }): Promise<Blob>
  /** Vector linework of a plan/section/elevation (for sheets, PDF/DXF/SVG export). */
  vectorize(source: SheetViewSource): Promise<Drawing2D & { bounds: { min: [number, number]; max: [number, number] } }>
  /** Raster image of a plan/section/elevation at a given pixel size (shaded sheet viewports). */
  renderView(source: SheetViewSource, opts: { width: number; height: number; style: 'shaded' | 'realistic' | 'hidden-line' }): Promise<Blob>
  startRealistic(targetSamples?: number): void
  stopRealistic(): void

  /** Nodes currently visible (after isolation/levels/layers) */
  visibleNodes(): AnyNode[]

  resize(): void
  dispose(): void
}

export type CreateEditor = (options: EditorOptions) => Editor

// ------------------------------------------------------------------ export helper (used by @cadsandbox/io)
/** Build a self-contained three.js Group of the (visible or selected) scene with world transforms
 *  and MeshPhysicalMaterials (procedural textures baked to canvases when `textures`). With `yUp`
 *  the group is rotated -90° about X for Y-up formats (glTF, USDZ, OBJ convention). */
export type BuildExportScene = (
  doc: CadDocument,
  geometry: GeometryService,
  assets: EditorAssets | AssetResolver,
  opts?: { selection?: string[]; textures?: boolean; yUp?: boolean; includeDrawings?: boolean },
) => Promise<import('three').Group>
