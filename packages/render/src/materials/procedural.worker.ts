// Worker entry: synthesizes procedural textures off the main thread and returns ImageBitmaps.
import { generateProcedural, type ProceduralParams } from './proceduralCore'

export interface ProceduralRequest extends ProceduralParams {
  id: number
}

export interface ProceduralResponse {
  id: number
  color: ImageBitmap
  normal: ImageBitmap
  roughness: ImageBitmap
  roughnessScale: number
  error?: string
}

interface WorkerScope {
  onmessage: ((ev: MessageEvent<ProceduralRequest>) => void) | null
  postMessage(message: unknown, transfer?: Transferable[]): void
}

const ctx = self as unknown as WorkerScope

function imageData(data: Uint8ClampedArray, size: number): ImageData {
  return new ImageData(data as Uint8ClampedArray<ArrayBuffer>, size, size)
}

ctx.onmessage = async (ev: MessageEvent<ProceduralRequest>) => {
  const req = ev.data
  try {
    const px = generateProcedural(req)
    const [color, normal, roughness] = await Promise.all([
      createImageBitmap(imageData(px.color, px.size)),
      createImageBitmap(imageData(px.normal, px.size)),
      createImageBitmap(imageData(px.roughness, px.size)),
    ])
    const res: ProceduralResponse = { id: req.id, color, normal, roughness, roughnessScale: px.roughnessScale }
    ctx.postMessage(res, [color, normal, roughness])
  } catch (err) {
    ctx.postMessage({ id: req.id, error: String(err) })
  }
}
