// "Auto-dimension walls": exterior chain dimensions (Maßketten) for the four sides of a level's
// building — wall segments and openings (Rohbaumaß widths) as stations — plus an overall dimension
// per side, and optional interior chains along walls with openings. Pure: doc → NewNode[] (the caller
// commits them as one undo step). Coordinates are level-local; chains sit `offset` outside the
// outermost wall faces. Associative refs point at wall end points (anchors 'a'/'b') where a station
// coincides with one; opening stations stay static.
import type { CadDocument, DimensionParams, NewNode, NodeBase, Vec2, Vec3 } from '@cadsandbox/doc'
import { invertMatrix, multiplyMatrices, transformPoint } from '@cadsandbox/doc'
import { LAYERS, newNode } from '../util/nodes'
import { v2 } from '../util/vec'
import { wallFaces } from '../util/walls'

export interface AutoDimensionOptions {
  /** Exterior chains along the building's bounding sides (default true) */
  exterior?: boolean
  /** Chains along interior walls that have openings (default false) */
  interior?: boolean
  /** Distance of the first chain from the outer wall face (m, default 1.0) */
  offset?: number
  /** Distance between the chain and the overall dimension (m, default 0.7) */
  spacing?: number
  /** Opening edges (Rohbaumaß) as stations (default true) */
  openings?: boolean
  /** Reference wall end points so chains follow wall edits (default true) */
  associative?: boolean
  /** Text size (m) written to node.meta.textSize when not the default */
  textSize?: number
}

interface WallInfo {
  node: NodeBase<'wall'>
  /** centerline ends, level-local */
  a: Vec2
  b: Vec2
  /** face corner points, level-local */
  corners: Vec2[]
  /** opening edge points along the centerline, level-local */
  openingEdges: Vec2[]
}

interface Side {
  name: 'south' | 'north' | 'west' | 'east'
  dir: Vec2
  /** outward normal */
  out: Vec2
}

const SIDES: Side[] = [
  { name: 'south', dir: [1, 0], out: [0, -1] },
  { name: 'north', dir: [1, 0], out: [0, 1] },
  { name: 'west', dir: [0, 1], out: [-1, 0] },
  { name: 'east', dir: [0, 1], out: [1, 0] },
]

const STATION_TOL = 0.005

function collectWalls(doc: CadDocument, levelId: string, openings: boolean): WallInfo[] {
  const levelInv = invertMatrix(doc.getWorldMatrix(levelId))
  const out: WallInfo[] = []
  for (const w of doc.nodesOfType('wall')) {
    if (doc.getLevelOf(w.id) !== levelId || !doc.isEffectivelyVisible(w.id)) continue
    if (Math.abs(w.params.bulge ?? 0) > 1e-6) continue // curved walls: not chained
    const m = multiplyMatrices(levelInv, doc.getWorldMatrix(w.id))
    const map = (p: Vec2): Vec2 => {
      const q = transformPoint(m, [p[0], p[1], 0])
      return [q[0], q[1]]
    }
    const faces = wallFaces(w.params)
    const a = map(w.params.a), b = map(w.params.b)
    if (v2.dist(a, b) < 1e-6) continue
    const openingEdges: Vec2[] = []
    if (openings) {
      const axis = v2.norm(v2.sub(w.params.b, w.params.a))
      for (const cid of doc.getChildren(w.id)) {
        const o = doc.getNode<'opening'>(cid)
        if (!o || o.type !== 'opening' || !o.visible) continue
        const half = Math.max(0, o.params.width) / 2
        for (const s of [-1, 1]) openingEdges.push(map(v2.add(w.params.a, v2.scale(axis, o.params.offset + s * half))))
      }
    }
    out.push({ node: w, a, b, corners: [map(faces.left.a), map(faces.left.b), map(faces.right.a), map(faces.right.b)], openingEdges })
  }
  return out
}

/** Sorted stations (parameter along `dir`) with the world points they came from; near-duplicates merged. */
function mergeStations(items: { t: number; p: Vec2; ref?: { node: string; anchor: string } }[]): { t: number; p: Vec2; ref?: { node: string; anchor: string } }[] {
  items.sort((x, y) => x.t - y.t)
  const out: typeof items = []
  for (const it of items) {
    const last = out[out.length - 1]
    if (last && it.t - last.t <= STATION_TOL) {
      if (!last.ref && it.ref) last.ref = it.ref
      continue
    }
    out.push({ ...it })
  }
  return out
}

function chainNode(
  levelId: string,
  stations: { p: Vec2; ref?: { node: string; anchor: string } }[],
  offset: number,
  axis: 'x' | 'y' | undefined,
  name: string,
  associative: boolean,
  textSize: number | undefined,
): NewNode<'dimension'> {
  const params: DimensionParams = { kind: 'chain', points: stations.map((s) => [s.p[0], s.p[1], 0] as Vec3), offset }
  if (axis) params.axis = axis
  if (associative && stations.some((s) => s.ref)) params.refs = stations.map((s) => s.ref ?? { node: '', anchor: '' })
  const meta: Record<string, unknown> = {}
  if (textSize && textSize !== 0.2) meta.textSize = textSize
  return newNode('dimension', params, { parent: levelId, layer: LAYERS.dims, name, meta })
}

/**
 * Chain + overall dimensions for the walls of `levelId`. Returns nothing for levels without straight
 * walls. Exterior sides use the outermost wall faces within one wall thickness of the building's
 * bounding box; the chains are placed outside the building.
 */
export function autoDimensionWalls(doc: CadDocument, levelId: string, opts: AutoDimensionOptions = {}): NewNode<'dimension'>[] {
  const exterior = opts.exterior ?? true
  const interior = opts.interior ?? false
  const offset = Math.max(0.05, opts.offset ?? 1.0)
  const spacing = Math.max(0.05, opts.spacing ?? 0.7)
  const associative = opts.associative ?? true
  const walls = collectWalls(doc, levelId, opts.openings ?? true)
  if (!walls.length) return []
  const nodes: NewNode<'dimension'>[] = []
  const usedExterior = new Set<string>()

  if (exterior) {
    const corners = walls.flatMap((w) => w.corners)
    for (const side of SIDES) {
      const extreme = Math.max(...corners.map((c) => v2.dot(c, side.out)))
      const perpSign = v2.dot(v2.perp(side.dir), side.out) >= 0 ? 1 : -1
      const items: { t: number; p: Vec2; ref?: { node: string; anchor: string } }[] = []
      for (const w of walls) {
        const along = v2.norm(v2.sub(w.b, w.a))
        if (Math.abs(v2.dot(along, side.dir)) < Math.cos((10 * Math.PI) / 180)) continue
        const tol = Math.max(0.3, w.node.params.thickness * 1.5)
        const outer = Math.max(...w.corners.map((c) => v2.dot(c, side.out)))
        if (outer < extreme - tol) continue
        usedExterior.add(w.node.id)
        const onSide = (p: Vec2): Vec2 => v2.add(v2.scale(side.dir, v2.dot(p, side.dir)), v2.scale(side.out, extreme))
        // wall extents: the outer face corners
        for (const c of w.corners) items.push({ t: v2.dot(c, side.dir), p: onSide(c) })
        for (const end of ['a', 'b'] as const) {
          const p = end === 'a' ? w.a : w.b
          items.push({ t: v2.dot(p, side.dir), p: onSide(p), ref: { node: w.node.id, anchor: end } })
        }
        for (const e of w.openingEdges) items.push({ t: v2.dot(e, side.dir), p: onSide(e) })
      }
      const stations = mergeStations(items)
      if (stations.length < 2) continue
      const axis = side.dir[0] === 1 ? 'x' : 'y'
      const label = side.name[0]!.toUpperCase() + side.name.slice(1)
      nodes.push(chainNode(levelId, stations, perpSign * offset, axis, `Chain ${label}`, associative, opts.textSize))
      if (stations.length > 2) {
        const first = stations[0]!, last = stations[stations.length - 1]!
        nodes.push(chainNode(levelId, [first, last], perpSign * (offset + spacing), axis, `Overall ${label}`, associative, opts.textSize))
      }
    }
  }

  if (interior) {
    for (const w of walls) {
      if (usedExterior.has(w.node.id) || !w.openingEdges.length) continue
      const dir = v2.norm(v2.sub(w.b, w.a))
      const items: { t: number; p: Vec2; ref?: { node: string; anchor: string } }[] = [
        { t: 0, p: w.a, ref: { node: w.node.id, anchor: 'a' } },
        { t: v2.dot(v2.sub(w.b, w.a), dir), p: w.b, ref: { node: w.node.id, anchor: 'b' } },
        ...w.openingEdges.map((e) => ({ t: v2.dot(v2.sub(e, w.a), dir), p: e })),
      ]
      const stations = mergeStations(items)
      if (stations.length < 2) continue
      nodes.push(chainNode(levelId, stations, w.node.params.thickness / 2 + 0.45, undefined, `Chain ${w.node.name || 'wall'}`, associative, opts.textSize))
    }
  }
  return nodes
}
