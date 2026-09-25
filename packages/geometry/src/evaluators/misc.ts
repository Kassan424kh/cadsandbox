// Non-solid node types: group, level, light, section, image, instance.
import type { NodeBase } from '@cadsandbox/doc'
import type { GeometryResult } from '../api'
import { DrawingBuilder } from '../core/drawing'
import { MeshBuilder } from '../core/mesh'
import type { EvalContext } from './context'
import { drawingBounds, emptyResult, errorResult, finish, snap } from './result'

export function evaluateEmpty(): GeometryResult {
  return emptyResult()
}

/** Lights: symbolic bounds + a plan symbol (reflected ceiling plans). */
export function evaluateLight(node: NodeBase<'light'>): GeometryResult {
  const p = node.params
  const d = new DrawingBuilder()
  const r = 0.15
  switch (p.kind) {
    case 'point':
      d.circle('symbol', [0, 0], r)
      for (let k = 0; k < 4; k++) {
        const a = Math.PI / 4 + (k * Math.PI) / 2
        d.seg('symbol', Math.cos(a) * r, Math.sin(a) * r, Math.cos(a) * r * 1.6, Math.sin(a) * r * 1.6)
      }
      break
    case 'spot':
      d.circle('symbol', [0, 0], r)
      d.seg('symbol', 0, 0, 0, -r * 2.5)
      d.seg('symbol', 0, -r * 2.5, -r * 0.5, -r * 1.8)
      d.seg('symbol', 0, -r * 2.5, r * 0.5, -r * 1.8)
      break
    case 'directional':
      d.seg('symbol', -r * 2, 0, r * 2, 0)
      d.seg('symbol', r * 2, 0, r, r * 0.6)
      d.seg('symbol', r * 2, 0, r, -r * 0.6)
      break
    case 'area': {
      const w = (p.width ?? 1) / 2, h = (p.height ?? 1) / 2
      d.rect('symbol', -w, -h, w, h)
      d.seg('symbol', -w, -h, w, h)
      d.seg('symbol', -w, h, w, -h)
      break
    }
  }
  const plan = d.build()
  const res = emptyResult({ plan })
  const w = p.kind === 'area' ? (p.width ?? 1) / 2 : r
  const h = p.kind === 'area' ? (p.height ?? 1) / 2 : r
  res.bounds = { min: [-w, -h, -r], max: [w, h, r] }
  res.snaps = [snap('insertion', 0, 0, 0)]
  return res
}

/** Section plane: symbol frame + label drawn in the plane (local XY, normal = +Z). */
export function evaluateSection(node: NodeBase<'section'>): GeometryResult {
  const p = node.params
  const d = new DrawingBuilder()
  const s = 0.5
  // corner brackets of a 1×1 frame + label
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    d.seg('symbol', sx * s, sy * s, sx * s - sx * 0.2, sy * s)
    d.seg('symbol', sx * s, sy * s, sx * s, sy * s - sy * 0.2)
  }
  d.seg('symbol', -s, 0, s, 0)
  d.seg('symbol', 0, -s, 0, s)
  d.text(p.label || 'A', [s + 0.1, s], 0.2, { align: 'left', baseline: 'top', style: 'title' })
  const drawing = d.build()
  const res = emptyResult({ drawing })
  res.bounds = drawingBounds(drawing) ?? res.bounds
  res.snaps = [snap('insertion', 0, 0, 0)]
  return res
}

/**
 * Reference image: a quad in local XY (centered) with material id `image:<assetHash>` — the
 * renderer resolves that prefix to a textured, unlit material with `params.opacity`.
 */
export function evaluateImage(node: NodeBase<'image'>): GeometryResult {
  const p = node.params
  const w = Math.max(1e-6, p.width) / 2, h = Math.max(1e-6, p.height) / 2
  const mb = new MeshBuilder(4)
  // UVs 0..1 (not meter-scale) since the image is stretched over the quad
  const a = mb.vertex(-w, -h, 0, 0, 0, 1, 0, 0)
  const b = mb.vertex(w, -h, 0, 0, 0, 1, 1, 0)
  const c = mb.vertex(w, h, 0, 0, 0, 1, 1, 1)
  const dd = mb.vertex(-w, h, 0, 0, 0, 1, 0, 1)
  mb.quad(a, b, c, dd)
  const mesh = mb.build()
  const res = finish([{ mesh, material: { id: `image:${p.asset}` }, castShadow: false, receiveShadow: false }], {
    snaps: [snap('center', 0, 0, 0), snap('endpoint', -w, -h, 0), snap('endpoint', w, -h, 0), snap('endpoint', w, h, 0), snap('endpoint', -w, h, 0)],
    quantities: { width: p.width, height: p.height },
  })
  if (!p.asset) return errorResult('Image has no asset', res)
  return res
}

/** Instance: empty parts + bounds of the referenced component definition (renderer instances it). */
export function evaluateInstance(node: NodeBase<'instance'>, ctx: EvalContext): GeometryResult {
  const res = emptyResult()
  if (!node.params.component) return errorResult('Instance has no component', res)
  if (ctx.definitionBounds) res.bounds = { min: [...ctx.definitionBounds.min], max: [...ctx.definitionBounds.max] }
  res.snaps = [snap('insertion', 0, 0, 0)]
  return res
}
