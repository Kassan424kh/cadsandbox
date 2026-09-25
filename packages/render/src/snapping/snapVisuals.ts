// Snap feedback: axis-colored inference guide (dashed fat line), snap glyph and tooltip.
import * as THREE from 'three'
import type { SnapResult } from '../tools/types'
import type { ThemeColors } from '../util/css'
import type { LineStyleMaterials } from '../scene/drawing'
import { makeFatLines } from '../scene/drawing'
import type { OverlayLayer } from '../core/overlayLayer'
import { SNAP_LABELS } from '../core/overlayLayer'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import type { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'

export class SnapVisuals {
  readonly root = new THREE.Group()
  private guide: LineSegments2
  private markerHandle: string | null = null
  private tooltipHandle: string | null = null
  private overlay: OverlayLayer
  private theme: ThemeColors
  private lineMaterials: LineStyleMaterials
  private lastKind = ''

  constructor(theme: ThemeColors, lineMaterials: LineStyleMaterials, overlay: OverlayLayer) {
    this.theme = theme
    this.lineMaterials = lineMaterials
    this.overlay = overlay
    this.root.name = 'cs-snap-visuals'
    this.guide = makeFatLines([0, 0, 0, 0, 0, 0], lineMaterials.get('guide', null, 1, 'overlay'))
    this.guide.visible = false
    this.guide.raycast = () => {}
    this.root.add(this.guide)
  }

  setTheme(theme: ThemeColors): void {
    this.theme = theme
  }

  private axisColor(axis: 'x' | 'y' | 'z' | 'custom'): string | null {
    switch (axis) {
      case 'x':
        return `#${this.theme.get('--cs-danger').color.getHexString(THREE.SRGBColorSpace)}`
      case 'y':
        return `#${this.theme.get('--cs-success').color.getHexString(THREE.SRGBColorSpace)}`
      case 'z':
        return `#${this.theme.get('--cs-info').color.getHexString(THREE.SRGBColorSpace)}`
      default:
        return null
    }
  }

  show(result: SnapResult, viewport: number): void {
    // guide
    if (result.guide) {
      const g = result.guide
      const geo = this.guide.geometry as LineSegmentsGeometry
      geo.setPositions([g.from[0], g.from[1], g.from[2], g.to[0], g.to[1], g.to[2]])
      this.guide.computeLineDistances()
      this.guide.material = this.lineMaterials.get('guide', this.axisColor(g.axis), 1, 'overlay')
      this.guide.visible = true
    } else this.guide.visible = false
    // marker + tooltip
    const show = result.kind !== 'free' && result.kind !== 'grid'
    if (show) {
      if (this.markerHandle) this.overlay.remove(this.markerHandle)
      this.markerHandle = this.overlay.marker(result.point, result.kind, viewport)
      const label = SNAP_LABELS[result.kind]
      if (this.tooltipHandle) this.overlay.remove(this.tooltipHandle)
      this.tooltipHandle = label ? this.overlay.tooltip(result.point, label, viewport) : null
      this.lastKind = result.kind
    } else this.hideMarkers()
  }

  private hideMarkers(): void {
    if (this.markerHandle) this.overlay.remove(this.markerHandle)
    if (this.tooltipHandle) this.overlay.remove(this.tooltipHandle)
    this.markerHandle = null
    this.tooltipHandle = null
    this.lastKind = ''
  }

  hide(): void {
    this.guide.visible = false
    this.hideMarkers()
  }

  dispose(): void {
    this.hide()
    this.guide.geometry.dispose()
    this.root.parent?.remove(this.root)
  }
}
