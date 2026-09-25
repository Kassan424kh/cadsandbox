// Opening plan symbols (in the opening frame): door leaves + swing arcs, window frames/sashes/sills.
import type { DoorStyle, Vec2, WindowStyle } from '@cadsandbox/doc'
import type { Drawing2D } from '../../api'
import { DrawingBuilder } from '../../core/drawing'
import type { OpeningFrame } from './index'

/** Thin rectangle outline (leaf) from p along dir with length len and thickness th. */
function leafRect(d: DrawingBuilder, p: Vec2, dir: Vec2, len: number, th: number): void {
  const n: Vec2 = [-dir[1], dir[0]]
  const a: Vec2 = [p[0] - (n[0] * th) / 2, p[1] - (n[1] * th) / 2]
  const b: Vec2 = [a[0] + dir[0] * len, a[1] + dir[1] * len]
  const c: Vec2 = [b[0] + n[0] * th, b[1] + n[1] * th]
  const e: Vec2 = [a[0] + n[0] * th, a[1] + n[1] * th]
  d.polyline('symbol', [a, b, c, e], true)
}

function arrow(d: DrawingBuilder, from: Vec2, to: Vec2): void {
  d.segP('symbol', from, to)
  const dx = to[0] - from[0], dy = to[1] - from[1]
  const l = Math.hypot(dx, dy) || 1
  const ux = dx / l, uy = dy / l
  const s = 0.08
  d.seg('symbol', to[0], to[1], to[0] - ux * s - uy * s * 0.5, to[1] - uy * s + ux * s * 0.5)
  d.seg('symbol', to[0], to[1], to[0] - ux * s + uy * s * 0.5, to[1] - uy * s - ux * s * 0.5)
}

function doorPlan(d: DrawingBuilder, f: OpeningFrame): void {
  const style = f.p.style as DoorStyle
  const half = f.t / 2
  const yFace = f.swing * half
  const x0 = -f.w / 2, x1 = f.w / 2
  // frame jambs
  if (f.fw > 0) {
    d.rect('thin', x0, -f.fd / 2, x0 + f.fw, f.fd / 2)
    d.rect('thin', x1 - f.fw, -f.fd / 2, x1, f.fd / 2)
  }
  const inner = f.w - 2 * f.fw
  const hinge: Vec2 = [f.hingeX > 0 ? x1 - f.fw : x0 + f.fw, yFace]
  const towardOther = f.hingeX > 0 ? -1 : 1
  const swing = (h: Vec2, len: number, dirX: number) => {
    leafRect(d, h, [0, f.swing], len, 0.04)
    // quarter arc from the leaf tip to the opposite jamb
    const a0 = f.swing > 0 ? Math.PI / 2 : -Math.PI / 2
    const a1 = dirX > 0 ? 0 : Math.PI
    let sweep = a1 - a0
    while (sweep > Math.PI) sweep -= 2 * Math.PI
    while (sweep < -Math.PI) sweep += 2 * Math.PI
    d.arc('symbol', h, len, a0, sweep)
  }
  switch (style) {
    case 'single':
      swing(hinge, inner, towardOther)
      break
    case 'double':
      swing([x0 + f.fw, yFace], inner / 2, 1)
      swing([x1 - f.fw, yFace], inner / 2, -1)
      break
    case 'sliding': {
      const y = yFace + f.swing * 0.05
      leafRect(d, [hinge[0], y], [towardOther, 0], inner, 0.04)
      arrow(d, [hinge[0] + towardOther * inner * 0.35, y + f.swing * 0.12], [hinge[0] - towardOther * inner * 0.15, y + f.swing * 0.12])
      break
    }
    case 'double-sliding': {
      const y = yFace + f.swing * 0.05
      leafRect(d, [0, y], [-1, 0], inner / 2, 0.04)
      leafRect(d, [0, y + f.swing * 0.05], [1, 0], inner / 2, 0.04)
      arrow(d, [-0.1, y + f.swing * 0.16], [-inner * 0.4, y + f.swing * 0.16])
      arrow(d, [0.1, y + f.swing * 0.16], [inner * 0.4, y + f.swing * 0.16])
      break
    }
    case 'folding': {
      const n = f.w > 1.4 ? 4 : 2
      const pw = inner / n
      const pts: Vec2[] = [hinge]
      let x = hinge[0]
      for (let i = 0; i < n; i++) {
        x += towardOther * pw * 0.55
        const zig = i % 2 === 0 ? pw * 0.83 : 0
        pts.push([x, yFace + f.swing * zig])
      }
      d.polyline('symbol', pts, false)
      break
    }
    case 'pocket': {
      // leaf slides into the wall pocket beyond the hinge jamb: dashed pocket outline + arrow
      const px0 = hinge[0], px1 = hinge[0] - towardOther * inner
      d.rect('hidden', Math.min(px0, px1), -0.03, Math.max(px0, px1), 0.03)
      leafRect(d, [hinge[0] - towardOther * 0.15, 0], [towardOther, 0], inner - 0.15, 0.04)
      arrow(d, [hinge[0] + towardOther * inner * 0.3, yFace + f.swing * 0.12], [hinge[0] - towardOther * 0.1, yFace + f.swing * 0.12])
      break
    }
    case 'garage': {
      const depth = Math.min(f.h, 2.6)
      const y1 = yFace + f.swing * depth
      d.rect('overhead', x0, Math.min(yFace, y1), x1, Math.max(yFace, y1))
      d.seg('symbol', x0, yFace, x1, yFace)
      break
    }
    case 'revolving': {
      const r = f.w / 2
      d.circle('symbol', [0, 0], r)
      for (let k = 0; k < 4; k++) {
        const a = Math.PI / 4 + (k * Math.PI) / 2
        d.seg('symbol', 0, 0, Math.cos(a) * (r - 0.03), Math.sin(a) * (r - 0.03))
      }
      d.arc('thin', [0, 0], r - 0.01, Math.PI * 0.2, Math.PI * 0.6)
      d.arc('thin', [0, 0], r - 0.01, Math.PI * 1.2, Math.PI * 0.6)
      break
    }
  }
}

function windowPlan(d: DrawingBuilder, f: OpeningFrame): void {
  const style = f.p.style as WindowStyle
  const x0 = -f.w / 2, x1 = f.w / 2
  const fd = f.fd
  const ext = -f.swing
  // frame outline and jamb blocks
  d.rect('thin', x0, -fd / 2, x1, fd / 2)
  if (f.fw > 0) {
    d.seg('thin', x0 + f.fw, -fd / 2, x0 + f.fw, fd / 2)
    d.seg('thin', x1 - f.fw, -fd / 2, x1 - f.fw, fd / 2)
  }
  const inX0 = x0 + f.fw, inX1 = x1 - f.fw
  switch (style) {
    case 'double-casement':
      d.seg('symbol', inX0, 0, inX1, 0)
      d.rect('thin', -f.fw / 2, -fd / 2, f.fw / 2, fd / 2)
      break
    case 'sliding': {
      const mid = (inX0 + inX1) / 2
      d.seg('symbol', inX0, -fd / 4, mid + 0.02, -fd / 4)
      d.seg('symbol', mid - 0.02, fd / 4, inX1, fd / 4)
      break
    }
    case 'bay': {
      const proj = Math.min(0.45, f.w * 0.35)
      const cw = f.w * 0.5
      const yOut = ext * (f.t / 2 + proj)
      const pts: Vec2[] = [[x0, ext * (f.t / 2)], [-cw / 2, yOut], [cw / 2, yOut], [x1, ext * (f.t / 2)]]
      d.polyline('thin', pts, false)
      const inner: Vec2[] = [[x0 + 0.02, ext * (f.t / 2 - 0.0)], [-cw / 2 + 0.02, yOut - ext * 0.05], [cw / 2 - 0.02, yOut - ext * 0.05], [x1 - 0.02, ext * (f.t / 2)]]
      d.polyline('symbol', inner, false)
      break
    }
    default:
      d.seg('symbol', inX0, 0, inX1, 0)
      if (style === 'hung' || style === 'awning' || style === 'tilt-turn') d.seg('thin', inX0, fd * 0.15, inX1, fd * 0.15)
  }
  // exterior sill
  const sillY = ext * (f.t / 2 + 0.04)
  d.seg('thin', x0 - 0.03, sillY, x1 + 0.03, sillY)
  d.seg('thin', x0 - 0.03, ext * (f.t / 2), x0 - 0.03, sillY)
  d.seg('thin', x1 + 0.03, ext * (f.t / 2), x1 + 0.03, sillY)
}

export function buildOpeningPlan(f: OpeningFrame): Drawing2D {
  const d = new DrawingBuilder()
  const cut = f.cutZ
  if (cut <= 0) {
    // opening entirely above the cut plane → dashed overhead outline
    d.rect('overhead', -f.w / 2, -f.t / 2, f.w / 2, f.t / 2)
    return d.build()
  }
  if (cut >= f.h) {
    d.rect('hidden', -f.w / 2, -f.t / 2, f.w / 2, f.t / 2)
    return d.build()
  }
  if (f.p.kind === 'door') doorPlan(d, f)
  else if (f.p.kind === 'window') windowPlan(d, f)
  else if (f.h < f.wallTop - 1e-6) d.rect('overhead', -f.w / 2, -f.t / 2, f.w / 2, f.t / 2) // lintel above a plain opening
  return d.build()
}
