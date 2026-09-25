// Non-destructive booleans via manifold-3d. Operand materials survive through original IDs.
import type { NodeBase } from '@cadsandbox/doc'
import type { Manifold } from 'manifold-3d'
import type { GeometryResult, MeshPart } from '../api'
import { getManifold, manifoldToMeshes, meshToManifold } from '../worker/manifold'
import type { EvalContext } from './context'
import { errorResult, finish, snap } from './result'

export async function evaluateBoolean(node: NodeBase<'boolean'>, ctx: EvalContext): Promise<GeometryResult> {
  const operands = (ctx.operands ?? []).filter((o) => o.solids.some((s) => s.mesh.positions.length > 0))
  if (!operands.length) return errorResult('Boolean has no solid operands')
  const w = await getManifold()
  const alive = new Set<Manifold>()
  const track = (m: Manifold): Manifold => {
    alive.add(m)
    return m
  }
  const drop = (m: Manifold) => {
    if (alive.delete(m)) m.delete()
  }
  const cleanup = () => {
    for (const m of alive) m.delete()
    alive.clear()
  }
  const materialById = new Map<number, string | null>()
  try {
    const solids: Manifold[] = []
    for (const op of operands) {
      const pieces: Manifold[] = []
      for (const s of op.solids) {
        if (!s.mesh.positions.length) continue
        const r = meshToManifold(w, s.mesh)
        if (!r.ok) {
          cleanup()
          return errorResult(`Operand ${op.nodeId}: ${r.error}`)
        }
        // tag each piece with its own original id so materials can be recovered per piece
        const original = track(track(r.manifold).asOriginal())
        drop(r.manifold)
        materialById.set(original.originalID(), s.material)
        pieces.push(original)
      }
      if (!pieces.length) continue
      if (pieces.length === 1) solids.push(pieces[0]!)
      else {
        const u = track(w.Manifold.union(pieces))
        for (const p of pieces) drop(p)
        solids.push(u)
      }
    }
    if (!solids.length) return errorResult('Boolean has no solid operands')
    let result: Manifold
    const op = node.params.op
    if (solids.length === 1) result = solids[0]!
    else if (op === 'union') result = track(w.Manifold.union(solids))
    else if (op === 'intersect') result = track(w.Manifold.intersection(solids))
    else {
      const rest = solids.length === 2 ? solids[1]! : track(w.Manifold.union(solids.slice(1)))
      result = track(w.Manifold.difference(solids[0]!, rest))
    }
    const status = result.status()
    if (status !== 'NoError') {
      cleanup()
      return errorResult(`Boolean failed: ${status}`)
    }
    const volume = result.volume()
    const area = result.surfaceArea()
    const runs = result.isEmpty() ? [] : manifoldToMeshes(result)
    cleanup()
    const parts: MeshPart[] = runs.map((r) => {
      const mat = materialById.get(r.originalID)
      return { mesh: r.mesh, material: mat ? { id: mat } : 'node', castShadow: true, receiveShadow: true }
    })
    return finish(parts, { edges: 'auto', snaps: [snap('insertion', 0, 0, 0)], quantities: { volume, area, operands: operands.length } })
  } catch (e) {
    cleanup()
    return errorResult(`Boolean failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}
