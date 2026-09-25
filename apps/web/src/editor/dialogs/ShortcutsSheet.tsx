// "?" — keyboard shortcut reference (tools, commands by category, navigation, panels).
import { useMemo } from 'react'
import { TOOL_SHORTCUTS, type ToolId } from '@cadsandbox/render'
import { useT } from '../../i18n'
import { Kbd, SectionLabel, Sheet, SheetContent } from '../../ui'
import { useEditorCtx } from '../EditorContext'
import { TOOL_META } from '../engine/tools'
import { useUiStore } from '../ui-store'

function Row({ label, keys }: { label: string; keys: string[] }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 28, fontSize: 'var(--cs-text-sm)' }}>
      <span style={{ color: 'var(--cs-text-2)' }}>{label}</span>
      <span style={{ display: 'inline-flex', gap: 6 }}>
        {keys.map((k) => (
          <Kbd key={k} shortcut={k} />
        ))}
      </span>
    </div>
  )
}

export function ShortcutsSheet() {
  const t = useT()
  const { editor } = useEditorCtx()
  const open = useUiStore((s) => s.dialog === 'shortcuts')
  const close = useUiStore((s) => s.closeDialog)
  const groups = useMemo(() => {
    const byCat = new Map<string, { label: string; shortcut: string }[]>()
    for (const c of editor.commands.list()) {
      if (!c.shortcut) continue
      byCat.set(c.category, [...(byCat.get(c.category) ?? []), { label: t(`command.${c.id}`, c.label), shortcut: c.shortcut }])
    }
    return byCat
  }, [editor, t])

  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()}>
      <SheetContent title={t('shortcuts.title', 'Keyboard shortcuts')} description={t('shortcuts.desc', 'Single keys switch tools; hold Shift for ×10 steps in number fields.')} width={420}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <section>
            <SectionLabel style={{ marginBottom: 6 }}>{t('shortcuts.general', 'General')}</SectionLabel>
            <Row label={t('palette.title', 'Command palette')} keys={['Mod+K']} />
            <Row label={t('shortcuts.help', 'This sheet')} keys={['?']} />
            <Row label={t('shortcuts.cancel', 'Cancel tool / deselect')} keys={['Escape']} />
            <Row label={t('shortcuts.vcb', 'Type an exact value while drawing')} keys={['Tab']} />
            <Row label={t('shortcuts.panels', 'Toggle Scene · Files · Library · Comments')} keys={['Alt+S', 'Alt+F', 'Alt+L', 'Alt+C']} />
          </section>
          <section>
            <SectionLabel style={{ marginBottom: 6 }}>{t('shortcuts.navigation', 'Navigation')}</SectionLabel>
            <Row label={t('shortcuts.orbit', 'Orbit')} keys={['Alt+drag', 'Middle drag']} />
            <Row label={t('shortcuts.pan', 'Pan')} keys={['Shift+Middle drag', 'Space+drag']} />
            <Row label={t('shortcuts.zoom', 'Zoom')} keys={['Wheel']} />
            <Row label={t('shortcuts.walkKeys', 'Walk mode movement')} keys={['W', 'A', 'S', 'D']} />
          </section>
          <section>
            <SectionLabel style={{ marginBottom: 6 }}>{t('shortcuts.tools', 'Tools')}</SectionLabel>
            {(Object.entries(TOOL_SHORTCUTS) as [ToolId, string][]).map(([id, key]) => (
              <Row key={id} label={t(TOOL_META[id].key, TOOL_META[id].fallback)} keys={[key]} />
            ))}
          </section>
          {[...groups.entries()].map(([cat, list]) => (
            <section key={cat}>
              <SectionLabel style={{ marginBottom: 6 }}>{t(`command.category.${cat}`, cat)}</SectionLabel>
              {list.map((c) => (
                <Row key={c.label + c.shortcut} label={c.label} keys={[c.shortcut]} />
              ))}
            </section>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}
