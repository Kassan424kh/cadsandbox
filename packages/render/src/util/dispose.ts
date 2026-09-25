// GPU resource disposal helpers. Materials are owned by the material cache (shared between meshes),
// so object disposal only frees geometries unless `ownMaterials` is set.
import * as THREE from 'three'

export function disposeMaterial(m: THREE.Material): void {
  const rec = m as unknown as Record<string, unknown>
  for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'bumpMap', 'emissiveMap', 'alphaMap', 'envMap']) {
    const t = rec[key]
    if (t instanceof THREE.Texture && (t as THREE.Texture & { userData: { shared?: boolean } }).userData?.shared !== true) t.dispose()
  }
  m.dispose()
}

/** Dispose geometries (and BVHs) of a subtree; materials only when `ownMaterials`. */
export function disposeObject(root: THREE.Object3D, ownMaterials = false): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (mesh.geometry) {
      const g = mesh.geometry as THREE.BufferGeometry & { disposeBoundsTree?: () => void; boundsTree?: unknown }
      if (g.boundsTree && typeof g.disposeBoundsTree === 'function') g.disposeBoundsTree()
      g.dispose()
    }
    if (ownMaterials && mesh.material) {
      if (Array.isArray(mesh.material)) for (const m of mesh.material) disposeMaterial(m)
      else disposeMaterial(mesh.material)
    }
    const t = o as unknown as { dispose?: () => void; isText?: boolean }
    if (t.isText && typeof t.dispose === 'function') t.dispose()
  })
}

export function removeAndDispose(o: THREE.Object3D | null | undefined, ownMaterials = false): void {
  if (!o) return
  o.parent?.remove(o)
  disposeObject(o, ownMaterials)
}
