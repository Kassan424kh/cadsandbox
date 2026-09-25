// /signup — create an account (email + password), accept terms, email verification notice.
import { useId, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { KeyRound, Mail, User, UserPlus } from 'lucide-react'
import { Button, Checkbox, Input } from '../../ui'
import { getLanguage, useT } from '../../i18n'
import { authClient, unwrap } from '../../data/auth/client'
import { useAuth } from '../../data/auth/AuthProvider'
import { useServer } from '../../data/online'
import { api } from '../../data/api/endpoints'
import { useDocumentTitle } from '../hooks'
import { errorMessage } from '../components/Dialogs'
import { MIN_PASSWORD, passwordScore, safeNext } from './AuthLayout'
import s from './auth.module.css'
import { LinkButton } from '../components/LinkButton'

export function PasswordStrength({ password }: { password: string }) {
  const t = useT()
  const score = passwordScore(password)
  const labels = ['', t('auth.strength.weak', 'Weak'), t('auth.strength.fair', 'Fair'), t('auth.strength.good', 'Good'), t('auth.strength.strong', 'Strong')]
  return (
    <>
      <div className={s.strength} data-score={score} aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
      <span className={s.hint} aria-live="polite">
        {password ? labels[score] : t('auth.passwordRule', 'At least {n} characters. Longer is stronger.', { n: MIN_PASSWORD })}
      </span>
    </>
  )
}

export default function SignupPage() {
  const t = useT()
  const navigate = useNavigate()
  const [search] = useSearchParams()
  const next = safeNext(search.get('next'))
  const auth = useAuth()
  const { config, available } = useServer()
  const nameId = useId()
  const emailId = useId()
  const pwId = useId()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [terms, setTerms] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  useDocumentTitle(t('auth.createAccount', 'Create account'))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!terms || password.length < MIN_PASSWORD) return
    setBusy(true)
    setError(null)
    try {
      // Keep `next` (e.g. an /invite/:id link) through the e-mail round trip: the confirmation link
      // lands on /verify-email, which continues there instead of the dashboard.
      const verifyUrl = `${window.location.origin}/verify-email${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`
      const data = await unwrap(authClient.signUp.email({ name: name.trim(), email: email.trim(), password, callbackURL: verifyUrl }))
      const hasSession = !!(data as { token?: string | null } | null)?.token
      if (config?.features.emailVerification && !hasSession) setSent(true)
      else {
        await api.me.update({ locale: getLanguage() }).catch(() => undefined)
        await auth.refresh()
        navigate(next, { replace: true })
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (config && !config.features.signup)
    return (
      <header className={s.head}>
        <h1>{t('auth.signupClosed', 'Sign-ups are closed')}</h1>
        <p>{t('auth.signupClosedDesc', 'New accounts cannot be created at the moment. You can still use CadSandbox on this device without an account.')}</p>
        <LinkButton to="/" variant="primary">{t('auth.continueLocal', 'Continue without account')}</LinkButton>
      </header>
    )

  if (sent)
    return (
      <header className={s.head}>
        <h1>{t('auth.checkInbox', 'Check your inbox')}</h1>
        <p>{t('auth.checkInboxDesc', 'We sent a confirmation link to {email}. Open it to activate your account.', { email })}</p>
        <LinkButton to="/login" variant="secondary">{t('auth.backToSignIn', 'Back to sign in')}</LinkButton>
      </header>
    )

  return (
    <>
      <header className={s.head}>
        <h1>{t('auth.createAccount', 'Create account')}</h1>
        <p>{t('auth.signupDesc', 'Free. Your projects on this device stay yours — you can upload them after signing up.')}</p>
      </header>
      {available === false && <p className={s.error}>{t('auth.serverDown', 'The CadSandbox server is unreachable right now. You can keep working on projects stored on this device.')}</p>}
      <form className={s.form} onSubmit={submit}>
        <label className={s.field} htmlFor={nameId}>
          {t('auth.name', 'Name')}
          <Input id={nameId} required maxLength={120} autoComplete="name" value={name} prefix={<User size={15} />} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label className={s.field} htmlFor={emailId}>
          {t('auth.email', 'Email')}
          <Input id={emailId} type="email" required autoComplete="email" value={email} prefix={<Mail size={15} />} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className={s.field} htmlFor={pwId}>
          {t('auth.password', 'Password')}
          <Input id={pwId} type="password" required minLength={MIN_PASSWORD} maxLength={128} autoComplete="new-password" value={password} prefix={<KeyRound size={15} />} onChange={(e) => setPassword(e.target.value)} />
          <PasswordStrength password={password} />
        </label>
        <Checkbox
          checked={terms}
          onChange={setTerms}
          label={
            <span className={s.checkboxText}>
              {t('auth.acceptPrefix', 'I agree to the')} <Link to="/legal/terms" target="_blank">{t('legal.terms', 'Terms of service')}</Link>{' '}
              {t('auth.acceptAnd', 'and have read the')} <Link to="/legal/privacy" target="_blank">{t('legal.privacy', 'Privacy policy')}</Link>.
            </span>
          }
        />
        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" icon={<UserPlus size={16} />} loading={busy} disabled={!terms || password.length < MIN_PASSWORD}>
          {t('auth.createAccount', 'Create account')}
        </Button>
      </form>
      <p className={s.alt}>
        {t('auth.haveAccount', 'Already have an account?')} <Link to={`/login${search.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`}>{t('auth.signIn', 'Sign in')}</Link>
      </p>
    </>
  )
}
