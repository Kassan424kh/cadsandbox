// /verify-email — confirm an email address (token link) and resend the confirmation mail.
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { CheckCircle2, MailWarning } from 'lucide-react'
import { Button, Spinner, toast } from '../../ui'
import { useT } from '../../i18n'
import { authClient, unwrap } from '../../data/auth/client'
import { useAuth } from '../../data/auth/AuthProvider'
import { useDocumentTitle } from '../hooks'
import { errorMessage } from '../components/Dialogs'
import s from './auth.module.css'
import { LinkButton } from '../components/LinkButton'
import { safeNext } from './AuthLayout'

type Phase = 'verifying' | 'done' | 'failed' | 'pending'

export default function VerifyEmailPage() {
  const t = useT()
  const auth = useAuth()
  const [search] = useSearchParams()
  const token = search.get('token')
  // Where the user was headed before signing up (e.g. an invitation) — see SignupPage.
  const next = safeNext(search.get('next'))
  const callbackURL = `${window.location.origin}/verify-email${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`
  const [phase, setPhase] = useState<Phase>(token ? 'verifying' : search.get('error') ? 'failed' : auth.user && !auth.user.emailVerified ? 'pending' : 'done')
  const [busy, setBusy] = useState(false)
  const ran = useRef(false)
  useDocumentTitle(t('auth.verifyTitle', 'Verify email'))

  useEffect(() => {
    if (!token || ran.current) return
    ran.current = true
    unwrap(authClient.verifyEmail({ query: { token } }))
      .then(async () => {
        setPhase('done')
        await auth.refresh()
      })
      .catch(() => setPhase('failed'))
  }, [token, auth])

  const resend = async () => {
    if (!auth.user?.email) return
    setBusy(true)
    try {
      await unwrap(authClient.sendVerificationEmail({ email: auth.user.email, callbackURL }))
      toast.success(t('auth.verifySent', 'Confirmation email sent'))
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (phase === 'verifying')
    return (
      <header className={s.head}>
        <Spinner size={22} />
        <h1>{t('auth.verifying', 'Verifying your email…')}</h1>
      </header>
    )
  if (phase === 'done')
    return (
      <header className={s.head}>
        <CheckCircle2 size={32} color="var(--cs-success)" />
        <h1>{t('auth.verified', 'Your email is verified')}</h1>
        <p>{t('auth.verifiedDesc', 'Thanks! Your account is fully set up.')}</p>
        {next !== '/' ? (
          <LinkButton to={next} variant="primary">{t('common.continue', 'Continue')}</LinkButton>
        ) : (
          <LinkButton to="/" variant="primary">{t('auth.toDashboard', 'Go to your projects')}</LinkButton>
        )}
      </header>
    )
  return (
    <header className={s.head}>
      <MailWarning size={32} color="var(--cs-warning)" />
      <h1>{phase === 'failed' ? t('auth.verifyFailed', 'This confirmation link is invalid or has expired') : t('auth.verifyPending', 'Please confirm your email')}</h1>
      <p>
        {auth.user
          ? t('auth.verifyResendDesc', 'We can send a new confirmation link to {email}.', { email: auth.user.email })
          : t('auth.verifySignInDesc', 'Sign in to request a new confirmation link.')}
      </p>
      {auth.user ? (
        <Button variant="primary" loading={busy} onClick={resend}>
          {t('auth.resend', 'Send new link')}
        </Button>
      ) : (
        <LinkButton to={`/login?next=${encodeURIComponent(next !== '/' ? `/verify-email?next=${encodeURIComponent(next)}` : '/verify-email')}`} variant="primary">{t('auth.signIn', 'Sign in')}</LinkButton>
      )}
    </header>
  )
}
