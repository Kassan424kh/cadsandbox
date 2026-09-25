import type { ToolRegistry } from '../tools/types'
import type { CoreToolDeps } from './deps'
import { SelectTool } from './selectTool'
import { OrbitTool, PanTool, WalkTool, ZoomWindowTool } from './navigationTools'
import { PlaceTool } from './placeTool'

export function createCoreTools(d: CoreToolDeps): ToolRegistry {
  return {
    select: { factory: () => new SelectTool(d), label: 'Select' },
    pan: { factory: () => new PanTool(), label: 'Pan' },
    orbit: { factory: () => new OrbitTool(), label: 'Orbit' },
    'zoom-window': { factory: () => new ZoomWindowTool(d), label: 'Zoom Window' },
    walk: { factory: () => new WalkTool(d), label: 'Walk' },
    place: { factory: () => new PlaceTool(d), label: 'Place' },
  }
}

export type { CoreToolDeps } from './deps'
