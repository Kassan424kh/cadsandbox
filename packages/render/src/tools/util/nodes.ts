// Layer ids, wall presets and small node-construction helpers shared by the tools.
import type { AnyNode, NewNode, Quat, Transform, Vec2, Vec3, WallLayer, WallParams } from '@cadsandbox/doc'
import type { ToolOptionSpec } from '../types'

export const LAYERS = {
  walls: 'layer-walls',
  openings: 'layer-openings',
  dims: 'layer-dims',
  anno: 'layer-anno',
  hatch: 'layer-hatch',
  furniture: 'layer-furniture',
  structure: 'layer-structure',
} as const

export function transformAt(p: Vec3, rotationZ = 0, scale: Vec3 = [1, 1, 1]): Transform {
  const r: Quat = [0, 0, Math.sin(rotationZ / 2), Math.cos(rotationZ / 2)]
  return { p: [p[0], p[1], p[2]], r, s: [...scale] as Vec3 }
}

export function transformWithQuat(p: Vec3, r: Quat, scale: Vec3 = [1, 1, 1]): Transform {
  return { p: [p[0], p[1], p[2]], r: [...r] as Quat, s: [...scale] as Vec3 }
}

/** Build a NewNode with the common tool fields set. */
export function newNode<T extends AnyNode['type']>(
  type: T,
  params: NewNode<T>['params'],
  extra: Omit<NewNode<T>, 'type' | 'params'> = {},
): NewNode<T> {
  return { type, params, ...extra }
}

export function vec2s(points: readonly Vec2[]): Vec2[] {
  return points.map((p) => [p[0], p[1]])
}

// ------------------------------------------------------------------ wall presets
export interface WallPreset {
  id: string
  label: string
  thickness: number
  layers?: WallLayer[]
  exterior: boolean
  structural: boolean
}

const layer = (material: string | null, thickness: number, fn: WallLayer['function']): WallLayer => ({ material, thickness, function: fn })

export const WALL_PRESETS: WallPreset[] = [
  { id: 'custom', label: 'Custom (thickness option)', thickness: 0.24, exterior: false, structural: true },
  {
    id: 'ext-365-masonry',
    label: 'Exterior 36.5 masonry + insulation',
    thickness: 0.365,
    exterior: true,
    structural: true,
    layers: [
      layer('mat-plaster', 0.015, 'finish'),
      layer('mat-masonry-ks', 0.175, 'structure'),
      layer('mat-insulation', 0.16, 'insulation'),
      layer('mat-plaster', 0.015, 'finish'),
    ],
  },
  {
    id: 'ext-300-concrete',
    label: 'Exterior 30 concrete + insulation',
    thickness: 0.3,
    exterior: true,
    structural: true,
    layers: [layer('mat-concrete-rc', 0.2, 'structure'), layer('mat-insulation', 0.1, 'insulation')],
  },
  {
    id: 'ext-250-timber',
    label: 'Exterior 25 timber frame',
    thickness: 0.25,
    exterior: true,
    structural: true,
    layers: [
      layer('mat-plaster', 0.015, 'finish'),
      layer('mat-insulation', 0.16, 'insulation'),
      layer('mat-insulation', 0.06, 'insulation'),
      layer('mat-plaster', 0.015, 'finish'),
    ],
  },
  { id: 'int-240', label: 'Interior 24 masonry (load-bearing)', thickness: 0.24, exterior: false, structural: true, layers: [layer('mat-masonry-ks', 0.24, 'structure')] },
  { id: 'int-175', label: 'Interior 17.5 masonry', thickness: 0.175, exterior: false, structural: true, layers: [layer('mat-masonry-ks', 0.175, 'structure')] },
  { id: 'int-115', label: 'Interior 11.5 masonry', thickness: 0.115, exterior: false, structural: false, layers: [layer('mat-masonry-ks', 0.115, 'structure')] },
  {
    id: 'drywall-100',
    label: 'Drywall 10',
    thickness: 0.1,
    exterior: false,
    structural: false,
    layers: [layer('mat-plaster', 0.0125, 'finish'), layer('mat-insulation', 0.075, 'insulation'), layer('mat-plaster', 0.0125, 'finish')],
  },
  { id: 'concrete-200', label: 'Concrete 20', thickness: 0.2, exterior: false, structural: true, layers: [layer('mat-concrete-rc', 0.2, 'structure')] },
]

export function wallPreset(id: unknown): WallPreset {
  return WALL_PRESETS.find((p) => p.id === id) ?? WALL_PRESETS[0]
}

export const WALL_PRESET_OPTIONS: ToolOptionSpec['options'] = WALL_PRESETS.map((p) => ({ value: p.id, label: p.label }))

/** Wall params from tool options (preset overrides thickness/layers unless custom). */
export function wallParamsFromOptions(options: Record<string, unknown>, levelHeight: number): Omit<WallParams, 'a' | 'b'> {
  const preset = wallPreset(options.preset)
  const custom = preset.id === 'custom'
  const thickness = custom ? num(options.thickness, 0.24) : preset.thickness
  const params: Omit<WallParams, 'a' | 'b'> = {
    thickness,
    height: num(options.height, 0) > 0 ? num(options.height, 0) : levelHeight,
    baseOffset: num(options.baseOffset, 0),
    justification: (options.justification as WallParams['justification']) ?? 'center',
    exterior: custom ? bool(options.exterior, false) : preset.exterior || bool(options.exterior, false),
    structural: preset.structural,
  }
  if (!custom && preset.layers) params.layers = preset.layers.map((l) => ({ ...l }))
  return params
}

export function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

export function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

export function str<T extends string>(v: unknown, fallback: T, allowed?: readonly T[]): T {
  if (typeof v !== 'string') return fallback
  if (allowed && !allowed.includes(v as T)) return fallback
  return v as T
}

/** Selection-list option spec helper. */
export function selectOption(key: string, label: string, def: string, values: readonly (string | { value: string; label: string })[]): ToolOptionSpec {
  return {
    key,
    label,
    kind: 'select',
    default: def,
    options: values.map((v) => (typeof v === 'string' ? { value: v, label: v.charAt(0).toUpperCase() + v.slice(1).replace(/-/g, ' ') } : v)),
  }
}

export function lengthOption(key: string, label: string, def: number, min = 0, max?: number): ToolOptionSpec {
  return { key, label, kind: 'length', default: def, min, ...(max !== undefined ? { max } : {}) }
}

export function numberOption(key: string, label: string, def: number, min?: number, max?: number): ToolOptionSpec {
  return { key, label, kind: 'number', default: def, ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) }
}

export function angleOption(key: string, label: string, def: number): ToolOptionSpec {
  return { key, label, kind: 'angle', default: def }
}

export function boolOption(key: string, label: string, def: boolean): ToolOptionSpec {
  return { key, label, kind: 'boolean', default: def }
}

/** Defaults from a spec list (used by tools when activated without options). */
export function optionDefaults(specs: ToolOptionSpec[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const s of specs) out[s.key] = s.default
  return out
}
