// Unit helpers for importers.
import { METERS_PER_UNIT } from '@cadsandbox/shared'
import type { LengthUnit } from '@cadsandbox/shared'

export const unitScale = (u: LengthUnit): number => METERS_PER_UNIT[u]

/** DXF $INSUNITS code → meters per unit (null = unitless). */
export function insunitsScale(code: number): number | null {
  const table: Record<number, number> = {
    1: 0.0254, // inches
    2: 0.3048, // feet
    3: 1609.344, // miles
    4: 0.001, // millimeters
    5: 0.01, // centimeters
    6: 1, // meters
    7: 1000, // kilometers
    8: 0.0254e-6, // microinches
    9: 0.0254e-3, // mils
    10: 0.9144, // yards
    11: 1e-10, // angstroms
    12: 1e-9, // nanometers
    13: 1e-6, // microns
    14: 0.1, // decimeters
    15: 10, // decameters
    16: 100, // hectometers
    17: 1e9, // gigameters
    21: 1200 / 3937, // US survey feet
    22: 0.0254000508, // US survey inch
    23: 0.9144018288, // US survey yard
    24: 1609.347219, // US survey mile
  }
  return table[code] ?? null
}

/** $INSUNITS code for a length unit. */
export const INSUNITS: Record<LengthUnit, number> = { in: 1, ft: 2, mm: 4, cm: 5, m: 6 }

/** 3MF model unit attribute → meters. */
export function threeMfUnitScale(unit: string | null | undefined): number {
  switch ((unit ?? 'millimeter').toLowerCase()) {
    case 'micron':
      return 1e-6
    case 'centimeter':
      return 0.01
    case 'inch':
      return 0.0254
    case 'foot':
      return 0.3048
    case 'meter':
      return 1
    default:
      return 0.001
  }
}
