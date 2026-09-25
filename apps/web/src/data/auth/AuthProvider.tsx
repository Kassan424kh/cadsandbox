// Auth/session state for the whole app. Signed-out users get the full local-first app; signing in
// adds cloud sync, sharing and organisations. When the server is unreachable the last known account
// (id + name only) is kept so cached cloud projects stay usable offline.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { MeDTO, SystemRole } from '@cadsandbox/shared'
import { authClient } from './client'
import { api } from '../api/endpoints'
import { clearCloudCache } from '../cloud-cache'
import { closeAllSessions } from '../session/manager'
import { adoptLocale } from '../../i18n'

export interface AccountUser {
  id: string
  name: string
  email: string
  image: string | null
  role: SystemRole
  emailVerified: boolean
  twoFactorEnabled: boolean
}

export interface AuthState {
  status: 'loading' | 'signed-in' | 'signed-out'
  /** Server unreachable: cloud features degrade to cached data. */
  offline: boolean
  user: AccountUser | null
  me: MeDTO | null
  /** Admin id when a staff member is impersonating this account. */
  impersonatedBy: string | null
  isStaff: boolean
  isAdmin: boolean
  refresh(): Promise<void>
  signOut(): Promise<void>
}

const LAST_ACCOUNT_KEY = 'cadsandbox.account'
/** Identity (user id, plus `@adminId` while impersonated) that this device's cloud cache belongs to. */
const CACHE_OWNER_KEY = 'cadsandbox.cacheOwner'
const AuthContext = createContext<AuthState | null>(null)

function readLastAccount(): Pick<AccountUser, 'id' | 'name'> | null {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_ACCOUNT_KEY) ?? 'null') as { id?: unknown; name?: unknown } | null
    return v && typeof v.id === 'string' && typeof v.name === 'string' ? { id: v.id, name: v.name } : null
  } catch {
    return null
  }
}

function readCacheOwner(): string | null {
  try {
    return localStorage.getItem(CACHE_OWNER_KEY)
  } catch {
    return null
  }
}

function writeCacheOwner(v: string | null): void {
  try {
    if (v) localStorage.setItem(CACHE_OWNER_KEY, v)
    else localStorage.removeItem(CACHE_OWNER_KEY)
  } catch {
    /* ignore */
  }
}

function writeLastAccount(v: Pick<AccountUser, 'id' | 'name'> | null): void {
  try {
    if (v) localStorage.setItem(LAST_ACCOUNT_KEY, JSON.stringify({ id: v.id, name: v.name }))
    else localStorage.removeItem(LAST_ACCOUNT_KEY)
  } catch {
    /* ignore */
  }
}

type RawUser = { id: string; name?: string | null; email?: string | null; image?: string | null; role?: string | null; emailVerified?: boolean | null; twoFactorEnabled?: boolean | null }

function toAccount(u: RawUser): AccountUser {
  const role = u.role === 'admin' || u.role === 'support' ? u.role : 'user'
  return {
    id: u.id,
    name: u.name ?? '',
    email: u.email ?? '',
    image: u.image ?? null,
    role,
    emailVerified: !!u.emailVerified,
    twoFactorEnabled: !!u.twoFactorEnabled,
  }
}

function isNetworkError(err: unknown): boolean {
  const e = err as { status?: number; message?: string } | null
  return !!e && (!e.status || e.status === 0 || e.status >= 502) && !/unauthori[sz]ed/i.test(e.message ?? '')
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const session = authClient.useSession()
  const raw = session.data as { user: RawUser; session: { impersonatedBy?: string | null } } | null
  // "Offline" only matters for someone who has an account on this device; signed-out users are
  // simply local-only when there is no server.
  const offline = !raw && !!session.error && isNetworkError(session.error) && readLastAccount() !== null
  const signedIn = !!raw

  const meQuery = useQuery({ queryKey: ['me'], queryFn: api.me.get, enabled: signedIn, staleTime: 60_000 })

  const impersonatedBy = raw?.session.impersonatedBy ?? null
  useEffect(() => {
    // An impersonation session is not "the account of this device" (offline mode shows the last one).
    if (raw?.user && !impersonatedBy) writeLastAccount({ id: raw.user.id, name: raw.user.name ?? '' })
  }, [raw?.user, impersonatedBy])

  // The device cache of cloud projects (documents, files, metadata) belongs to one identity. When a
  // different one is signed in — another account after an expired session, an admin who starts or
  // stops impersonating — drop the previous identity's cached cloud data before anything is shown
  // (device-only projects stay). Until then auth reports 'loading', so no editor session opens.
  const identity = raw?.user ? (impersonatedBy ? `${raw.user.id}@${impersonatedBy}` : raw.user.id) : null
  const [cacheOwner, setCacheOwner] = useState(readCacheOwner)
  const switching = identity !== null && cacheOwner !== null && cacheOwner !== identity
  useEffect(() => {
    if (!identity || cacheOwner === identity) return
    if (cacheOwner === null) {
      writeCacheOwner(identity)
      setCacheOwner(identity)
      return
    }
    let cancelled = false
    closeAllSessions()
    void clearCloudCache()
      .catch((err: unknown) => console.warn('[auth] cache cleanup failed', err))
      .finally(() => {
        if (cancelled) return
        writeCacheOwner(identity)
        setCacheOwner(identity)
        void qc.invalidateQueries()
      })
    return () => {
      cancelled = true
    }
  }, [identity, cacheOwner, qc])

  useEffect(() => {
    adoptLocale(meQuery.data?.user.locale)
  }, [meQuery.data?.user.locale])

  const refresh = useCallback(async () => {
    await session.refetch()
    await qc.invalidateQueries({ queryKey: ['me'] })
  }, [session, qc])

  const signOut = useCallback(async () => {
    try {
      await authClient.signOut()
    } finally {
      writeLastAccount(null)
      closeAllSessions()
      await clearCloudCache().catch((err: unknown) => console.warn('[auth] cache cleanup failed', err))
      writeCacheOwner(null)
      setCacheOwner(null)
      qc.clear()
      await session.refetch()
    }
  }, [qc, session])

  const value = useMemo<AuthState>(() => {
    let user: AccountUser | null = null
    if (raw?.user) user = { ...toAccount(raw.user), ...(meQuery.data ? pickMe(meQuery.data) : {}) }
    else if (offline) {
      const last = readLastAccount()
      if (last) user = { ...last, email: '', image: null, role: 'user', emailVerified: true, twoFactorEnabled: false }
    }
    const status: AuthState['status'] = (session.isPending && !session.error) || switching ? 'loading' : user ? 'signed-in' : 'signed-out'
    return {
      status,
      offline,
      user,
      me: meQuery.data ?? null,
      impersonatedBy,
      isStaff: user?.role === 'admin' || user?.role === 'support',
      isAdmin: user?.role === 'admin',
      refresh,
      signOut,
    }
  }, [raw, offline, meQuery.data, session.isPending, session.error, switching, impersonatedBy, refresh, signOut])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

function pickMe(me: MeDTO): Partial<AccountUser> {
  const u = me.user
  return { name: u.name, email: u.email, image: u.image, role: u.role, emailVerified: u.emailVerified, twoFactorEnabled: u.twoFactorEnabled }
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth() outside <AuthProvider>')
  return ctx
}
