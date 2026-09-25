import { describe, expect, it } from 'vitest'
import {
  adaptiveGridStep,
  axisOf,
  closestPointOnSegment,
  intersectSegments2D,
  makePlane,
  orthoSnap,
  perpendicularFoot,
  planePoint,
  planeUV,
  polarSnap,
  projectToPlane,
  rayPlane,
  segmentsClosest,
  snapToGrid,
} from '../src/snapping/snapMath'

const xy = makePlane([0, 0, 0], [0, 0, 1])

describe('work planes', () => {
  it('builds orthonormal frames with u = +X for horizontal planes', () => {
    expect(xy.u).toEqual([1, 0, 0])
    expect(xy.v).toEqual([0, 1, 0])
    const front = makePlane([0, 0, 0], [0, -1, 0])
    // u × v = normal
    const n = [front.u[1] * front.v[2] - front.u[2] * front.v[1], front.u[2] * front.v[0] - front.u[0] * front.v[2], front.u[0] * front.v[1] - front.u[1] * front.v[0]]
    expect(n[0]).toBeCloseTo(front.normal[0])
    expect(n[1]).toBeCloseTo(front.normal[1])
    expect(n[2]).toBeCloseTo(front.normal[2])
  })

  it('round-trips plane coordinates and projects points', () => {
    const p = makePlane([1, 2, 3], [0, 0, 1])
    const uv = planeUV(p, [4, 6, 3])
    expect(uv).toEqual([3, 4])
    expect(planePoint(p, uv)).toEqual([4, 6, 3])
    expect(projectToPlane(p, [4, 6, 10])).toEqual([4, 6, 3])
  })

  it('intersects rays with planes', () => {
    expect(rayPlane([0, 0, 5], [0, 0, -1], xy)).toEqual([0, 0, 0])
    expect(rayPlane([0, 0, 5], [1, 0, 0], xy)).toBeNull()
    expect(rayPlane([0, 0, -5], [0, 0, -1], xy)).toBeNull()
    expect(rayPlane([0, 0, -5], [0, 0, -1], xy, true)).toEqual([0, 0, 0])
  })
})

describe('grid / polar / ortho snapping', () => {
  it('snaps to grid steps in the plane, keeping height', () => {
    const p = snapToGrid(xy, [1.26, -0.74, 0.5], 0.5)
    expect(p[0]).toBeCloseTo(1.5)
    expect(p[1]).toBeCloseTo(-0.5)
    expect(p[2]).toBeCloseTo(0.5)
  })

  it('snaps directions to 15° steps', () => {
    const r = polarSnap(xy, [0, 0, 0], [1, 0.2, 0], (15 * Math.PI) / 180)!
    expect(r.angle).toBeCloseTo((15 * Math.PI) / 180)
    expect(Math.hypot(r.point[0], r.point[1])).toBeCloseTo(Math.hypot(1, 0.2))
    expect(polarSnap(xy, [0, 0, 0], [0, 0, 0], 0.1)).toBeNull()
  })

  it('locks to the dominant axis in ortho mode', () => {
    expect(orthoSnap(xy, [0, 0, 0], [3, 1, 0])).toEqual({ point: [3, 0, 0], axis: 'u' })
    expect(orthoSnap(xy, [0, 0, 0], [1, 3, 0])).toEqual({ point: [0, 3, 0], axis: 'v' })
  })

  it('picks readable adaptive grid steps', () => {
    expect(adaptiveGridStep(1, 10, 0.001)).toBeCloseTo(0.1)
    expect(adaptiveGridStep(1, 10, 0.05)).toBeCloseTo(1)
    expect(adaptiveGridStep(1, 10, 0.5)).toBeCloseTo(10)
  })
})

describe('segments', () => {
  it('finds closest points and perpendicular feet', () => {
    const c = closestPointOnSegment([2, 5, 0], [0, 0, 0], [4, 0, 0])
    expect(c.point).toEqual([2, 0, 0])
    expect(c.t).toBeCloseTo(0.5)
    expect(c.dist).toBeCloseTo(5)
    const clamped = closestPointOnSegment([9, 1, 0], [0, 0, 0], [4, 0, 0])
    expect(clamped.point).toEqual([4, 0, 0])
    expect(perpendicularFoot([9, 1, 0], [0, 0, 0], [4, 0, 0])).toEqual([9, 0, 0])
    expect(perpendicularFoot([1, 1, 0], [0, 0, 0], [0, 0, 0])).toBeNull()
  })

  it('intersects 2D segments with and without extension', () => {
    expect(intersectSegments2D([0, 0], [2, 2], [0, 2], [2, 0])).toEqual([1, 1])
    expect(intersectSegments2D([0, 0], [1, 1], [3, 0], [3, 5])).toBeNull()
    const ext = intersectSegments2D([0, 0], [1, 1], [3, 0], [3, 5], true)!
    expect(ext[0]).toBeCloseTo(3)
    expect(ext[1]).toBeCloseTo(3)
    expect(intersectSegments2D([0, 0], [1, 0], [0, 1], [1, 1])).toBeNull() // parallel
  })

  it('computes closest points between 3D segments', () => {
    const r = segmentsClosest([0, 0, 0], [2, 0, 0], [1, -1, 1], [1, 1, 1])
    expect(r.dist).toBeCloseTo(1)
    expect(r.pa).toEqual([1, 0, 0])
    expect(r.pb[0]).toBeCloseTo(1)
    expect(r.pb[2]).toBeCloseTo(1)
    const touching = segmentsClosest([0, 0, 0], [2, 0, 0], [1, -1, 0], [1, 1, 0])
    expect(touching.dist).toBeCloseTo(0)
  })

  it('classifies axis-aligned directions', () => {
    expect(axisOf([5, 0, 0])).toBe('x')
    expect(axisOf([0, -2, 0])).toBe('y')
    expect(axisOf([0, 0, 0.1])).toBe('z')
    expect(axisOf([1, 1, 0])).toBe('custom')
  })
})
