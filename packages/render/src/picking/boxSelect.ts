// Window / crossing box selection classification (pure, unit-tested).
// Dragging left→right = window (objects fully inside), right→left = crossing (any overlap) — the
// AutoCAD convention that architects expect.
export interface Rect {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export type BoxMode = 'window' | 'crossing'

export function boxMode(startX: number, endX: number): BoxMode {
  return endX >= startX ? 'window' : 'crossing'
}

export function normalizeRect(x0: number, y0: number, x1: number, y1: number): Rect {
  return { minX: Math.min(x0, x1), minY: Math.min(y0, y1), maxX: Math.max(x0, x1), maxY: Math.max(y0, y1) }
}

export function rectContains(outer: Rect, inner: Rect): boolean {
  return inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minY >= outer.minY && inner.maxY <= outer.maxY
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY
}

/** True when an object's screen rect passes the selection box in the given mode. */
export function classifyBox(objectRect: Rect, box: Rect, mode: BoxMode): boolean {
  return mode === 'window' ? rectContains(box, objectRect) : rectsIntersect(objectRect, box)
}

/** Point-in-rect test for tiny drags treated as clicks. */
export function isClickDrag(x0: number, y0: number, x1: number, y1: number, tolerancePx = 4): boolean {
  return Math.abs(x1 - x0) <= tolerancePx && Math.abs(y1 - y0) <= tolerancePx
}

/** Screen-space rect of projected points (clip-space NDC → pixels). Returns null when all behind the camera. */
export function rectFromPoints(points: ArrayLike<number>, width: number, height: number): Rect | null {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (let i = 0; i + 1 < points.length; i += 2) {
    const x = ((points[i]! + 1) / 2) * width
    const y = ((1 - points[i + 1]!) / 2) * height
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  if (minX === Infinity) return null
  return { minX, minY, maxX, maxY }
}
