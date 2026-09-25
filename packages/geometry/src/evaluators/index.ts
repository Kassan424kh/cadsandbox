// Evaluator dispatch: one entry per NodeType. Pure functions of (node, ctx) — no document access.
import type { AnyNode, NodeBase, NodeType } from '@cadsandbox/doc'
import type { GeometryResult } from '../api'
import { evaluateGridline, evaluateLevelmark, evaluateNorthArrow, evaluateScaleBar } from './annotation'
import { evaluateBoolean } from './boolean'
import { defaultContext, type EvalContext } from './context'
import { evaluateDimension } from './dimension'
import { evaluateArc, evaluateCircle, evaluateEllipse, evaluateHatch, evaluateLeader, evaluateLine, evaluatePolyline, evaluateRect, evaluateSpline } from './drafting'
import { evaluateFurniture } from './furniture/index'
import { evaluateMesh } from './mesh'
import { evaluateEmpty, evaluateImage, evaluateInstance, evaluateLight, evaluateSection } from './misc'
import { evaluateOpening } from './opening/index'
import { evaluatePrimitive } from './primitive'
import { errorResult } from './result'
import { evaluateRoof } from './roof'
import { evaluateRoom } from './room'
import { evaluateShape } from './shape'
import { evaluateStair } from './stair'
import { evaluateBeam, evaluateColumn, evaluateRailing, evaluateSlab } from './structure'
import { evaluateLoft, evaluateRevolve, evaluateSweep } from './sweeps'
import { evaluateTerrain } from './terrain'
import { evaluateText } from './text'
import { evaluateWall } from './wall/index'

/** Types whose evaluation needs asynchronous resources (WASM, fonts). */
export const ASYNC_TYPES: ReadonlySet<NodeType> = new Set<NodeType>(['boolean', 'text'])

/** Relative cost classes used for scheduling (lower = evaluated first). */
export function costClass(type: NodeType): number {
  switch (type) {
    case 'group':
    case 'level':
    case 'light':
    case 'section':
    case 'instance':
    case 'line':
    case 'polyline':
    case 'rect':
    case 'circle':
    case 'arc':
    case 'ellipse':
    case 'spline':
    case 'dimension':
    case 'leader':
    case 'gridline':
    case 'levelmark':
    case 'northarrow':
    case 'scalebar':
    case 'image':
      return 0
    case 'primitive':
    case 'shape':
    case 'wall':
    case 'opening':
    case 'column':
    case 'beam':
    case 'slab':
    case 'room':
    case 'railing':
    case 'hatch':
      return 1
    default:
      return 2
  }
}

/** Synchronous evaluation; returns null for async types. Exceptions become error results. */
export function evaluateNodeSync(node: AnyNode, ctx: EvalContext = defaultContext()): GeometryResult | null {
  if (ASYNC_TYPES.has(node.type)) return null
  try {
    return dispatchSync(node, ctx)
  } catch (e) {
    return errorResult(e instanceof Error ? e.message : String(e))
  }
}

/** Evaluate any node. `ctx` defaults to a detached context (no dependencies). */
export async function evaluateNode(node: AnyNode, ctx?: Partial<EvalContext> | EvalContext): Promise<GeometryResult> {
  const full = ctx && 'units' in ctx && 'level' in ctx && 'materials' in ctx ? (ctx as EvalContext) : defaultContext(ctx ?? {})
  try {
    switch (node.type) {
      case 'boolean':
        return await evaluateBoolean(node as NodeBase<'boolean'>, full)
      case 'text':
        return await evaluateText(node as NodeBase<'text'>)
      default:
        return dispatchSync(node, full)
    }
  } catch (e) {
    return errorResult(e instanceof Error ? e.message : String(e))
  }
}

function dispatchSync(node: AnyNode, ctx: EvalContext): GeometryResult {
  switch (node.type) {
    case 'group':
    case 'level':
      return evaluateEmpty()
    case 'primitive':
      return evaluatePrimitive(node as NodeBase<'primitive'>)
    case 'shape':
      return evaluateShape(node as NodeBase<'shape'>)
    case 'revolve':
      return evaluateRevolve(node as NodeBase<'revolve'>)
    case 'loft':
      return evaluateLoft(node as NodeBase<'loft'>)
    case 'sweep':
      return evaluateSweep(node as NodeBase<'sweep'>)
    case 'mesh':
      return evaluateMesh(node as NodeBase<'mesh'>, ctx)
    case 'instance':
      return evaluateInstance(node as NodeBase<'instance'>, ctx)
    case 'light':
      return evaluateLight(node as NodeBase<'light'>)
    case 'image':
      return evaluateImage(node as NodeBase<'image'>)
    case 'section':
      return evaluateSection(node as NodeBase<'section'>)
    case 'line':
      return evaluateLine(node as NodeBase<'line'>)
    case 'polyline':
      return evaluatePolyline(node as NodeBase<'polyline'>)
    case 'rect':
      return evaluateRect(node as NodeBase<'rect'>)
    case 'circle':
      return evaluateCircle(node as NodeBase<'circle'>)
    case 'arc':
      return evaluateArc(node as NodeBase<'arc'>)
    case 'ellipse':
      return evaluateEllipse(node as NodeBase<'ellipse'>)
    case 'spline':
      return evaluateSpline(node as NodeBase<'spline'>)
    case 'hatch':
      return evaluateHatch(node as NodeBase<'hatch'>)
    case 'dimension':
      return evaluateDimension(node as NodeBase<'dimension'>, ctx)
    case 'leader':
      return evaluateLeader(node as NodeBase<'leader'>)
    case 'gridline':
      return evaluateGridline(node as NodeBase<'gridline'>)
    case 'levelmark':
      return evaluateLevelmark(node as NodeBase<'levelmark'>, ctx)
    case 'northarrow':
      return evaluateNorthArrow(node as NodeBase<'northarrow'>)
    case 'scalebar':
      return evaluateScaleBar(node as NodeBase<'scalebar'>, ctx)
    case 'wall':
      return evaluateWall(node as NodeBase<'wall'>, ctx)
    case 'opening':
      return evaluateOpening(node as NodeBase<'opening'>, ctx)
    case 'slab':
      return evaluateSlab(node as NodeBase<'slab'>, ctx)
    case 'roof':
      return evaluateRoof(node as NodeBase<'roof'>)
    case 'stair':
      return evaluateStair(node as NodeBase<'stair'>, ctx)
    case 'column':
      return evaluateColumn(node as NodeBase<'column'>, ctx)
    case 'beam':
      return evaluateBeam(node as NodeBase<'beam'>, ctx)
    case 'railing':
      return evaluateRailing(node as NodeBase<'railing'>, ctx)
    case 'room':
      return evaluateRoom(node as NodeBase<'room'>, ctx)
    case 'furniture':
      return evaluateFurniture(node as NodeBase<'furniture'>)
    case 'terrain':
      return evaluateTerrain(node as NodeBase<'terrain'>)
    case 'boolean':
    case 'text':
      throw new Error(`${node.type} requires async evaluation`)
  }
}
