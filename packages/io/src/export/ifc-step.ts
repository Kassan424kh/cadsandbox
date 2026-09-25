// ISO 10303-21 (STEP physical file) writer primitives for IFC4 + IFC GlobalId encoding.

const B64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$'

/** Compress 16 bytes (a UUID) into the 22-character IFC GlobalId alphabet (buildingSMART algorithm). */
export function ifcGuid(bytes: Uint8Array): string {
  const b = bytes
  const nums = [b[0]!, (b[1]! << 16) | (b[2]! << 8) | b[3]!, (b[4]! << 16) | (b[5]! << 8) | b[6]!, (b[7]! << 16) | (b[8]! << 8) | b[9]!, (b[10]! << 16) | (b[11]! << 8) | b[12]!, (b[13]! << 16) | (b[14]! << 8) | b[15]!]
  let s = ''
  nums.forEach((n, i) => {
    let part = ''
    let v = n
    for (let k = 0; k < (i === 0 ? 2 : 4); k++) {
      part = B64[v % 64] + part
      v = Math.floor(v / 64)
    }
    s += part
  })
  return s
}

export const isIfcGuid = (s: unknown): s is string => typeof s === 'string' && /^[0-3][0-9A-Za-z_$]{21}$/.test(s)

/** Random (version 4) GlobalId. */
export function randomIfcGuid(): string {
  const b = new Uint8Array(16)
  globalThis.crypto.getRandomValues(b)
  b[6] = (b[6]! & 0x0f) | 0x40
  b[8] = (b[8]! & 0x3f) | 0x80
  return ifcGuid(b)
}

// ------------------------------------------------------------------ value tokens
/** STEP string literal ('' escaping, \X2\ / \X4\ for non-ASCII). */
export function S(text: string | null | undefined): string {
  if (text === null || text === undefined) return '$'
  let out = "'"
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    if (ch === "'") out += "''"
    else if (ch === '\\') out += '\\\\'
    else if (cp >= 0x20 && cp < 0x7f) out += ch
    else if (cp <= 0xffff) out += `\\X2\\${cp.toString(16).toUpperCase().padStart(4, '0')}\\X0\\`
    else out += `\\X4\\${cp.toString(16).toUpperCase().padStart(8, '0')}\\X0\\`
  }
  return out + "'"
}

/** STEP REAL (always with a decimal point). */
export function R(x: number): string {
  if (!Number.isFinite(x) || Math.abs(x) < 1e-12) return '0.'
  let s = Number(x.toPrecision(12)).toString()
  if (s.includes('e')) {
    const [m, e] = s.split('e') as [string, string]
    s = `${m.includes('.') ? m : `${m}.`}E${e}`
  } else if (!s.includes('.')) s += '.'
  return s
}
export const I = (n: number): string => String(Math.round(n))
export const E = (v: string): string => `.${v}.`
export const B = (v: boolean): string => (v ? '.T.' : '.F.')
export const L = (items: readonly string[]): string => `(${items.join(',')})`
export const T = (type: string, value: string): string => `${type}(${value})`
export const $ = '$'
export const STAR = '*'

/** Typed IfcValue for property sets. */
export function ifcValue(v: unknown): string | null {
  if (typeof v === 'boolean') return T('IFCBOOLEAN', B(v))
  if (typeof v === 'number' && Number.isFinite(v)) return Number.isInteger(v) && Math.abs(v) < 2 ** 31 ? T('IFCINTEGER', I(v)) : T('IFCREAL', R(v))
  if (typeof v === 'string') return v.length > 255 ? T('IFCTEXT', S(v)) : T('IFCLABEL', S(v))
  return null
}

export class StepWriter {
  private readonly lines: string[] = []
  private readonly memo = new Map<string, string>()
  private next = 1

  /** Append an entity instance; returns its reference (#n). */
  add(type: string, args: readonly string[]): string {
    const ref = `#${this.next++}`
    this.lines.push(`${ref}=${type}(${args.join(',')});`)
    return ref
  }

  /** Like add(), but identical instances (points, directions…) are written once. */
  shared(type: string, args: readonly string[]): string {
    const key = `${type}(${args.join(',')})`
    let ref = this.memo.get(key)
    if (!ref) {
      ref = this.add(type, args)
      this.memo.set(key, ref)
    }
    return ref
  }

  point(p: readonly number[]): string {
    return this.shared('IFCCARTESIANPOINT', [L(p.map(R))])
  }
  dir(d: readonly number[]): string {
    return this.shared('IFCDIRECTION', [L(d.map(R))])
  }
  axis3(origin: readonly number[], z?: readonly number[] | null, x?: readonly number[] | null): string {
    return this.shared('IFCAXIS2PLACEMENT3D', [this.point(origin), z ? this.dir(z) : $, x ? this.dir(x) : $])
  }
  axis2(origin: readonly number[], x?: readonly number[] | null): string {
    return this.shared('IFCAXIS2PLACEMENT2D', [this.point(origin), x ? this.dir(x) : $])
  }

  get count(): number {
    return this.next - 1
  }

  toString(header: { fileName: string; author: string; organization: string; description: string; timestamp: string }): string {
    return [
      'ISO-10303-21;',
      'HEADER;',
      `FILE_DESCRIPTION((${S(header.description)}),'2;1');`,
      `FILE_NAME(${S(header.fileName)},${S(header.timestamp)},(${S(header.author)}),(${S(header.organization)}),'CadSandbox','CadSandbox IFC exporter','');`,
      "FILE_SCHEMA(('IFC4'));",
      'ENDSEC;',
      'DATA;',
      ...this.lines,
      'ENDSEC;',
      'END-ISO-10303-21;',
      '',
    ].join('\n')
  }
}
