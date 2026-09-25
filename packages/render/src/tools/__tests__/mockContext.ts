// Reusable mock ToolContext backed by a real CadDocument. Records hints/inputs/previews/events,
// snaps by intersecting the pointer ray with the work plane and picks geometrically (walls, 2D
// entities, solids footprints) unless a pick result was queued with `queuePick`.
import { OrthographicCamera } from 'three'
import type * as THREE from 'three'
import { createStore } from 'zustand/vanilla'
import {
  CadDocument,
  invertMatrix,
  transformPoint,
  type AnyNode,
  type NewNode,
  type NodeBase,
  type UnitsSettings,
  type Vec3,
} from '@cadsandbox/doc'
import type { Drawing2D, GeometryResult, GeometryService } from '@cadsandbox/geometry'
import { formatLength, parseAngle, parseLength } from '@cadsandbox/shared'
import type { Editor, EditorEvents, EditorState, ToolId, ToolInput } from '../../api'
import type { LevelInfo, OverlayLayer, PickResult, PreviewLayer, SnapQuery, SnapResult, Tool, ToolContext, ToolPointerEvent, WorkPlane } from '../types'
import { entityOutline, nearestCurve } from '../util/scene'
import { intersectRayPlane, planeAtZ, v3 } from '../util/vec'
import { pointInPolygon } from '../util/polygon'
import { pointInWall, wallOffsetOf } from '../util/walls'

export class RecordingPreview implements PreviewLayer {
  private seq = 0
  readonly nodes = new Map<string, AnyNode>()
  readonly lineSets = new Map<string, { points: Vec3[]; opts?: Record<string, unknown> }>()
  readonly polygons = new Map<string, Vec3[]>()
  readonly markers = new Map<string, Vec3>()
  readonly drawings = new Map<string, Drawing2D>()
  calls = 0
  private next(prefix: string) {
    this.calls++
    return `${prefix}-${++this.seq}`
  }
  node(node: AnyNode, _opts?: { opacity?: number; parentMatrix?: THREE.Matrix4 }): string {
    const h = this.next('node')
    this.nodes.set(h, node)
    return h
  }
  updateNode(handle: string, node: AnyNode): void {
    this.nodes.set(handle, node)
  }
  lines(points: Vec3[], opts?: Record<string, unknown>): string {
    const h = this.next('lines')
    this.lineSets.set(h, { points, opts })
    return h
  }
  drawing(d: Drawing2D): string {
    const h = this.next('drawing')
    this.drawings.set(h, d)
    return h
  }
  polygon(points: Vec3[]): string {
    const h = this.next('polygon')
    this.polygons.set(h, points)
    return h
  }
  marker(point: Vec3): string {
    const h = this.next('marker')
    this.markers.set(h, point)
    return h
  }
  remove(handle: string): void {
    this.nodes.delete(handle)
    this.lineSets.delete(handle)
    this.polygons.delete(handle)
    this.markers.delete(handle)
    this.drawings.delete(handle)
  }
  clear(): void {
    this.nodes.clear()
    this.lineSets.clear()
    this.polygons.clear()
    this.markers.clear()
    this.drawings.clear()
  }
  get count(): number {
    return this.nodes.size + this.lineSets.size + this.polygons.size + this.markers.size + this.drawings.size
  }
}

export class RecordingOverlay implements OverlayLayer {
  private seq = 0
  readonly labels = new Map<string, { world: Vec3; text: string }>()
  promptResponses: (string | null)[] = []
  prompts: { world: Vec3; initial: string }[] = []
  label(world: Vec3, text: string): string {
    const h = `label-${++this.seq}`
    this.labels.set(h, { world, text })
    return h
  }
  updateLabel(handle: string, world: Vec3, text: string): void {
    this.labels.set(handle, { world, text })
  }
  prompt(world: Vec3, initial: string): Promise<string | null> {
    this.prompts.push({ world, initial })
    return Promise.resolve(this.promptResponses.length ? this.promptResponses.shift()! : initial)
  }
  remove(handle: string): void {
    this.labels.delete(handle)
  }
  clear(): void {
    this.labels.clear()
  }
  texts(): string[] {
    return [...this.labels.values()].map((l) => l.text)
  }
}

export class MockGeometry implements GeometryService {
  getComponentGeometry(): [] {
    return []
  }
  keyOf(): undefined {
    return undefined
  }
  readonly results = new Map<string, GeometryResult>()
  readonly stats = { pending: 0, evaluated: 0, cacheSize: 0, lastEvalMs: 0 }
  get(nodeId: string): GeometryResult | undefined {
    return this.results.get(nodeId)
  }
  onUpdate(): () => void {
    return () => {}
  }
  isConsumed(): boolean {
    return false
  }
  invalidate(): void {}
  idle(): Promise<void> {
    return Promise.resolve()
  }
  preview(): Promise<GeometryResult> {
    return Promise.resolve({ parts: [], bounds: { min: [0, 0, 0], max: [0, 0, 0] } })
  }
  previewSync(): GeometryResult | null {
    return null
  }
  worldBounds(): null {
    return null
  }
  dispose(): void {}
}

function initialState(activeLevel: string | null): EditorState {
  return {
    ready: true,
    selection: [],
    hover: null,
    selectionBounds: null,
    tool: 'select',
    toolOptions: {},
    toolHint: '',
    toolInput: null,
    gizmo: 'translate',
    transformSpace: 'world',
    layout: 'single',
    viewports: [],
    activeViewport: 0,
    snapping: {
      enabled: true,
      grid: true,
      endpoint: true,
      midpoint: true,
      center: true,
      intersection: true,
      perpendicular: true,
      parallel: true,
      nearest: true,
      extension: true,
      angle: true,
      angleStepDeg: 15,
      ortho: false,
      radiusPx: 10,
    },
    navigation: { trackpadGestures: false },
    gridVisible: true,
    activeLevel,
    isolated: null,
    editingContext: null,
    cursorWorld: null,
    measure: null,
    realistic: { active: false, samples: 0, targetSamples: 0 },
    canUndo: false,
    canRedo: false,
    clipboard: false,
    remoteUsers: [],
    following: null,
    stats: { fps: 0, frameMs: 0, triangles: 0, drawCalls: 0, nodes: 0, geometryPending: 0, gpu: '', backend: 'webgl2', quality: 'medium' },
    theme: 'dark',
    readOnly: false,
  }
}

export class MockContext implements ToolContext {
  readonly doc: CadDocument
  readonly editor: Editor
  readonly geometry = new MockGeometry()
  readonly preview = new RecordingPreview()
  readonly overlay = new RecordingOverlay()
  readonly hints: string[] = []
  readonly inputs: (ToolInput | null)[] = []
  readonly notifications: { level: string; message: string }[] = []
  readonly events: { event: string; payload: unknown }[] = []
  readonly toolSwitches: { tool: ToolId; options?: Record<string, unknown> }[] = []
  readonly pickQueue: (PickResult | null)[] = []
  snapOverride: ((e: ToolPointerEvent, q?: SnapQuery) => SnapResult | null) | null = null
  planView = true
  wpp = 0.01
  cursor = 'default'
  renders = 0

  constructor(doc = CadDocument.create('test', { withLevel: true })) {
    this.doc = doc
    const store = createStore<EditorState>(() => initialState(doc.meta.activeLevel))
    const listeners = new Map<string, Set<(e: unknown) => void>>()
    const self = this
    const editor: Partial<Editor> = {
      doc,
      geometry: this.geometry,
      store,
      getState: () => store.getState(),
      on(event, listener) {
        let set = listeners.get(event)
        if (!set) listeners.set(event, (set = new Set()))
        set.add(listener as (e: unknown) => void)
        return () => set!.delete(listener as (e: unknown) => void)
      },
      setTool(tool, options) {
        self.toolSwitches.push({ tool, options })
        store.setState({ tool })
      },
      select(ids) {
        store.setState({ selection: [...ids] })
      },
      cancel() {},
      submitToolInput() {},
    }
    this.editor = editor as Editor
  }

  get levelId(): string | null {
    return this.doc.meta.activeLevel
  }

  select(ids: string[]): void {
    this.editor.store.setState({ selection: ids })
  }

  queuePick(result: PickResult | null): void {
    this.pickQueue.push(result)
  }

  workPlane(): WorkPlane {
    const lvl = this.activeLevel()
    return planeAtZ(lvl?.elevation ?? 0, lvl?.id ?? null)
  }

  snap(e: ToolPointerEvent, query?: SnapQuery): SnapResult {
    const o = this.snapOverride?.(e, query)
    if (o) return o
    const plane = query?.plane ?? this.workPlane()
    const hit = intersectRayPlane(e.ray.origin, e.ray.direction, plane) ?? plane.origin
    return { point: hit, kind: 'free', nodeId: null, normal: null, guide: null, raw: hit }
  }

  pick(e: ToolPointerEvent, filter?: (n: AnyNode) => boolean): PickResult | null {
    if (this.pickQueue.length) {
      const r = this.pickQueue.shift()!
      if (!r) return null
      const n = this.doc.getNode(r.nodeId) as AnyNode | undefined
      return n && filter && !filter(n) ? null : r
    }
    return this.geometricPick(e, filter)
  }

  private geometricPick(e: ToolPointerEvent, filter?: (n: AnyNode) => boolean): PickResult | null {
    const plane = this.workPlane()
    const world = intersectRayPlane(e.ray.origin, e.ray.direction, plane)
    if (!world) return null
    const tol = this.wpp * 8
    let curveHit: PickResult | null = null
    for (const n of this.doc.allNodes()) {
      if (n.type === 'level' || n.type === 'group' || !this.doc.isEffectivelyVisible(n.id)) continue
      if (filter && !filter(n)) continue
      const local = this.toLocal(n.parent, world)
      const p2: [number, number] = [local[0], local[1]]
      if (n.type === 'wall') {
        if (!pointInWall(n.params, p2)) continue
        const off = wallOffsetOf(n.params, p2)
        const top: Vec3 = [world[0], world[1], plane.origin[2] + n.params.baseOffset + n.params.height]
        return { nodeId: n.id, point: top, normal: [0, 0, 1], wallOffset: off.offset, wallSide: off.side, face: { normal: [0, 0, 1], point: top } }
      }
      if (n.type === 'primitive' || n.type === 'column' || n.type === 'furniture' || n.type === 'shape') {
        const w = (n.params as { width?: number; radius?: number }).width ?? ((n.params as { radius?: number }).radius ?? 0.5) * 2
        const d = (n.params as { depth?: number; height?: number }).depth ?? w
        const dx = p2[0] - n.t.p[0],
          dy = p2[1] - n.t.p[1]
        if (Math.abs(dx) <= w / 2 && Math.abs(dy) <= d / 2) {
          const h = n.type === 'shape' ? n.params.depth : ((n.params as { height?: number }).height ?? 1)
          const top: Vec3 = [world[0], world[1], plane.origin[2] + n.t.p[2] + h]
          return { nodeId: n.id, point: top, normal: [0, 0, 1], face: { normal: [0, 0, 1], point: top } }
        }
        continue
      }
      if (n.type === 'slab' || n.type === 'room' || n.type === 'hatch') {
        const outline = entityOutline(n)
        if (outline && pointInPolygon(p2, outline)) {
          const top: Vec3 = [world[0], world[1], plane.origin[2] + (n.type === 'slab' ? n.params.offset : 0)]
          return { nodeId: n.id, point: top, normal: [0, 0, 1], face: { normal: [0, 0, 1], point: top } }
        }
        continue
      }
      if (!curveHit) {
        const hit = nearestCurve([n], p2, tol)
        if (hit) curveHit = { nodeId: n.id, point: this.toWorld(n.parent, [hit.point[0], hit.point[1], 0]), normal: null }
      }
    }
    return curveHit
  }

  rayPlane(e: ToolPointerEvent, plane: WorkPlane): Vec3 | null {
    return intersectRayPlane(e.ray.origin, e.ray.direction, plane)
  }

  activeLevel(): LevelInfo | null {
    const id = this.doc.meta.activeLevel
    const lvl = id ? this.doc.getNode<'level'>(id) : undefined
    if (!lvl) return null
    return { id: lvl.id, name: lvl.name, elevation: lvl.t.p[2], height: lvl.params.height, cutHeight: lvl.params.cutHeight }
  }

  units(): UnitsSettings {
    return this.doc.meta.units
  }
  formatLength(meters: number): string {
    const u = this.units()
    return formatLength(meters, u.length, u.precision)
  }
  parseLength(text: string): number | null {
    return parseLength(text, this.units().length)
  }
  parseAngle(text: string): number | null {
    return parseAngle(text)
  }

  setHint(text: string): void {
    this.hints.push(text)
    this.editor.store.setState({ toolHint: text })
  }
  setInput(input: ToolInput | null): void {
    this.inputs.push(input)
    this.editor.store.setState({ toolInput: input })
  }
  setCursor(css: string): void {
    this.cursor = css
  }
  notify(level: EditorEvents['notify']['level'], message: string): void {
    this.notifications.push({ level, message })
  }
  emit<K extends keyof EditorEvents>(event: K, payload: EditorEvents[K]): void {
    this.events.push({ event, payload })
  }

  commitNodes(nodes: NewNode[], opts?: { select?: boolean }): string[] {
    const parent = this.defaultParent()
    const ids = this.doc.transact(() => this.doc.addNodes(nodes.map((n) => (n.parent === undefined ? { ...n, parent } : n))))
    if (opts?.select !== false) this.editor.store.setState({ selection: ids })
    return ids
  }
  commit<R>(fn: () => R): R {
    return this.doc.transact(fn)
  }
  defaultParent(): string | null {
    return this.doc.meta.activeLevel
  }
  toLocal(parent: string | null, world: Vec3): Vec3 {
    return transformPoint(invertMatrix(this.doc.getWorldMatrix(parent)), world)
  }
  toWorld(parent: string | null, local: Vec3): Vec3 {
    return transformPoint(this.doc.getWorldMatrix(parent), local)
  }
  result(nodeId: string): GeometryResult | undefined {
    return this.geometry.get(nodeId)
  }
  node<T extends AnyNode['type']>(id: string): NodeBase<T> | undefined {
    return this.doc.getNode<T>(id)
  }
  setTool(tool: ToolId, options?: Record<string, unknown>): void {
    this.toolSwitches.push({ tool, options })
  }
  requestRender(): void {
    this.renders++
  }
  isPlanView(): boolean {
    return this.planView
  }
  camera(): THREE.Camera {
    const cam = new OrthographicCamera(-10, 10, 10, -10, 0.1, 1000)
    cam.position.set(0, 0, 100)
    cam.up.set(0, 1, 0)
    cam.lookAt(0, 0, 0)
    return cam
  }
  worldPerPixel(): number {
    return this.wpp
  }

  // ---- convenience for tests
  nodesOfType<T extends AnyNode['type']>(type: T): NodeBase<T>[] {
    return this.doc.nodesOfType(type)
  }
  lastHint(): string {
    return this.hints[this.hints.length - 1] ?? ''
  }
  lastInput(): ToolInput | null {
    return this.inputs[this.inputs.length - 1] ?? null
  }
  created(): string[] {
    return this.events.filter((e) => e.event === 'created').flatMap((e) => (e.payload as { ids: string[] }).ids)
  }
}

// ------------------------------------------------------------------ pointer helpers
export function ptr(x: number, y: number, opts: Partial<ToolPointerEvent> = {}): ToolPointerEvent {
  const native = { preventDefault() {}, stopPropagation() {} } as unknown as PointerEvent
  return {
    clientX: x * 100,
    clientY: -y * 100,
    ndc: [0, 0],
    button: 0,
    buttons: 1,
    shift: false,
    alt: false,
    mod: false,
    viewport: 0,
    ray: { origin: [x, y, 100], direction: [0, 0, -1] },
    pointerType: 'mouse',
    native,
    ...opts,
  }
}

export function move(tool: Tool, x: number, y: number, opts: Partial<ToolPointerEvent> = {}): void {
  tool.onPointerMove?.(ptr(x, y, { buttons: 0, ...opts }))
}

export function click(tool: Tool, x: number, y: number, opts: Partial<ToolPointerEvent> = {}): void {
  move(tool, x, y, opts)
  const e = ptr(x, y, opts)
  tool.onPointerDown?.(e)
  tool.onPointerUp?.(ptr(x, y, { ...opts, buttons: 0 }))
}

export function drag(tool: Tool, from: [number, number], to: [number, number], steps = 3): void {
  move(tool, from[0], from[1])
  tool.onPointerDown?.(ptr(from[0], from[1]))
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    tool.onPointerMove?.(ptr(from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, { buttons: 1 }))
  }
  tool.onPointerUp?.(ptr(to[0], to[1], { buttons: 0 }))
}

export function key(tool: Tool, k: string, extra: Partial<KeyboardEvent> = {}): boolean | void {
  const e = { key: k, code: k, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, preventDefault() {}, ...extra } as unknown as KeyboardEvent
  return tool.onKeyDown?.(e)
}

export function dblclick(tool: Tool, x: number, y: number): void {
  tool.onDoubleClick?.(ptr(x, y))
}

/** Add a rectangular room of 4 walls (centerline rectangle) to the doc; returns wall ids. */
export function addWallLoop(ctx: MockContext, x0: number, y0: number, x1: number, y1: number, thickness = 0.24): string[] {
  const parent = ctx.defaultParent()
  const corners: [number, number][] = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ]
  return ctx.doc.addNodes(
    corners.map((c, i) => ({
      type: 'wall' as const,
      parent,
      layer: 'layer-walls',
      params: { a: c, b: corners[(i + 1) % 4], thickness, height: 2.75, baseOffset: 0, justification: 'center' as const },
    })),
  )
}

export function activate(tool: Tool, ctx: MockContext, options: Record<string, unknown> = {}): Tool {
  tool.activate(ctx, options)
  return tool
}
