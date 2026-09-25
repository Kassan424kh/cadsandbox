// Small app-level hooks.
import { useEffect } from 'react'
import { BRAND } from '@cadsandbox/shared'

/** Sets document.title as "<title> · CadSandbox". */
export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    document.title = title ? `${title} · ${BRAND.name}` : BRAND.name
  }, [title])
}
