// annotate.grid — structural grid axes (Achsraster). Single: two clicks (or length<angle) → one
// 'gridline' with an automatic label (letters A, B, C… for vertical-ish axes, numbers 1, 2, 3… for
// horizontal ones). Rectangular: one click sets the lower-left origin of a countX × countY grid.
import type { GridlineParams, NewNode, Vec2, Vec3 } from '@cadsandbox/doc'
import { makeNode } from '@cadsandbox/doc'
import { evaluateNodeSync } from '@cadsandbox/geometry'
import type { ToolOptionSpec } from '../types'
import { ChainTool } from '../util/chain'
import { LAYERS, boolOption, lengthOption, newNode, numberOption, selectOption } from '../util/nodes'
import { fromPlane, toPlane, v2 } from '../util/vec'

const MODES = ['single', 'rect'] as const
const BUBBLES: GridlineParams['bubble'][] = ['start', 'end', 'both', 'none']

export const GRID_OPTIONS: ToolOptionSpec[] = [
  selectOption('mode', 'Mode', 'single', [
    { value: 'single', label: 'Single axis' },
    { value: 'rect', label: 'Rectangular grid' },
  ]),
  selectOption('bubble', 'Bubbles', 'start', BUBBLES),
  numberOption('countX', 'Axes A, B, C… (along X)', 4, 1, 50),
  lengthOption('spacingX', 'Spacing A–B', 5, 0.01),
  numberOption('countY', 'Axes 1, 2, 3… (along Y)', 3, 1, 50),
  lengthOption('spacingY', 'Spacing 1–2', 4, 0.01),
  lengthOption('overhang', 'Overhang past the grid', 1, 0),
  boolOption('autoLabel', 'Automatic labels', true),
]

/** 0 → A … 25 → Z, 26 → AA, 27 → AB … */
export function letterLabel(index: number): string {
  let n = Math.max(0, Math.floor(index))
  let s = ''
  do {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return s
}

/** Next free label of a kind given the labels already used on the level. */
export function nextGridLabel(existing: readonly string[], kind: 'letter' | 'number'): string {
  const used = new Set(existing.map((l) => l.trim().toUpperCase()))
  if (kind === 'number') {
    let n = 1
    while (used.has(String(n))) n++
    return String(n)
  }
  let i = 0
  while (used.has(letterLabel(i))) i++
  return letterLabel(i)
}

export class GridTool extends ChainTool {
  readonly id = 'annotate.grid' as const
  override readonly specs = GRID_OPTIONS

  protected override start(): void {
    this.allowClose = false
    this.minPoints = 1
    super.start()
  }
  private mode(): (typeof MODES)[number] {
    return this.optStr('mode', 'single', MODES)
  }
  private bubble(): GridlineParams['bubble'] {
    return this.optStr<GridlineParams['bubble']>('bubble', 'start', BUBBLES)
  }
  protected override firstHint(): string {
    return this.mode() === 'rect' ? 'Grid: click the origin (lower-left corner) · A, B, C… along X · 1, 2, 3… along Y' : 'Grid axis: click the start point'
  }
  protected override nextHint(): string {
    return 'Click the end point · type length or length<angle · Esc cancel'
  }
  protected override optionsChanged(): void {
    this.reset()
  }

  protected override pointAdded(): void {
    if (this.mode() === 'rect' || this.points.length >= 2) this.finishChain(false)
  }

  /** Labels already used by grid lines under the same parent. */
  private usedLabels(): string[] {
    const parent = this.parent()
    return this.ctx.doc
      .nodesOfType('gridline')
      .filter((n) => n.parent === parent)
      .map((n) => n.params.label)
  }

  private labelFor(a: Vec2, b: Vec2, used: string[]): string {
    const d = v2.sub(b, a)
    return nextGridLabel(used, Math.abs(d[0]) < Math.abs(d[1]) ? 'letter' : 'number')
  }

  /** Lines of a rectangular grid in plane space: [a, b, label][]. */
  private rectLines(origin: Vec2): { a: Vec2; b: Vec2; label: string }[] {
    const nx = Math.max(1, Math.round(this.optNum('countX', 4)))
    const ny = Math.max(1, Math.round(this.optNum('countY', 3)))
    const sx = Math.max(0.01, this.optNum('spacingX', 5))
    const sy = Math.max(0.01, this.optNum('spacingY', 4))
    const over = Math.max(0, this.optNum('overhang', 1))
    const w = (nx - 1) * sx
    const h = (ny - 1) * sy
    const out: { a: Vec2; b: Vec2; label: string }[] = []
    for (let i = 0; i < nx; i++) {
      const x = origin[0] + i * sx
      out.push({ a: [x, origin[1] - over], b: [x, origin[1] + h + over], label: letterLabel(i) })
    }
    for (let j = 0; j < ny; j++) {
      const y = origin[1] + j * sy
      out.push({ a: [origin[0] - over, y], b: [origin[0] + w + over, y], label: String(j + 1) })
    }
    return out
  }

  private previewLine(a: Vec2, b: Vec2, label: string): void {
    const plane = this.plane()
    const node = makeNode({ type: 'gridline', params: { a, b, label, bubble: this.bubble() } })
    const res = evaluateNodeSync(node)
    if (res?.drawing) this.drawing(res.drawing, plane)
    else this.lines([fromPlane(plane, a), fromPlane(plane, b)], { style: 'rubber' })
  }

  protected override drawChain(points: Vec3[], cursor: Vec3 | null): void {
    const plane = this.plane()
    if (this.mode() === 'rect') {
      const o = cursor ?? points[0]
      if (!o) return
      const lines = this.rectLines(toPlane(plane, o))
      // cheap preview: axes as rubber lines, bubbles only on the first of each direction
      for (const [i, l] of lines.entries()) {
        if (i === 0 || i === Math.max(1, Math.round(this.optNum('countX', 4)))) this.previewLine(l.a, l.b, l.label)
        else this.lines([fromPlane(plane, l.a), fromPlane(plane, l.b)], { style: 'rubber' })
      }
      return
    }
    const a = points[0]
    const b = cursor ?? points[1]
    if (!a || !b) return
    const ua = toPlane(plane, a), ub = toPlane(plane, b)
    if (v2.dist(ua, ub) < 1e-6) return
    const label = this.optBool('autoLabel', true) ? this.labelFor(ua, ub, this.usedLabels()) : '?'
    this.previewLine(ua, ub, label)
    this.distanceLabel(a, b)
  }

  protected commitChain(points: Vec3[]): void {
    const parent = this.parent()
    const plane = this.plane()
    const bubble = this.bubble()
    const nodes: NewNode<'gridline'>[] = []
    if (this.mode() === 'rect') {
      const o = points[0]
      if (!o) return
      for (const l of this.rectLines(toPlane(plane, o))) {
        nodes.push(newNode('gridline', { a: this.toLocal2(fromPlane(plane, l.a), parent), b: this.toLocal2(fromPlane(plane, l.b), parent), label: l.label, bubble }, { parent, layer: LAYERS.anno, name: `Axis ${l.label}` }))
      }
    } else {
      const [a, b] = points
      if (!a || !b || v2.dist(toPlane(plane, a), toPlane(plane, b)) < 1e-6) return
      const label = this.optBool('autoLabel', true) ? this.labelFor(toPlane(plane, a), toPlane(plane, b), this.usedLabels()) : '?'
      nodes.push(newNode('gridline', { a: this.toLocal2(a, parent), b: this.toLocal2(b, parent), label, bubble }, { parent, layer: LAYERS.anno, name: `Axis ${label}` }))
    }
    if (nodes.length) this.commitNodes(nodes)
  }
}
