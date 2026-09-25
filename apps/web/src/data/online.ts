// Online/offline detection: browser connectivity + whether our API server is reachable.
import { useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { PublicConfigDTO } from '@cadsandbox/shared'
import { api } from './api/endpoints'

function subscribe(cb: () => void): () => void {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}

/** Browser network state (navigator.onLine). */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  )
}

/**
 * Public server config. `available === false` means there is no reachable server: the app runs
 * in local-only mode (all features except sync/sharing/accounts).
 */
export function useServer(): { config: PublicConfigDTO | null; available: boolean | null; refetch: () => void } {
  const online = useOnline()
  const q = useQuery({
    queryKey: ['config', online],
    queryFn: api.config,
    retry: 1,
    staleTime: 5 * 60_000,
    refetchInterval: (query) => (query.state.status === 'error' ? 30_000 : false),
  })
  return {
    config: q.data ?? null,
    available: q.isSuccess ? true : q.isError ? false : null,
    refetch: () => void q.refetch(),
  }
}
