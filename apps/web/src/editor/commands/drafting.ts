// Drafting commands shared by the Annotate menu and the command palette: "Auto-dimension walls"
// (exterior chain dimensions of the active level as one undo step).
import { useCallback } from 'react'
import { autoDimensionWalls, type AutoDimensionOptions } from '@cadsandbox/render'
import { useT } from '../../i18n'
import { toast } from '../../ui'
import { useEditorCtx } from '../EditorContext'

export function useAutoDimension(): (opts?: AutoDimensionOptions) => void {
  const t = useT()
  const { doc, editor, readOnly } = useEditorCtx()
  return useCallback(
    (opts: AutoDimensionOptions = { exterior: true, interior: false }) => {
      if (readOnly) return
      const levelId = editor.getState().activeLevel
      if (!levelId) {
        toast.info(t('autoDim.noLevel', 'Select a level first — the walls of the active level are dimensioned.'))
        return
      }
      const nodes = autoDimensionWalls(doc, levelId, opts)
      if (!nodes.length) {
        toast.info(t('autoDim.noWalls', 'No straight walls on this level to dimension.'))
        return
      }
      const ids = doc.transact(() => doc.addNodes(nodes))
      editor.select(ids)
      toast.success(t('autoDim.done', '{n} dimension chains added — drag them to adjust the offset', { n: ids.length }))
    },
    [doc, editor, readOnly, t],
  )
}
