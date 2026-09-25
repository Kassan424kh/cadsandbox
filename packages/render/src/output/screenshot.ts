// Offscreen rendering helpers: viewport screenshots (PNG/WebP) and render-target readback.
import * as THREE from 'three'
import type { Pipeline } from '../renderer/pipeline'
import type { Viewport } from '../renderer/viewport'
import { ORTHO_BASE } from '../renderer/viewport'

export async function targetToBlob(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget, mime: 'image/png' | 'image/webp' = 'image/png'): Promise<Blob> {
  const w = target.width
  const h = target.height
  const pixels = new Uint8Array(w * h * 4)
  await renderer.readRenderTargetPixelsAsync(target, 0, 0, w, h, pixels)
  // flip vertically (GL origin is bottom-left)
  const flipped = new Uint8ClampedArray(w * h * 4)
  const row = w * 4
  for (let y = 0; y < h; y++) flipped.set(pixels.subarray(y * row, (y + 1) * row), (h - 1 - y) * row)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.putImageData(new ImageData(flipped as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0)
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), mime, 0.92))
}

/** Camera copy for an output aspect ratio (keeps framing height). */
export function cameraForOutput(vp: Viewport, width: number, height: number): THREE.Camera {
  const aspect = width / Math.max(1, height)
  if (vp.isOrtho) {
    const cam = vp.ortho.clone()
    cam.left = (-ORTHO_BASE / 2) * aspect
    cam.right = (ORTHO_BASE / 2) * aspect
    cam.top = ORTHO_BASE / 2
    cam.bottom = -ORTHO_BASE / 2
    cam.zoom = vp.ortho.zoom
    cam.updateProjectionMatrix()
    cam.matrixWorld.copy(vp.ortho.matrixWorld)
    cam.matrixWorldInverse.copy(vp.ortho.matrixWorldInverse)
    cam.matrixAutoUpdate = false
    return cam
  }
  const cam = vp.persp.clone()
  cam.aspect = aspect
  cam.updateProjectionMatrix()
  cam.matrixWorld.copy(vp.persp.matrixWorld)
  cam.matrixWorldInverse.copy(vp.persp.matrixWorldInverse)
  cam.matrixAutoUpdate = false
  return cam
}

export interface ScreenshotOptions {
  width?: number
  height?: number
  transparent?: boolean
  mime?: 'image/png' | 'image/webp'
  samples?: number
}

export async function screenshotViewport(pipeline: Pipeline, vp: Viewport, opts: ScreenshotOptions, isolated: ReadonlySet<string> | null): Promise<Blob> {
  const renderer = pipeline.d.ctx.renderer
  const dpr = pipeline.d.ctx.pixelRatio
  const width = Math.max(1, Math.round(opts.width ?? vp.rect.w * dpr))
  const height = Math.max(1, Math.round(opts.height ?? vp.rect.h * dpr))
  const camera = cameraForOutput(vp, width, height)
  const mode = vp.renderMode
  let target: THREE.WebGLRenderTarget
  const pt = pipeline.pathTracer
  if (mode === 'realistic' && pt.texture && pt.samples > 0) {
    // progressive result: composite the accumulated HDR buffer (already converged samples)
    target = new THREE.WebGLRenderTarget(width, height, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false })
    target.texture.colorSpace = THREE.SRGBColorSpace
    renderer.setRenderTarget(target)
    renderer.setScissorTest(false)
    renderer.setClearColor(0x000000, opts.transparent ? 0 : 1)
    renderer.clear(true, true, true)
    pipeline.tonemap.render(renderer, pt.texture, pipeline.toneMode('realistic'), pipeline.d.doc.meta.render.exposure)
    renderer.setRenderTarget(null)
  } else {
    target = pipeline.renderOffscreen(camera, mode === 'realistic' ? 'shaded' : mode, width, height, { transparent: opts.transparent, planLevel: vp.planLevel, section: vp.section, isolated })
  }
  try {
    return await targetToBlob(renderer, target, opts.mime ?? 'image/png')
  } finally {
    target.dispose()
    pipeline.d.ctx.requestRender()
  }
}
