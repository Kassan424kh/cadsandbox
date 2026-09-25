// Docked chrome around the stage: left rail + panel, right inspector, status bar, and the global
// singletons (command palette, shortcuts, context menu, dialogs, toasts from engine notifications).
import { Component, useEffect, type ReactNode } from 'react'
import { useT } from '../../i18n'
import { Sheet, SheetContent, toast } from '../../ui'
import { ShareDialog } from '../../app/dialogs/ShareDialog'
import { SupportDialog } from '../../app/dialogs/SupportDialog'
import { VersionsPanel } from '../../app/dialogs/VersionsPanel'
import { useEditorCtx } from '../EditorContext'
import { CommandPalette } from '../commands/CommandPalette'
import { EditorContextMenu } from '../commands/EditorContextMenu'
import { useGlobalShortcuts } from '../commands/useGlobalShortcuts'
import { Onboarding } from '../dialogs/Onboarding'
import { PdfImportDialog } from '../dialogs/PdfImportDialog'
import { RenderImageDialog } from '../dialogs/RenderImageDialog'
import { VideoExportDialog } from '../dialogs/VideoExportDialog'
import { SaveToCollectionDialog } from '../dialogs/SaveToCollectionDialog'
import { SheetEditorDialog } from '../dialogs/SheetEditorDialog'
import { ShortcutsSheet } from '../dialogs/ShortcutsSheet'
import { MaterialEditorDialog } from '../inspector/MaterialEditorDialog'
import { Inspector } from '../inspector/Inspector'
import { LeftRail } from '../panels/LeftRail'
import { useUiStore } from '../ui-store'
import { useNarrow, usePhone } from './hooks'
import { StatusBar } from './StatusBar'

/** App-shell dialogs are developed concurrently; never let one of them take the editor down. */
class DialogBoundary extends Component<{ children: ReactNode; onError(): void }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  override componentDidCatch(err: unknown) {
    console.error('[cadsandbox] dialog crashed:', err)
    this.props.onError()
  }
  override componentDidUpdate(prev: { children: ReactNode }) {
    if (this.state.failed && prev.children !== this.props.children) this.setState({ failed: false })
  }
  override render() {
    return this.state.failed ? null : this.props.children
  }
}

function EngineToasts() {
  const { editor } = useEditorCtx()
  useEffect(
    () =>
      editor.on('notify', (e) => {
        if (e.level === 'error') toast.error(e.message)
        else if (e.level === 'warning') toast.warning(e.message)
        else if (e.level === 'success') toast.success(e.message)
        else toast.info(e.message)
      }),
    [editor],
  )
  return null
}

export function EditorShell() {
  const t = useT()
  const { session, fileId } = useEditorCtx()
  const ui = useUiStore()
  const phone = usePhone()
  const narrow = useNarrow()
  useGlobalShortcuts()

  return (
    <>
      <EngineToasts />
      {!phone && <LeftRail drawer={narrow} />}
      {!phone && <Inspector drawer={narrow} />}
      <StatusBar />
      <CommandPalette />
      <EditorContextMenu />
      <Onboarding />

      <DialogBoundary
        onError={() => {
          toast.error(t('editor.dialogFailed', 'This dialog is not available right now'))
          ui.closeDialog()
        }}
      >
        {ui.dialog === 'share' && <ShareDialog session={session} open onOpenChange={(o) => !o && ui.closeDialog()} />}
        {ui.dialog === 'support' && <SupportDialog open onOpenChange={(o) => !o && ui.closeDialog()} projectId={session.projectId} />}
        {ui.dialog === 'versions' && (
          <Sheet open onOpenChange={(o) => !o && ui.closeDialog()}>
            <SheetContent title={t('versions.title', 'Version history')} width={440} flush>
              <VersionsPanel session={session} fileId={fileId} onClose={() => ui.closeDialog()} />
            </SheetContent>
          </Sheet>
        )}
      </DialogBoundary>
      <RenderImageDialog />
      <PdfImportDialog />
      <VideoExportDialog />
      <ShortcutsSheet />
      <SaveToCollectionDialog />
      <SheetEditorDialog />
      <MaterialEditorDialog />
    </>
  )
}
