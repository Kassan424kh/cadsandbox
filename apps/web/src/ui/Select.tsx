import { forwardRef, type ReactNode } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { Select as RS } from 'radix-ui'
import styles from './Controls.module.css'
import { useFieldLabelledBy } from './fieldLabel'
import { cx } from './utils'

export interface SelectOption<V extends string = string> {
  value: V
  label: ReactNode
  icon?: ReactNode
  disabled?: boolean
  /** Optional group heading; options with the same group are rendered together. */
  group?: string
}

export interface SelectProps<V extends string = string> {
  value: V | null | undefined
  onChange(value: V): void
  options: readonly SelectOption<V>[]
  placeholder?: string
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  invalid?: boolean
  ghost?: boolean
  className?: string
  id?: string
  'aria-label'?: string
  /** Text for mixed multi-selection values. */
  mixed?: boolean
  mixedLabel?: string
}

function SelectInner<V extends string>(
  { value, onChange, options, placeholder = 'Select…', size = 'md', disabled, invalid, ghost, className, id, mixed, mixedLabel = 'Mixed', ...rest }: SelectProps<V>,
  ref: React.ForwardedRef<HTMLButtonElement>,
) {
  const groups = new Map<string | undefined, SelectOption<V>[]>()
  for (const o of options) {
    const list = groups.get(o.group) ?? []
    list.push(o)
    groups.set(o.group, list)
  }
  const current = options.find((o) => o.value === value)
  const labelledBy = useFieldLabelledBy(rest)
  return (
    // Always controlled: '' = "nothing selected" (placeholder / mixed). Passing undefined would make
    // Radix uncontrolled, so a null-valued picker (e.g. "+ Add") would keep showing — and could not
    // re-pick — the last chosen option.
    <RS.Root value={mixed ? '' : (value ?? '')} onValueChange={(v) => v !== '' && onChange(v as V)} disabled={disabled}>
      <RS.Trigger
        ref={ref}
        id={id}
        aria-label={rest['aria-label']}
        aria-labelledby={labelledBy}
        className={cx(styles.field, styles.selectTrigger, size === 'sm' && styles.fieldSm, size === 'lg' && styles.fieldLg, invalid && styles.fieldInvalid, ghost && styles.fieldGhost, disabled && styles.fieldDisabled, className)}
      >
        <span className={styles.selectValue} style={mixed ? { color: 'var(--cs-text-3)', fontStyle: 'italic' } : undefined}>
          {mixed ? mixedLabel : current ? (
            <>
              {current.icon}
              <RS.Value>{current.label}</RS.Value>
            </>
          ) : (
            <RS.Value placeholder={placeholder} />
          )}
        </span>
        <RS.Icon asChild>
          <ChevronDown className={styles.selectChevron} />
        </RS.Icon>
      </RS.Trigger>
      <RS.Portal>
        <RS.Content className={styles.selectContent} position="popper" sideOffset={6} collisionPadding={12}>
          <RS.Viewport className={styles.selectViewport}>
            {[...groups.entries()].map(([group, list], gi) => (
              <RS.Group key={group ?? `g${gi}`}>
                {group && <RS.Label className={styles.selectLabel}>{group}</RS.Label>}
                {gi > 0 && !group && <RS.Separator className={styles.selectSeparator} />}
                {list.map((o) => (
                  <RS.Item key={o.value} value={o.value} disabled={o.disabled} className={styles.selectItem}>
                    <span className={styles.selectIndicator}>
                      <RS.ItemIndicator>
                        <Check />
                      </RS.ItemIndicator>
                    </span>
                    {o.icon}
                    <RS.ItemText>{o.label}</RS.ItemText>
                  </RS.Item>
                ))}
              </RS.Group>
            ))}
          </RS.Viewport>
        </RS.Content>
      </RS.Portal>
    </RS.Root>
  )
}

export const Select = forwardRef(SelectInner) as <V extends string = string>(props: SelectProps<V> & { ref?: React.ForwardedRef<HTMLButtonElement> }) => ReturnType<typeof SelectInner>
