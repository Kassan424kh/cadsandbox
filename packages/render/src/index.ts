export * from './api'
export { createEditor } from './editor'
export { buildExportScene } from './output/exportScene'
// helpers useful to other packages (io, web)
export { solarPosition, sunDirection, sunFromDoc } from './renderer/sun'
export { generateProcedural, proceduralKey } from './materials/proceduralCore'
export { serializeClipboard, parseClipboard, CLIPBOARD_PREFIX } from './commands/clipboard'
export { COMMAND_INFO, COMMAND_IDS } from './commands/registry'
export { probeGpu, autoTier, tierSettings } from './renderer/quality'
export { sanitizeText, FONT_URL } from './scene/text'
export { createTools } from './tools'
export type * from './tools/types'
// drafting helpers (web: "Auto-dimension walls" command, Markup layer)
export { autoDimensionWalls, ensureMarkupLayer, MARKUP_LAYER_ID, MARKUP_COLOR } from './tools'
export type { AutoDimensionOptions } from './tools'
// presentation: sun-study animation, turntable / walkthrough video, WebXR
export { startSunStudy, recordVideo, videoMimeType, vrSupported, startVr } from './output/presentation'
export type { SunStudy, SunStudyOptions, VideoOptions, VrSession } from './output/presentation'
