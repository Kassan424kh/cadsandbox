// Icon + display label per node type (outliner, inspector, palette).
import type { ReactNode } from 'react'
import { Box, Boxes, Circle, Combine, Compass, Component, Folder, Grid3x3, Image, Lightbulb, Minus, Mountain, PenTool, Ruler, Slash, Spline, Square, Triangle, Type, Waypoints } from 'lucide-react'
import type { AnyNode, NodeType } from '@cadsandbox/doc'
import { FURNITURE_ICONS } from './catalog'
import { IconArc, IconBeam, IconColumn, IconDimension, IconDoor, IconEllipse, IconHatch, IconLeader, IconLevel, IconLoft, IconOpening, IconRailing, IconRevolve, IconRoof, IconRoom, IconSection, IconSlab, IconStair, IconWall, IconWindow } from './icons'

export const NODE_TYPE_ICONS: Record<NodeType, ReactNode> = {
  group: <Folder />,
  level: <IconLevel />,
  primitive: <Box />,
  shape: <PenTool />,
  revolve: <IconRevolve />,
  loft: <IconLoft />,
  sweep: <Waypoints />,
  boolean: <Combine />,
  mesh: <Boxes />,
  instance: <Component />,
  text: <Type />,
  light: <Lightbulb />,
  image: <Image />,
  section: <IconSection />,
  line: <Slash />,
  polyline: <Waypoints />,
  rect: <Square />,
  circle: <Circle />,
  arc: <IconArc />,
  ellipse: <IconEllipse />,
  spline: <Spline />,
  hatch: <IconHatch />,
  dimension: <IconDimension />,
  leader: <IconLeader />,
  gridline: <Grid3x3 />,
  levelmark: <Triangle />,
  northarrow: <Compass />,
  scalebar: <Ruler />,
  wall: <IconWall />,
  opening: <IconOpening />,
  slab: <IconSlab />,
  roof: <IconRoof />,
  stair: <IconStair />,
  column: <IconColumn />,
  beam: <IconBeam />,
  railing: <IconRailing />,
  room: <IconRoom />,
  furniture: <Minus />,
  terrain: <Mountain />,
}

export const NODE_TYPE_LABELS: Record<NodeType, string> = {
  group: 'Group',
  level: 'Level',
  primitive: 'Primitive',
  shape: 'Shape',
  revolve: 'Revolve',
  loft: 'Loft',
  sweep: 'Sweep',
  boolean: 'Boolean',
  mesh: 'Mesh',
  instance: 'Component instance',
  text: 'Text',
  light: 'Light',
  image: 'Image',
  section: 'Section plane',
  line: 'Line',
  polyline: 'Polyline',
  rect: 'Rectangle',
  circle: 'Circle',
  arc: 'Arc',
  ellipse: 'Ellipse',
  spline: 'Spline',
  hatch: 'Hatch',
  dimension: 'Dimension',
  leader: 'Leader',
  gridline: 'Grid axis',
  levelmark: 'Height marker',
  northarrow: 'North arrow',
  scalebar: 'Scale bar',
  wall: 'Wall',
  opening: 'Opening',
  slab: 'Slab',
  roof: 'Roof',
  stair: 'Stair',
  column: 'Column',
  beam: 'Beam',
  railing: 'Railing',
  room: 'Room',
  furniture: 'Furniture',
  terrain: 'Terrain',
}

/** Icon for a concrete node (furniture kinds and openings get specific glyphs). */
export function nodeIcon(node: AnyNode): ReactNode {
  if (node.type === 'furniture') return FURNITURE_ICONS[node.params.kind] ?? NODE_TYPE_ICONS.furniture
  if (node.type === 'opening') return node.params.kind === 'door' ? <IconDoor /> : node.params.kind === 'window' ? <IconWindow /> : <IconOpening />
  return NODE_TYPE_ICONS[node.type]
}

/** Display name of a node's type; pass `t` (useT) to get it in the UI language. */
export function nodeTypeLabel(node: AnyNode, t?: (key: string, fallback: string) => string): string {
  const tr = (key: string, fallback: string) => (t ? t(key, fallback) : fallback)
  if (node.type === 'opening') return node.params.kind === 'door' ? tr('nodeType.door', 'Door') : node.params.kind === 'window' ? tr('nodeType.window', 'Window') : tr('nodeType.opening', 'Opening')
  if (node.type === 'primitive') return tr(`param.primitive.shape.${node.params.shape}`, node.params.shape.charAt(0).toUpperCase() + node.params.shape.slice(1))
  return tr(`nodeType.${node.type}`, NODE_TYPE_LABELS[node.type])
}
