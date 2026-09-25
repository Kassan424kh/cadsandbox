// Per-viewport glass chips (view preset + render mode) and the layout switcher.
import { ChevronDown } from 'lucide-react'
import type { RenderMode } from '@cadsandbox/doc'
import type { ViewLayout, ViewPreset } from '@cadsandbox/render'
import { useT } from '../../i18n'
import { Chip, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger, Tooltip, cx } from '../../ui'
import { useEditorCtx, useEditorState } from '../EditorContext'
import { IconQuadView, IconSingleView, IconSplitView, IconViewCube } from '../library/icons'
import styles from '../editor.module.css'
import { usePhone } from './hooks'

const PRESETS: ViewPreset[] = ['perspective', 'iso', 'top', 'front', 'right', 'left', 'back', 'bottom']
const MODES: RenderMode[] = ['shaded', 'realistic', 'clay', 'wireframe', 'xray', 'hidden-line', 'technical']

interface Region {
  top: number
  left: number
}

/** Viewport regions in percent for the engine's fixed layouts (split = 50/50, quad = 2×2). */
function regions(layout: ViewLayout): Region[] {
  if (layout === 'single') return [{ top: 0, left: 0 }]
  if (layout === 'split') return [{ top: 0, left: 0 }, { top: 0, left: 50 }]
  return [{ top: 0, left: 0 }, { top: 0, left: 50 }, { top: 50, left: 0 }, { top: 50, left: 50 }]
}

export function ViewportChrome() {
  const t = useT()
  const { editor } = useEditorCtx()
  const layout = useEditorState((s) => s.layout)
  const viewports = useEditorState((s) => s.viewports)
  const active = useEditorState((s) => s.activeViewport)
  const phone = usePhone()
  const presetLabel: Record<ViewPreset | 'custom', string> = {
    perspective: t('view.perspective', 'Perspective'),
    iso: t('view.iso', 'Isometric'),
    top: t('view.top', 'Top'),
    bottom: t('view.bottom', 'Bottom'),
    front: t('view.front', 'Front'),
    back: t('view.back', 'Back'),
    left: t('view.left', 'Left'),
    right: t('view.right', 'Right'),
    custom: t('view.custom', 'Custom'),
  }
  const modeLabel: Record<RenderMode, string> = {
    shaded: t('render.shaded', 'Shaded'),
    realistic: t('render.realistic', 'Realistic'),
    clay: t('render.clay', 'Clay'),
    wireframe: t('render.wireframe', 'Wireframe'),
    xray: t('render.xray', 'X-ray'),
    'hidden-line': t('render.hiddenLine', 'Hidden line'),
    technical: t('render.technical', 'Technical'),
  }
  const regs = regions(layout)

  return (
    <>
      {viewports.map((vp) => {
        const r = regs[vp.index] ?? regs[0]!
        // top-row viewports: chips sit under the top-left pills and to the RIGHT of the engine's view
        // cube (84 px at left 14, see EditorPage viewCubeOffset); lower viewports keep the corner.
        const top = r.top === 0 ? 78 : `calc(${r.top}% + 14px)`
        const left = r.top === 0 ? `calc(${r.left}% + 108px)` : `calc(${r.left}% + 14px)`
        const isActive = vp.index === active
        return (
          <div key={vp.index} className={styles.viewportChips} style={{ top, left }}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Chip icon={<IconViewCube />} active={isActive} className={cx(isActive && styles.viewportActive)} onPointerDown={() => editor.setActiveViewport(vp.index)} aria-label={t('viewport.viewMenu', 'View: {label}', { label: vp.label })}>
                  {vp.preset === 'custom' ? vp.label : presetLabel[vp.preset]}
                  <ChevronDown style={{ opacity: 0.6, width: 12, height: 12 }} />
                </Chip>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>{t('viewport.standardViews', 'Standard views')}</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={vp.preset} onValueChange={(v) => editor.setViewPreset(v as ViewPreset, vp.index)}>
                  {PRESETS.map((p) => (
                    <DropdownMenuRadioItem key={p} value={p}>
                      {presetLabel[p]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => editor.zoomToFit(undefined, true)} shortcut="Shift+Z">
                  {t('viewport.zoomExtents', 'Zoom extents')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void editor.commands.execute('view.saveView')}>{t('viewport.saveView', 'Save this view')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {!phone && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Chip active={isActive} onPointerDown={() => editor.setActiveViewport(vp.index)} aria-label={t('viewport.renderMenu', 'Render mode: {label}', { label: modeLabel[vp.renderMode] })}>
                    {modeLabel[vp.renderMode]}
                    <ChevronDown style={{ opacity: 0.6, width: 12, height: 12 }} />
                  </Chip>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuRadioGroup value={vp.renderMode} onValueChange={(v) => editor.setRenderMode(v as RenderMode, vp.index)}>
                    {MODES.map((m) => (
                      <DropdownMenuRadioItem key={m} value={m}>
                        {modeLabel[m]}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )
      })}
      {!phone && (
        <div className={styles.underTopRight}>
          <div className={styles.layoutSwitch} role="radiogroup" aria-label={t('viewport.layout', 'Viewport layout')}>
            {(
              [
                ['single', <IconSingleView key="s" />, t('viewport.layoutSingle', 'Single view')],
                ['split', <IconSplitView key="sp" />, t('viewport.layoutSplit', 'Split: 2D + 3D')],
                ['quad', <IconQuadView key="q" />, t('viewport.layoutQuad', 'Four views')],
              ] as const
            ).map(([id, icon, label]) => (
              <Tooltip key={id} content={label} side="left">
                <button type="button" role="radio" aria-checked={layout === id} aria-label={label} className={cx(styles.layoutBtn, layout === id && styles.layoutBtnActive)} onClick={() => editor.setLayout(id)}>
                  {icon}
                </button>
              </Tooltip>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
