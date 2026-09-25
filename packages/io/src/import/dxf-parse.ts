// dxf-parser extensions: a HATCH entity handler (not supported upstream) and a LAYER/header table
// scanner for the fields dxf-parser drops (linetype, lineweight, plot flag, true color).
import type { IEntity } from 'dxf-parser'
import type { Vec2 } from '@cadsandbox/doc'

interface Group {
  code: number
  value: number | string | boolean
}
interface Scanner {
  next(): Group
  isEOF(): boolean
  lastReadGroup: Group
}

export type HatchEdge =
  | { type: 'line'; a: Vec2; b: Vec2 }
  | { type: 'arc'; c: Vec2; r: number; start: number; end: number; ccw: boolean }
  | { type: 'ellipse'; c: Vec2; major: Vec2; ratio: number; start: number; end: number; ccw: boolean }
  | { type: 'spline'; degree: number; knots: number[]; ctrl: Vec2[]; weights?: number[]; fit: Vec2[] }

export interface HatchLoop {
  flags: number
  polyline?: { points: Vec2[]; bulges: number[]; closed: boolean }
  edges?: HatchEdge[]
}

export interface IHatchEntity extends IEntity {
  patternName: string
  solid: boolean
  loops: HatchLoop[]
  patternAngle: number // degrees
  patternScale: number
  elevation: number
  extrusionZ: number
}

const num = (g: Group | undefined): number => (typeof g?.value === 'number' ? g.value : parseFloat(String(g?.value ?? 0)) || 0)

/** Registered with DxfParser.registerEntityHandler (dxf-parser has no HATCH support). */
export class HatchHandler {
  ForEntityName = 'HATCH'

  parseEntity(scanner: Scanner, curr: Group): IHatchEntity {
    const groups: Group[] = []
    let g = scanner.next()
    while (!scanner.isEOF() && g.code !== 0) {
      groups.push(g)
      g = scanner.next()
    }
    const e = { type: String(curr.value), loops: [] as HatchLoop[], patternName: 'SOLID', solid: false, patternAngle: 0, patternScale: 1, elevation: 0, extrusionZ: 1 } as unknown as IHatchEntity
    let i = 0
    const peek = () => groups[i]
    const take = () => groups[i++]
    const point = (): Vec2 => {
      const x = num(take())
      const y = peek() && (peek()!.code === 20 || peek()!.code === 21 || peek()!.code === 22 || peek()!.code === 23) ? num(take()) : 0
      return [x, y]
    }
    let inBoundary = false
    while (i < groups.length) {
      const cur = take()!
      switch (cur.code) {
        case 8:
          e.layer = String(cur.value)
          break
        case 62:
          e.colorIndex = num(cur)
          break
        case 420:
          e.color = num(cur)
          break
        case 370:
          e.lineweight = num(cur) as IEntity['lineweight']
          break
        case 5:
          e.handle = cur.value as unknown as number
          break
        case 67:
          e.inPaperSpace = num(cur) === 1
          break
        case 2:
          e.patternName = String(cur.value).trim()
          break
        case 70:
          e.solid = num(cur) === 1
          break
        case 30:
          e.elevation = num(cur)
          break
        case 230:
          e.extrusionZ = num(cur)
          break
        case 52:
          if (!inBoundary) e.patternAngle = num(cur)
          break
        case 41:
          if (!inBoundary) e.patternScale = num(cur) || 1
          break
        case 91: {
          inBoundary = true
          const count = num(cur)
          for (let k = 0; k < count && i < groups.length; k++) e.loops.push(this.loop(take, peek, point))
          inBoundary = false
          break
        }
      }
    }
    return e
  }

  private loop(take: () => Group | undefined, peek: () => Group | undefined, point: () => Vec2): HatchLoop {
    const flagG = take()
    const flags = num(flagG)
    const loop: HatchLoop = { flags }
    if (flags & 2) {
      let hasBulge = false,
        n = 0
      while (peek() && peek()!.code !== 10) {
        const g = take()!
        if (g.code === 72) hasBulge = num(g) === 1
        else if (g.code === 93) n = num(g) // 73 (closed) is ignored: hatch loops are always closed
      }
      const points: Vec2[] = [],
        bulges: number[] = []
      for (let k = 0; k < n && peek()?.code === 10; k++) {
        points.push(point())
        let bulge = 0
        if (hasBulge && peek()?.code === 42) bulge = num(take())
        bulges.push(bulge)
      }
      loop.polyline = { points, bulges, closed: true }
    } else {
      const g93 = take()
      const n = num(g93)
      const edges: HatchEdge[] = []
      for (let k = 0; k < n && peek()?.code === 72; k++) {
        const type = num(take())
        if (type === 1) {
          const a = point(),
            b = point()
          edges.push({ type: 'line', a, b })
        } else if (type === 2) {
          const c = point()
          const r = num(take()),
            s = num(take()),
            en = num(take())
          const ccw = peek()?.code === 73 ? num(take()) === 1 : true
          edges.push({ type: 'arc', c, r, start: (s * Math.PI) / 180, end: (en * Math.PI) / 180, ccw })
        } else if (type === 3) {
          const c = point(),
            major = point()
          const ratio = num(take()),
            s = num(take()),
            en = num(take())
          const ccw = peek()?.code === 73 ? num(take()) === 1 : true
          edges.push({ type: 'ellipse', c, major, ratio, start: (s * Math.PI) / 180, end: (en * Math.PI) / 180, ccw })
        } else if (type === 4) {
          let degree = 3,
            rational = false,
            nk = 0,
            nc = 0
          while (peek() && [94, 73, 74, 95, 96].includes(peek()!.code)) {
            const g = take()!
            if (g.code === 94) degree = num(g)
            else if (g.code === 73) rational = num(g) === 1
            else if (g.code === 95) nk = num(g)
            else if (g.code === 96) nc = num(g)
          }
          const knots: number[] = []
          for (let q = 0; q < nk && peek()?.code === 40; q++) knots.push(num(take()))
          const ctrl: Vec2[] = [],
            weights: number[] = []
          for (let q = 0; q < nc && peek()?.code === 10; q++) {
            ctrl.push(point())
            if (rational && peek()?.code === 42) weights.push(num(take()))
          }
          const fit: Vec2[] = []
          if (peek()?.code === 97) {
            const nf = num(take())
            for (let q = 0; q < nf && peek()?.code === 11; q++) fit.push(point())
          }
          while (peek() && (peek()!.code === 12 || peek()!.code === 13)) point()
          edges.push({ type: 'spline', degree, knots, ctrl, ...(rational ? { weights } : {}), fit })
        } else break
      }
      loop.edges = edges
    }
    // source boundary objects
    if (peek()?.code === 97) {
      const n = num(take())
      for (let k = 0; k < n && peek()?.code === 330; k++) take()
    }
    return loop
  }
}

export interface DxfLayerExtra {
  name: string
  lineType?: string
  lineWeight?: number // 1/100 mm, negative = default
  plot?: boolean
  trueColor?: number
  locked?: boolean
}

/** Scan the LAYER table for the fields dxf-parser does not keep. */
export function scanLayerTable(text: string): Map<string, DxfLayerExtra> {
  const out = new Map<string, DxfLayerExtra>()
  const start = text.search(/\n\s*2\s*\r?\n\s*LAYER\s*\r?\n/)
  if (start < 0) return out
  const end = text.indexOf('ENDTAB', start)
  const lines = text.slice(start, end > 0 ? end : undefined).split(/\r?\n/)
  let cur: DxfLayerExtra | null = null
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i]!.trim(), 10)
    const value = lines[i + 1]!.trim()
    if (Number.isNaN(code)) {
      i-- // resync on odd line breaks
      continue
    }
    if (code === 0) {
      if (cur?.name) out.set(cur.name, cur)
      cur = value === 'LAYER' ? { name: '' } : null
      continue
    }
    if (!cur) continue
    if (code === 2) cur.name = value
    else if (code === 6) cur.lineType = value
    else if (code === 370) cur.lineWeight = parseInt(value, 10)
    else if (code === 290) cur.plot = value !== '0'
    else if (code === 420) cur.trueColor = parseInt(value, 10)
    else if (code === 70) cur.locked = (parseInt(value, 10) & 4) === 4
  }
  if (cur?.name) out.set(cur.name, cur)
  return out
}
