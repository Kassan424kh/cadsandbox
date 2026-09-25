// Solar position (NOAA General Solar Position Calculations) — pure, unit-tested.
// Inputs: geographic location, local date + hour; output: azimuth (from true north, clockwise)
// and elevation, plus the world-space direction toward the sun honoring the plan's north angle.
import type { GeoLocation, Vec3 } from '@cadsandbox/doc'

export interface SolarPosition {
  /** radians, 0 = north, π/2 = east (clockwise seen from above) */
  azimuth: number
  /** radians above the horizon (negative = below) */
  elevation: number
}

const RAD = Math.PI / 180

/** Julian day for a UTC instant. */
export function julianDay(year: number, month: number, day: number, hourUTC: number): number {
  let y = year
  let m = month
  if (m <= 2) {
    y -= 1
    m += 12
  }
  const a = Math.floor(y / 100)
  const b = 2 - a + Math.floor(a / 4)
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524.5 + hourUTC / 24
}

/** Timezone offset (hours east of UTC) for a date: IANA zone via Intl when given, else from longitude. */
export function timezoneOffsetHours(date: string, timezone: string | undefined, longitude: number): number {
  if (timezone) {
    try {
      const probe = new Date(`${date}T12:00:00Z`)
      const fmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'longOffset' })
      const part = fmt.formatToParts(probe).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT'
      const m = /GMT([+-])(\d{1,2})(?::?(\d{2}))?/.exec(part)
      if (m) return (m[1] === '-' ? -1 : 1) * (parseInt(m[2]!, 10) + (m[3] ? parseInt(m[3], 10) / 60 : 0))
      if (part === 'GMT') return 0
    } catch {
      /* fall through to longitude estimate */
    }
  }
  return Math.round(longitude / 15)
}

/** NOAA algorithm. `hour` is local clock time (decimal). */
export function solarPosition(latitude: number, longitude: number, date: string, hour: number, timezone?: string): SolarPosition {
  const [ys, ms, ds] = date.split('-')
  const year = parseInt(ys ?? '2026', 10)
  const month = parseInt(ms ?? '6', 10)
  const day = parseInt(ds ?? '21', 10)
  const tz = timezoneOffsetHours(date, timezone, longitude)
  const hourUTC = hour - tz
  const jd = julianDay(year, month, day, hourUTC)
  const t = (jd - 2451545) / 36525 // Julian century
  const L0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360
  const M = 357.52911 + t * (35999.05029 - 0.0001537 * t)
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t)
  const Mr = M * RAD
  const C = Math.sin(Mr) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(2 * Mr) * (0.019993 - 0.000101 * t) + Math.sin(3 * Mr) * 0.000289
  const trueLong = L0 + C
  const omega = 125.04 - 1934.136 * t
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD)
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD)
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD))
  const y = Math.tan((eps / 2) * RAD) ** 2
  const L0r = L0 * RAD
  const eqTime =
    4 *
    (y * Math.sin(2 * L0r) - 2 * e * Math.sin(Mr) + 4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r) - 0.5 * y * y * Math.sin(4 * L0r) - 1.25 * e * e * Math.sin(2 * Mr)) *
    (1 / RAD) // minutes
  let tst = (hourUTC * 60 + eqTime + 4 * longitude) % 1440
  if (tst < 0) tst += 1440
  const ha = tst / 4 < 0 ? tst / 4 + 180 : tst / 4 - 180 // degrees
  const lat = latitude * RAD
  const har = ha * RAD
  const cosZen = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(har)
  const zenith = Math.acos(Math.max(-1, Math.min(1, cosZen)))
  const elevation = Math.PI / 2 - zenith
  let azimuth: number
  const azDenom = Math.cos(lat) * Math.sin(zenith)
  if (Math.abs(azDenom) > 1e-6) {
    const azRad = Math.acos(Math.max(-1, Math.min(1, (Math.sin(lat) * Math.cos(zenith) - Math.sin(decl)) / azDenom)))
    // NOAA: 180° − acos(...) before solar noon; mirrored to the west after it.
    azimuth = Math.PI - azRad
    if (ha > 0) azimuth = 2 * Math.PI - azimuth
  } else azimuth = latitude > 0 ? Math.PI : 0
  azimuth = ((azimuth % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  return { azimuth, elevation }
}

/** Unit vector pointing from the scene toward the sun (Z-up), honoring the north angle. */
export function sunDirection(pos: SolarPosition, northAngle: number): Vec3 {
  // north in plan = +Y rotated CCW by northAngle; east = north rotated clockwise 90°
  const n: [number, number] = [-Math.sin(northAngle), Math.cos(northAngle)]
  const e: [number, number] = [Math.cos(northAngle), Math.sin(northAngle)]
  const ca = Math.cos(pos.azimuth)
  const sa = Math.sin(pos.azimuth)
  const hx = n[0] * ca + e[0] * sa
  const hy = n[1] * ca + e[1] * sa
  const ce = Math.cos(pos.elevation)
  return [hx * ce, hy * ce, Math.sin(pos.elevation)]
}

/** Convenience for documents: null when no geo location. */
export function sunFromDoc(geo: GeoLocation | null, date: string, hour: number): { position: SolarPosition; direction: Vec3 } {
  const lat = geo?.latitude ?? 52.52
  const lon = geo?.longitude ?? 13.405
  const north = geo?.northAngle ?? 0
  const position = solarPosition(lat, lon, date, hour, geo?.timezone)
  return { position, direction: sunDirection(position, north) }
}

/** Sky color temperature helper: warm near the horizon, neutral at noon (used for the sun light). */
export function sunColor(elevation: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, elevation / (30 * RAD)))
  const r = 1
  const g = 0.55 + 0.42 * t
  const b = 0.25 + 0.7 * t
  return [r, g, b]
}
