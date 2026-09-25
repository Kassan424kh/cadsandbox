// Uniform-grid spatial hash for snap points (world space), grouped per owner node so a node's
// points can be replaced atomically when its geometry or transform changes.
import type { Vec3 } from '@cadsandbox/doc'
import type { SnapKind } from '@cadsandbox/geometry'

export interface HashedPoint {
  p: Vec3
  kind: SnapKind
  nodeId: string
}

export class SpatialHash {
  private cellSize: number
  private cells = new Map<string, HashedPoint[]>()
  private byNode = new Map<string, string[]>()

  constructor(cellSize = 0.5) {
    this.cellSize = cellSize
  }

  private key(x: number, y: number, z: number): string {
    const s = this.cellSize
    return `${Math.floor(x / s)},${Math.floor(y / s)},${Math.floor(z / s)}`
  }

  /** Replace all points of a node. */
  set(nodeId: string, points: HashedPoint[]): void {
    this.remove(nodeId)
    const keys: string[] = []
    for (const pt of points) {
      const k = this.key(pt.p[0], pt.p[1], pt.p[2])
      let cell = this.cells.get(k)
      if (!cell) this.cells.set(k, (cell = []))
      cell.push(pt)
      keys.push(k)
    }
    this.byNode.set(nodeId, keys)
  }

  remove(nodeId: string): void {
    const keys = this.byNode.get(nodeId)
    if (!keys) return
    for (const k of keys) {
      const cell = this.cells.get(k)
      if (!cell) continue
      const rest = cell.filter((p) => p.nodeId !== nodeId)
      if (rest.length) this.cells.set(k, rest)
      else this.cells.delete(k)
    }
    this.byNode.delete(nodeId)
  }

  has(nodeId: string): boolean {
    return this.byNode.has(nodeId)
  }

  /** Points within `radius` of `center` (Euclidean), optionally excluding nodes. */
  query(center: Vec3, radius: number, exclude?: ReadonlySet<string> | null, out: HashedPoint[] = []): HashedPoint[] {
    out.length = 0
    const s = this.cellSize
    const r2 = radius * radius
    const x0 = Math.floor((center[0] - radius) / s)
    const x1 = Math.floor((center[0] + radius) / s)
    const y0 = Math.floor((center[1] - radius) / s)
    const y1 = Math.floor((center[1] + radius) / s)
    const z0 = Math.floor((center[2] - radius) / s)
    const z1 = Math.floor((center[2] + radius) / s)
    if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > 4096) return out
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++) {
          const cell = this.cells.get(`${x},${y},${z}`)
          if (!cell) continue
          for (const p of cell) {
            if (exclude?.has(p.nodeId)) continue
            const dx = p.p[0] - center[0]
            const dy = p.p[1] - center[1]
            const dz = p.p[2] - center[2]
            if (dx * dx + dy * dy + dz * dz <= r2) out.push(p)
          }
        }
    return out
  }

  get size(): number {
    let n = 0
    for (const c of this.cells.values()) n += c.length
    return n
  }

  clear(): void {
    this.cells.clear()
    this.byNode.clear()
  }
}
