// Everything floating over the canvas: top/bottom pills, tool options, viewport chips, drop
// handling (library items, materials, collection items, files) and the "3D view unavailable" notice.
import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { RefreshCw, Upload } from 'lucide-react'
import type { MaterialDef, DocSnapshot } from '@cadsandbox/doc'
import { useT } from '../../i18n'
import { Button, cx, toast } from '../../ui'
import { useEditorCtx, useEditorState } from '../EditorContext'
import { endDrag, hasDragPayload, hasFiles, payloadContent, peekDrag, readDragPayload } from '../io/dnd'
import { useImportExport } from '../io/useImportExport'
import { useUiStore } from '../ui-store'
import styles from '../editor.module.css'
import { StageContext, type StageInfo } from './hooks'
import { ContextPill, UndoRedoPill, WalkRenderPill } from './BottomBars'
import { CommentPins } from './CommentPins'
import { ToolOptionsBar } from './ToolOptionsBar'
import { ModePill, TopLeft, TopRight } from './TopBar'
import { ViewportChrome } from './ViewportChrome'

/** Empty stage drawn behind the chrome when the render engine could not start. */
function PlaceholderStage() {
  const layout = useEditorState((s) => s.layout)
  return (
    <div className={styles.placeholder}>
      {layout === 'split' && <div className={styles.placeholderSplit} />}
      <div className={styles.placeholderGround} />
    </div>
  )
}

/** Why the 3D view is missing and what to do about it (lives in the overlay so Reload is clickable). */
function EngineUnavailableNotice() {
  const t = useT()
  const { engineError } = useEditorCtx()
  const webgl = /webgl/i.test(engineError ?? '')
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
      <div className={styles.placeholderCard} role="alert">
        <div className={styles.placeholderTitle}>{t('engine.unavailableTitle', '3D view unavailable')}</div>
        <div>
          {webgl
            ? t('engine.unavailableWebgl', 'Your browser could not start WebGL 2, which the 3D view needs. Turn on hardware acceleration in the browser settings, update your graphics driver, or use a current Chrome, Edge, Firefox or Safari.')
            : t('engine.unavailableLoad', 'The 3D engine could not be loaded. Check your connection and reload the page.')}
        </div>
        <div>{t('engine.unavailableStill', 'Panels and document editing still work. Exports that need the 3D view are paused.')}</div>
        <Button size="sm" variant="secondary" icon={<RefreshCw size={14} />} onClick={() => window.location.reload()}>
          {t('engine.reload', 'Reload')}
        </Button>
        {engineError && <small className={styles.placeholderDetail}>{engineError}</small>}
      </div>
    </div>
  )
}

export function StageChrome() {
  const t = useT()
  const { editor, doc, session, library, engineAvailable, readOnly } = useEditorCtx()
  const { importFiles } = useImportExport()
  const [dropping, setDropping] = useState<'files' | 'item' | null>(null)
  const setContextMenu = useUiStore((s) => s.setContextMenu)

  const overlayRef = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState<StageInfo>({ width: 1600, height: 900, compact: false, tight: false })
  useEffect(() => {
    const el = overlayRef.current?.parentElement
    if (!el) return
    const ro = new ResizeObserver(() => {
      const width = el.clientWidth
      const height = el.clientHeight
      setStage((s) => (s.width === width && s.height === height ? s : { width, height, compact: width < 1180, tight: width < 900 }))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const onDragOver = useCallback(
    (e: globalThis.DragEvent) => {
      if (readOnly) return
      if (hasDragPayload(e)) {
        e.preventDefault()
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
        const content = payloadContent(peekDrag())
        if (content) editor.dragPreview(content, e.clientX, e.clientY)
        setDropping((d) => (d === 'item' ? d : 'item'))
      } else if (hasFiles(e)) {
        e.preventDefault()
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
        setDropping((d) => (d === 'files' ? d : 'files'))
      }
    },
    [editor, readOnly],
  )

  const onDragLeave = useCallback(
    (e: globalThis.DragEvent) => {
      const stage = e.currentTarget as HTMLElement | null
      if (stage && e.relatedTarget && stage.contains(e.relatedTarget as Node)) return
      setDropping(null)
      editor.dragPreview(null)
    },
    [editor],
  )

  const onDrop = useCallback(
    async (e: globalThis.DragEvent) => {
      e.preventDefault()
      setDropping(null)
      editor.dragPreview(null)
      if (readOnly) return
      const at = { clientX: e.clientX, clientY: e.clientY }
      const payload = readDragPayload(e)
      endDrag()
      if (payload) {
        try {
          if (payload.kind === 'node') await editor.insert([payload.node], at)
          else if (payload.kind === 'snapshot') await editor.insert(payload.snapshot, at)
          else if (payload.kind === 'material') {
            const hit = editor.pick(e.clientX, e.clientY)
            if (!hit?.nodeId) return void toast.info(t('dnd.dropMaterialOnObject', 'Drop a material onto an object to apply it'))
            let id = payload.materialId
            if (payload.material && !doc.getMaterial(id)) id = doc.addMaterial({ ...payload.material, id: payload.material.id, builtin: false })
            doc.updateNode(hit.nodeId, { material: id })
            toast.success(t('dnd.materialApplied', 'Material applied'))
          } else if (payload.kind === 'collection-item') {
            if (!library) return
            const items = await library.listItems(payload.collectionId)
            const item = items.find((i) => i.id === payload.itemId)
            if (!item) return
            await library.materialize(item, session.assets)
            if (item.kind === 'material') {
              const m = item.payload as MaterialDef
              const hit = editor.pick(e.clientX, e.clientY)
              const id = doc.getMaterial(m.id) ? m.id : doc.addMaterial({ ...m, builtin: false })
              if (hit?.nodeId) doc.updateNode(hit.nodeId, { material: id })
              else toast.info(t('dnd.materialAdded', 'Material "{name}" added to this document', { name: m.name }))
            } else {
              await editor.insert(item.payload as DocSnapshot, at)
            }
          }
        } catch (err) {
          toast.error(err instanceof Error ? err.message : String(err))
        }
        return
      }
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (files.length) await importFiles(files, at)
    },
    [editor, doc, session, library, importFiles, readOnly, t],
  )

  // Drag events must be caught on the stage element itself: the overlay is pointer-events:none so
  // the engine's canvas keeps receiving pointer input.
  useEffect(() => {
    const stage = overlayRef.current?.parentElement
    if (!stage) return
    const drop = (e: globalThis.DragEvent) => void onDrop(e)
    stage.addEventListener('dragenter', onDragOver)
    stage.addEventListener('dragover', onDragOver)
    stage.addEventListener('dragleave', onDragLeave)
    stage.addEventListener('drop', drop)
    return () => {
      stage.removeEventListener('dragenter', onDragOver)
      stage.removeEventListener('dragover', onDragOver)
      stage.removeEventListener('dragleave', onDragLeave)
      stage.removeEventListener('drop', drop)
    }
  }, [onDragOver, onDragLeave, onDrop])

  const onContextMenu = (e: MouseEvent<HTMLDivElement>) => {
    // The engine emits its own 'contextmenu' event; the placeholder needs a DOM fallback.
    e.preventDefault()
    if (!engineAvailable) setContextMenu({ x: e.clientX, y: e.clientY, nodeId: editor.getState().selection[0] ?? null })
  }

  return (
    <StageContext.Provider value={stage}>
      {!engineAvailable && <PlaceholderStage />}
      <div ref={overlayRef} className={styles.overlay} onContextMenu={onContextMenu} style={{ pointerEvents: !engineAvailable ? 'auto' : 'none' }}>
        {!engineAvailable && <EngineUnavailableNotice />}
        {dropping && (
          <div className={styles.dropOverlay}>
            <div className={styles.dropCard}>
              <Upload size={18} />
              {dropping === 'files' ? t('dnd.dropFiles', 'Drop to import') : t('dnd.dropItem', 'Drop to place')}
            </div>
          </div>
        )}
        <TopLeft />
        <div className={cx(styles.topCenter)}>
          <ModePill />
          <ToolOptionsBar />
        </div>
        <TopRight />
        <ViewportChrome />
        <UndoRedoPill />
        <ContextPill />
        <WalkRenderPill />
        <CommentPins />
      </div>
    </StageContext.Provider>
  )
}
