// Drag projects onto folders (grid tiles, breadcrumbs, sidebar "All projects").
import { useState, type DragEvent } from 'react'
import type { ProjectMode } from '../../data/projects'

export const PROJECT_DND = 'application/x-cadsandbox-project'

export interface ProjectDrag {
  id: string
  mode: ProjectMode
  name: string
}

export function startProjectDrag(e: DragEvent, p: ProjectDrag): void {
  e.dataTransfer.setData(PROJECT_DND, JSON.stringify(p))
  e.dataTransfer.setData('text/plain', p.name)
  e.dataTransfer.effectAllowed = 'move'
}

function read(e: DragEvent): ProjectDrag | null {
  try {
    const v = JSON.parse(e.dataTransfer.getData(PROJECT_DND)) as Partial<ProjectDrag>
    return typeof v.id === 'string' && (v.mode === 'local' || v.mode === 'cloud') ? { id: v.id, mode: v.mode, name: String(v.name ?? '') } : null
  } catch {
    return null
  }
}

/** Props for an element that accepts dropped projects. */
export function useProjectDrop(onDrop: (p: ProjectDrag) => void, enabled = true) {
  const [over, setOver] = useState(false)
  const accepts = (e: DragEvent) => enabled && e.dataTransfer.types.includes(PROJECT_DND)
  return {
    over,
    dropProps: {
      onDragOver: (e: DragEvent) => {
        if (!accepts(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        if (!over) setOver(true)
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: DragEvent) => {
        setOver(false)
        if (!accepts(e)) return
        e.preventDefault()
        const p = read(e)
        if (p) onDrop(p)
      },
    },
  }
}
