// Tool registry — provided by the tools module (draw.*, arch.*, measure.*, annotate.*, modify.*, section).
// Core-owned tools (select, pan, orbit, zoom-window, walk, place) are registered by the editor core.
import type { ToolId } from '../api'
import { CALIBRATE_OPTIONS, CalibrateTool } from './annotate/calibrate'
import { CHAIN_OPTIONS, ChainDimensionTool } from './annotate/chain'
import { CLOUD_OPTIONS, CloudTool } from './annotate/cloud'
import { CommentTool } from './annotate/comment'
import { DIMENSION_OPTIONS, DimensionTool } from './annotate/dimension'
import { GRID_OPTIONS, GridTool } from './annotate/grid'
import { LEADER_OPTIONS, LeaderTool } from './annotate/leader'
import { LEVELMARK_OPTIONS, LevelmarkTool } from './annotate/levelmark'
import { MARKUP_OPTIONS, MarkupTool } from './annotate/markup'
import { BEAM_OPTIONS, BeamTool } from './arch/beam'
import { COLUMN_OPTIONS, ColumnTool } from './arch/column'
import { OpeningTool, openingOptions } from './arch/opening'
import { RAILING_OPTIONS, RailingTool } from './arch/railing'
import { ROOF_OPTIONS, RoofTool } from './arch/roof'
import { ROOM_OPTIONS, RoomTool } from './arch/room'
import { SLAB_OPTIONS, SlabTool } from './arch/slab'
import { STAIR_OPTIONS, StairTool } from './arch/stair'
import { WALL_OPTIONS, WallTool } from './arch/wall'
import { ARC_OPTIONS, ArcTool } from './draw/arc'
import { CIRCLE_OPTIONS, CircleTool } from './draw/circle'
import { ELLIPSE_OPTIONS, EllipseTool } from './draw/ellipse'
import { HATCH_OPTIONS, HatchTool } from './draw/hatch'
import { LINE_OPTIONS, LineTool } from './draw/line'
import { PEN_OPTIONS, PenTool } from './draw/pen'
import { POLYLINE_OPTIONS, PolylineTool } from './draw/polyline'
import { RECT_OPTIONS, RectTool } from './draw/rect'
import { SPLINE_OPTIONS, SplineTool } from './draw/spline'
import { TEXT_OPTIONS, TextTool } from './draw/text'
import { AngleTool, AreaTool, DISTANCE_OPTIONS, DistanceTool } from './measure/measure'
import { ARRAY_OPTIONS, ArrayTool } from './modify/array'
import { FILLET_OPTIONS, FilletTool } from './modify/fillet'
import { MIRROR_OPTIONS, MirrorTool } from './modify/mirror'
import { OFFSET_OPTIONS, OffsetTool } from './modify/offset'
import { PUSHPULL_OPTIONS, PushPullTool } from './modify/pushpull'
import { ExtendTool, TrimTool } from './modify/trim'
import { SECTION_OPTIONS, SectionTool } from './section/section'
import type { ToolRegistry } from './types'

/** Every tool id this module provides (all ToolIds except the core-owned navigation/select/place tools). */
export const PROVIDED_TOOL_IDS: readonly ToolId[] = [
  'draw.line',
  'draw.polyline',
  'draw.rect',
  'draw.circle',
  'draw.arc',
  'draw.ellipse',
  'draw.spline',
  'draw.pen',
  'draw.hatch',
  'draw.text',
  'arch.wall',
  'arch.door',
  'arch.window',
  'arch.opening',
  'arch.slab',
  'arch.roof',
  'arch.stair',
  'arch.column',
  'arch.beam',
  'arch.railing',
  'arch.room',
  'measure.distance',
  'measure.area',
  'measure.angle',
  'annotate.dimension',
  'annotate.leader',
  'annotate.comment',
  'annotate.chain',
  'annotate.grid',
  'annotate.levelmark',
  'annotate.cloud',
  'annotate.markup',
  'annotate.calibrate',
  'modify.pushpull',
  'modify.offset',
  'modify.trim',
  'modify.extend',
  'modify.fillet',
  'modify.mirror',
  'modify.array',
  'section',
]

export function createTools(): ToolRegistry {
  return {
    'draw.line': { factory: () => new LineTool(), label: 'Line', options: LINE_OPTIONS },
    'draw.polyline': { factory: () => new PolylineTool(), label: 'Polyline', options: POLYLINE_OPTIONS },
    'draw.rect': { factory: () => new RectTool(), label: 'Rectangle', options: RECT_OPTIONS },
    'draw.circle': { factory: () => new CircleTool(), label: 'Circle', options: CIRCLE_OPTIONS },
    'draw.arc': { factory: () => new ArcTool(), label: 'Arc', options: ARC_OPTIONS },
    'draw.ellipse': { factory: () => new EllipseTool(), label: 'Ellipse', options: ELLIPSE_OPTIONS },
    'draw.spline': { factory: () => new SplineTool(), label: 'Spline', options: SPLINE_OPTIONS },
    'draw.pen': { factory: () => new PenTool(), label: 'Pen', options: PEN_OPTIONS },
    'draw.hatch': { factory: () => new HatchTool(), label: 'Hatch', options: HATCH_OPTIONS },
    'draw.text': { factory: () => new TextTool(), label: 'Text', options: TEXT_OPTIONS },
    'arch.wall': { factory: () => new WallTool(), label: 'Wall', options: WALL_OPTIONS },
    'arch.door': { factory: () => new OpeningTool('door'), label: 'Door', options: openingOptions('door') },
    'arch.window': { factory: () => new OpeningTool('window'), label: 'Window', options: openingOptions('window') },
    'arch.opening': { factory: () => new OpeningTool('opening'), label: 'Opening', options: openingOptions('opening') },
    'arch.slab': { factory: () => new SlabTool(), label: 'Slab', options: SLAB_OPTIONS },
    'arch.roof': { factory: () => new RoofTool(), label: 'Roof', options: ROOF_OPTIONS },
    'arch.stair': { factory: () => new StairTool(), label: 'Stair', options: STAIR_OPTIONS },
    'arch.column': { factory: () => new ColumnTool(), label: 'Column', options: COLUMN_OPTIONS },
    'arch.beam': { factory: () => new BeamTool(), label: 'Beam', options: BEAM_OPTIONS },
    'arch.railing': { factory: () => new RailingTool(), label: 'Railing', options: RAILING_OPTIONS },
    'arch.room': { factory: () => new RoomTool(), label: 'Room', options: ROOM_OPTIONS },
    'measure.distance': { factory: () => new DistanceTool(), label: 'Measure distance', options: DISTANCE_OPTIONS },
    'measure.area': { factory: () => new AreaTool(), label: 'Measure area' },
    'measure.angle': { factory: () => new AngleTool(), label: 'Measure angle' },
    'annotate.dimension': { factory: () => new DimensionTool(), label: 'Dimension', options: DIMENSION_OPTIONS },
    'annotate.leader': { factory: () => new LeaderTool(), label: 'Leader', options: LEADER_OPTIONS },
    'annotate.comment': { factory: () => new CommentTool(), label: 'Comment' },
    'annotate.chain': { factory: () => new ChainDimensionTool(), label: 'Chain dimension', options: CHAIN_OPTIONS },
    'annotate.grid': { factory: () => new GridTool(), label: 'Grid axes', options: GRID_OPTIONS },
    'annotate.levelmark': { factory: () => new LevelmarkTool(), label: 'Height marker', options: LEVELMARK_OPTIONS },
    'annotate.cloud': { factory: () => new CloudTool(), label: 'Revision cloud', options: CLOUD_OPTIONS },
    'annotate.markup': { factory: () => new MarkupTool(), label: 'Markup pen', options: MARKUP_OPTIONS },
    'annotate.calibrate': { factory: () => new CalibrateTool(), label: 'Calibrate underlay', options: CALIBRATE_OPTIONS },
    'modify.pushpull': { factory: () => new PushPullTool(), label: 'Push/Pull', options: PUSHPULL_OPTIONS },
    'modify.offset': { factory: () => new OffsetTool(), label: 'Offset', options: OFFSET_OPTIONS },
    'modify.trim': { factory: () => new TrimTool(), label: 'Trim' },
    'modify.extend': { factory: () => new ExtendTool(), label: 'Extend' },
    'modify.fillet': { factory: () => new FilletTool(), label: 'Fillet', options: FILLET_OPTIONS },
    'modify.mirror': { factory: () => new MirrorTool(), label: 'Mirror', options: MIRROR_OPTIONS },
    'modify.array': { factory: () => new ArrayTool(), label: 'Array', options: ARRAY_OPTIONS },
    section: { factory: () => new SectionTool(), label: 'Section', options: SECTION_OPTIONS },
  }
}

export { vectorizeView } from './vectorize'
export { autoDimensionWalls } from './annotate/autoDimension'
export type { AutoDimensionOptions } from './annotate/autoDimension'
export { ensureMarkupLayer, MARKUP_LAYER_ID, MARKUP_COLOR } from './annotate/markup'
export type * from './types'
