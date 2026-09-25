// Device preferences that affect data (not UI chrome): default units for new designs.
// Stored in localStorage (no personal data, no tokens).
import { useSyncExternalStore } from 'react'
import { LENGTH_UNITS, type LengthUnit } from '@cadsandbox/shared'

export interface Prefs {
  /** Length unit for new design files. */
  units: LengthUnit
  /** Trackpad navigation: two-finger scroll pans/orbits (off = the wheel always zooms to the cursor). */
  trackpadGestures: boolean
}

const KEY = 'cadsandbox.prefs'
const DEFAULTS: Prefs = { units: 'mm', trackpadGestures: false }
const listeners = new Set<() => void>()

function read(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>
    return {
      units: LENGTH_UNITS.includes(raw.units as LengthUnit) ? (raw.units as LengthUnit) : DEFAULTS.units,
      trackpadGestures: raw.trackpadGestures === true,
    }
  } catch {
    return DEFAULTS
  }
}

let current = read()

export function getPrefs(): Prefs {
  return current
}

export function setPrefs(patch: Partial<Prefs>): void {
  current = { ...current, ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    /* ignore */
  }
  for (const l of listeners) l()
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current,
    () => current,
  )
}
