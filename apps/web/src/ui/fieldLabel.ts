// Accessible names for controls inside a FieldRow: the row renders its <label> with an id and provides
// it here; controls that carry no aria-label / aria-labelledby of their own point at it with
// aria-labelledby (several controls of one row — e.g. X/Y/Z — may share it, unlike a label's `for`).
import { createContext, useContext } from 'react'

export const FieldLabelContext = createContext<string | undefined>(undefined)

/** aria-labelledby for a control: the enclosing FieldRow's label unless the control is named explicitly. */
export function useFieldLabelledBy(props: { 'aria-label'?: string; 'aria-labelledby'?: string }): string | undefined {
  const rowLabel = useContext(FieldLabelContext)
  return props['aria-labelledby'] ?? (props['aria-label'] ? undefined : rowLabel)
}
