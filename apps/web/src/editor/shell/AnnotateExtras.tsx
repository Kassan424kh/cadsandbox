// Extra Annotate-menu entries: north arrow + scale bar symbols (placed with the Add/place tool) and
// the "Auto-dimension walls" command (exterior chain dimensions of the active level, one undo step).
import { Compass, Ruler, RulerDimensionLine } from 'lucide-react'
import { useT } from '../../i18n'
import { ToolButton } from '../../ui'
import { useEditorCtx, useEditorState } from '../EditorContext'
import { useActions } from '../commands/actions'
import { useAutoDimension } from '../commands/drafting'
import styles from './toolmenu.module.css'

export function AnnotateExtras({ onPick }: { onPick?(): void }) {
  const t = useT()
  const actions = useActions()
  const { doc, readOnly } = useEditorCtx()
  const autoDimension = useAutoDimension()
  const activeItem = useEditorState((s) => (s.tool === 'place' ? (s.toolOptions.itemId as string | undefined) : undefined))

  const placeNorthArrow = () => {
    actions.place({ type: 'northarrow', name: 'North arrow', layer: 'layer-anno', params: { size: 1.2, style: 'compass', angle: doc.meta.geo?.northAngle ?? 0 } }, 'northarrow')
    onPick?.()
  }
  const placeScaleBar = () => {
    actions.place({ type: 'scalebar', name: 'Scale bar', layer: 'layer-anno', params: { scale: 100, length: 5, segments: 5 } }, 'scalebar')
    onPick?.()
  }

  return (
    <>
      <ToolButton className={styles.gridItem} icon={<Compass />} label={t('symbol.northArrow', 'North arrow')} active={activeItem === 'northarrow'} tooltip={t('symbol.northArrowTip', 'North arrow symbol (follows the document north angle)')} onClick={placeNorthArrow} disabled={readOnly} />
      <ToolButton className={styles.gridItem} icon={<Ruler />} label={t('symbol.scaleBar', 'Scale bar')} active={activeItem === 'scalebar'} tooltip={t('symbol.scaleBarTip', 'Graphic scale bar for plans and sheets')} onClick={placeScaleBar} disabled={readOnly} />
      <ToolButton
        className={styles.gridItem}
        icon={<RulerDimensionLine />}
        label={t('autoDim.label', 'Auto-dimension')}
        tooltip={t('autoDim.tip', 'Exterior chain dimensions for the walls of the active level')}
        onClick={() => {
          autoDimension()
          onPick?.()
        }}
        disabled={readOnly}
      />
    </>
  )
}
