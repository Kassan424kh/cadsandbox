// Door 3D models (closed state) per DoorStyle, in the opening frame.
import type { DoorStyle } from '@cadsandbox/doc'
import { TAU } from '../../core/math2d'
import { MeshBuilder } from '../../core/mesh'
import { addBox, addBoxRotated, addCylinderBetween, addCylinderZ, addSphere, type PartSet } from '../../core/solids'
import type { OpeningFrame } from './index'

const LEAF = 0.04

/** U-shaped frame: two jambs + head, centered on the wall axis with depth fd. */
export function addFrameU(mb: MeshBuilder, f: OpeningFrame, fw = f.fw, fd = f.fd, zTop = f.h): void {
  if (fw <= 0) return
  const y0 = -fd / 2, y1 = fd / 2
  addBox(mb, -f.w / 2, y0, 0, -f.w / 2 + fw, y1, zTop)
  addBox(mb, f.w / 2 - fw, y0, 0, f.w / 2, y1, zTop)
  addBox(mb, -f.w / 2 + fw, y0, zTop - fw, f.w / 2 - fw, y1, zTop)
}

function addHandle(mb: MeshBuilder, x: number, yFace: number, side: 1 | -1, z = 1.05): void {
  // lever handle: rosette + lever pointing toward the door center
  const y0 = yFace, y1 = yFace + side * 0.06
  addCylinderBetween(mb, [x, y0, z], [x, y1, z], 0.01, 12)
  const dir = x > 0 ? -1 : 1
  addCylinderBetween(mb, [x, y1, z], [x + dir * 0.12, y1, z], 0.009, 12)
}

function leaf(parts: PartSet, f: OpeningFrame, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void {
  addBox(parts.get(f.materials.panel), x0, y0, z0, x1, y1, z1)
}

export function buildDoor(parts: PartSet, f: OpeningFrame): void {
  const style = f.p.style as DoorStyle
  const frameMb = parts.get(f.materials.frame)
  const inner0 = -f.w / 2 + f.fw, inner1 = f.w / 2 - f.fw
  const top = f.h - f.fw
  const gap = 0.004
  switch (style) {
    case 'single': {
      addFrameU(frameMb, f)
      leaf(parts, f, inner0 + gap, inner1 - gap, -LEAF / 2, LEAF / 2, 0.006, top - gap)
      const hx = f.hingeX > 0 ? inner1 - 0.06 : inner0 + 0.06
      const handleX = -hx // handle opposite to the hinge
      addHandle(parts.get('mat-chrome'), handleX, LEAF / 2, 1)
      addHandle(parts.get('mat-chrome'), handleX, -LEAF / 2, -1)
      break
    }
    case 'double': {
      addFrameU(frameMb, f)
      leaf(parts, f, inner0 + gap, -gap / 2, -LEAF / 2, LEAF / 2, 0.006, top - gap)
      leaf(parts, f, gap / 2, inner1 - gap, -LEAF / 2, LEAF / 2, 0.006, top - gap)
      for (const x of [-0.06, 0.06]) {
        addHandle(parts.get('mat-chrome'), x, LEAF / 2, 1)
        addHandle(parts.get('mat-chrome'), x, -LEAF / 2, -1)
      }
      break
    }
    case 'sliding':
    case 'pocket': {
      addFrameU(frameMb, f)
      // leaf in front of the opening on the swing side (sliding) or inside the wall (pocket)
      const y = style === 'sliding' ? f.swing * (f.t / 2 + LEAF / 2 + 0.01) : 0
      leaf(parts, f, inner0 + gap, inner1 - gap, y - LEAF / 2, y + LEAF / 2, 0.01, top)
      if (style === 'sliding') addBox(frameMb, -f.w / 2 - 0.1, y - 0.03, f.h, f.w / 2 + 0.1, y + 0.03, f.h + 0.06) // track
      const handleX = f.hingeX > 0 ? inner0 + 0.08 : inner1 - 0.08
      addBox(parts.get('mat-chrome'), handleX - 0.015, y - LEAF / 2 - 0.004, 0.95, handleX + 0.015, y + LEAF / 2 + 0.004, 1.15)
      break
    }
    case 'double-sliding': {
      addFrameU(frameMb, f)
      const y = f.swing * (f.t / 2 + LEAF / 2 + 0.01)
      leaf(parts, f, inner0 + gap, -gap, y - LEAF / 2, y + LEAF / 2, 0.01, top)
      leaf(parts, f, gap, inner1 - gap, y - LEAF / 2 - LEAF - 0.01, y - LEAF / 2 - 0.01, 0.01, top)
      addBox(frameMb, -f.w / 2 - 0.1, y - 0.06, f.h, f.w / 2 + 0.1, y + 0.03, f.h + 0.06)
      break
    }
    case 'folding': {
      addFrameU(frameMb, f)
      const n = f.w > 1.4 ? 4 : 2
      const pw = (inner1 - inner0) / n
      for (let i = 0; i < n; i++) {
        const x0 = inner0 + i * pw + gap, x1 = inner0 + (i + 1) * pw - gap
        leaf(parts, f, x0, x1, -LEAF / 2, LEAF / 2, 0.006, top - gap)
        // glass insert
        addBox(parts.get(f.materials.glass, { castShadow: false }), x0 + 0.08, -0.003, 0.9, x1 - 0.08, 0.003, top - 0.15)
      }
      break
    }
    case 'garage': {
      // sectional door: 4 horizontal panels with grooves, side rails
      const panelMb = parts.get(f.materials.panel)
      const n = 4
      const ph = (f.h - 0.02) / n
      for (let i = 0; i < n; i++) {
        const z0 = 0.01 + i * ph
        addBox(panelMb, -f.w / 2 + 0.02, -0.02, z0 + 0.005, f.w / 2 - 0.02, 0.02, z0 + ph - 0.005)
      }
      addBox(frameMb, -f.w / 2, -f.fd / 2, 0, -f.w / 2 + 0.04, f.fd / 2, f.h)
      addBox(frameMb, f.w / 2 - 0.04, -f.fd / 2, 0, f.w / 2, f.fd / 2, f.h)
      addBox(frameMb, -f.w / 2, -f.fd / 2, f.h - 0.06, f.w / 2, f.fd / 2, f.h)
      break
    }
    case 'revolving': {
      const r = f.w / 2
      const glass = parts.get(f.materials.glass, { castShadow: false })
      const wing = parts.get(f.materials.frame)
      // curved enclosure walls (two arcs of ~110° each side of the wall axis) as thin curved glass
      for (const side of [1, -1]) {
        const segs = 16
        const a0 = side > 0 ? Math.PI * 0.2 : Math.PI * 1.2
        const a1 = side > 0 ? Math.PI * 0.8 : Math.PI * 1.8
        const mb = glass
        for (let i = 0; i < segs; i++) {
          const t0 = a0 + ((a1 - a0) * i) / segs, t1 = a0 + ((a1 - a0) * (i + 1)) / segs
          const ri = r - 0.01, ro = r
          mb.quadFace([Math.cos(t0) * ro, Math.sin(t0) * ro, 0], [Math.cos(t1) * ro, Math.sin(t1) * ro, 0], [Math.cos(t1) * ro, Math.sin(t1) * ro, f.h], [Math.cos(t0) * ro, Math.sin(t0) * ro, f.h])
          mb.quadFace([Math.cos(t1) * ri, Math.sin(t1) * ri, 0], [Math.cos(t0) * ri, Math.sin(t0) * ri, 0], [Math.cos(t0) * ri, Math.sin(t0) * ri, f.h], [Math.cos(t1) * ri, Math.sin(t1) * ri, f.h])
        }
      }
      // canopy + floor ring
      const ring = parts.get(f.materials.frame)
      const segs = 32
      for (let i = 0; i < segs; i++) {
        const t0 = (TAU * i) / segs, t1 = (TAU * (i + 1)) / segs
        ring.quadFace([Math.cos(t0) * r, Math.sin(t0) * r, f.h], [Math.cos(t1) * r, Math.sin(t1) * r, f.h], [Math.cos(t1) * (r - 0.06), Math.sin(t1) * (r - 0.06), f.h], [Math.cos(t0) * (r - 0.06), Math.sin(t0) * (r - 0.06), f.h])
      }
      // 4 wings
      addCylinderZ(wing, 0, 0, 0.04, 0, f.h, 16)
      for (let k = 0; k < 4; k++) {
        const ang = Math.PI / 4 + (k * Math.PI) / 2
        addBoxRotated(wing, Math.cos(ang) * (r - 0.03) * 0.5, Math.sin(ang) * (r - 0.03) * 0.5, 0.02, r - 0.06, 0.03, f.h - 0.05, ang)
        addBoxRotated(glass, Math.cos(ang) * (r - 0.03) * 0.5, Math.sin(ang) * (r - 0.03) * 0.5, 0.1, r - 0.14, 0.008, f.h - 0.25, ang)
      }
      break
    }
  }
  if (style === 'single' || style === 'double') {
    // hinges as small spheres on the hinge jamb
    const hx = f.hingeX > 0 ? inner1 : inner0
    for (const z of [0.25, f.h / 2, f.h - 0.3]) addSphere(parts.get('mat-chrome'), [hx, f.swing * (LEAF / 2 + 0.01), z], 0.012, 8)
  }
}
