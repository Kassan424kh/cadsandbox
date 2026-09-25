// section — plan view: 2 clicks define the section line, a 3rd click picks the look direction;
// 3D: click a face → plane on the face. Labels auto-increment (A, B, C…). Creates a root-level
// 'section' node whose local +Z is the plane normal (the +normal side is clipped) and whose local
// X runs along the section line (meta.extent.length keeps the line length for sheet views).
import type { NewNode, Quat, Vec3 } from '@cadsandbox/doc'
import type { ToolOptionSpec, ToolPointerEvent } from '../types'
import { ToolBase, isPrimary } from '../util/base'
import { planeQuat } from '../util/frame'
import { parseVcb } from '../util/input'
import { boolOption, lengthOption } from '../util/nodes'
import { fromPlane, toPlane, v2, v3 } from '../util/vec'

export const SECTION_OPTIONS: ToolOptionSpec[] = [lengthOption('depth', 'View depth (0 = unlimited)', 0), boolOption('showCaps', 'Show cut caps', true)]

/** Next free section label: A…Z, then AA, AB… */
export function nextSectionLabel(existing: Iterable<string>): string {
  const used = new Set([...existing].map((s) => s.toUpperCase()))
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  for (const l of letters) if (!used.has(l)) return l
  for (const a of letters) for (const b of letters) if (!used.has(a + b)) return a + b
  return `S${used.size + 1}`
}

/** Quaternion with local X = `along`, local Z = `normal` (both unit, perpendicular). */
export function sectionQuat(along: Vec3, normal: Vec3): Quat {
  const v = v3.norm(v3.cross(normal, along))
  return planeQuat({ origin: [0, 0, 0], u: along, v, normal, levelId: null })
}

export class SectionTool extends ToolBase {
  readonly id = 'section' as const
  override readonly specs = SECTION_OPTIONS
  private pts: Vec3[] = []

  protected override start(): void {
    this.pts = []
    this.hint(this.ctx.isPlanView() ? 'Section: click the start of the section line' : 'Section: click a face to place the section plane on it')
  }
  protected isBusy(): boolean {
    return this.pts.length > 0
  }
  protected reset(): void {
    this.pts = []
    this.clearAll()
    this.clearInput()
    this.hint(this.ctx.isPlanView() ? 'Section: click the start of the section line' : 'Section: click a face to place the section plane on it')
  }

  private nextLabel(): string {
    return nextSectionLabel(this.ctx.doc.nodesOfType('section').map((s) => s.params.label))
  }

  onPointerDown(e: ToolPointerEvent): boolean {
    if (!isPrimary(e)) return false
    if (!this.ctx.isPlanView() && this.pts.length === 0) {
      const hit = this.ctx.pick(e)
      if (hit && (hit.face?.normal ?? hit.normal)) {
        const n = v3.norm(hit.face?.normal ?? hit.normal!)
        const along = Math.abs(n[2]) > 0.9 ? ([1, 0, 0] as Vec3) : v3.norm(v3.cross([0, 0, 1], n))
        this.createSection(hit.face?.point ?? hit.point, n, along, null)
        return true
      }
    }
    const s = this.snap(e, this.pts[this.pts.length - 1] ?? null)
    this.pts.push(s.point)
    if (this.pts.length === 1) this.hint('Click the end of the section line · type length<angle')
    else if (this.pts.length === 2) this.hint('Click on the side the section looks toward')
    else this.finishFromLine(s.point)
    this.clearAll()
    return true
  }

  onPointerMove(e: ToolPointerEvent): void {
    this.clearAll()
    const s = this.snap(e, this.pts[this.pts.length - 1] ?? null)
    if (this.pts.length === 1) {
      this.lines([this.pts[0], s.point], { style: 'rubber' })
      this.distanceLabel(this.pts[0], s.point)
      this.input('Length', this.fmt(v3.dist(this.pts[0], s.point)))
    } else if (this.pts.length === 2) this.drawLine(this.pts[0], this.pts[1], this.lookDir(s.point))
  }

  onInput(text: string): void {
    if (this.pts.length !== 1) return void this.ctx.notify('info', 'Click the start point first')
    const v = parseVcb(text, this.ctx)
    if (!v || v.kind === 'length') return void this.ctx.notify('info', 'Type the line as length<angle or dx;dy')
    const plane = this.plane()
    const a = toPlane(plane, this.pts[0])
    const b = v.kind === 'delta' ? v2.add(a, [v.dx, v.dy]) : v2.add(a, v2.fromAngle(v.angle, v.length))
    this.pts.push(fromPlane(plane, b))
    this.hint('Click on the side the section looks toward')
  }

  /** Unit look direction (in the plane) toward `p` from the section line. */
  private lookDir(p: Vec3): Vec3 {
    const [a, b] = this.pts
    const plane = this.plane()
    const ua = toPlane(plane, a),
      ub = toPlane(plane, b),
      up = toPlane(plane, p)
    const dir = v2.norm(v2.sub(ub, ua))
    const n = v2.perp(dir)
    const side = v2.dot(v2.sub(up, ua), n) >= 0 ? 1 : -1
    const look = v2.scale(n, side)
    const w = fromPlane(plane, v2.add(ua, look))
    return v3.norm(v3.sub(w, fromPlane(plane, ua)))
  }

  private drawLine(a: Vec3, b: Vec3, look: Vec3): void {
    this.lines([a, b], { style: 'cut' })
    const mid = v3.mid(a, b)
    const L = v3.dist(a, b)
    const arrow = Math.max(0.3, L * 0.08)
    for (const p of [a, b]) {
      const tip = v3.add(p, v3.scale(look, arrow))
      this.lines([p, tip], { style: 'symbol' })
    }
    this.lines([mid, v3.add(mid, v3.scale(look, arrow * 1.5))], { style: 'symbol' })
    this.label(v3.add(a, v3.scale(look, arrow * 1.6)), this.nextLabel(), 'dimension')
  }

  private finishFromLine(sidePoint: Vec3): void {
    const [a, b] = this.pts
    if (v3.dist(a, b) < 1e-6) return this.reset()
    const look = this.lookDir(sidePoint)
    // Everything on the +normal side is clipped → the normal points away from the view direction.
    const normal = v3.scale(look, -1)
    const along = v3.norm(v3.sub(b, a))
    this.createSection(v3.mid(a, b), normal, along, v3.dist(a, b))
  }

  private createSection(position: Vec3, normal: Vec3, along: Vec3, length: number | null): void {
    this.clearAll()
    this.clearInput()
    this.pts = []
    const label = this.nextLabel()
    const node: NewNode<'section'> = {
      type: 'section',
      parent: null,
      name: `Section ${label}`,
      t: { p: [...position] as Vec3, r: sectionQuat(along, normal), s: [1, 1, 1] },
      params: { enabled: true, showCaps: this.optBool('showCaps', true), label, depth: Math.max(0, this.optNum('depth', 0)) },
      meta: length !== null ? { extent: { length, height: this.ctx.activeLevel()?.height ?? 3 } } : {},
    }
    const id = this.ctx.commit(() => this.ctx.doc.addNode(node))
    this.ctx.editor.select([id])
    this.ctx.emit('created', { ids: [id], tool: this.id })
    this.ctx.requestRender()
    this.ctx.notify('success', `Section ${label} created`)
    this.ctx.setTool('select')
  }
}
