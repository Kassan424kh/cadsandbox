// arch.door / arch.window / arch.opening — hover a wall → ghost sliding along it (5 cm steps) with
// distance labels to the wall ends and neighbouring openings; click → child 'opening' of the wall.
// Tab flips the hinge side, Space flips the opening direction, typed value = distance from the
// nearer wall end to the opening edge.
import type { DoorStyle, NodeBase, OpeningParams, Vec2, Vec3, WindowStyle } from '@cadsandbox/doc'
import { WINDOW_DEFAULTS, OPENING_DEFAULTS, DEFAULT_PARAMS } from '@cadsandbox/doc'
import type { ToolId } from '../../api'
import type { ToolOptionSpec, ToolPointerEvent } from '../types'
import { ToolBase, isPrimary } from '../util/base'
import { LAYERS, lengthOption, newNode, selectOption } from '../util/nodes'
import { clamp, roundTo, v2 } from '../util/vec'
import { pointOnWall, wallAxis, wallOffsetOf, wallSideOffsets, type WallNode } from '../util/walls'

export type OpeningKind = OpeningParams['kind']

export const DOOR_STYLES: DoorStyle[] = ['single', 'double', 'sliding', 'double-sliding', 'folding', 'pocket', 'garage', 'revolving']
export const WINDOW_STYLES: WindowStyle[] = ['casement', 'double-casement', 'fixed', 'sliding', 'tilt-turn', 'awning', 'hung', 'bay', 'skylight']

export function openingOptions(kind: OpeningKind): ToolOptionSpec[] {
  const d = kind === 'window' ? { ...DEFAULT_PARAMS.opening, ...WINDOW_DEFAULTS } : kind === 'opening' ? { ...DEFAULT_PARAMS.opening, ...OPENING_DEFAULTS } : DEFAULT_PARAMS.opening
  const specs: ToolOptionSpec[] = []
  if (kind === 'door') specs.push(selectOption('style', 'Style', 'single', DOOR_STYLES))
  if (kind === 'window') specs.push(selectOption('style', 'Style', 'casement', WINDOW_STYLES))
  specs.push(lengthOption('width', 'Width', d.width, 0.1), lengthOption('height', 'Height', d.height, 0.1))
  if (kind !== 'door') specs.push(lengthOption('sill', 'Sill height', d.sill))
  if (kind === 'door') specs.push(selectOption('hinge', 'Hinge (Tab)', 'left', ['left', 'right']))
  specs.push(lengthOption('snapStep', 'Position step', 0.05))
  return specs
}

interface Hover {
  wall: WallNode
  offset: number
  side: 'left' | 'right'
}

export class OpeningTool extends ToolBase {
  readonly id: ToolId
  override readonly specs: ToolOptionSpec[]
  private hover: Hover | null = null
  private hingeFlipped = false
  private opensFlipped = false

  constructor(private readonly kind: OpeningKind) {
    super()
    this.id = kind === 'door' ? 'arch.door' : kind === 'window' ? 'arch.window' : 'arch.opening'
    this.specs = openingOptions(kind)
  }

  protected override start(): void {
    this.hover = null
    this.hint(`${this.title()}: hover a wall, click to place · Tab flips the hinge · Space flips the opening side · type the distance from the wall end`)
  }
  protected isBusy(): boolean {
    return false
  }
  protected reset(): void {
    this.hover = null
    this.clearAll()
  }
  private title(): string {
    return this.kind === 'door' ? 'Door' : this.kind === 'window' ? 'Window' : 'Opening'
  }

  private width(): number {
    return Math.max(0.1, this.optNum('width', this.kind === 'door' ? 0.885 : 1))
  }

  /** Snap the opening center so its nearer edge sits on the position grid, and keep it inside the wall. */
  private snapOffset(wall: WallNode, offset: number): number {
    const L = wallAxis(wall.params).length
    const w = this.width()
    const step = Math.max(0, this.optNum('snapStep', 0.05))
    const half = w / 2
    let o: number
    if (offset <= L / 2) o = roundTo(offset - half, step) + half
    else o = L - (roundTo(L - offset - half, step) + half)
    return clamp(o, Math.min(half, L / 2), Math.max(L - half, L / 2))
  }

  private hoverAt(e: ToolPointerEvent): Hover | null {
    const hit = this.ctx.pick(e, (n) => n.type === 'wall')
    if (!hit) return null
    const wall = this.ctx.node<'wall'>(hit.nodeId) as WallNode | undefined
    if (!wall || wall.type !== 'wall') return null
    let offset = hit.wallOffset
    let side = hit.wallSide
    if (offset === undefined || side === undefined) {
      const local = this.ctx.toLocal(wall.parent, hit.point)
      const r = wallOffsetOf(wall.params, [local[0], local[1]])
      offset = r.offset
      side = r.side
    }
    return { wall, offset: this.snapOffset(wall, offset), side }
  }

  private hinge(): 'left' | 'right' {
    const base = this.optStr('hinge', 'left', ['left', 'right'])
    return this.hingeFlipped ? (base === 'left' ? 'right' : 'left') : base
  }
  private opensTo(h: Hover): 'left' | 'right' {
    return this.opensFlipped ? (h.side === 'left' ? 'right' : 'left') : h.side
  }

  onPointerMove(e: ToolPointerEvent): void {
    this.clearAll()
    this.hover = this.hoverAt(e)
    if (!this.hover) {
      this.clearInput()
      this.ctx.setCursor('not-allowed')
      return
    }
    this.ctx.setCursor('crosshair')
    this.drawGhost(this.hover)
  }

  onPointerDown(e: ToolPointerEvent): boolean {
    if (!isPrimary(e)) return false
    const h = this.hoverAt(e) ?? this.hover
    if (!h) {
      this.ctx.notify('info', 'Hover a wall to place the opening')
      return true
    }
    this.place(h)
    return true
  }

  onInput(text: string): void {
    const h = this.hover
    if (!h) return void this.ctx.notify('info', 'Hover a wall first, then type the distance from its end')
    const d = this.ctx.parseLength(text)
    if (d === null) return void this.ctx.notify('warning', `Cannot read "${text}"`)
    const L = wallAxis(h.wall.params).length
    const half = this.width() / 2
    const fromStart = h.offset <= L / 2
    const offset = clamp(fromStart ? d + half : L - d - half, half, L - half)
    this.place({ ...h, offset })
  }

  protected override onKey(key: string, e: KeyboardEvent): boolean {
    if (key === 'Tab') {
      e.preventDefault?.()
      this.hingeFlipped = !this.hingeFlipped
    } else if (key === ' ' || key === 'Spacebar') {
      e.preventDefault?.()
      this.opensFlipped = !this.opensFlipped
    } else return false
    if (this.hover) {
      this.clearAll()
      this.drawGhost(this.hover)
    }
    return true
  }

  private params(h: Hover): Partial<OpeningParams> {
    const p: Partial<OpeningParams> = {
      kind: this.kind,
      offset: h.offset,
      width: this.width(),
      height: Math.max(0.1, this.optNum('height', this.kind === 'door' ? 2.01 : this.kind === 'window' ? 1.26 : 2.1)),
      sill: this.kind === 'door' ? 0 : Math.max(0, this.optNum('sill', this.kind === 'window' ? 0.9 : 0)),
      hinge: this.hinge(),
      opensTo: this.opensTo(h),
    }
    if (this.kind === 'door') p.style = this.optStr<DoorStyle>('style', 'single', DOOR_STYLES)
    else if (this.kind === 'window') p.style = this.optStr<WindowStyle>('style', 'casement', WINDOW_STYLES)
    else p.style = 'none'
    return p
  }

  private place(h: Hover): void {
    this.clearAll()
    this.commitNodes([newNode('opening', this.params(h), { parent: h.wall.id, layer: LAYERS.openings, name: this.title() })])
    this.hover = null
  }

  // ---- ghost + labels (drawn in the wall's parent frame → world)
  private drawGhost(h: Hover): void {
    const wall = h.wall
    const wp = wall.params
    const ax = wallAxis(wp)
    const { left, right } = wallSideOffsets(wp)
    const w = this.width()
    const z = wp.baseOffset
    const W = (p: Vec2, dz = 0): Vec3 => this.ctx.toWorld(wall.parent, [p[0], p[1], z + dz])
    const o0 = h.offset - w / 2,
      o1 = h.offset + w / 2
    const corners = [pointOnWall(wp, o0, -right), pointOnWall(wp, o1, -right), pointOnWall(wp, o1, left), pointOnWall(wp, o0, left)]
    this.polygon(corners.map((c) => W(c)), { opacity: 0.35 })
    this.lines(corners.map((c) => W(c)), { closed: true, style: 'symbol' })
    if (this.kind === 'door') {
      const opensTo = this.opensTo(h)
      // Hinge 'left' = the b-side jamb when seen from the wall's left side.
      const hingeAtB = this.hinge() === 'left'
      const hingeOff = hingeAtB ? o1 : o0
      const lateral = opensTo === 'left' ? left : -right
      const hingePt = pointOnWall(wp, hingeOff, lateral)
      const closedDir = v2.scale(ax.dir, hingeAtB ? -1 : 1)
      const openDir = v2.scale(ax.normal, opensTo === 'left' ? 1 : -1)
      const a0 = v2.angle(closedDir)
      let a1 = v2.angle(openDir)
      while (a1 - a0 > Math.PI) a1 -= Math.PI * 2
      while (a1 - a0 < -Math.PI) a1 += Math.PI * 2
      const arc: Vec3[] = []
      const steps = 12
      for (let i = 0; i <= steps; i++) arc.push(W(v2.add(hingePt, v2.fromAngle(a0 + ((a1 - a0) * i) / steps, w))))
      this.lines([W(hingePt), W(v2.add(hingePt, v2.scale(openDir, w)))], { style: 'symbol' })
      this.lines(arc, { style: 'symbol', dashed: true })
    } else if (this.kind === 'window') {
      const mid = (left - right) / 2
      this.lines([W(pointOnWall(wp, o0, mid)), W(pointOnWall(wp, o1, mid))], { style: 'symbol' })
    }
    // Distance labels: to the wall ends and to the nearest openings on each side.
    const siblings = this.ctx.doc
      .getChildren(wall.id)
      .map((id) => this.ctx.node<'opening'>(id))
      .filter((n): n is NodeBase<'opening'> => !!n && n.type === 'opening')
    let prevEdge = 0
    let nextEdge = ax.length
    for (const s of siblings) {
      const e0 = s.params.offset - s.params.width / 2
      const e1 = s.params.offset + s.params.width / 2
      if (e1 <= o0 + 1e-9) prevEdge = Math.max(prevEdge, e1)
      if (e0 >= o1 - 1e-9) nextEdge = Math.min(nextEdge, e0)
    }
    const labelZ = 0.02
    if (o0 - prevEdge > 1e-6) this.label(W(pointOnWall(wp, (prevEdge + o0) / 2, left + 0.05), labelZ), this.fmt(o0 - prevEdge), 'dimension')
    if (nextEdge - o1 > 1e-6) this.label(W(pointOnWall(wp, (o1 + nextEdge) / 2, left + 0.05), labelZ), this.fmt(nextEdge - o1), 'dimension')
    this.label(W(pointOnWall(wp, h.offset, -right - 0.05), labelZ), `${this.title()} ${this.fmt(w)} · ${this.hinge()} hinge · opens ${this.opensTo(h)}`, 'hint')
    const fromStart = h.offset <= ax.length / 2
    this.input('From end', this.fmt(fromStart ? o0 : ax.length - o1), fromStart ? 'from wall start' : 'from wall end')
    this.hint(`Click to place the ${this.title().toLowerCase()} · Tab hinge · Space swing side · type distance from the ${fromStart ? 'start' : 'end'} of the wall`)
  }
}
