// GPU capability probing and quality tiers. A throw-away WebGL2 context reads the renderer string
// and extensions before the real renderer is created (so we can pick reversed-Z, MSAA, DPR caps).
import type { Quality } from '../api'

export type Tier = Exclude<Quality, 'auto'>

export interface GpuInfo {
  renderer: string
  vendor: string
  webgl2: boolean
  maxTextureSize: number
  maxSamples: number
  clipControl: boolean
  floatColorBuffer: boolean
  mobile: boolean
  cores: number
  memoryGB: number
}

export interface TierSettings {
  tier: Tier
  /** Device pixel ratio cap while idle / while the camera moves. */
  dprCap: number
  dprMoving: number
  msaa: number
  shadowMapSize: number
  ao: boolean
  aoQuality: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'
  textureSize: 512 | 1024
  pathTracing: boolean
  softShadows: boolean
}

export function probeGpu(): GpuInfo {
  const info: GpuInfo = {
    renderer: 'unknown',
    vendor: 'unknown',
    webgl2: false,
    maxTextureSize: 4096,
    maxSamples: 4,
    clipControl: false,
    floatColorBuffer: false,
    mobile: isMobile(),
    cores: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4,
    memoryGB: typeof navigator !== 'undefined' ? ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) : 8,
  }
  if (typeof document === 'undefined') return info
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false })
    if (!gl) return info
    info.webgl2 = true
    const dbg = gl.getExtension('WEBGL_debug_renderer_info')
    if (dbg) {
      info.renderer = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) ?? 'unknown')
      info.vendor = String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) ?? 'unknown')
    } else {
      info.renderer = String(gl.getParameter(gl.RENDERER) ?? 'unknown')
    }
    info.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
    info.maxSamples = gl.getParameter(gl.MAX_SAMPLES) as number
    info.clipControl = !!gl.getExtension('EXT_clip_control')
    info.floatColorBuffer = !!gl.getExtension('EXT_color_buffer_float')
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  } catch {
    /* probing is best-effort */
  }
  return info
}

export function isMobile(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  const uaMobile = /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(ua)
  const touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1 // iPadOS desktop UA
  return uaMobile || touchMac
}

/** Heuristic tier from the GPU renderer string + device signals. */
export function autoTier(info: GpuInfo): Tier {
  const r = info.renderer.toLowerCase()
  if (!info.webgl2) return 'low'
  if (info.mobile) return info.memoryGB >= 6 && /apple|adreno 7|mali-g7|xclipse/.test(r) ? 'medium' : 'low'
  const swRender = /swiftshader|llvmpipe|softpipe|mesa offscreen|basic render/.test(r)
  if (swRender) return 'low'
  const high = /rtx|radeon rx 6|radeon rx 7|radeon rx 9|arc a7|apple m[1-9] (pro|max|ultra)|apple m[2-9]|geforce gtx 16|geforce gtx 1080|radeon pro w/.test(r)
  const ultra = /rtx 40|rtx 50|rtx 30(80|90)|rx 79|rx 90|apple m[2-9] (max|ultra)|apple m[3-9] pro/.test(r)
  if (ultra && info.memoryGB >= 8) return 'ultra'
  if (high) return 'high'
  const integrated = /intel|uhd|iris|hd graphics|vega [3-8]\b|radeon graphics|mali|adreno|powervr/.test(r)
  if (integrated) return info.cores >= 8 && info.floatColorBuffer ? 'medium' : 'low'
  // Apple base M-series and unknown discrete GPUs
  if (/apple/.test(r)) return 'high'
  return info.floatColorBuffer ? 'medium' : 'low'
}

export function tierSettings(tier: Tier, info: GpuInfo): TierSettings {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  const msaaMax = Math.min(info.maxSamples || 4, 8)
  switch (tier) {
    case 'low':
      return { tier, dprCap: Math.min(dpr, 1.25), dprMoving: 0.75, msaa: 0, shadowMapSize: 1024, ao: false, aoQuality: 'Performance', textureSize: 512, pathTracing: false, softShadows: false }
    case 'medium':
      return { tier, dprCap: Math.min(dpr, 1.5), dprMoving: 1, msaa: Math.min(2, msaaMax), shadowMapSize: 2048, ao: true, aoQuality: 'Low', textureSize: 1024, pathTracing: info.floatColorBuffer, softShadows: true }
    case 'high':
      return { tier, dprCap: Math.min(dpr, 2), dprMoving: 1.25, msaa: Math.min(4, msaaMax), shadowMapSize: 2048, ao: true, aoQuality: 'Medium', textureSize: 1024, pathTracing: info.floatColorBuffer, softShadows: true }
    case 'ultra':
      return { tier, dprCap: Math.min(dpr, 2), dprMoving: 1.5, msaa: Math.min(4, msaaMax), shadowMapSize: 4096, ao: true, aoQuality: 'High', textureSize: 1024, pathTracing: info.floatColorBuffer, softShadows: true }
  }
}

export function resolveQuality(q: Quality | undefined, info: GpuInfo): TierSettings {
  const tier: Tier = !q || q === 'auto' ? autoTier(info) : q
  return tierSettings(tier, info)
}
