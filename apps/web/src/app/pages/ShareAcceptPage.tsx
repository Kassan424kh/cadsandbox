// /s/:token — accept a share link (optionally password-protected), then open the project.
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { KeyRound, LogIn, UserPlus } from 'lucide-react'
import { Button, Input, Logomark } from '../../ui'
import { useT } from '../../i18n'
import { api } from '../../data/api/endpoints'
import { isApiError } from '../../data/api/client'
import { useAuth } from '../../data/auth/AuthProvider'
import { useDocumentTitle } from '../hooks'
import { ErrorCard, FullPageLoader } from '../components/PageStates'
import { loginHref } from '../components/Guards'
import { errorMessage } from '../components/Dialogs'
import c from '../components/components.module.css'
import { LinkButton } from '../components/LinkButton'

type Phase = { kind: 'working' } | { kind: 'password'; wrong: boolean } | { kind: 'signin' } | { kind: 'invalid' } | { kind: 'error'; message: string }

export default function ShareAcceptPage() {
  const t = useT()
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const auth = useAuth()
  const pwId = useId()
  const [phase, setPhase] = useState<Phase>({ kind: 'working' })
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  useDocumentTitle(t('shareLink.title', 'Shared project'))

  const accept = useCallback(
    async (pw?: string) => {
      setBusy(true)
      try {
        // Password-protected links return a short-lived signed grant; guests must use it (the raw
        // token alone is not accepted for those links), so it becomes the session's share credential.
        const { projectId, grant } = await api.links.accept(token, pw)
        const credential = grant ?? token
        const guest = auth.status !== 'signed-in'
        navigate(`/p/${projectId}${guest ? `?share=${encodeURIComponent(credential)}` : ''}`, { replace: true })
      } catch (err) {
        if (!isApiError(err)) return setPhase({ kind: 'error', message: errorMessage(err) })
        const reason = err.reason
        if (reason === 'password_required' || reason === 'password_invalid' || (err.status === 403 && /password/i.test(err.message))) {
          setPhase({ kind: 'password', wrong: reason === 'password_invalid' || !!pw })
        } else if (err.status === 401) setPhase({ kind: 'signin' })
        else if (err.status === 404 || err.status === 410 || reason === 'expired') setPhase({ kind: 'invalid' })
        else setPhase({ kind: 'error', message: err.message })
      } finally {
        setBusy(false)
      }
    },
    [token, auth.status, navigate],
  )

  useEffect(() => {
    if (auth.status !== 'loading') void accept()
  }, [auth.status, accept])

  if (phase.kind === 'working') return <FullPageLoader label={t('shareLink.opening', 'Opening shared project…')} />
  if (phase.kind === 'invalid')
    return (
      <ErrorCard title={t('shareLink.invalid', 'This link is invalid or has expired')} message={t('shareLink.invalidDesc', 'Ask the person who shared it for a new link.')}>
        <LinkButton to="/" variant="primary">{t('common.home', 'Home')}</LinkButton>
      </ErrorCard>
    )
  if (phase.kind === 'error')
    return (
      <ErrorCard title={t('shareLink.failed', 'The link could not be opened')} message={phase.message}>
        <Button variant="primary" onClick={() => void accept()}>
          {t('common.retry', 'Retry')}
        </Button>
      </ErrorCard>
    )
  if (phase.kind === 'signin')
    return (
      <ErrorCard title={t('shareLink.signIn', 'Sign in to join this project')} message={t('shareLink.signInDesc', 'This link gives access to a project. Sign in or create a free account to continue.')}>
        <div className={c.row}>
          <LinkButton to={loginHref(location.pathname)} variant="primary" icon={<LogIn size={16} />}>{t('auth.signIn', 'Sign in')}</LinkButton>
          <LinkButton to={`/signup?next=${encodeURIComponent(location.pathname)}`} variant="secondary" icon={<UserPlus size={16} />}>{t('auth.createAccount', 'Create account')}</LinkButton>
        </div>
      </ErrorCard>
    )

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (password) void accept(password)
  }
  return (
    <ErrorCard title={t('shareLink.passwordTitle', 'This project is password-protected')} message={t('shareLink.passwordDesc', 'Enter the password you received with the link.')}>
      <form className={c.form} onSubmit={submit} style={{ width: '100%' }}>
        <Logomark size={36} style={{ justifySelf: 'center' }} />
        <label className={c.label} htmlFor={pwId}>
          {t('auth.password', 'Password')}
          <Input id={pwId} type="password" value={password} autoFocus autoComplete="off" invalid={phase.wrong} prefix={<KeyRound size={15} />} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {phase.wrong && (
          <p className={c.error} role="alert">
            {t('shareLink.wrongPassword', 'That password is not correct.')}
          </p>
        )}
        <Button type="submit" variant="primary" loading={busy} disabled={!password}>
          {t('shareLink.open', 'Open project')}
        </Button>
      </form>
    </ErrorCard>
  )
}
