// Route/page guards. Signed-out users see a friendly prompt instead of a redirect loop; staff-only
// areas render 404 for everyone else (no hint that they exist).
import type { ReactNode } from 'react'
import { useLocation } from 'react-router'
import { LogIn } from 'lucide-react'
import { EmptyState, Spinner } from '../../ui'
import { useT } from '../../i18n'
import { useAuth } from '../../data/auth/AuthProvider'
import { NotFoundPage } from './PageStates'
import s from './components.module.css'
import { LinkButton } from './LinkButton'

export function loginHref(returnTo: string): string {
  return `/login?next=${encodeURIComponent(returnTo)}`
}

export function SignInGate({ title, description }: { title?: string; description?: string }) {
  const t = useT()
  const loc = useLocation()
  return (
    <div className={s.gate}>
      <EmptyState
        icon={<LogIn size={22} />}
        title={title ?? t('gate.title', 'Sign in to continue')}
        description={description ?? t('gate.description', 'This area needs a CadSandbox account. Your local projects stay available without one.')}
        actions={
          <>
            <LinkButton to={loginHref(loc.pathname + loc.search)} variant="primary">{t('auth.signIn', 'Sign in')}</LinkButton>
            <LinkButton to="/signup" variant="secondary">{t('auth.createAccount', 'Create account')}</LinkButton>
          </>
        }
      />
    </div>
  )
}

export function RequireAuth({ children, title, description }: { children: ReactNode; title?: string; description?: string }) {
  const auth = useAuth()
  if (auth.status === 'loading')
    return (
      <div className={s.gate}>
        <Spinner size={20} />
      </div>
    )
  if (auth.status !== 'signed-in') return <SignInGate title={title} description={description} />
  return children
}

export function RequireStaff({ children, adminOnly = false }: { children: ReactNode; adminOnly?: boolean }) {
  const auth = useAuth()
  if (auth.status === 'loading')
    return (
      <div className={s.gate}>
        <Spinner size={20} />
      </div>
    )
  if (auth.status !== 'signed-in') return <SignInGate />
  if (!(adminOnly ? auth.isAdmin : auth.isStaff)) return <NotFoundPage />
  return children
}
