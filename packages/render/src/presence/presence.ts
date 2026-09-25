// Presence over Yjs awareness: local {user, selection, tool, cursor ≤30 Hz, camera throttled};
// remote 3D cursors (colored pointer + name pill), remote selections and follow mode.
import * as THREE from 'three'
import type { Awareness } from 'y-protocols/awareness'
import type { CameraState, Vec3 } from '@cadsandbox/doc'
import type { EditorUser, RemoteUser, ToolId } from '../api'
import type { OverlayLayer } from '../core/overlayLayer'
import { throttle } from '../util/emitter'

interface AwarenessState {
  user?: EditorUser
  selection?: string[]
  tool?: ToolId | null
  cursor?: Vec3 | null
  camera?: CameraState | null
  fileId?: string | null
}

interface RemoteVisual {
  pointer: THREE.Mesh
  pill: string
}

export class Presence {
  readonly root = new THREE.Group()
  private awareness: Awareness | null
  private user: EditorUser
  private overlay: OverlayLayer
  private visuals = new Map<number, RemoteVisual>()
  private listener: (() => void) | null = null
  private onChange: (users: RemoteUser[]) => void
  private followed: number | null = null
  private onFollowCamera: (camera: CameraState) => void
  private users: RemoteUser[] = []
  private pointerGeometry = new THREE.ConeGeometry(0.06, 0.22, 12).rotateX(Math.PI / 2).translate(0, 0, -0.11)

  constructor(awareness: Awareness | null, user: EditorUser, overlay: OverlayLayer, onChange: (users: RemoteUser[]) => void, onFollowCamera: (camera: CameraState) => void) {
    this.awareness = awareness
    this.user = user
    this.overlay = overlay
    this.onChange = onChange
    this.onFollowCamera = onFollowCamera
    this.root.name = 'cs-presence'
    if (awareness) {
      awareness.setLocalStateField('user', { id: user.id, name: user.name, color: user.color })
      awareness.setLocalStateField('selection', [])
      awareness.setLocalStateField('tool', 'select')
      awareness.setLocalStateField('cursor', null)
      this.listener = () => this.refresh()
      awareness.on('change', this.listener)
      this.refresh()
    }
  }

  get enabled(): boolean {
    return this.awareness !== null
  }

  setSelection(ids: string[]): void {
    this.awareness?.setLocalStateField('selection', ids)
  }

  setTool(tool: ToolId): void {
    this.awareness?.setLocalStateField('tool', tool)
  }

  readonly setCursor = throttle((cursor: Vec3 | null) => {
    this.awareness?.setLocalStateField('cursor', cursor)
  }, 33)

  readonly setCamera = throttle((camera: CameraState) => {
    this.awareness?.setLocalStateField('camera', camera)
  }, 200)

  follow(clientId: number | null): void {
    this.followed = clientId
    if (clientId !== null) {
      const u = this.users.find((x) => x.clientId === clientId)
      if (u?.camera) this.onFollowCamera(u.camera)
    }
  }

  get following(): number | null {
    return this.followed
  }

  remoteUsers(): RemoteUser[] {
    return this.users
  }

  private refresh(): void {
    if (!this.awareness) return
    const local = this.awareness.clientID
    const next: RemoteUser[] = []
    const seen = new Set<number>()
    for (const [clientId, raw] of this.awareness.getStates() as Map<number, AwarenessState>) {
      if (clientId === local || !raw?.user) continue
      seen.add(clientId)
      const user: RemoteUser = {
        clientId,
        user: { id: String(raw.user.id ?? clientId), name: String(raw.user.name ?? 'Guest'), color: String(raw.user.color ?? '#7c5cff') },
        selection: Array.isArray(raw.selection) ? raw.selection.filter((s): s is string => typeof s === 'string') : [],
        tool: (raw.tool as ToolId | null) ?? null,
        cursor: isVec3(raw.cursor) ? raw.cursor : null,
        camera: raw.camera ?? null,
        fileId: raw.fileId ?? null,
      }
      next.push(user)
      this.updateVisual(user)
      if (this.followed === clientId && user.camera) this.onFollowCamera(user.camera)
    }
    for (const [cid, v] of this.visuals) if (!seen.has(cid)) {
      this.root.remove(v.pointer)
      ;(v.pointer.material as THREE.Material).dispose()
      this.overlay.remove(v.pill)
      this.visuals.delete(cid)
    }
    if (this.followed !== null && !seen.has(this.followed)) this.followed = null
    this.users = next
    this.onChange(next)
  }

  private updateVisual(u: RemoteUser): void {
    let v = this.visuals.get(u.clientId)
    if (!u.cursor) {
      if (v) {
        v.pointer.visible = false
        this.overlay.updateCursor(v.pill, [0, 0, -1e6], u.user.name, u.user.color)
      }
      return
    }
    if (!v) {
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(u.user.color), toneMapped: false, depthTest: false })
      const pointer = new THREE.Mesh(this.pointerGeometry, mat)
      pointer.renderOrder = 90
      pointer.userData.noPathTrace = true
      pointer.userData.helper = true
      pointer.raycast = () => {}
      this.root.add(pointer)
      v = { pointer, pill: this.overlay.cursor(u.cursor, u.user.name, u.user.color) }
      this.visuals.set(u.clientId, v)
    }
    v.pointer.visible = true
    v.pointer.position.set(u.cursor[0], u.cursor[1], u.cursor[2])
    ;(v.pointer.material as THREE.MeshBasicMaterial).color.set(u.user.color)
    this.overlay.updateCursor(v.pill, u.cursor, u.user.name, u.user.color)
  }

  /** Scale pointers to a constant screen size for a camera. */
  updateScale(worldPerPixel: (p: THREE.Vector3) => number): void {
    for (const v of this.visuals.values()) {
      if (!v.pointer.visible) continue
      const s = worldPerPixel(v.pointer.position) * 60
      v.pointer.scale.setScalar(s)
    }
  }

  dispose(): void {
    if (this.awareness && this.listener) this.awareness.off('change', this.listener)
    this.awareness?.setLocalStateField('cursor', null)
    this.setCursor.cancel()
    this.setCamera.cancel()
    for (const v of this.visuals.values()) {
      ;(v.pointer.material as THREE.Material).dispose()
      this.overlay.remove(v.pill)
    }
    this.visuals.clear()
    this.pointerGeometry.dispose()
    this.root.clear()
    void this.user
  }
}

function isVec3(v: unknown): v is Vec3 {
  return Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x))
}
