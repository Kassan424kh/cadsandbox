// Window 3D models per WindowStyle, in the opening frame (x along wall, y = wall left, z from sill).
import type { WindowStyle } from '@cadsandbox/doc'
import type { MeshBuilder } from '../../core/mesh'
import { PartSet, addBox, addCylinderBetween } from '../../core/solids'
import type { OpeningFrame } from './index'

const GLASS = 0.006

/** Closed rectangular frame ring (4 members) with face width fw and depth fd, around [x0,x1]×[z0,z1]. */
export function addFrameRing(mb: MeshBuilder, x0: number, x1: number, z0: number, z1: number, fw: number, y0: number, y1: number): void {
  if (fw <= 0 || x1 - x0 < 2 * fw || z1 - z0 < 2 * fw) return
  addBox(mb, x0, y0, z0, x0 + fw, y1, z1)
  addBox(mb, x1 - fw, y0, z0, x1, y1, z1)
  addBox(mb, x0 + fw, y0, z0, x1 - fw, y1, z0 + fw)
  addBox(mb, x0 + fw, y0, z1 - fw, x1 - fw, y1, z1)
}

function pane(parts: PartSet, f: OpeningFrame, x0: number, x1: number, z0: number, z1: number, y = 0): void {
  if (x1 <= x0 || z1 <= z0) return
  addBox(parts.get(f.materials.glass, { castShadow: false }), x0, y - GLASS / 2, z0, x1, y + GLASS / 2, z1)
}

/** Sash (inner frame + glass) inside the rectangle, optionally with a handle. */
function sash(parts: PartSet, f: OpeningFrame, x0: number, x1: number, z0: number, z1: number, y: number, depth: number, handle?: { x: number; z: number }): void {
  const sw = Math.max(0.03, f.fw * 0.8)
  const gap = 0.004
  addFrameRing(parts.get(f.materials.frame), x0 + gap, x1 - gap, z0 + gap, z1 - gap, sw, y - depth / 2, y + depth / 2)
  pane(parts, f, x0 + gap + sw, x1 - gap - sw, z0 + gap + sw, z1 - gap - sw, y)
  if (handle) {
    const hy = y + f.swing * (depth / 2 + 0.02)
    addCylinderBetween(parts.get('mat-chrome'), [handle.x, y + f.swing * (depth / 2), handle.z], [handle.x, hy, handle.z], 0.008, 10)
    addBox(parts.get('mat-chrome'), handle.x - 0.008, hy - 0.008 * f.swing, handle.z - 0.06, handle.x + 0.008, hy + 0.008 * f.swing, handle.z + 0.06)
  }
}

export function buildWindow(parts: PartSet, f: OpeningFrame): void {
  const style = f.p.style as WindowStyle
  const frameMb = parts.get(f.materials.frame)
  const fd = f.fd
  const x0 = -f.w / 2, x1 = f.w / 2
  const inX0 = x0 + f.fw, inX1 = x1 - f.fw, inZ0 = f.fw, inZ1 = f.h - f.fw
  const sashDepth = Math.max(0.04, Math.min(fd * 0.75, 0.08))
  // exterior sill board on the side opposite to the swing (interior)
  const ext = -f.swing
  addBox(frameMb, x0 - 0.03, ext > 0 ? f.t / 2 : -f.t / 2 - 0.04, -0.03, x1 + 0.03, ext > 0 ? f.t / 2 + 0.04 : -f.t / 2, 0.0)
  if (style === 'bay') {
    // three angled units projecting to the exterior side by `proj`
    const proj = Math.min(0.45, f.w * 0.35)
    const side = Math.hypot(proj, f.w * 0.25)
    const cw = f.w * 0.5
    const yOut = ext * (f.t / 2 + proj)
    const unit = (cx: number, cy: number, ang: number, w: number) => {
      const local = new PartSet()
      addFrameRing(local.get(f.materials.frame), -w / 2, w / 2, 0, f.h, f.fw, -fd / 2, fd / 2)
      pane(local, f, -w / 2 + f.fw, w / 2 - f.fw, f.fw, f.h - f.fw, 0)
      const c = Math.cos(ang), s = Math.sin(ang)
      const m = [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, cx, cy, 0, 1]
      for (const p of local.build(m)) {
        const target = parts.get(p.material === 'node' ? null : p.material.id, { castShadow: p.castShadow })
        target.append(p.mesh)
      }
    }
    unit(0, yOut, 0, cw)
    const ang = Math.atan2(proj, (f.w - cw) / 2)
    unit(-(cw / 2 + (f.w - cw) / 4), ext * (f.t / 2 + proj / 2), -ext * ang, side)
    unit(cw / 2 + (f.w - cw) / 4, ext * (f.t / 2 + proj / 2), ext * ang, side)
    // roof and floor of the bay
    const roof = parts.get(f.materials.frame)
    const pts: [number, number][] = [[x0, ext * (f.t / 2)], [-cw / 2, yOut], [cw / 2, yOut], [x1, ext * (f.t / 2)]]
    const ring = ext > 0 ? pts : pts.slice().reverse()
    roof.face(ring.map((q) => [q[0], q[1], f.h] as [number, number, number]), [], [0, 0, 1])
    roof.face(ring.map((q) => [q[0], q[1], f.h - 0.04] as [number, number, number]), [], [0, 0, -1])
    roof.face(ring.map((q) => [q[0], q[1], 0] as [number, number, number]), [], [0, 0, -1])
    roof.face(ring.map((q) => [q[0], q[1], 0.04] as [number, number, number]), [], [0, 0, 1])
    return
  }
  // outer frame
  addFrameRing(frameMb, x0, x1, 0, f.h, f.fw, -fd / 2, fd / 2)
  switch (style) {
    case 'fixed':
    case 'skylight':
      pane(parts, f, inX0, inX1, inZ0, inZ1)
      if (style === 'skylight') addFrameRing(frameMb, x0 - 0.02, x1 + 0.02, -0.02, f.h + 0.02, 0.03, ext * (fd / 2), ext * (fd / 2 + 0.05))
      break
    case 'casement':
      sash(parts, f, inX0, inX1, inZ0, inZ1, 0, sashDepth, { x: f.hingeX > 0 ? inX0 + 0.08 : inX1 - 0.08, z: f.h / 2 })
      break
    case 'tilt-turn':
      sash(parts, f, inX0, inX1, inZ0, inZ1, 0, sashDepth, { x: f.hingeX > 0 ? inX0 + 0.08 : inX1 - 0.08, z: f.h / 2 })
      break
    case 'awning':
      sash(parts, f, inX0, inX1, inZ0, inZ1, 0, sashDepth, { x: 0, z: inZ0 + 0.08 })
      break
    case 'double-casement': {
      const mullion = f.fw
      addBox(frameMb, -mullion / 2, -fd / 2, inZ0, mullion / 2, fd / 2, inZ1)
      sash(parts, f, inX0, -mullion / 2, inZ0, inZ1, 0, sashDepth, { x: -mullion / 2 - 0.06, z: f.h / 2 })
      sash(parts, f, mullion / 2, inX1, inZ0, inZ1, 0, sashDepth, { x: mullion / 2 + 0.06, z: f.h / 2 })
      break
    }
    case 'sliding': {
      const mid = (inX0 + inX1) / 2
      const sd = Math.min(sashDepth, fd / 2 - 0.002)
      sash(parts, f, inX0, mid + 0.02, inZ0, inZ1, -sd / 2 - 0.001, sd)
      sash(parts, f, mid - 0.02, inX1, inZ0, inZ1, sd / 2 + 0.001, sd)
      break
    }
    case 'hung': {
      const mid = (inZ0 + inZ1) / 2
      const sd = Math.min(sashDepth, fd / 2 - 0.002)
      sash(parts, f, inX0, inX1, inZ0, mid + 0.02, -sd / 2 - 0.001, sd)
      sash(parts, f, inX0, inX1, mid - 0.02, inZ1, sd / 2 + 0.001, sd)
      break
    }
    default:
      pane(parts, f, inX0, inX1, inZ0, inZ1)
  }
}
