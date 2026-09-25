// Editor page: opens the design, creates the render engine (or the placeholder), wires theme,
// thumbnails and lifecycle, and renders the chrome around the full-bleed canvas.
import { useEffect, useMemo, useRef, useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import type { Editor } from '@cadsandbox/render'
import { useT } from '../i18n'
import type { DesignHandle, LibraryStore, ProjectSession } from '../data/types'
import { usePrefs } from '../data/prefs'
import { Button, EmptyState, Spinner, Toaster, TooltipProvider, useTheme } from '../ui'
import { usePhone } from './shell/hooks'
import styles from './editor.module.css'
import { EditorContext, type EditorContextValue } from './EditorContext'
import { createEngine } from './engine/createEngine'
import { EditorShell } from './shell/EditorShell'
import { StageChrome } from './shell/StageChrome'

export interface EditorPageProps {
  session: ProjectSession
  /** Design file to open (defaults to the manifest's mainFile). */
  fileId: string | null
  /** Navigate to another file of the project (updates the URL). */
  onOpenFile(fileId: string): void
  /** Leave the editor (back to dashboard). */
  onExit(): void
  /** Import a project archive (.csbx) as a new project and open it. */
  onImportProject?(file: File): void
  /** Optional: the user's reusable library ("My collections"). */
  library?: LibraryStore
}

type Status = { kind: 'loading' } | { kind: 'ready'; ctx: EditorContextValue } | { kind: 'error'; message: string }

export function EditorPage({ session, fileId: fileIdProp, onOpenFile, onExit, onImportProject, library }: EditorPageProps) {
  const t = useT()
  const { resolved } = useTheme()
  const containerRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<Status>({ kind: 'loading' })
  const fileId = useMemo(() => fileIdProp ?? session.manifest.info.mainFile ?? session.manifest.designFiles()[0]?.id ?? null, [fileIdProp, session])
  // Mount a Toaster only if the app shell hasn't already.
  const [needToaster] = useState(() => typeof document !== 'undefined' && !document.querySelector('[data-sonner-toaster]'))
  const themeRef = useRef(resolved)
  themeRef.current = resolved

  useEffect(() => {
    if (!fileId) {
      setStatus({ kind: 'error', message: t('editor.error.noFile', 'This project has no design file yet.') })
      return
    }
    let cancelled = false
    let handle: DesignHandle | null = null
    let editor: Editor | null = null
    let thumbTimer: ReturnType<typeof setTimeout> | null = null
    let offDoc: (() => void) | null = null
    setStatus({ kind: 'loading' })

    const run = async () => {
      handle = session.openDesign(fileId)
      await Promise.race([handle.ready, new Promise((r) => setTimeout(r, 8000))])
      if (cancelled) return
      const container = containerRef.current
      if (!container) return
      const result = await createEngine({
        container,
        doc: handle.doc,
        assets: session.assets,
        user: session.user,
        awareness: handle.awareness,
        theme: themeRef.current,
        readOnly: session.readOnly,
        // the shell renders its own view chips; the engine's label would sit under them
        showViewportLabels: false,
        // keep the view cube below the top-left back button / file pill (StageChrome measures the exact offset)
        viewCubeOffset: { top: 64, left: 16 },
      })
      if (cancelled) {
        result.editor.dispose()
        return
      }
      editor = result.editor
      const ctx: EditorContextValue = {
        editor,
        engineAvailable: result.available,
        doc: handle.doc,
        session,
        handle,
        fileId,
        library: library ?? null,
        onOpenFile,
        onExit,
        onImportProject,
        readOnly: session.readOnly,
      }
      // Thumbnail after local edits (debounced, best effort).
      if (!session.readOnly) {
        offDoc = handle.doc.onChange((e) => {
          if (!e.local) return
          if (thumbTimer) clearTimeout(thumbTimer)
          // Long debounce + idle callback: the offscreen render must never land during interaction.
          thumbTimer = setTimeout(() => {
            const run = async () => {
              try {
                const blob = await editor!.screenshot({ width: 640, height: 400, mime: 'image/webp' })
                await session.saveThumbnail(blob)
              } catch {
                /* ignore */
              }
            }
            if ('requestIdleCallback' in window) window.requestIdleCallback(() => void run(), { timeout: 10_000 })
            else void run()
          }, 20_000)
        })
      }
      setStatus({ kind: 'ready', ctx })
    }
    run().catch((err: unknown) => {
      if (!cancelled) setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    })

    return () => {
      cancelled = true
      if (thumbTimer) clearTimeout(thumbTimer)
      offDoc?.()
      editor?.dispose()
      handle?.release()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, fileId, library, onOpenFile, onExit])

  useEffect(() => {
    if (status.kind === 'ready') status.ctx.editor.setTheme(resolved)
  }, [resolved, status])

  // device-level navigation preference (localStorage) → engine
  const prefs = usePrefs()
  useEffect(() => {
    if (status.kind === 'ready') status.ctx.editor.setNavigation({ trackpadGestures: prefs.trackpadGestures })
  }, [prefs.trackpadGestures, status])

  // Phones are viewers: every touch moves the camera (orbit / pan / pinch) — no marquee or picking.
  const phone = usePhone()
  useEffect(() => {
    if (status.kind === 'ready') status.ctx.editor.setNavigation({ viewOnly: phone })
  }, [phone, status])

  const ctx = status.kind === 'ready' ? status.ctx : null
  return (
    <TooltipProvider>
      <EditorContext.Provider value={ctx}>
        <div className={styles.shell} data-readonly={session.readOnly || undefined}>
          <main className={styles.stage} aria-label={t('editor.stage', 'Design canvas')}>
            <div ref={containerRef} className={styles.canvasHost} tabIndex={-1} />
            {status.kind === 'loading' && (
              <div className={styles.placeholder} aria-busy>
                <div className={styles.placeholderCard}>
                  <Spinner size={22} />
                  <div className={styles.placeholderTitle}>{t('editor.loading', 'Opening design…')}</div>
                </div>
              </div>
            )}
            {status.kind === 'error' && (
              <div className={styles.placeholder}>
                <div className={styles.placeholderCard}>
                  <EmptyState
                    icon={<TriangleAlert />}
                    title={t('editor.error.title', 'Could not open this design')}
                    description={status.message}
                    actions={
                      <Button variant="secondary" onClick={onExit}>
                        {t('editor.error.back', 'Back to projects')}
                      </Button>
                    }
                  />
                </div>
              </div>
            )}
            {ctx && <StageChrome />}
          </main>
          {ctx && <EditorShell />}
        </div>
        {needToaster && <Toaster />}
      </EditorContext.Provider>
    </TooltipProvider>
  )
}
