// Drag-and-drop plumbing between the Library panel (drag source) and the canvas (drop target).
// dataTransfer data is unreadable during dragover, so the active payload is also kept in memory
// to drive the engine's drop preview ghost.
import type { DragEvent as ReactDragEvent } from 'react'
import type { DocSnapshot, NewNode } from '@cadsandbox/doc'
import { DND_MIME, type DragPayload } from '../../data/types'

let current: DragPayload | null = null

export function beginDrag(e: ReactDragEvent, payload: DragPayload, label?: string): void {
  current = payload
  try {
    e.dataTransfer.setData(DND_MIME, JSON.stringify(payload))
    e.dataTransfer.setData('text/plain', label ?? payload.kind)
    e.dataTransfer.effectAllowed = 'copy'
  } catch {
    /* some browsers throw on custom types */
  }
}

export function endDrag(): void {
  current = null
}

export function peekDrag(): DragPayload | null {
  return current
}

export function hasDragPayload(e: { dataTransfer: DataTransfer | null }): boolean {
  const types = e.dataTransfer?.types
  if (!types) return false
  return Array.from(types).includes(DND_MIME) || current !== null
}

export function hasFiles(e: { dataTransfer: DataTransfer | null }): boolean {
  const types = e.dataTransfer?.types
  return !!types && Array.from(types).includes('Files')
}

export function readDragPayload(e: { dataTransfer: DataTransfer | null }): DragPayload | null {
  try {
    const raw = e.dataTransfer?.getData(DND_MIME)
    if (raw) return JSON.parse(raw) as DragPayload
  } catch {
    /* fall through */
  }
  return current
}

/** Content the engine can preview/insert for node & snapshot payloads. */
export function payloadContent(p: DragPayload | null): NewNode[] | DocSnapshot | null {
  if (!p) return null
  if (p.kind === 'node') return [p.node]
  if (p.kind === 'snapshot') return p.snapshot
  return null
}
