// better-auth React client (session cookie; nothing is stored in localStorage).
// Plugins mirror the server: organization, admin (impersonation), two-factor (TOTP), passkeys.
import { createAuthClient } from 'better-auth/react'
import { adminClient, organizationClient, twoFactorClient } from 'better-auth/client/plugins'
import { passkeyClient } from '@better-auth/passkey/client'
import { API_ORIGIN } from '../api/client'

const origin = API_ORIGIN || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173')

export const authClient = createAuthClient({
  baseURL: `${origin}/api/auth`,
  fetchOptions: { credentials: 'include' },
  plugins: [
    organizationClient(),
    adminClient(),
    // The sign-in form handles `twoFactorRedirect` itself (inline TOTP step), so no page redirect.
    twoFactorClient({ onTwoFactorRedirect: () => undefined }),
    passkeyClient(),
  ],
})

export type AuthClient = typeof authClient
export type AuthSession = typeof authClient.$Infer.Session

/** better-auth returns `{ data, error }`; turn errors into exceptions with a readable message. */
export async function unwrap<T>(p: Promise<{ data: T | null; error: { message?: string; status?: number; code?: string } | null }>): Promise<T> {
  const { data, error } = await p
  if (error) {
    const err = new Error(error.message || 'Request failed') as Error & { status?: number; code?: string }
    err.status = error.status
    err.code = error.code
    throw err
  }
  return data as T
}
