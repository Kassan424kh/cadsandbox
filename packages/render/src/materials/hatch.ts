// Hatch pattern tiles for 2D fills (plans, sections, drafting hatches): white strokes on transparent,
// tinted by the fill material's color. One CanvasTexture per pattern, generated on demand.
import * as THREE from 'three'
import type { HatchPattern } from '@cadsandbox/doc'

const TILE = 128

type Painter = (ctx: CanvasRenderingContext2D, s: number) => void

function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  ctx.beginPath()
  ctx.moveTo(x0, y0)
  ctx.lineTo(x1, y1)
  ctx.stroke()
}

/** Diagonal lines (45°) with `count` lines per tile — drawn seamlessly by wrapping. */
function diagonals(ctx: CanvasRenderingContext2D, s: number, count: number, angle = 45): void {
  const step = s / count
  ctx.save()
  ctx.translate(s / 2, s / 2)
  ctx.rotate((angle * Math.PI) / 180)
  for (let i = -count * 2; i <= count * 2; i++) line(ctx, -s * 1.5, i * step, s * 1.5, i * step)
  ctx.restore()
}

const PAINTERS: Record<Exclude<HatchPattern, 'none' | 'solid'>, Painter> = {
  ansi31: (ctx, s) => diagonals(ctx, s, 4),
  ansi32: (ctx, s) => {
    diagonals(ctx, s, 4)
    ctx.save()
    ctx.translate(s / 2, s / 2)
    ctx.rotate(Math.PI / 4)
    for (let i = -8; i <= 8; i++) line(ctx, -s * 1.5, i * (s / 4) + s / 12, s * 1.5, i * (s / 4) + s / 12)
    ctx.restore()
  },
  ansi37: (ctx, s) => {
    diagonals(ctx, s, 4, 45)
    diagonals(ctx, s, 4, -45)
  },
  concrete: (ctx, s) => {
    // aggregate: scattered triangles and dots, deterministic positions
    let seed = 7
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    for (let i = 0; i < 26; i++) {
      const x = rnd() * s
      const y = rnd() * s
      const r = 1.2 + rnd() * 1.8
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    }
    for (let i = 0; i < 6; i++) {
      const x = rnd() * s
      const y = rnd() * s
      const r = 5 + rnd() * 6
      ctx.beginPath()
      ctx.moveTo(x, y - r)
      ctx.lineTo(x + r * 0.9, y + r * 0.6)
      ctx.lineTo(x - r * 0.9, y + r * 0.5)
      ctx.closePath()
      ctx.stroke()
    }
  },
  'reinforced-concrete': (ctx, s) => {
    PAINTERS.concrete(ctx, s)
    diagonals(ctx, s, 3)
  },
  brick: (ctx, s) => {
    const rows = 4
    const h = s / rows
    for (let r = 0; r < rows; r++) {
      const y = r * h
      line(ctx, 0, y, s, y)
      const off = r % 2 ? s / 4 : 0
      for (let c = 0; c < 2; c++) line(ctx, off + c * (s / 2), y, off + c * (s / 2), y + h)
    }
  },
  masonry: (ctx, s) => {
    diagonals(ctx, s, 3)
    diagonals(ctx, s, 3, -45)
    ctx.globalAlpha = 0.6
    for (let i = 0; i < 4; i++) line(ctx, 0, (i * s) / 4, s, (i * s) / 4)
  },
  insulation: (ctx, s) => {
    // zigzag "batting" symbol
    ctx.beginPath()
    const n = 4
    for (let i = 0; i <= n; i++) {
      const x = (i / n) * s
      const y = i % 2 ? s * 0.85 : s * 0.15
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(s * 0.25, s * 0.85, s * 0.12, Math.PI, 0)
    ctx.arc(s * 0.75, s * 0.15, s * 0.12, 0, Math.PI)
    ctx.stroke()
  },
  earth: (ctx, s) => {
    for (let r = 0; r < 4; r++) {
      const y = (r + 0.5) * (s / 4)
      const off = r % 2 ? s / 8 : 0
      for (let c = 0; c < 2; c++) line(ctx, off + c * (s / 2), y, off + c * (s / 2) + s / 3, y)
    }
  },
  gravel: (ctx, s) => {
    let seed = 3
    const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647
    for (let i = 0; i < 14; i++) {
      ctx.beginPath()
      ctx.ellipse(rnd() * s, rnd() * s, 4 + rnd() * 5, 3 + rnd() * 3, rnd() * 3, 0, Math.PI * 2)
      ctx.stroke()
    }
  },
  sand: (ctx, s) => {
    let seed = 11
    const rnd = () => (seed = (seed * 69621) % 2147483647) / 2147483647
    for (let i = 0; i < 60; i++) {
      ctx.beginPath()
      ctx.arc(rnd() * s, rnd() * s, 1, 0, Math.PI * 2)
      ctx.fill()
    }
  },
  wood: (ctx, s) => {
    for (let i = 0; i < 6; i++) {
      const y = (i + 0.5) * (s / 6)
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.bezierCurveTo(s * 0.3, y - 4, s * 0.6, y + 4, s, y)
      ctx.stroke()
    }
  },
  timber: (ctx, s) => {
    diagonals(ctx, s, 2, 45)
    diagonals(ctx, s, 2, -45)
  },
  steel: (ctx, s) => {
    diagonals(ctx, s, 6)
  },
  glass: (ctx, s) => {
    diagonals(ctx, s, 2, 45)
    ctx.globalAlpha = 0.5
    diagonals(ctx, s, 2, 45)
  },
  tiles: (ctx, s) => {
    for (let i = 0; i <= 4; i++) {
      line(ctx, (i * s) / 4, 0, (i * s) / 4, s)
      line(ctx, 0, (i * s) / 4, s, (i * s) / 4)
    }
  },
  grass: (ctx, s) => {
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const x = (c + 0.5) * (s / 3) + (r % 2 ? s / 6 : 0)
        const y = (r + 0.7) * (s / 3)
        line(ctx, x, y, x, y - 8)
        line(ctx, x, y, x - 5, y - 6)
        line(ctx, x, y, x + 5, y - 6)
      }
    }
  },
  water: (ctx, s) => {
    for (let r = 0; r < 4; r++) {
      const y = (r + 0.5) * (s / 4)
      ctx.beginPath()
      for (let x = 0; x <= s; x += 4) {
        const yy = y + Math.sin((x / s) * Math.PI * 4) * 3
        if (x === 0) ctx.moveTo(x, yy)
        else ctx.lineTo(x, yy)
      }
      ctx.stroke()
    }
  },
  dots: (ctx, s) => {
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      ctx.beginPath()
      ctx.arc((c + 0.5) * (s / 4) + (r % 2 ? s / 8 : 0), (r + 0.5) * (s / 4), 1.6, 0, Math.PI * 2)
      ctx.fill()
    }
  },
  grid: (ctx, s) => {
    for (let i = 0; i <= 4; i++) {
      line(ctx, (i * s) / 4, 0, (i * s) / 4, s)
      line(ctx, 0, (i * s) / 4, s, (i * s) / 4)
    }
  },
}

export class HatchTextures {
  private cache = new Map<HatchPattern, THREE.CanvasTexture>()

  /** Texture for a pattern; null for none/solid. */
  get(pattern: HatchPattern): THREE.CanvasTexture | null {
    if (pattern === 'none' || pattern === 'solid') return null
    let tex = this.cache.get(pattern)
    if (tex) return tex
    const canvas = document.createElement('canvas')
    canvas.width = TILE
    canvas.height = TILE
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, TILE, TILE)
    ctx.strokeStyle = '#ffffff'
    ctx.fillStyle = '#ffffff'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    PAINTERS[pattern](ctx, TILE)
    tex = new THREE.CanvasTexture(canvas)
    tex.wrapS = THREE.RepeatWrapping
    tex.wrapT = THREE.RepeatWrapping
    tex.minFilter = THREE.LinearMipmapLinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.anisotropy = 4
    tex.colorSpace = THREE.NoColorSpace
    tex.userData.shared = true
    this.cache.set(pattern, tex)
    return tex
  }

  /** World size (m) of one tile at scale 1 — patterns repeat every 0.25 m by default. */
  static tileSize(pattern: HatchPattern, scale: number): number {
    const base = pattern === 'brick' || pattern === 'tiles' || pattern === 'grid' ? 0.5 : 0.25
    return base * Math.max(1e-3, scale)
  }

  dispose(): void {
    for (const t of this.cache.values()) t.dispose()
    this.cache.clear()
  }
}
