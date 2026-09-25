// Growable typed-array builders (amortized doubling, no per-element allocations).
import type { Vec2 } from '@cadsandbox/doc'

export class F32Buf {
  data: Float32Array
  length = 0
  constructor(capacity = 256) {
    this.data = new Float32Array(Math.max(16, capacity))
  }
  ensure(extra: number): void {
    const need = this.length + extra
    if (need <= this.data.length) return
    let cap = this.data.length * 2
    while (cap < need) cap *= 2
    const next = new Float32Array(cap)
    next.set(this.data.subarray(0, this.length))
    this.data = next
  }
  push2(a: number, b: number): void {
    this.ensure(2)
    this.data[this.length++] = a
    this.data[this.length++] = b
  }
  push3(a: number, b: number, c: number): void {
    this.ensure(3)
    this.data[this.length++] = a
    this.data[this.length++] = b
    this.data[this.length++] = c
  }
  pushArray(arr: ArrayLike<number>): void {
    this.ensure(arr.length)
    for (let i = 0; i < arr.length; i++) this.data[this.length++] = arr[i]!
  }
  toArray(): Float32Array {
    return this.data.slice(0, this.length)
  }
}

export class U32Buf {
  data: Uint32Array
  length = 0
  constructor(capacity = 256) {
    this.data = new Uint32Array(Math.max(16, capacity))
  }
  ensure(extra: number): void {
    const need = this.length + extra
    if (need <= this.data.length) return
    let cap = this.data.length * 2
    while (cap < need) cap *= 2
    const next = new Uint32Array(cap)
    next.set(this.data.subarray(0, this.length))
    this.data = next
  }
  push3(a: number, b: number, c: number): void {
    this.ensure(3)
    this.data[this.length++] = a
    this.data[this.length++] = b
    this.data[this.length++] = c
  }
  pushArray(arr: ArrayLike<number>, offset = 0): void {
    this.ensure(arr.length)
    for (let i = 0; i < arr.length; i++) this.data[this.length++] = arr[i]! + offset
  }
  toArray(): Uint32Array {
    return this.data.slice(0, this.length)
  }
}

/** 2D segment buffer: [x0,y0,x1,y1, …]. */
export class SegBuf {
  private buf: F32Buf
  constructor(capacity = 64) {
    this.buf = new F32Buf(capacity * 4)
  }
  get count(): number {
    return this.buf.length / 4
  }
  seg(x0: number, y0: number, x1: number, y1: number): void {
    this.buf.ensure(4)
    const d = this.buf.data
    let n = this.buf.length
    d[n++] = x0
    d[n++] = y0
    d[n++] = x1
    d[n++] = y1
    this.buf.length = n
  }
  segP(a: Vec2, b: Vec2): void {
    this.seg(a[0], a[1], b[0], b[1])
  }
  polyline(points: readonly Vec2[], closed = false): void {
    const n = points.length
    for (let i = 0; i < n - 1; i++) this.segP(points[i]!, points[i + 1]!)
    if (closed && n > 2) this.segP(points[n - 1]!, points[0]!)
  }
  append(segments: ArrayLike<number>): void {
    this.buf.pushArray(segments)
  }
  toArray(): Float32Array {
    return this.buf.toArray()
  }
}

/** 3D segment buffer: [x,y,z, x,y,z, …]. */
export class Seg3Buf {
  private buf: F32Buf
  constructor(capacity = 64) {
    this.buf = new F32Buf(capacity * 6)
  }
  get count(): number {
    return this.buf.length / 6
  }
  seg(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    this.buf.ensure(6)
    const d = this.buf.data
    let n = this.buf.length
    d[n++] = x0
    d[n++] = y0
    d[n++] = z0
    d[n++] = x1
    d[n++] = y1
    d[n++] = z1
    this.buf.length = n
  }
  append(segments: ArrayLike<number>): void {
    this.buf.pushArray(segments)
  }
  toArray(): Float32Array {
    return this.buf.toArray()
  }
}
