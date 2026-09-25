// Client IP handling with privacy in mind: raw IPs are used only transiently (rate limiting),
// logs get a salted hash that rotates daily, persisted records get a truncated address.
import { createHmac, randomBytes } from 'node:crypto'
import { BlockList, isIP } from 'node:net'

/** Strip IPv4-mapped IPv6 prefix and zone ids. */
export function normalizeIp(ip: string | null | undefined): string | null {
  if (!ip) return null
  let v = ip.trim()
  if (v.startsWith('[') && v.includes(']')) v = v.slice(1, v.indexOf(']'))
  const zone = v.indexOf('%')
  if (zone >= 0) v = v.slice(0, zone)
  if (v.toLowerCase().startsWith('::ffff:') && isIP(v.slice(7)) === 4) v = v.slice(7)
  return isIP(v) ? v : null
}

function expandIpv6(ip: string): string[] {
  const [head, tail] = ip.split('::') as [string, string | undefined]
  const h = head ? head.split(':') : []
  const t = tail !== undefined && tail !== '' ? tail.split(':') : []
  const fill = tail !== undefined ? Array<string>(8 - h.length - t.length).fill('0') : []
  return [...h, ...fill, ...t].map((x) => x || '0')
}

/** IPv4 → /24 (a.b.c.0), IPv6 → /48. Used for anything that is stored (audit log, sessions). */
export function truncateIp(ip: string | null | undefined): string | null {
  const v = normalizeIp(ip)
  if (!v) return null
  if (isIP(v) === 4) return v.replace(/\.\d+$/, '.0')
  const parts = expandIpv6(v)
  return `${parts.slice(0, 3).join(':')}::`
}

/** Salted, daily-rotating HMAC of the IP (never reversible, not linkable across days). */
export class IpHasher {
  private salt = randomBytes(32)
  private day = this.today()

  private today(): number {
    return Math.floor(Date.now() / 86_400_000)
  }

  hash(ip: string | null | undefined): string {
    const d = this.today()
    if (d !== this.day) {
      this.day = d
      this.salt = randomBytes(32)
    }
    return createHmac('sha256', this.salt)
      .update(ip ?? 'unknown')
      .digest('hex')
      .slice(0, 16)
  }
}

export class ProxyTrust {
  private readonly list = new BlockList()
  private readonly hasList: boolean

  constructor(
    private readonly enabled: boolean,
    proxies: string[],
  ) {
    for (const p of proxies) {
      const [addr, bits] = p.split('/') as [string, string | undefined]
      const a = normalizeIp(addr)
      if (!a) continue
      const type = isIP(a) === 4 ? 'ipv4' : 'ipv6'
      if (bits !== undefined) this.list.addSubnet(a, Number(bits), type)
      else this.list.addAddress(a, type)
    }
    this.hasList = proxies.length > 0
  }

  private trusted(ip: string): boolean {
    if (!this.hasList) return true
    return this.list.check(ip, isIP(ip) === 4 ? 'ipv4' : 'ipv6')
  }

  /**
   * Resolve the client address. Forwarded headers are only honoured when TRUST_PROXY is on and the
   * direct peer is a trusted proxy; the X-Forwarded-For chain is walked right-to-left skipping
   * trusted hops (without a proxy list, only the right-most entry — the one our proxy appended).
   */
  resolve(peer: string | null | undefined, forwardedFor: string | null | undefined): string | null {
    const direct = normalizeIp(peer)
    if (!this.enabled || !forwardedFor || (direct && !this.trusted(direct))) return direct
    const chain = forwardedFor
      .split(',')
      .map((s) => normalizeIp(s))
      .filter((s): s is string => !!s)
    if (!chain.length) return direct
    if (!this.hasList) return chain[chain.length - 1]!
    for (let i = chain.length - 1; i >= 0; i--) if (!this.trusted(chain[i]!)) return chain[i]!
    return chain[0]!
  }
}
