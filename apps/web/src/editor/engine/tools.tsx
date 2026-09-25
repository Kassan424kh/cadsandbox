// Tool metadata for the chrome: labels (i18n keys), icons, groups, shortcuts and fallback option
// specs (used until @cadsandbox/render's createTools() provides the authoritative ToolOptionSpec).
import { useEffect, useState, type ReactNode } from 'react'
import { Angle, Circle, Cloud, Footprints, Grid3x3, Hand, LandPlot, MessageSquarePlus, MousePointer2, Orbit, PenTool, Pencil, Pentagon, Ruler, Scaling, Slash, Spline, Square, Triangle, Type, ZoomIn, Grid2x2 } from 'lucide-react'
import { TOOL_SHORTCUTS, type ToolId } from '@cadsandbox/render'
// Type-only import (erased at runtime): TS maps the .js subpath onto src/tools/types.ts.
import type { ToolOptionSpec, ToolRegistry } from '@cadsandbox/render/tools/types.js'
import {
  IconArc,
  IconBeam,
  IconColumn,
  IconDimension,
  IconDistance,
  IconDoor,
  IconExtend,
  IconFillet,
  IconHatch,
  IconLeader,
  IconMirror,
  IconOffset,
  IconOpening,
  IconPolyline,
  IconPushPull,
  IconRailing,
  IconRoof,
  IconRoom,
  IconSection,
  IconSlab,
  IconStair,
  IconTrim,
  IconWall,
  IconWindow,
  IconEllipse,
} from '../library/icons'

export type ToolGroup = 'select' | 'nav' | 'draw' | 'add' | 'build' | 'annotate' | 'modify'

export interface ToolMeta {
  id: ToolId
  key: string
  fallback: string
  icon: ReactNode
  group: ToolGroup
  shortcut?: string
  /** Option specs used until the engine's registry provides them. */
  fallbackOptions?: ToolOptionSpec[]
}

const len = (key: string, label: string, def: number, min = 0, max = 100): ToolOptionSpec => ({ key, label, kind: 'length', default: def, min, max })
const num = (key: string, label: string, def: number, min = 0, max = 1000): ToolOptionSpec => ({ key, label, kind: 'number', default: def, min, max })
const ang = (key: string, label: string, def: number): ToolOptionSpec => ({ key, label, kind: 'angle', default: def, min: 0, max: 90 })
const bool = (key: string, label: string, def: boolean): ToolOptionSpec => ({ key, label, kind: 'boolean', default: def })
const sel = (key: string, label: string, def: string, options: string[]): ToolOptionSpec => ({ key, label, kind: 'select', default: def, options: options.map((v) => ({ value: v, label: v.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) })) })

const DIN_USAGE = ['NUF1', 'NUF2', 'NUF3', 'NUF4', 'NUF5', 'NUF6', 'NUF7', 'TF', 'VF']

const meta = (id: ToolId, key: string, fallback: string, icon: ReactNode, group: ToolGroup, fallbackOptions?: ToolOptionSpec[]): ToolMeta => ({
  id,
  key: `tool.${key}`,
  fallback,
  icon,
  group,
  shortcut: TOOL_SHORTCUTS[id],
  fallbackOptions,
})

export const TOOL_META: Record<ToolId, ToolMeta> = {
  select: meta('select', 'select', 'Select', <MousePointer2 />, 'select'),
  pan: meta('pan', 'pan', 'Pan', <Hand />, 'nav'),
  orbit: meta('orbit', 'orbit', 'Orbit', <Orbit />, 'nav'),
  'zoom-window': meta('zoom-window', 'zoomWindow', 'Zoom window', <ZoomIn />, 'nav'),
  walk: meta('walk', 'walk', 'Walk', <Footprints />, 'nav', [len('eyeHeight', 'Eye height', 1.7, 0.5, 3), num('speed', 'Speed', 1.5, 0.2, 10)]),
  place: meta('place', 'place', 'Place', <Square />, 'add'),
  'draw.line': meta('draw.line', 'line', 'Line', <Slash />, 'draw'),
  'draw.polyline': meta('draw.polyline', 'polyline', 'Polyline', <IconPolyline />, 'draw', [bool('closed', 'Close path', false)]),
  'draw.rect': meta('draw.rect', 'rect', 'Rectangle', <Square />, 'draw', [len('cornerRadius', 'Corner radius', 0, 0, 5)]),
  'draw.circle': meta('draw.circle', 'circle', 'Circle', <Circle />, 'draw'),
  'draw.arc': meta('draw.arc', 'arc', 'Arc', <IconArc />, 'draw'),
  'draw.ellipse': meta('draw.ellipse', 'ellipse', 'Ellipse', <IconEllipse />, 'draw'),
  'draw.spline': meta('draw.spline', 'spline', 'Spline', <Spline />, 'draw'),
  'draw.pen': meta('draw.pen', 'pen', 'Pen', <PenTool />, 'draw', [len('depth', 'Extrude depth', 0.2, 0, 50)]),
  'draw.hatch': meta('draw.hatch', 'hatch', 'Hatch', <IconHatch />, 'draw', [sel('pattern', 'Pattern', 'ansi31', ['ansi31', 'ansi32', 'ansi37', 'concrete', 'brick', 'insulation', 'earth', 'gravel', 'wood', 'steel', 'glass', 'tiles', 'dots', 'grid', 'solid']), num('scale', 'Scale', 1, 0.1, 20), ang('angle', 'Angle', 0)]),
  'draw.text': meta('draw.text', 'text', 'Text', <Type />, 'draw', [len('size', 'Size', 0.25, 0.01, 10), sel('font', 'Font', 'sans', ['sans', 'serif', 'mono', 'display'])]),
  'arch.wall': meta('arch.wall', 'wall', 'Wall', <IconWall />, 'build', [len('thickness', 'Thickness', 0.24, 0.01, 2), len('height', 'Height', 2.75, 0.1, 30), sel('justification', 'Justify', 'center', ['center', 'left', 'right']), bool('exterior', 'Exterior', false)]),
  'arch.door': meta('arch.door', 'door', 'Door', <IconDoor />, 'build', [sel('style', 'Style', 'single', ['single', 'double', 'sliding', 'double-sliding', 'folding', 'pocket', 'garage', 'revolving']), len('width', 'Width', 0.885, 0.3, 6), len('height', 'Height', 2.01, 0.5, 6), sel('hinge', 'Hinge', 'left', ['left', 'right']), sel('opensTo', 'Opens to', 'left', ['left', 'right'])]),
  'arch.window': meta('arch.window', 'window', 'Window', <IconWindow />, 'build', [sel('style', 'Style', 'casement', ['casement', 'double-casement', 'fixed', 'sliding', 'tilt-turn', 'awning', 'hung', 'bay', 'skylight']), len('width', 'Width', 1.01, 0.2, 8), len('height', 'Height', 1.26, 0.2, 6), len('sill', 'Sill', 0.9, 0, 3)]),
  'arch.opening': meta('arch.opening', 'opening', 'Opening', <IconOpening />, 'build', [len('width', 'Width', 1.0, 0.1, 10), len('height', 'Height', 2.1, 0.1, 10), len('sill', 'Sill', 0, 0, 5)]),
  'arch.slab': meta('arch.slab', 'slab', 'Slab', <IconSlab />, 'build', [sel('kind', 'Kind', 'floor', ['floor', 'ceiling', 'foundation', 'roof', 'balcony']), len('thickness', 'Thickness', 0.2, 0.02, 2), len('offset', 'Offset', 0, -5, 5)]),
  'arch.roof': meta('arch.roof', 'roof', 'Roof', <IconRoof />, 'build', [sel('kind', 'Kind', 'gable', ['flat', 'shed', 'gable', 'hip', 'mansard', 'gambrel', 'pyramid']), ang('pitchDeg', 'Pitch', 35), len('overhang', 'Overhang', 0.5, 0, 3), len('thickness', 'Thickness', 0.25, 0.05, 1)]),
  'arch.stair': meta('arch.stair', 'stair', 'Stair', <IconStair />, 'build', [sel('kind', 'Kind', 'straight', ['straight', 'l-shape', 'u-shape', 'spiral']), len('width', 'Width', 1.0, 0.6, 4), len('treadDepth', 'Tread', 0.27, 0.2, 0.4), sel('turn', 'Turn', 'left', ['left', 'right'])]),
  'arch.column': meta('arch.column', 'column', 'Column', <IconColumn />, 'build', [sel('shape', 'Shape', 'rect', ['rect', 'round', 'h-beam']), len('width', 'Width', 0.3, 0.05, 3), len('depth', 'Depth', 0.3, 0.05, 3), len('height', 'Height', 2.75, 0.1, 30)]),
  'arch.beam': meta('arch.beam', 'beam', 'Beam', <IconBeam />, 'build', [sel('shape', 'Shape', 'rect', ['rect', 'i-beam', 'round']), len('width', 'Width', 0.2, 0.02, 2), len('height', 'Height', 0.4, 0.02, 3)]),
  'arch.railing': meta('arch.railing', 'railing', 'Railing', <IconRailing />, 'build', [sel('style', 'Style', 'bars', ['bars', 'glass', 'solid', 'cable']), len('height', 'Height', 1.0, 0.3, 2), len('postSpacing', 'Post spacing', 1.2, 0.2, 5)]),
  'arch.room': meta('arch.room', 'room', 'Room', <IconRoom />, 'build', [sel('usage', 'Usage (DIN 277)', 'NUF1', DIN_USAGE), bool('auto', 'Auto-detect from walls', true)]),
  'measure.distance': meta('measure.distance', 'measureDistance', 'Distance', <IconDistance />, 'annotate'),
  'measure.area': meta('measure.area', 'measureArea', 'Area', <LandPlot />, 'annotate'),
  'measure.angle': meta('measure.angle', 'measureAngle', 'Angle', <Angle />, 'annotate'),
  'annotate.dimension': meta('annotate.dimension', 'dimension', 'Dimension', <IconDimension />, 'annotate', [sel('kind', 'Kind', 'aligned', ['linear', 'aligned', 'angular', 'radius', 'diameter', 'arc-length']), len('offset', 'Offset', 0.5, 0, 10)]),
  'annotate.leader': meta('annotate.leader', 'leader', 'Leader', <IconLeader />, 'annotate'),
  'annotate.comment': meta('annotate.comment', 'comment', 'Comment', <MessageSquarePlus />, 'annotate'),
  'annotate.chain': meta('annotate.chain', 'chain', 'Chain dimension', <Ruler />, 'annotate', [sel('axis', 'Direction', 'auto', ['auto', 'x', 'y']), len('textSize', 'Text size', 0.2, 0.01, 5)]),
  'annotate.grid': meta('annotate.grid', 'grid', 'Grid axes', <Grid3x3 />, 'annotate', [sel('mode', 'Mode', 'single', ['single', 'rect']), sel('bubble', 'Bubbles', 'start', ['start', 'end', 'both', 'none']), num('countX', 'Axes A, B, C…', 4, 1, 50), len('spacingX', 'Spacing A–B', 5, 0.01, 100), num('countY', 'Axes 1, 2, 3…', 3, 1, 50), len('spacingY', 'Spacing 1–2', 4, 0.01, 100)]),
  'annotate.levelmark': meta('annotate.levelmark', 'levelmark', 'Height marker', <Triangle />, 'annotate', [sel('variant', 'Variant', 'plan', ['plan', 'section']), sel('prefix', 'Prefix', 'none', ['none', 'OKFF', 'OKRF', 'OK', 'UK'])]),
  'annotate.cloud': meta('annotate.cloud', 'cloud', 'Revision cloud', <Cloud />, 'annotate', [len('arcLength', 'Arc length', 0.5, 0.05, 10)]),
  'annotate.markup': meta('annotate.markup', 'markup', 'Markup pen', <Pencil />, 'annotate', [num('smoothing', 'Smoothing', 2, 0, 5)]),
  'annotate.calibrate': meta('annotate.calibrate', 'calibrate', 'Calibrate underlay', <Scaling />, 'annotate'),
  'modify.pushpull': meta('modify.pushpull', 'pushpull', 'Push/Pull', <IconPushPull />, 'modify'),
  'modify.offset': meta('modify.offset', 'offset', 'Offset', <IconOffset />, 'modify', [len('distance', 'Distance', 0.1, 0.001, 50)]),
  'modify.trim': meta('modify.trim', 'trim', 'Trim', <IconTrim />, 'modify'),
  'modify.extend': meta('modify.extend', 'extend', 'Extend', <IconExtend />, 'modify'),
  'modify.fillet': meta('modify.fillet', 'fillet', 'Fillet', <IconFillet />, 'modify', [len('radius', 'Radius', 0.1, 0.001, 20)]),
  'modify.mirror': meta('modify.mirror', 'mirror', 'Mirror', <IconMirror />, 'modify', [bool('copy', 'Keep original', true)]),
  'modify.array': meta('modify.array', 'array', 'Array', <Grid2x2 />, 'modify', [num('count', 'Count', 3, 2, 500), len('spacing', 'Spacing', 1, 0.001, 100), sel('mode', 'Mode', 'linear', ['linear', 'grid', 'polar'])]),
  section: meta('section', 'section', 'Section', <IconSection />, 'annotate', [len('depth', 'View depth', 0, 0, 500)]),
}

export const DRAW_TOOLS: ToolId[] = ['draw.line', 'draw.polyline', 'draw.rect', 'draw.circle', 'draw.arc', 'draw.ellipse', 'draw.spline', 'draw.pen', 'draw.hatch', 'draw.text']
export const BUILD_TOOLS: ToolId[] = ['arch.wall', 'arch.door', 'arch.window', 'arch.opening', 'arch.slab', 'arch.roof', 'arch.stair', 'arch.column', 'arch.beam', 'arch.railing', 'arch.room']
export const ANNOTATE_TOOLS: ToolId[] = ['measure.distance', 'measure.area', 'measure.angle', 'annotate.dimension', 'annotate.chain', 'annotate.leader', 'annotate.comment', 'section']
/** Drafting symbols & review tools (second row of the Annotate menu). */
export const DRAFTING_TOOLS: ToolId[] = ['annotate.grid', 'annotate.levelmark', 'annotate.cloud', 'annotate.markup', 'annotate.calibrate']
export const MODIFY_TOOLS: ToolId[] = ['modify.pushpull', 'modify.offset', 'modify.trim', 'modify.extend', 'modify.fillet', 'modify.mirror', 'modify.array']
export const NAV_TOOLS: ToolId[] = ['pan', 'orbit', 'zoom-window', 'walk']
export const ALL_TOOLS = Object.keys(TOOL_META) as ToolId[]

/** Which top-bar mode a tool belongs to. */
export function toolMode(tool: ToolId): 'select' | 'draw' | 'add' | 'build' | 'annotate' | 'modify' {
  const g = TOOL_META[tool]?.group ?? 'select'
  return g === 'nav' ? 'select' : g
}

// ------------------------------------------------------------------ engine registry (optional)
type ToolsModule = Partial<{ createTools: () => ToolRegistry }>
let registryPromise: Promise<ToolRegistry | null> | null = null

/** Loads createTools() from the render package root (contract request: re-export it from index.ts);
 *  resolves null when unavailable. */
export function loadToolRegistry(): Promise<ToolRegistry | null> {
  if (!registryPromise) {
    registryPromise = import('@cadsandbox/render')
      .then((m) => {
        const mod = m as unknown as ToolsModule
        return typeof mod.createTools === 'function' ? mod.createTools() : null
      })
      .catch(() => null)
  }
  return registryPromise
}

export function toolOptionSpecs(tool: ToolId, registry: ToolRegistry | null): ToolOptionSpec[] {
  const fromEngine = registry?.[tool]?.options
  if (fromEngine && fromEngine.length > 0) return fromEngine
  return TOOL_META[tool]?.fallbackOptions ?? []
}

/** Default option values for a tool (spec defaults). */
export function toolDefaults(specs: ToolOptionSpec[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const s of specs) out[s.key] = s.default
  return out
}

// ------------------------------------------------------------------ React hook
let cachedRegistry: ToolRegistry | null | undefined
const registryListeners = new Set<() => void>()

/** The engine's tool registry (null until loaded / when unavailable). */
export function useToolRegistry(): ToolRegistry | null {
  const [, force] = useState(0)
  useEffect(() => {
    if (cachedRegistry === undefined) {
      cachedRegistry = null
      loadToolRegistry().then((r) => {
        cachedRegistry = r
        registryListeners.forEach((l) => l())
      })
    }
    const l = () => force((n) => n + 1)
    registryListeners.add(l)
    return () => {
      registryListeners.delete(l)
    }
  }, [])
  return cachedRegistry ?? null
}
