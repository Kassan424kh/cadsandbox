// Lazy, self-hosted WASM loaders (GDPR: no CDN, no third-party request). Every module is fetched
// from the app's own origin via Vite `?url` assets on first use and cached for the session.
// In Node (tests) the packages locate their .wasm files next to their own JS.
import type { IfcAPI } from 'web-ifc'
import type { LoadingManager } from 'three'
import type { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'

type NodeProcess = { versions?: { node?: string } }
export const isNode = (): boolean =>
  typeof window === 'undefined' && !!(globalThis as { process?: NodeProcess }).process?.versions?.node

/** Import a package only in Node (tests/CLI). The specifier is opaque to the bundler so the Node
 *  builds (with `fs`, `ws`, …) never end up in the browser bundle. */
const nodeImport = <T>(specifier: string): Promise<T> => import(/* @vite-ignore */ specifier) as Promise<T>

// ------------------------------------------------------------------ web-ifc (MPL-2.0)
export type WebIfcModule = typeof import('web-ifc')
let webIfc: Promise<{ api: IfcAPI; mod: WebIfcModule }> | null = null

/** Shared IfcAPI instance (single-threaded build: no SharedArrayBuffer worker spawning). */
export function loadWebIfc(): Promise<{ api: IfcAPI; mod: WebIfcModule }> {
  webIfc ??= (async () => {
    const mod = await import('web-ifc')
    const api = new mod.IfcAPI()
    if (isNode()) await api.Init(undefined, true)
    else {
      const wasmUrl = (await import('web-ifc/web-ifc.wasm?url')).default
      await api.Init((path: string) => (path.endsWith('.wasm') ? wasmUrl : path), true)
    }
    try {
      api.SetLogLevel(mod.LogLevel.LOG_LEVEL_OFF)
    } catch {
      /* older builds */
    }
    return { api, mod }
  })().catch((e: unknown) => {
    webIfc = null
    throw e
  })
  return webIfc
}

// ------------------------------------------------------------------ Draco (Apache-2.0, three/examples)
let draco: Promise<DRACOLoader | null> | null = null

/** DRACO decoder served from our own origin. Returns null in Node (no workers). */
export function loadDracoLoader(): Promise<DRACOLoader | null> {
  if (isNode() || typeof Worker === 'undefined') return Promise.resolve(null)
  draco ??= (async () => {
    const [{ DRACOLoader }, { LoadingManager }, wrapper, wasm] = await Promise.all([
      import('three/examples/jsm/loaders/DRACOLoader.js'),
      import('three'),
      import('three/examples/jsm/libs/draco/draco_wasm_wrapper.js?url'),
      import('three/examples/jsm/libs/draco/draco_decoder.wasm?url'),
    ])
    const manager: LoadingManager = new LoadingManager()
    manager.setURLModifier((url) => {
      if (url.endsWith('draco_wasm_wrapper.js')) return wrapper.default
      if (url.endsWith('draco_decoder.wasm')) return wasm.default
      return url
    })
    const loader = new DRACOLoader(manager)
    loader.setDecoderPath('')
    loader.setDecoderConfig({ type: 'wasm' })
    loader.setWorkerLimit(2)
    return loader
  })()
  return draco
}

// ------------------------------------------------------------------ rhino3dm (MIT)
/** Minimal structural view of the rhino3dm module (the bundled d.ts is incomplete for our use). */
export type RhinoModule = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
let rhino: Promise<RhinoModule> | null = null

export function loadRhino(): Promise<RhinoModule> {
  rhino ??= (async () => {
    if (isNode()) {
      const m = await nodeImport<{ default: (o?: object) => Promise<RhinoModule> }>('rhino3dm')
      return m.default()
    }
    // Loaded as an unbundled same-origin ES module (its Node-only branch imports node:module).
    const [js, wasm] = await Promise.all([import('rhino3dm/rhino3dm.module.js?url'), import('rhino3dm/rhino3dm.wasm?url')])
    const m = (await import(/* @vite-ignore */ js.default)) as { default: (o?: object) => Promise<RhinoModule> }
    return m.default({ locateFile: (p: string) => (p.endsWith('.wasm') ? wasm.default : p) })
  })().catch((e: unknown) => {
    rhino = null
    throw e
  })
  return rhino
}

// ------------------------------------------------------------------ occt-import-js (LGPL-2.1)
// Loaded as a separate, unmodified script inside a classic worker (keeps the LGPL module
// replaceable and the UI responsive). In Node the CommonJS build is used directly.
export interface OcctMesh {
  name: string
  color?: [number, number, number]
  brep_faces: { first: number; last: number; color: [number, number, number] | null }[]
  attributes: { position: { array: ArrayLike<number> }; normal?: { array: ArrayLike<number> } }
  index: { array: ArrayLike<number> }
}
export interface OcctNode {
  name: string
  meshes: number[]
  children: OcctNode[]
}
export interface OcctResult {
  success: boolean
  root: OcctNode
  meshes: OcctMesh[]
}
export interface OcctParams {
  linearUnit?: 'millimeter' | 'centimeter' | 'meter' | 'inch' | 'foot'
  linearDeflectionType?: 'bounding_box_ratio' | 'absolute_value'
  linearDeflection?: number
  angularDeflection?: number
}
type OcctFormat = 'step' | 'iges' | 'brep'
type OcctModule = Record<'ReadStepFile' | 'ReadIgesFile' | 'ReadBrepFile', (b: Uint8Array, p: OcctParams | null) => OcctResult>

let occtNode: Promise<OcctModule> | null = null
let occtWorker: Promise<{ worker: Worker; scriptUrl: string; wasmUrl: string }> | null = null
let occtSeq = 0

export async function readOcct(format: OcctFormat, bytes: Uint8Array, params: OcctParams, signal?: AbortSignal): Promise<OcctResult> {
  if (isNode() || typeof Worker === 'undefined') {
    occtNode ??= (async () => {
      const m = await nodeImport<{ default: (o?: object) => Promise<OcctModule> }>('occt-import-js')
      return m.default()
    })()
    const occt = await occtNode
    const fn = format === 'step' ? occt.ReadStepFile : format === 'iges' ? occt.ReadIgesFile : occt.ReadBrepFile
    return fn(bytes, params)
  }
  occtWorker ??= (async () => {
    const [w, s, m] = await Promise.all([
      import('./import/occt-worker.js?url'),
      import('occt-import-js/dist/occt-import-js.js?url'),
      import('occt-import-js/dist/occt-import-js.wasm?url'),
    ])
    return { worker: new Worker(w.default, { name: 'occt-import' }), scriptUrl: s.default, wasmUrl: m.default }
  })()
  const { worker, scriptUrl, wasmUrl } = await occtWorker
  const id = ++occtSeq
  return new Promise<OcctResult>((resolve, reject) => {
    const cleanup = () => {
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
      signal?.removeEventListener('abort', onAbort)
    }
    const onMessage = (ev: MessageEvent<{ id: number; ok: boolean; result?: OcctResult; error?: string }>) => {
      if (ev.data.id !== id) return
      cleanup()
      if (ev.data.ok && ev.data.result) resolve(ev.data.result)
      else reject(new Error(ev.data.error || 'CAD import failed'))
    }
    const onError = (ev: ErrorEvent) => {
      cleanup()
      occtWorker = null
      worker.terminate()
      reject(new Error(ev.message || 'CAD import worker crashed'))
    }
    const onAbort = () => {
      cleanup()
      occtWorker = null
      worker.terminate()
      reject(signal?.reason instanceof Error ? signal.reason : new DOMException('Import aborted', 'AbortError'))
    }
    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)
    signal?.addEventListener('abort', onAbort)
    const copy = bytes.slice()
    worker.postMessage({ id, scriptUrl, wasmUrl, format, bytes: copy, params }, [copy.buffer])
  })
}
