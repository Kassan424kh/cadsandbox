// Small shared helpers for evaluators.
import { TYPE_DEFAULT_MATERIAL, type AnyNode, type HatchPattern } from '@cadsandbox/doc'
import type { EvalContext } from './context'

/** Effective material id of a node (node.material or the type default). */
export function effectiveMaterial(node: AnyNode): string | null {
  return node.material ?? TYPE_DEFAULT_MATERIAL[node.type] ?? null
}

/** Hatch pattern of the node's effective material (undefined when unknown / none). */
export function nodeHatch(node: AnyNode, ctx: EvalContext): HatchPattern | undefined {
  const id = effectiveMaterial(node)
  const h = id ? ctx.materials[id]?.hatch : undefined
  return h && h !== 'none' ? h : undefined
}

export function metaNumber(node: AnyNode, key: string, fallback: number): number {
  const v = (node.meta as Record<string, unknown>)[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}
