// Internal service bundle shared by the editor subsystems (type-only imports keep modules acyclic).
import type * as THREE from 'three'
import type { StoreApi } from 'zustand/vanilla'
import type { CadDocument } from '@cadsandbox/doc'
import type { GeometryService } from '@cadsandbox/geometry'
import type { EditorAssets, EditorEvents, EditorState, EditorUser } from '../api'
import type { RenderContext } from '../renderer/context'
import type { ViewportManager } from '../renderer/viewportManager'
import type { Viewport } from '../renderer/viewport'
import type { SceneSync } from '../scene/sceneSync'
import type { ViewStateApplier } from '../scene/viewState'
import type { MaterialCache } from '../materials/materials'
import type { LineStyleMaterials } from '../scene/drawing'
import type { HatchTextures } from '../materials/hatch'
import type { ThemeColors } from '../util/css'
import type { Emitter } from '../util/emitter'
import type { Pipeline } from '../renderer/pipeline'

export interface Core {
  readonly doc: CadDocument
  readonly geometry: GeometryService
  readonly assets: EditorAssets
  readonly user: EditorUser
  readonly store: StoreApi<EditorState>
  readonly ctx: RenderContext
  readonly theme: ThemeColors
  readonly viewports: ViewportManager
  readonly sync: SceneSync
  readonly viewState: ViewStateApplier
  readonly materials: MaterialCache
  readonly lineMaterials: LineStyleMaterials
  readonly hatches: HatchTextures
  readonly scene: THREE.Scene
  readonly overlayScene: THREE.Scene
  readonly pipeline: Pipeline
  readonly events: Emitter<EditorEvents>
  readonly readOnly: boolean
  requestRender(): void
  /** Mark camera/drag motion for adaptive resolution (ms of expected motion). */
  notifyMotion(ms?: number): void
  emit<K extends keyof EditorEvents>(event: K, payload: EditorEvents[K]): void
  /** Ids hidden by isolation for the current state (recomputed per frame). */
  hiddenIds(): ReadonlySet<string>
  /** Elevation (m) of the active level (0 when none). */
  activeLevelElevation(): number
  /** Whether a level id is the active one, resolving null → doc.meta.activeLevel. */
  activeLevelId(): string | null
  /** Raycast helper for a viewport + client position. */
  rayFor(vp: Viewport, clientX: number, clientY: number, out: THREE.Ray): THREE.Ray
}

export const IS_MAC: boolean = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
