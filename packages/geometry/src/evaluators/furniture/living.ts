// Living / bedroom / office furniture builders.
import type { FurnitureKind } from '@cadsandbox/doc'
import type { DrawingBuilder } from '../../core/drawing'
import { TAU } from '../../core/math2d'
import { MeshBuilder } from '../../core/mesh'
import { PartSet, addBox, addCylinderBetween, addCylinderZ, addSphere } from '../../core/solids'
import type { FurnitureBuilder, FurnitureSpec } from './index'

const outline = (d: DrawingBuilder, s: FurnitureSpec, style: 'thin' | 'symbol' = 'thin') => d.rect(style, -s.w / 2, -s.d, s.w / 2, 0)

function legs(mb: MeshBuilder, s: FurnitureSpec, inset: number, r: number, z1: number, round = true): void {
  for (const [sx, sy] of [[-1, 0], [1, 0], [-1, -1], [1, -1]] as const) {
    const x = sx * (s.w / 2 - inset), y = sy === 0 ? -inset : -s.d + inset
    if (round) addCylinderZ(mb, x, y, r, 0, z1, 8)
    else addBox(mb, x - r, y - r, 0, x + r, y + r, z1)
  }
}

const sofa: FurnitureBuilder = (parts, s, d) => {
  const body = parts.get(s.primary)
  const frame = parts.get(s.secondary)
  const seatH = Math.min(0.42, s.h * 0.5)
  const arm = Math.min(0.2, s.w * 0.12)
  const back = Math.min(0.22, s.d * 0.3)
  legs(frame, s, 0.08, 0.02, 0.1)
  addBox(body, -s.w / 2, -s.d, 0.1, s.w / 2, 0, seatH - 0.08) // base
  // seat cushions
  const n = Math.max(1, Math.round((s.w - 2 * arm) / 0.75))
  const cw = (s.w - 2 * arm) / n
  for (let i = 0; i < n; i++) {
    const x0 = -s.w / 2 + arm + i * cw
    addBox(body, x0 + 0.01, -s.d + 0.03, seatH - 0.08, x0 + cw - 0.01, -back - 0.02, seatH)
    addBox(body, x0 + 0.01, -back, seatH, x0 + cw - 0.01, -0.02, s.h - 0.02) // back cushions
  }
  addBox(body, -s.w / 2, -s.d + 0.02, 0.1, -s.w / 2 + arm, 0, seatH + 0.2)
  addBox(body, s.w / 2 - arm, -s.d + 0.02, 0.1, s.w / 2, 0, seatH + 0.2)
  addBox(body, -s.w / 2, -back, 0.1, s.w / 2, 0, s.h)
  outline(d, s)
  d.seg('thin', -s.w / 2, -back, s.w / 2, -back)
  d.seg('thin', -s.w / 2 + arm, -s.d, -s.w / 2 + arm, -back)
  d.seg('thin', s.w / 2 - arm, -s.d, s.w / 2 - arm, -back)
  for (let i = 1; i < n; i++) d.seg('thin', -s.w / 2 + arm + i * cw, -s.d, -s.w / 2 + arm + i * cw, -back)
}

const armchair: FurnitureBuilder = (parts, s, d) => sofa(parts, { ...s, w: Math.max(0.6, s.w) }, d)

const chair: FurnitureBuilder = (parts, s, d) => {
  const seat = parts.get(s.primary)
  const frame = parts.get(s.secondary)
  const seatH = Math.min(0.46, s.h * 0.55)
  legs(frame, s, 0.03, 0.015, seatH - 0.03)
  addBox(seat, -s.w / 2, -s.d, seatH - 0.03, s.w / 2, 0, seatH)
  addBox(seat, -s.w / 2 + 0.02, -0.03, seatH, s.w / 2 - 0.02, 0, s.h) // back
  outline(d, s)
  d.seg('thin', -s.w / 2, -0.04, s.w / 2, -0.04)
}

const stool: FurnitureBuilder = (parts, s, d) => {
  const seat = parts.get(s.primary)
  const frame = parts.get(s.secondary)
  const r = Math.min(s.w, s.d) / 2
  addCylinderZ(frame, 0, -s.d / 2, 0.02, 0, s.h - 0.04, 12)
  addCylinderZ(frame, 0, -s.d / 2, r * 0.7, 0, 0.02, 24)
  addCylinderZ(seat, 0, -s.d / 2, r, s.h - 0.04, s.h, 24)
  d.circle('thin', [0, -s.d / 2], r)
}

const table = (legInset: number, topT: number): FurnitureBuilder => (parts, s, d) => {
  const top = parts.get(s.primary)
  const frame = parts.get(s.secondary)
  addBox(top, -s.w / 2, -s.d, s.h - topT, s.w / 2, 0, s.h)
  legs(frame, s, legInset, 0.03, s.h - topT, false)
  outline(d, s)
}

const desk: FurnitureBuilder = (parts, s, d) => {
  table(0.04, 0.03)(parts, s, d)
  // drawer block on the right
  const blockW = Math.min(0.45, s.w * 0.35)
  addBox(parts.get(s.primary), s.w / 2 - blockW, -s.d + 0.05, 0.1, s.w / 2 - 0.02, -0.02, s.h - 0.03)
  d.seg('thin', s.w / 2 - blockW, -s.d, s.w / 2 - blockW, 0)
}

const bed = (double: boolean): FurnitureBuilder => (parts, s, d) => {
  const mattress = parts.get(s.primary)
  const frame = parts.get(s.secondary)
  const frameH = Math.min(0.25, s.h * 0.5)
  addBox(frame, -s.w / 2, -s.d, 0.05, s.w / 2, 0, frameH)
  addBox(frame, -s.w / 2, -0.05, 0, s.w / 2, 0, s.h + 0.4) // headboard
  addBox(mattress, -s.w / 2 + 0.03, -s.d + 0.03, frameH, s.w / 2 - 0.03, -0.05, s.h)
  const pillows = double ? 2 : 1
  const pw = (s.w - 0.2) / pillows
  for (let i = 0; i < pillows; i++) {
    const x0 = -s.w / 2 + 0.1 + i * pw
    addBox(mattress, x0 + 0.05, -0.55, s.h, x0 + pw - 0.05, -0.12, s.h + 0.1)
    d.rect('thin', x0 + 0.05, -0.55, x0 + pw - 0.05, -0.12)
  }
  outline(d, s)
  d.rect('thin', -s.w / 2 + 0.03, -s.d + 0.03, s.w / 2 - 0.03, -0.05)
  // duvet fold line
  d.seg('thin', -s.w / 2 + 0.03, -0.7, s.w / 2 - 0.03, -0.7)
}

const cabinet = (doors: number, drawers = 0, plinth = 0.08): FurnitureBuilder => (parts, s, d) => {
  const body = parts.get(s.primary)
  const trim = parts.get(s.secondary)
  addBox(trim, -s.w / 2 + 0.02, -s.d + 0.03, 0, s.w / 2 - 0.02, 0, plinth)
  addBox(body, -s.w / 2, -s.d, plinth, s.w / 2, 0, s.h)
  // door / drawer joints as thin recessed grooves (small boxes slightly in front)
  const gap = 0.004
  if (drawers > 0) {
    const dh = (s.h - plinth) / drawers
    for (let i = 0; i < drawers; i++) {
      const z0 = plinth + i * dh
      addBox(trim, -s.w / 2 + 0.05, -s.d - 0.01, z0 + dh / 2 - 0.01, s.w / 2 - 0.05, -s.d, z0 + dh / 2 + 0.01) // handle bar
      void gap
    }
  } else {
    const dw = s.w / Math.max(1, doors)
    for (let i = 1; i < doors; i++) addBox(trim, -s.w / 2 + i * dw - gap, -s.d - 0.002, plinth, -s.w / 2 + i * dw + gap, -s.d + 0.01, s.h)
    for (let i = 0; i < doors; i++) {
      const hx = -s.w / 2 + (i + 1) * dw - 0.06 * (i === doors - 1 && doors > 1 ? -1 : 1)
      addCylinderBetween(trim, [hx, -s.d - 0.02, s.h * 0.5 - 0.06], [hx, -s.d - 0.02, s.h * 0.5 + 0.06], 0.006, 8)
    }
  }
  outline(d, s)
}

const wardrobe: FurnitureBuilder = (parts, s, d) => {
  cabinet(Math.max(1, Math.round(s.w / 0.5)))(parts, s, d)
  // plan: diagonal cross + hanger rail
  d.seg('thin', -s.w / 2, -s.d, s.w / 2, 0)
  d.seg('thin', -s.w / 2, 0, s.w / 2, -s.d)
}

const shelf: FurnitureBuilder = (parts, s, d) => {
  const body = parts.get(s.primary)
  const t = 0.025
  addBox(body, -s.w / 2, -s.d, 0, -s.w / 2 + t, 0, s.h)
  addBox(body, s.w / 2 - t, -s.d, 0, s.w / 2, 0, s.h)
  addBox(body, -s.w / 2, -t, 0, s.w / 2, 0, s.h) // back panel
  const n = Math.max(2, Math.round(s.h / 0.35))
  for (let i = 0; i <= n; i++) {
    const z = Math.min(s.h - t, (s.h * i) / n)
    addBox(body, -s.w / 2 + t, -s.d, z, s.w / 2 - t, 0, z + t)
  }
  outline(d, s)
  d.seg('thin', -s.w / 2, -s.d, s.w / 2, 0)
}

const dresser: FurnitureBuilder = (parts, s, d) => cabinet(0, Math.max(2, Math.round(s.h / 0.25)))(parts, s, d)

const tvUnit: FurnitureBuilder = (parts, s, d) => {
  cabinet(0, 1, 0.05)(parts, s, d)
  const tv = parts.get(s.secondary)
  const tvW = Math.min(s.w * 0.8, 1.4), tvH = tvW * 0.56
  addBox(tv, -tvW / 2, -0.15, s.h + 0.05, tvW / 2, -0.12, s.h + 0.05 + tvH)
  addBox(tv, -0.15, -0.2, s.h, 0.15, -0.1, s.h + 0.05)
  d.rect('thin', -tvW / 2, -0.15, tvW / 2, -0.12)
}

const rug: FurnitureBuilder = (parts, s, d) => {
  addBox(parts.get(s.primary), -s.w / 2, -s.d, 0, s.w / 2, 0, Math.max(0.005, s.h))
  outline(d, s)
  d.rect('thin', -s.w / 2 + 0.08, -s.d + 0.08, s.w / 2 - 0.08, -0.08)
}

const piano: FurnitureBuilder = (parts, s, d) => {
  const body = parts.get(s.primary)
  const keys = parts.get('mat-white-matte')
  const keyD = Math.min(0.3, s.d * 0.5)
  addBox(body, -s.w / 2, -s.d + keyD, 0, s.w / 2, 0, s.h) // upright body
  addBox(body, -s.w / 2, -s.d, 0.6, s.w / 2, -s.d + keyD, 0.68) // key bed
  addBox(keys, -s.w / 2 + 0.06, -s.d + 0.02, 0.68, s.w / 2 - 0.06, -s.d + keyD - 0.02, 0.7)
  for (const x of [-s.w / 2 + 0.03, s.w / 2 - 0.08]) addBox(body, x, -s.d, 0, x + 0.05, -s.d + keyD, 0.6)
  outline(d, s)
  d.rect('thin', -s.w / 2 + 0.06, -s.d + 0.02, s.w / 2 - 0.06, -s.d + keyD - 0.02)
}

const lampFloor: FurnitureBuilder = (parts, s, d) => {
  const base = parts.get(s.primary)
  const shade = parts.get(s.secondary, { castShadow: false })
  const cx = 0, cy = -s.d / 2
  addCylinderZ(base, cx, cy, Math.min(s.w, s.d) * 0.4, 0, 0.02, 24)
  addCylinderZ(base, cx, cy, 0.012, 0.02, s.h - 0.3, 10)
  const mb = new MeshBuilder(64)
  addCylinderBetween(mb, [cx, cy, s.h - 0.3], [cx, cy, s.h], s.w * 0.5, 24, s.w * 0.35)
  shade.append(mb.build())
  d.circle('thin', [cx, cy], s.w / 2)
  d.seg('symbol', cx - s.w / 2, cy, cx + s.w / 2, cy)
  d.seg('symbol', cx, cy - s.w / 2, cx, cy + s.w / 2)
}

const lampPendant: FurnitureBuilder = (parts, s, d) => {
  const cord = parts.get(s.primary)
  const shade = parts.get(s.secondary, { castShadow: false })
  const cx = 0, cy = -s.d / 2
  const hang = Math.max(0.05, s.h - 0.25)
  addCylinderZ(cord, cx, cy, 0.004, s.h - 0.25, s.h + hang, 6)
  const mb = new MeshBuilder(64)
  addCylinderBetween(mb, [cx, cy, s.h - 0.25], [cx, cy, s.h], s.w * 0.5, 24, s.w * 0.15)
  shade.append(mb.build())
  d.circle('symbol', [cx, cy], s.w / 2)
  d.seg('symbol', cx - s.w * 0.7, cy, cx + s.w * 0.7, cy)
  d.seg('symbol', cx, cy - s.w * 0.7, cx, cy + s.w * 0.7)
}

const nightstand: FurnitureBuilder = (parts, s, d) => {
  cabinet(0, 1, 0.05)(parts, s, d)
  addSphere(parts.get(s.secondary), [0, -s.d / 2, s.h + 0.12], 0.1, 10)
  d.circle('thin', [0, -s.d / 2], 0.1)
}

export const LIVING: Partial<Record<FurnitureKind, FurnitureBuilder>> & { sofa: FurnitureBuilder } = {
  sofa,
  armchair,
  chair,
  stool,
  'dining-table': table(0.06, 0.04),
  'coffee-table': table(0.04, 0.03),
  desk,
  'bed-single': bed(false),
  'bed-double': bed(true),
  nightstand,
  wardrobe,
  shelf,
  dresser,
  'tv-unit': tvUnit,
  rug,
  piano,
  'lamp-floor': lampFloor,
  'lamp-pendant': lampPendant,
}

export { TAU }
