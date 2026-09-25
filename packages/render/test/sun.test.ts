import { describe, expect, it } from 'vitest'
import { julianDay, solarPosition, sunDirection, timezoneOffsetHours } from '../src/renderer/sun'

const deg = (r: number) => (r * 180) / Math.PI

describe('solar position (NOAA)', () => {
  it('computes the Julian day of J2000', () => {
    expect(julianDay(2000, 1, 1, 12)).toBeCloseTo(2451545, 5)
  })

  it('resolves timezone offsets from IANA zones and longitude', () => {
    expect(timezoneOffsetHours('2026-06-21', 'Europe/Berlin', 13.4)).toBe(2) // CEST
    expect(timezoneOffsetHours('2026-01-15', 'Europe/Berlin', 13.4)).toBe(1) // CET
    expect(timezoneOffsetHours('2026-06-21', undefined, 13.4)).toBe(1)
    expect(timezoneOffsetHours('2026-06-21', undefined, -74)).toBe(-5)
  })

  it('puts the summer solstice sun high in the south at Berlin solar noon', () => {
    // Berlin 52.52°N 13.405°E, 2026-06-21, ~13:10 CEST is solar noon → elevation ≈ 61°, azimuth ≈ 180°
    const p = solarPosition(52.52, 13.405, '2026-06-21', 13.17, 'Europe/Berlin')
    expect(deg(p.elevation)).toBeGreaterThan(60)
    expect(deg(p.elevation)).toBeLessThan(62)
    expect(Math.abs(deg(p.azimuth) - 180)).toBeLessThan(2)
  })

  it('has the morning sun in the east and the evening sun in the west', () => {
    const am = solarPosition(52.52, 13.405, '2026-06-21', 8, 'Europe/Berlin')
    const pm = solarPosition(52.52, 13.405, '2026-06-21', 18, 'Europe/Berlin')
    expect(deg(am.azimuth)).toBeGreaterThan(60)
    expect(deg(am.azimuth)).toBeLessThan(120)
    expect(deg(pm.azimuth)).toBeGreaterThan(240)
    expect(deg(pm.azimuth)).toBeLessThan(300)
    expect(am.elevation).toBeGreaterThan(0)
    expect(pm.elevation).toBeGreaterThan(0)
  })

  it('is below the horizon at midnight and low in winter', () => {
    const night = solarPosition(52.52, 13.405, '2026-06-21', 0, 'Europe/Berlin')
    expect(night.elevation).toBeLessThan(0)
    const winter = solarPosition(52.52, 13.405, '2026-12-21', 12.5, 'Europe/Berlin')
    expect(deg(winter.elevation)).toBeGreaterThan(13)
    expect(deg(winter.elevation)).toBeLessThan(16)
  })

  it('works in the southern hemisphere (Sydney noon sun is in the north)', () => {
    const p = solarPosition(-33.87, 151.21, '2026-06-21', 12, 'Australia/Sydney')
    const az = deg(p.azimuth)
    expect(Math.min(az, 360 - az)).toBeLessThan(20)
    expect(deg(p.elevation)).toBeGreaterThan(30)
  })

  it('converts azimuth/elevation into a Z-up world direction honoring north angle', () => {
    const south = sunDirection({ azimuth: Math.PI, elevation: 0 }, 0)
    expect(south[0]).toBeCloseTo(0, 6)
    expect(south[1]).toBeCloseTo(-1, 6)
    expect(south[2]).toBeCloseTo(0, 6)
    const east = sunDirection({ azimuth: Math.PI / 2, elevation: 0 }, 0)
    expect(east[0]).toBeCloseTo(1, 6)
    expect(east[1]).toBeCloseTo(0, 6)
    // north rotated 90° CCW (north = -X) → sun in the "north" points along -X
    const rotated = sunDirection({ azimuth: 0, elevation: Math.PI / 4 }, Math.PI / 2)
    expect(rotated[0]).toBeCloseTo(-Math.SQRT1_2, 6)
    expect(rotated[1]).toBeCloseTo(0, 6)
    expect(rotated[2]).toBeCloseTo(Math.SQRT1_2, 6)
  })
})
