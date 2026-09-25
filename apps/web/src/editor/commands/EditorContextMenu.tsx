// Right-click menu for the canvas and the outliner (driven by ui.contextMenu + engine event).
import { useEffect } from 'react'
import { BookmarkPlus, Combine, Component, Copy, Eye, EyeOff, Focus, Group, Lock, LockOpen, Palette, PenLine, Scissors, Trash, Ungroup, ClipboardPaste } from 'lucide-react'
import { QUICK_COLORS } from '@cadsandbox/doc'
import { useT } from '../../i18n'
import { DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, Swatches } from '../../ui'
import { useEditorCtx, useEditorState, useSelectionNodes } from '../EditorContext'
import { useUiStore } from '../ui-store'
import { useActions } from './actions'
import { PointMenu } from './PointMenu'

export function EditorContextMenu() {
  const t = useT()
  const { editor, library, readOnly } = useEditorCtx()
  const actions = useActions()
  const anchor = useUiStore((s) => s.contextMenu)
  const setAnchor = useUiStore((s) => s.setContextMenu)
  const setRightOpen = useUiStore((s) => s.setRightOpen)
  const selection = useEditorState((s) => s.selection)
  const clipboard = useEditorState((s) => s.clipboard)
  const isolated = useEditorState((s) => s.isolated)
  const nodes = useSelectionNodes()
  const has = selection.length > 0
  const allLocked = has && nodes.every((n) => n.locked)
  const anyGroup = nodes.some((n) => n.type === 'group' || n.type === 'instance')

  useEffect(() => editor.on('contextmenu', (e) => setAnchor({ x: e.clientX, y: e.clientY, nodeId: e.nodeId })), [editor, setAnchor])

  const can = (id: Parameters<typeof editor.commands.canExecute>[0]) => editor.commands.canExecute(id)
  const item = (id: Parameters<typeof editor.commands.execute>[0], label: string, icon?: React.ReactNode, danger?: boolean) => {
    const info = editor.commands.get(id)
    return (
      <DropdownMenuItem key={id} icon={icon} shortcut={info?.shortcut} danger={danger} disabled={!can(id)} onSelect={() => actions.run(id)}>
        {label}
      </DropdownMenuItem>
    )
  }

  return (
    <PointMenu anchor={anchor} onClose={() => setAnchor(null)} minWidth={240}>
      {readOnly ? (
        <>
          <DropdownMenuItem icon={<Focus />} disabled={!has} onSelect={() => actions.focus()}>{t('ctx.zoomSelection', 'Zoom to selection')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => actions.run('view.zoomExtents')}>{t('ctx.zoomExtents', 'Zoom extents')}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => actions.setTool('measure.distance')}>{t('ctx.measure', 'Measure')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => actions.setTool('annotate.comment')}>{t('ctx.comment', 'Add comment')}</DropdownMenuItem>
        </>
      ) : has ? (
        <>
          {item('edit.cut', t('ctx.cut', 'Cut'), <Scissors />)}
          {item('edit.copy', t('ctx.copy', 'Copy'), <Copy />)}
          {item('edit.duplicate', t('action.duplicate', 'Duplicate'), <Copy />)}
          <DropdownMenuItem
            icon={<PenLine />}
            onSelect={() => {
              setRightOpen(true)
              requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[data-inspector-name]')?.focus())
            }}
          >
            {t('common.rename', 'Rename')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {anyGroup && selection.length === 1 ? item('object.ungroup', t('action.ungroup', 'Ungroup'), <Ungroup />) : item('object.group', t('action.group', 'Group'), <Group />)}
          {item('object.makeComponent', t('action.component', 'Make component'), <Component />)}
          {anyGroup && item('object.enter', t('ctx.editGroup', 'Edit group'))}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger icon={<Combine />}>{t('action.boolean', 'Boolean')}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {item('boolean.union', t('boolean.union', 'Union'))}
              {item('boolean.subtract', t('boolean.subtract', 'Subtract'))}
              {item('boolean.intersect', t('boolean.intersect', 'Intersect'))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger inset>{t('ctx.transform', 'Transform')}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {item('transform.rotate90', t('command.transform.rotate90', 'Rotate 90°'))}
              {item('transform.mirrorX', t('command.transform.mirrorX', 'Mirror X'))}
              {item('transform.mirrorY', t('command.transform.mirrorY', 'Mirror Y'))}
              {item('transform.mirrorZ', t('command.transform.mirrorZ', 'Mirror Z'))}
              {item('transform.dropToFloor', t('command.transform.dropToFloor', 'Drop to floor'))}
              {item('transform.reset', t('command.transform.reset', 'Reset transform'))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger inset>{t('ctx.align', 'Align & distribute')}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {item('align.minX', t('command.align.minX', 'Align left (X)'))}
              {item('align.centerX', t('command.align.centerX', 'Align center (X)'))}
              {item('align.maxX', t('command.align.maxX', 'Align right (X)'))}
              {item('align.minY', t('command.align.minY', 'Align front (Y)'))}
              {item('align.centerY', t('command.align.centerY', 'Align center (Y)'))}
              {item('align.maxY', t('command.align.maxY', 'Align back (Y)'))}
              {item('align.minZ', t('command.align.minZ', 'Align bottom (Z)'))}
              {item('align.maxZ', t('command.align.maxZ', 'Align top (Z)'))}
              <DropdownMenuSeparator />
              {item('distribute.x', t('command.distribute.x', 'Distribute X'))}
              {item('distribute.y', t('command.distribute.y', 'Distribute Y'))}
              {item('distribute.z', t('command.distribute.z', 'Distribute Z'))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger icon={<Palette />}>{t('color.label', 'Color')}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <div style={{ padding: '6px 8px' }}>
                <Swatches colors={QUICK_COLORS} value={nodes[0]?.color ?? null} onChange={(c) => actions.setColor(c)} allowNone onNone={() => actions.setColor(null)} size="sm" />
              </div>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          {item('object.hide', t('action.hide', 'Hide'), <EyeOff />)}
          <DropdownMenuItem icon={isolated ? <Eye /> : <Focus />} onSelect={() => (isolated ? editor.isolate(null) : actions.run('object.isolate'))}>
            {isolated ? t('action.unisolate', 'Show all') : t('action.isolate', 'Isolate')}
          </DropdownMenuItem>
          {item('object.lock', allLocked ? t('action.unlock', 'Unlock') : t('action.lock', 'Lock'), allLocked ? <LockOpen /> : <Lock />)}
          <DropdownMenuItem icon={<Focus />} onSelect={() => actions.focus()}>{t('ctx.zoomSelection', 'Zoom to selection')}</DropdownMenuItem>
          {library && (
            <DropdownMenuItem icon={<BookmarkPlus />} onSelect={() => actions.saveToCollection()}>
              {t('ctx.saveToCollection', 'Save to collection…')}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {item('edit.delete', t('action.delete', 'Delete'), <Trash />, true)}
        </>
      ) : (
        <>
          <DropdownMenuItem icon={<ClipboardPaste />} disabled={!clipboard} shortcut="Mod+V" onSelect={() => actions.run('edit.paste')}>{t('ctx.paste', 'Paste')}</DropdownMenuItem>
          <DropdownMenuItem shortcut="Mod+A" onSelect={() => actions.run('edit.selectAll')}>{t('ctx.selectAll', 'Select all')}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => actions.run('view.zoomExtents')}>{t('ctx.zoomExtents', 'Zoom extents')}</DropdownMenuItem>
          {isolated && <DropdownMenuItem icon={<Eye />} onSelect={() => editor.isolate(null)}>{t('action.unisolate', 'Show all')}</DropdownMenuItem>}
          <DropdownMenuItem icon={<Eye />} onSelect={() => actions.run('object.unhideAll')}>{t('command.object.unhideAll', 'Unhide all')}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => actions.setTool('annotate.comment')}>{t('ctx.comment', 'Add comment')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setRightOpen(true)}>{t('menu.project.settings', 'Document settings')}</DropdownMenuItem>
        </>
      )}
    </PointMenu>
  )
}
