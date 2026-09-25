// Plants, trees, vehicles, people.
import type { FurnitureKind, Vec3 } from '@cadsandbox/doc'
import { TAU } from '../../core/math2d'
import { MeshBuilder } from '../../core/mesh'
import { PartSet, addBox, addCylinderBetween, addCylinderZ, addSphere } from '../../core/solids'
import type { FurnitureBuilder } from './index'

/** Deterministic pseudo-random in [0,1) from an integer seed. */
const hash01 = (i: number): number => {
  let x = (i * 374761393 + 668265263) | 0
  x = ((x ^ (x >>> 13)) * 1274126177) | 0
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296
}

const plant: FurnitureBuilder = (parts, s, d) => {
  const pot = parts.get(s.primary)
  const foliage = parts.get(s.secondary)
  const cx = 0, cy = -s.d / 2
  const r = Math.min(s.w, s.d) / 2
  const potH = Math.min(0.35, s.h * 0.3)
  const mb = new MeshBuilder(64)
  addCylinderBetween(mb, [cx, cy, 0], [cx, cy, potH], r * 0.55, 16, r * 0.7)
  pot.append(mb.build())
  // foliage: cluster of spheres
  const n = 7
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU
    const rr = r * (0.35 + hash01(i) * 0.25)
    addSphere(foliage, [cx + Math.cos(a) * r * 0.45, cy + Math.sin(a) * r * 0.45, potH + (s.h - potH) * (0.45 + hash01(i + 9) * 0.35)], rr, 8)
  }
  addSphere(foliage, [cx, cy, potH + (s.h - potH) * 0.7], r * 0.5, 10)
  d.circle('thin', [cx, cy], r)
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU
    d.seg('symbol', cx + Math.cos(a) * r * 0.3, cy + Math.sin(a) * r * 0.3, cx + Math.cos(a) * r * 0.95, cy + Math.sin(a) * r * 0.95)
  }
}

const tree: FurnitureBuilder = (parts, s, d) => {
  const trunk = parts.get('mat-walnut')
  const canopy = parts.get(s.secondary)
  const cx = 0, cy = -s.d / 2
  const r = Math.min(s.w, s.d) / 2
  const trunkH = s.h * 0.35
  addCylinderBetween(trunk, [cx, cy, 0], [cx, cy, trunkH], r * 0.09, 10, r * 0.06)
  // canopy: a few overlapping spheres for a natural silhouette
  addSphere(canopy, [cx, cy, trunkH + (s.h - trunkH) * 0.5], r * 0.85, 12)
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + 0.3
    addSphere(canopy, [cx + Math.cos(a) * r * 0.4, cy + Math.sin(a) * r * 0.4, trunkH + (s.h - trunkH) * (0.35 + hash01(i) * 0.4)], r * (0.45 + hash01(i + 3) * 0.2), 10)
  }
  d.circle('thin', [cx, cy], r)
  d.circle('symbol', [cx, cy], r * 0.09)
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU
    d.seg('thin', cx + Math.cos(a) * r * 0.5, cy + Math.sin(a) * r * 0.5, cx + Math.cos(a) * r, cy + Math.sin(a) * r)
  }
}

const car: FurnitureBuilder = (parts, s, d) => {
  const body = parts.get(s.primary)
  const glass = parts.get(s.secondary, { castShadow: false })
  const wheels = parts.get('mat-black-matte')
  // frame: length along Y (front at −Y), width along X
  const L = s.d, W = s.w, H = s.h
  const wheelR = Math.min(0.33, H * 0.23)
  const bodyZ0 = wheelR * 0.6
  const bodyH = H * 0.42
  addBox(body, -W / 2, -L, bodyZ0, W / 2, 0, bodyZ0 + bodyH)
  // cabin (tapered box approximated by a box + windshields as glass slabs)
  const cabY0 = -L * 0.72, cabY1 = -L * 0.2
  addBox(body, -W / 2 + 0.08, cabY0 + 0.15, bodyZ0 + bodyH, W / 2 - 0.08, cabY1 - 0.15, H)
  const slope = (y0: number, y1: number, front: boolean) => {
    const mb = new MeshBuilder(8)
    const zLo = bodyZ0 + bodyH, zHi = H
    const a: Vec3 = [-W / 2 + 0.08, front ? y0 : y1, zLo], b: Vec3 = [W / 2 - 0.08, front ? y0 : y1, zLo]
    const c: Vec3 = [W / 2 - 0.08, front ? y0 + 0.15 : y1 - 0.15, zHi], e: Vec3 = [-W / 2 + 0.08, front ? y0 + 0.15 : y1 - 0.15, zHi]
    if (front) mb.quadFace(a, b, c, e)
    else mb.quadFace(b, a, e, c)
    glass.append(mb.build())
  }
  slope(cabY0, cabY1, true)
  slope(cabY0, cabY1, false)
  for (const x of [-W / 2 + 0.1, W / 2 - 0.1]) addBox(glass, x - 0.005, cabY0 + 0.16, bodyZ0 + bodyH, x + 0.005, cabY1 - 0.16, H - 0.05)
  for (const y of [-L * 0.8, -L * 0.2]) for (const x of [-W / 2 + 0.1, W / 2 - 0.1]) addCylinderBetween(wheels, [x - 0.1, y, wheelR], [x + 0.1, y, wheelR], wheelR, 16)
  d.rect('thin', -W / 2, -L, W / 2, 0)
  d.rect('thin', -W / 2 + 0.08, cabY0, W / 2 - 0.08, cabY1)
  d.seg('thin', -W / 2 + 0.08, cabY0 + 0.15, W / 2 - 0.08, cabY0 + 0.15)
}

const person: FurnitureBuilder = (parts, s, d) => {
  const body = parts.get(s.primary)
  const cloth = parts.get(s.secondary)
  const cx = 0, cy = -s.d / 2
  const H = s.h
  const headR = H * 0.065
  addSphere(body, [cx, cy, H - headR], headR, 12)
  addCylinderZ(body, cx, cy, headR * 0.45, H - 2.3 * headR, H - 1.9 * headR, 8) // neck
  addBox(cloth, cx - s.w / 2, cy - s.d * 0.35, H * 0.5, cx + s.w / 2, cy + s.d * 0.35, H - 2.3 * headR) // torso
  for (const sx of [-1, 1]) {
    addCylinderBetween(cloth, [cx + sx * (s.w / 2 + 0.03), cy, H - 2.6 * headR], [cx + sx * (s.w / 2 + 0.05), cy, H * 0.45], 0.045, 8) // arms
    addCylinderBetween(cloth, [cx + sx * s.w * 0.2, cy, H * 0.5], [cx + sx * s.w * 0.2, cy, 0.05], 0.07, 8) // legs
    addBox(body, cx + sx * s.w * 0.2 - 0.05, cy - 0.14, 0, cx + sx * s.w * 0.2 + 0.05, cy + 0.08, 0.05) // feet
  }
  d.circle('symbol', [cx, cy], headR)
  const n = 16
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * TAU, a1 = ((i + 1) / n) * TAU
    d.seg('thin', cx + Math.cos(a0) * (s.w / 2), cy + Math.sin(a0) * (s.d / 2), cx + Math.cos(a1) * (s.w / 2), cy + Math.sin(a1) * (s.d / 2))
  }
}

const bicycle: FurnitureBuilder = (parts, s, d) => {
  const frame = parts.get(s.primary)
  const tires = parts.get(s.secondary)
  const L = s.d, H = s.h
  const cx = 0
  const wheelR = Math.min(0.35, H * 0.34)
  const y1 = -L + wheelR, y2 = -wheelR
  for (const y of [y1, y2]) {
    // wheel as a thin torus approximated by a short cylinder ring
    const mb = new MeshBuilder(128)
    const segs = 24
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * TAU, a1 = ((i + 1) / segs) * TAU
      const p0: Vec3 = [cx, y + Math.cos(a0) * wheelR, wheelR + Math.sin(a0) * wheelR]
      const p1: Vec3 = [cx, y + Math.cos(a1) * wheelR, wheelR + Math.sin(a1) * wheelR]
      addCylinderBetween(mb, p0, p1, 0.02, 6)
    }
    tires.append(mb.build())
    addCylinderBetween(frame, [cx - 0.03, y, wheelR], [cx + 0.03, y, wheelR], 0.03, 10)
  }
  const seatZ = H * 0.85, barZ = H * 0.9
  const tube = 0.015
  addCylinderBetween(frame, [cx, y1, wheelR], [cx, y1 + 0.05, barZ], tube, 8) // fork/head
  addCylinderBetween(frame, [cx, y1 + 0.05, barZ], [cx, y2 - 0.1, seatZ], tube, 8) // top tube
  addCylinderBetween(frame, [cx, y1 + 0.08, barZ - 0.05], [cx, (y1 + y2) / 2, wheelR * 0.8], tube, 8) // down tube
  addCylinderBetween(frame, [cx, (y1 + y2) / 2, wheelR * 0.8], [cx, y2 - 0.1, seatZ], tube, 8) // seat tube
  addCylinderBetween(frame, [cx, (y1 + y2) / 2, wheelR * 0.8], [cx, y2, wheelR], tube, 8) // chain stay
  addCylinderBetween(frame, [cx, y2 - 0.1, seatZ], [cx, y2, wheelR], tube, 8) // seat stay
  addBox(parts.get('mat-black-matte'), cx - 0.07, y2 - 0.22, seatZ, cx + 0.07, y2 - 0.02, seatZ + 0.04) // saddle
  addCylinderBetween(frame, [cx - s.w / 2, y1 + 0.05, barZ + 0.05], [cx + s.w / 2, y1 + 0.05, barZ + 0.05], 0.012, 8) // handlebar
  addCylinderBetween(frame, [cx - 0.08, (y1 + y2) / 2, wheelR * 0.8], [cx + 0.08, (y1 + y2) / 2, wheelR * 0.8], 0.02, 8) // crank
  d.rect('thin', -s.w / 2, -L, s.w / 2, 0)
  for (const y of [y1, y2]) d.rect('thin', cx - 0.03, y - wheelR, cx + 0.03, y + wheelR)
  d.seg('thin', cx, y1 + wheelR, cx, y2 - wheelR)
  d.seg('thin', cx - s.w / 2, y1 + 0.05, cx + s.w / 2, y1 + 0.05)
}

export const OUTDOOR: Partial<Record<FurnitureKind, FurnitureBuilder>> = { plant, tree, car, person, bicycle }

export { addBox, addCylinderZ, PartSet }
