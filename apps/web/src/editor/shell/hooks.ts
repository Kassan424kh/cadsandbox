import { createContext, useContext, useEffect, useState } from 'react'
import type { SyncStatus } from '../../data/types'
import { useMediaQuery } from '../../ui'
import { useEditorCtx } from '../EditorContext'

/** Combined sync status of the project session and the open design. */
export function useSyncStatus(): SyncStatus {
  const { session, handle } = useEditorCtx()
  const [status, setStatus] = useState<SyncStatus>(() => worst(session.status(), handle.status()))
  useEffect(() => {
    const update = () => setStatus(worst(session.status(), handle.status()))
    const a = session.onStatus(update)
    const b = handle.onStatus(update)
    update()
    return () => {
      a()
      b()
    }
  }, [session, handle])
  return status
}

const RANK: Record<SyncStatus, number> = { synced: 0, local: 1, syncing: 2, connecting: 3, offline: 4, error: 5 }
function worst(a: SyncStatus, b: SyncStatus): SyncStatus {
  return RANK[a] >= RANK[b] ? a : b
}

/** Stage (canvas area) size → chrome density. compact: icon-only pills; tight: drop secondary pills. */
export interface StageInfo {
  width: number
  height: number
  compact: boolean
  tight: boolean
}
export const StageContext = createContext<StageInfo>({ width: 1600, height: 900, compact: false, tight: false })
export const useStage = () => useContext(StageContext)

/** Phone-sized viewport → simplified viewer chrome. */
export const usePhone = () => useMediaQuery('(max-width: 640px)')
/** Narrow (tablet portrait) → side panels become drawers. */
export const useNarrow = () => useMediaQuery('(max-width: 1100px)')
