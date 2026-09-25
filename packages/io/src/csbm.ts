// CSBM — the content-addressed binary mesh blob used by `mesh` nodes. The codec lives in
// @cadsandbox/geometry (single source of truth); io adds the blob MIME type and a bounds helper.
export { encodeCSBM, decodeCSBM, CSBM_VERSION } from '@cadsandbox/geometry'

export const CSBM_MIME = 'application/vnd.cadsandbox.mesh'

/** Axis-aligned bounds of a positions array. */
export function positionBounds(p: ArrayLike<number>): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = p[i + k]!
      if (v < min[k]!) min[k] = v
      if (v > max[k]!) max[k] = v
    }
  }
  if (min[0] === Infinity) return { min: [0, 0, 0], max: [0, 0, 0] }
  return { min, max }
}
