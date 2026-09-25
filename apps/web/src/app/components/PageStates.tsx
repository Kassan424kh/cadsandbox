// Full-page loading / error / not-found states (also the router's error boundary).
import type { ReactNode } from 'react'
import { isRouteErrorResponse, useNavigate, useRouteError } from 'react-router'
import { ArrowLeft, Home, RefreshCw } from 'lucide-react'
import { Button, Logomark } from '../../ui'
import { useT } from '../../i18n'
import { useDocumentTitle } from '../hooks'
import s from './components.module.css'
import { LinkButton } from './LinkButton'

export function FullPageLoader({ label }: { label?: string }) {
  const t = useT()
  return (
    <div className={s.fullPage} role="status" aria-live="polite">
      <div className={s.loaderStack}>
        <Logomark size={44} className={s.pulseMark} />
        <span>{label ?? t('common.loading', 'Loading…')}</span>
      </div>
    </div>
  )
}

export function ErrorCard({ code, title, message, children }: { code?: string; title: string; message?: string; children?: ReactNode }) {
  return (
    <div className={s.fullPage}>
      <div className={s.errorCard}>
        {code && <div className={s.errorCode} aria-hidden="true">{code}</div>}
        <h1 className={s.errorTitle}>{title}</h1>
        {message && <p className={s.muted}>{message}</p>}
        {children}
      </div>
    </div>
  )
}

export function NotFoundPage() {
  const t = useT()
  const navigate = useNavigate()
  useDocumentTitle(t('errors.notFound.title', 'This page does not exist'))
  return (
    <ErrorCard
      code="404"
      title={t('errors.notFound.title', 'This page does not exist')}
      message={t('errors.notFound.message', 'The link may be broken, or the page may have been moved.')}
    >
      <div className={s.row}>
        <Button variant="secondary" icon={<ArrowLeft size={16} />} onClick={() => navigate(-1)}>
          {t('common.back', 'Back')}
        </Button>
        <LinkButton to="/" variant="primary" icon={<Home size={16} />}>{t('common.home', 'Home')}</LinkButton>
      </div>
    </ErrorCard>
  )
}

/** Router error boundary: 404s from unknown routes, chunk load failures (offline), crashes. */
export function RouteError() {
  const t = useT()
  const error = useRouteError()
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />
  const message = error instanceof Error ? error.message : String(error ?? '')
  const chunk = /dynamically imported module|Failed to fetch|Importing a module script failed/i.test(message)
  return (
    <ErrorCard
      code={chunk ? undefined : '!'}
      title={chunk ? t('errors.chunk.title', 'This part of the app could not be loaded') : t('errors.crash.title', 'Something went wrong')}
      message={
        chunk
          ? t('errors.chunk.message', 'Check your internet connection and reload. After one visit online, CadSandbox also works offline.')
          : t('errors.crash.message', 'An unexpected error occurred. Your work is stored on this device and is not lost.')
      }
    >
      <div className={s.row}>
        <Button variant="primary" icon={<RefreshCw size={16} />} onClick={() => window.location.reload()}>
          {t('common.reload', 'Reload')}
        </Button>
        <LinkButton href="/" variant="secondary" icon={<Home size={16} />}>{t('common.home', 'Home')}</LinkButton>
      </div>
      {import.meta.env.DEV && message && <pre className={s.details}>{message}</pre>}
    </ErrorCard>
  )
}
