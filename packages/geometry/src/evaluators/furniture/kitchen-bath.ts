// Kitchen and bathroom fixtures.
import type { FurnitureKind, Vec2, Vec3 } from '@cadsandbox/doc'
import type { DrawingBuilder } from '../../core/drawing'
import { TAU } from '../../core/math2d'
import { MeshBuilder } from '../../core/mesh'
import { PartSet, addBox, addCylinderBetween, addCylinderZ, addSphere } from '../../core/solids'
import type { FurnitureBuilder, FurnitureSpec } from './index'

const outline = (d: DrawingBuilder, s: FurnitureSpec) => d.rect('thin', -s.w / 2, -s.d, s.w / 2, 0)

/** Rounded-rectangle ring in plan (for tubs/basins). */
function roundedRect(x0: number, y0: number, x1: number, y1: number, r: number, seg = 5): Vec2[] {
  const pts: Vec2[] = []
  const rr = Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2)
  const corners: [number, number, number][] = [[x1 - rr, y0 + rr, -Math.PI / 2], [x1 - rr, y1 - rr, 0], [x0 + rr, y1 - rr, Math.PI / 2], [x0 + rr, y0 + rr, Math.PI]]
  for (const [cx, cy, a0] of corners) for (let k = 0; k <= seg; k++) pts.push([cx + Math.cos(a0 + (Math.PI / 2) * (k / seg)) * rr, cy + Math.sin(a0 + (Math.PI / 2) * (k / seg)) * rr])
  return pts
}

/** Extrude a plan ring between z0 and z1 into a builder (flat top/bottom, vertical sides). */
function ringPrism(mb: MeshBuilder, ring: Vec2[], z0: number, z1: number): void {
  const top: Vec3[] = ring.map((q) => [q[0], q[1], z1])
  const bot: Vec3[] = ring.map((q) => [q[0], q[1], z0])
  mb.face(top, [], [0, 0, 1])
  mb.face(bot, [], [0, 0, -1])
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!
    mb.quadFace([a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1])
  }
}

const baseCabinet = (withTop: boolean): FurnitureBuilder => (parts, s, d) => {
  const body = parts.get(s.primary)
  const top = parts.get(s.secondary)
  const plinth = 0.1
  const topT = withTop ? 0.04 : 0
  addBox(parts.get('mat-black-matte'), -s.w / 2 + 0.02, -s.d + 0.05, 0, s.w / 2 - 0.02, 0, plinth)
  addBox(body, -s.w / 2, -s.d + 0.02, plinth, s.w / 2, 0, s.h - topT)
  if (withTop) addBox(top, -s.w / 2, -s.d, s.h - topT, s.w / 2, 0, s.h)
  const n = Math.max(1, Math.round(s.w / 0.6))
  const dw = s.w / n
  for (let i = 1; i < n; i++) addBox(parts.get('mat-black-matte'), -s.w / 2 + i * dw - 0.003, -s.d + 0.017, plinth, -s.w / 2 + i * dw + 0.003, -s.d + 0.03, s.h - topT)
  for (let i = 0; i < n; i++) addBox(parts.get('mat-chrome'), -s.w / 2 + i * dw + dw / 2 - 0.08, -s.d + 0.0, s.h - topT - 0.06, -s.w / 2 + i * dw + dw / 2 + 0.08, -s.d + 0.02, s.h - topT - 0.045)
  outline(d, s)
  if (withTop) d.seg('thin', -s.w / 2, -s.d + 0.02, s.w / 2, -s.d + 0.02)
}

const kitchenWall: FurnitureBuilder = (parts, s, d) => {
  const body = parts.get(s.primary)
  const z0 = 1.4
  addBox(body, -s.w / 2, -s.d, z0, s.w / 2, 0, z0 + s.h)
  const n = Math.max(1, Math.round(s.w / 0.6))
  for (let i = 1; i < n; i++) addBox(parts.get('mat-black-matte'), -s.w / 2 + (s.w / n) * i - 0.003, -s.d - 0.003, z0, -s.w / 2 + (s.w / n) * i + 0.003, -s.d + 0.01, z0 + s.h)
  d.rect('overhead', -s.w / 2, -s.d, s.w / 2, 0)
}

const island: FurnitureBuilder = (parts, s, d) => {
  baseCabinet(true)(parts, s, d)
  // overhang on the front for seating
  addBox(parts.get(s.secondary), -s.w / 2, -s.d - 0.25, s.h - 0.04, s.w / 2, -s.d, s.h)
  d.rect('thin', -s.w / 2, -s.d - 0.25, s.w / 2, -s.d)
}

const fridge: FurnitureBuilder = (parts, s, d) => {
  const body = parts.get(s.primary)
  addBox(body, -s.w / 2, -s.d, 0, s.w / 2, 0, s.h)
  const split = s.h * 0.35
  addBox(parts.get('mat-black-matte'), -s.w / 2 + 0.01, -s.d - 0.003, split - 0.004, s.w / 2 - 0.01, -s.d + 0.01, split + 0.004)
  const hx = s.w / 2 - 0.06
  addCylinderBetween(parts.get('mat-chrome'), [hx, -s.d - 0.03, split + 0.1], [hx, -s.d - 0.03, s.h - 0.15], 0.012, 8)
  addCylinderBetween(parts.get('mat-chrome'), [hx, -s.d - 0.03, 0.15], [hx, -s.d - 0.03, split - 0.1], 0.012, 8)
  outline(d, s)
  d.seg('thin', -s.w / 2, -s.d, s.w / 2, 0)
  d.seg('thin', -s.w / 2, 0, s.w / 2, -s.d)
}

const stove: FurnitureBuilder = (parts, s, d) => {
  baseCabinet(true)(parts, s, d)
  const hob = parts.get('mat-black-matte')
  addBox(hob, -s.w / 2 + 0.02, -s.d + 0.03, s.h, s.w / 2 - 0.02, -0.03, s.h + 0.006)
  const rings: Vec2[] = [[-s.w / 4, -s.d * 0.3], [s.w / 4, -s.d * 0.3], [-s.w / 4, -s.d * 0.7], [s.w / 4, -s.d * 0.7]]
  for (const c of rings) {
    addCylinderZ(parts.get('mat-steel-dark'), c[0], c[1], s.w * 0.14, s.h + 0.006, s.h + 0.012, 20)
    d.circle('symbol', c, s.w * 0.14)
    d.circle('symbol', c, s.w * 0.07)
  }
}

const oven: FurnitureBuilder = (parts, s, d) => {
  addBox(parts.get(s.primary), -s.w / 2, -s.d, 0, s.w / 2, 0, s.h)
  addBox(parts.get('mat-glass-tinted', { castShadow: false }), -s.w / 2 + 0.04, -s.d - 0.004, 0.08, s.w / 2 - 0.04, -s.d, s.h - 0.12)
  addCylinderBetween(parts.get('mat-chrome'), [-s.w / 2 + 0.06, -s.d - 0.04, s.h - 0.06], [s.w / 2 - 0.06, -s.d - 0.04, s.h - 0.06], 0.012, 8)
  outline(d, s)
  d.rect('thin', -s.w / 2 + 0.04, -s.d + 0.02, s.w / 2 - 0.04, -0.04)
}

const dishwasher: FurnitureBuilder = (parts, s, d) => {
  addBox(parts.get(s.primary), -s.w / 2, -s.d, 0, s.w / 2, 0, s.h)
  addBox(parts.get(s.secondary), -s.w / 2 + 0.01, -s.d - 0.004, 0.12, s.w / 2 - 0.01, -s.d, s.h - 0.02)
  addCylinderBetween(parts.get('mat-chrome'), [-s.w / 2 + 0.06, -s.d - 0.03, s.h - 0.1], [s.w / 2 - 0.06, -s.d - 0.03, s.h - 0.1], 0.01, 8)
  outline(d, s)
  d.circle('symbol', [0, -s.d / 2], Math.min(s.w, s.d) * 0.3)
}

const washingMachine: FurnitureBuilder = (parts, s, d) => {
  addBox(parts.get(s.primary), -s.w / 2, -s.d, 0, s.w / 2, 0, s.h)
  const cz = s.h * 0.5
  addCylinderBetween(parts.get('mat-chrome'), [0, -s.d, cz], [0, -s.d - 0.03, cz], s.w * 0.3, 24)
  addCylinderBetween(parts.get('mat-glass-tinted', { castShadow: false }), [0, -s.d - 0.03, cz], [0, -s.d - 0.05, cz], s.w * 0.25, 24, s.w * 0.15)
  addBox(parts.get(s.secondary), -s.w / 2 + 0.02, -s.d - 0.004, s.h - 0.1, s.w / 2 - 0.02, -s.d, s.h - 0.02)
  outline(d, s)
  d.circle('symbol', [0, -s.d / 2], s.w * 0.3)
}

const sink: FurnitureBuilder = (parts, s, d) => {
  baseCabinet(true)(parts, s, d)
  const basin = parts.get(s.secondary)
  const bx0 = -s.w / 2 + 0.06, bx1 = s.w / 2 - 0.06, by0 = -s.d + 0.08, by1 = -0.1
  const ring = roundedRect(bx0, by0, bx1, by1, 0.04)
  ringPrism(basin, ring, s.h - 0.18, s.h + 0.002)
  addCylinderZ(parts.get('mat-chrome'), 0, -0.06, 0.015, s.h, s.h + 0.25, 10)
  addCylinderBetween(parts.get('mat-chrome'), [0, -0.06, s.h + 0.25], [0, -0.06 - 0.18, s.h + 0.2], 0.012, 10)
  d.polyline('thin', ring, true)
  d.circle('symbol', [0, (by0 + by1) / 2], 0.02)
}

const toilet: FurnitureBuilder = (parts, s, d) => {
  const ceramic = parts.get(s.primary)
  const tankD = Math.min(0.2, s.d * 0.3)
  addBox(ceramic, -s.w / 2, -tankD, 0, s.w / 2, 0, s.h) // cistern / back
  // bowl: rounded plan shape extruded
  const bowl = roundedRect(-s.w / 2 + 0.02, -s.d, s.w / 2 - 0.02, -tankD + 0.02, s.w * 0.45, 8)
  ringPrism(ceramic, bowl, 0, 0.42)
  // seat ring (slightly larger, thin)
  const seat = roundedRect(-s.w / 2, -s.d - 0.01, s.w / 2, -tankD + 0.01, s.w * 0.5, 8)
  ringPrism(parts.get('mat-white-matte'), seat, 0.42, 0.45)
  addCylinderBetween(parts.get(s.secondary), [0, -tankD / 2, s.h], [0, -tankD / 2, s.h + 0.02], 0.02, 12)
  d.rect('thin', -s.w / 2, -tankD, s.w / 2, 0)
  d.polyline('thin', seat, true)
  d.polyline('thin', roundedRect(-s.w / 2 + 0.06, -s.d + 0.06, s.w / 2 - 0.06, -tankD - 0.03, s.w * 0.35, 8), true)
}

const washbasin: FurnitureBuilder = (parts, s, d) => {
  const ceramic = parts.get(s.primary)
  const rimZ = s.h
  const ring = roundedRect(-s.w / 2, -s.d, s.w / 2, 0, 0.1, 6)
  ringPrism(ceramic, ring, rimZ - 0.15, rimZ)
  // pedestal
  addBox(ceramic, -s.w * 0.15, -s.d * 0.6, 0, s.w * 0.15, -0.02, rimZ - 0.15)
  addCylinderZ(parts.get(s.secondary), 0, -0.08, 0.012, rimZ, rimZ + 0.12, 10)
  addCylinderBetween(parts.get(s.secondary), [0, -0.08, rimZ + 0.12], [0, -0.22, rimZ + 0.1], 0.01, 10)
  d.polyline('thin', ring, true)
  const inner = roundedRect(-s.w / 2 + 0.05, -s.d + 0.05, s.w / 2 - 0.05, -0.1, 0.12, 6)
  d.polyline('thin', inner, true)
  d.circle('symbol', [0, -s.d / 2 - 0.02], 0.02)
}

const bathtub: FurnitureBuilder = (parts, s, d) => {
  const ceramic = parts.get(s.primary)
  const outer: Vec2[] = [[-s.w / 2, -s.d], [s.w / 2, -s.d], [s.w / 2, 0], [-s.w / 2, 0]]
  const inner = roundedRect(-s.w / 2 + 0.07, -s.d + 0.07, s.w / 2 - 0.07, -0.07, 0.18, 6).reverse()
  const mb = new MeshBuilder(256)
  // tub as a box with a rounded pool cut from the top (rim face with hole + inner walls + pool floor)
  mb.face(outer.map((q) => [q[0], q[1], s.h] as Vec3), [inner.map((q) => [q[0], q[1], s.h] as Vec3)], [0, 0, 1])
  mb.face(outer.slice().reverse().map((q) => [q[0], q[1], 0] as Vec3), [], [0, 0, -1])
  for (let i = 0; i < outer.length; i++) {
    const a = outer[i]!, b = outer[(i + 1) % outer.length]!
    mb.quadFace([a[0], a[1], 0], [b[0], b[1], 0], [b[0], b[1], s.h], [a[0], a[1], s.h])
  }
  const floorZ = 0.12
  for (let i = 0; i < inner.length; i++) {
    const a = inner[i]!, b = inner[(i + 1) % inner.length]!
    mb.quadFace([a[0], a[1], s.h], [b[0], b[1], s.h], [b[0], b[1], floorZ], [a[0], a[1], floorZ])
  }
  mb.face(inner.slice().reverse().map((q) => [q[0], q[1], floorZ] as Vec3), [], [0, 0, 1])
  ceramic.append(mb.build())
  addCylinderBetween(parts.get(s.secondary), [s.w / 2 - 0.18, -s.d / 2, s.h], [s.w / 2 - 0.18, -s.d / 2, s.h + 0.15], 0.012, 10)
  addCylinderBetween(parts.get(s.secondary), [s.w / 2 - 0.18, -s.d / 2, s.h + 0.15], [s.w / 2 - 0.35, -s.d / 2, s.h + 0.12], 0.01, 10)
  outline(d, s)
  d.polyline('thin', inner, true)
  d.circle('symbol', [s.w / 2 - 0.3, -s.d / 2], 0.03)
}

const shower: FurnitureBuilder = (parts, s, d) => {
  const tray = parts.get(s.primary)
  const glass = parts.get(s.secondary, { castShadow: false })
  addBox(tray, -s.w / 2, -s.d, 0, s.w / 2, 0, 0.04)
  // glass on the front and one side (back/right sides are walls)
  addBox(glass, -s.w / 2, -s.d, 0.04, s.w / 2, -s.d + 0.008, s.h)
  addBox(glass, -s.w / 2, -s.d, 0.04, -s.w / 2 + 0.008, 0, s.h)
  addCylinderZ(parts.get('mat-chrome'), s.w / 2 - 0.05, -0.05, 0.012, 0.04, s.h - 0.1, 8)
  addSphere(parts.get('mat-chrome'), [s.w / 2 - 0.05, -0.25, s.h - 0.1], 0.06, 10)
  outline(d, s)
  d.seg('thin', -s.w / 2, -s.d, s.w / 2, 0)
  d.seg('thin', -s.w / 2, 0, s.w / 2, -s.d)
  d.circle('symbol', [0, -s.d / 2], 0.04)
}

export const KITCHEN_BATH: Partial<Record<FurnitureKind, FurnitureBuilder>> = {
  'kitchen-base': baseCabinet(true),
  'kitchen-wall': kitchenWall,
  'kitchen-island': island,
  fridge,
  stove,
  oven,
  dishwasher,
  sink,
  toilet,
  washbasin,
  bathtub,
  shower,
  'washing-machine': washingMachine,
}

export { TAU }
