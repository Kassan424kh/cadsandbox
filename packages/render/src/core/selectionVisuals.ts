// Selection / hover / remote-selection visuals: objects are tagged on three layers so the pipeline
// can render colored outline masks (local selection = --cs-selection, hover = accent-2, each remote
// user = their color). Instances get outline proxies; 2D drawings swap to a highlighted line style.
import * as THREE from 'three'
import type { CadDocument } from '@cadsandbox/doc'
import type { SceneSync } from '../scene/sceneSync'
import type { ThemeColors } from '../util/css'
import type { OutlineGroup } from '../renderer/pipeline'

const LAYER_SELECTION = 1
const LAYER_HOVER = 2
const LAYER_REMOTE_FIRST = 3
const LAYER_REMOTE_MAX = 31

export interface RemoteSelection {
  clientId: number
  color: string
  ids: string[]
}

export class SelectionVisuals {
  readonly proxies = new THREE.Group()
  private doc: CadDocument
  private sync: SceneSync
  private theme: ThemeColors
  private tagged = new Map<number, THREE.Object3D[]>()
  private remoteLayers = new Map<number, number>()
  private groups: OutlineGroup[] = []
  private highlightedDrawings = new Set<string>()
  /** Node ids currently tagged (rendered standalone by SceneSync so layer outlines work on batched parts). */
  private active = new Set<string>()
  private lastKey = ''

  constructor(doc: CadDocument, sync: SceneSync, theme: ThemeColors) {
    this.doc = doc
    this.sync = sync
    this.theme = theme
    this.proxies.name = 'cs-outline-proxies'
    this.proxies.matrixAutoUpdate = false
    this.proxies.layers.mask = 0 // never visible to the main camera
  }

  setTheme(theme: ThemeColors): void {
    this.theme = theme
    this.lastKey = ''
  }

  /** Recompute tagging when selection/hover/remote/content changed. */
  update(selection: readonly string[], hover: string | null, remote: RemoteSelection[]): void {
    const key = `${selection.join(',')}|${hover ?? ''}|${remote.map((r) => `${r.clientId}:${r.color}:${r.ids.join(',')}`).join(';')}|${this.sync.contentVersion}`
    if (key === this.lastKey) return
    this.lastKey = key
    this.clearTags()
    this.active.clear()
    this.groups = []
    const selColor = this.theme.get('--cs-selection').color
    const hoverColor = this.theme.get('--cs-accent-2').color
    if (selection.length) {
      this.tag(selection, LAYER_SELECTION, selColor)
      this.groups.push({ layer: LAYER_SELECTION, color: selColor, thicknessPx: 1.6, glow: 0.55 })
    }
    if (hover && !selection.includes(hover)) {
      this.tag([hover], LAYER_HOVER, hoverColor)
      this.groups.push({ layer: LAYER_HOVER, color: hoverColor, thicknessPx: 1.2, glow: 0.25 })
    }
    let next = LAYER_REMOTE_FIRST
    for (const r of remote) {
      if (!r.ids.length) continue
      let layer = this.remoteLayers.get(r.clientId)
      if (layer === undefined || layer < LAYER_REMOTE_FIRST) {
        while ([...this.remoteLayers.values()].includes(next) && next < LAYER_REMOTE_MAX) next++
        if (next > LAYER_REMOTE_MAX) break
        layer = next++
        this.remoteLayers.set(r.clientId, layer)
      }
      const color = new THREE.Color(r.color)
      this.tag(r.ids, layer, color)
      this.groups.push({ layer, color, thicknessPx: 1.4, glow: 0.35 })
    }
    for (const [cid] of this.remoteLayers) if (!remote.some((r) => r.clientId === cid)) this.remoteLayers.delete(cid)
    this.sync.setActive(this.active, new Set(selection))
  }

  outlineGroups(): OutlineGroup[] {
    return this.groups
  }

  private tag(ids: readonly string[], layer: number, color: THREE.Color): void {
    const list: THREE.Object3D[] = []
    const visit = (id: string) => {
      const node = this.doc.getNode(id)
      if (!node) return
      if (node.type === 'instance') {
        for (const p of this.sync.instancing.proxies(id)) {
          const mesh = new THREE.Mesh(p.geometry)
          mesh.matrixAutoUpdate = false
          mesh.matrix.copy(p.matrix)
          mesh.matrixWorld.copy(p.matrix)
          mesh.layers.set(layer)
          mesh.userData.proxy = true
          this.proxies.add(mesh)
          list.push(mesh)
        }
      }
      const view = this.sync.views.get(id)
      if (view) {
        if (view.parts.length) this.active.add(id)
        for (const p of view.parts) {
          p.mesh.layers.enable(layer)
          list.push(p.mesh)
        }
        for (const cap of view.caps.values()) {
          cap.layers.enable(layer)
          list.push(cap)
        }
        if (view.light) view.light.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) {
            o.layers.enable(layer)
            list.push(o)
          }
        })
        if (view.drawing && layer === LAYER_SELECTION) {
          view.drawing.setHighlight(`#${color.getHexString(THREE.SRGBColorSpace)}`)
          this.highlightedDrawings.add(id)
        }
      }
      for (const c of this.doc.getChildren(id)) visit(c)
    }
    for (const id of ids) visit(id)
    this.tagged.set(layer, [...(this.tagged.get(layer) ?? []), ...list])
  }

  private clearTags(): void {
    for (const [layer, objs] of this.tagged) {
      for (const o of objs) {
        if (o.userData.proxy) {
          this.proxies.remove(o)
          continue
        }
        o.layers.disable(layer)
      }
    }
    this.tagged.clear()
    for (const id of this.highlightedDrawings) this.sync.views.get(id)?.drawing?.setHighlight(null)
    this.highlightedDrawings.clear()
  }

  /** Force re-tagging next update (content rebuilt objects). */
  invalidate(): void {
    this.lastKey = ''
  }

  dispose(): void {
    this.clearTags()
    this.proxies.clear()
  }
}
