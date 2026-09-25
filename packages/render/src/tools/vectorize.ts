// vectorizeView — vector linework of a plan / ceiling plan / section / elevation / saved view /
// schedule for sheets and PDF/DXF/SVG export. Coordinates are meters on the drawing plane:
//   plans      → level-local XY
//   sections   → section frame (u along the section line, v up)
//   elevations → viewer frame (u to the viewer's right, v up); north = viewed from the north
//   views      → orthographic projection along the saved camera direction
//   schedules  → table with the top-left corner at the origin, rows growing downward
// Used by the editor core's `editor.vectorize()`.
import type { CadDocument, SheetViewSource } from '@cadsandbox/doc'
import type { GeometryService } from '@cadsandbox/geometry'
import { DrawingBuilder, type VectorDrawing, type VectorizeDeps } from './vectorize/common'
import { vectorizePlan } from './vectorize/plan'
import { buildTable, loadSchedules, tableDrawing } from './vectorize/schedule'
import { elevationSetup, sectionSetup, vectorizeSectionFrame, viewSetup } from './vectorize/sectionView'

export type { VectorDrawing, VectorizeDeps }

export async function vectorizeView(deps: { doc: CadDocument; geometry: GeometryService }, source: SheetViewSource): Promise<VectorDrawing> {
  // Make sure evaluated geometry is available before reading results.
  await deps.geometry.idle()
  switch (source.kind) {
    case 'plan':
      return vectorizePlan(deps, source.levelId, false)
    case 'ceiling-plan':
      return vectorizePlan(deps, source.levelId, true)
    case 'section': {
      const node = deps.doc.getNode(source.sectionId)
      const setup = node ? sectionSetup(deps.doc, node as Parameters<typeof sectionSetup>[1]) : null
      if (!setup) return new DrawingBuilder().build()
      return vectorizeSectionFrame(deps, setup)
    }
    case 'elevation':
      return vectorizeSectionFrame(deps, elevationSetup(deps, source.direction))
    case 'view': {
      const view = deps.doc.listViews().find((v) => v.id === source.viewId)
      if (!view) return new DrawingBuilder().build()
      return vectorizeSectionFrame(deps, viewSetup(view.camera))
    }
    case 'schedule': {
      const schedules = await loadSchedules(deps)
      return tableDrawing(buildTable(source.schedule, schedules, deps.doc))
    }
    default:
      return new DrawingBuilder().build()
  }
}
