// Dependencies shared by the core-owned tools (beyond the public ToolContext).
import type { Core } from '../core/types'
import type { Picker } from '../core/picker'
import type { DirectDrag } from '../gizmo/directDrag'
import type { OverlayLayer } from '../core/overlayLayer'
import type { PreviewLayer } from '../core/previewLayer'
import type { SnapEngine } from '../snapping/snapEngine'
import type { SnapVisuals } from '../snapping/snapVisuals'
import type { Editor } from '../api'

export interface CoreToolDeps {
  core: Core
  editor: () => Editor
  picker: Picker
  directDrag: DirectDrag
  overlay: OverlayLayer
  preview: PreviewLayer
  snap: SnapEngine
  snapVisuals: SnapVisuals
  /** Enter/exit group editing (updates the store). */
  setEditingContext(id: string | null): void
  /** Walk mode flag read by the input manager. */
  setWalking(on: boolean): void
}
