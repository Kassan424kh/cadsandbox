// /login — email + password, passkey, and the TOTP / backup-code second step.
import { useId, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Fingerprint, KeyRound, LogIn, Mail } from 'lucide-react'
import { Button, Checkbox, Input } from '../../ui'
import { useT } from '../../i18n'
import { authClient, unwrap } from '../../data/auth/client'
import { useAuth } from '../../data/auth/AuthProvider'
import { useServer } from '../../data/online'
import { useDocumentTitle } from '../hooks'
import { errorMessage } from '../components/Dialogs'
import { safeNext } from './AuthLayout'
import s from './auth.module.css'

function ServerDown() {
  const t = useT()
  return <p className={s.error}>{t('auth.serverDown', 'The CadSandbox server is unreachable right now. You can keep working on projects stored on this device.')}</p>
}

function TwoFactorStep({ onDone }: { onDone(): void }) {
  const t = useT()
  const codeId = useId()
  const [backup, setBackup] = useState(false)
  const [code, setCode] = useState('')
  const [trust, setTrust] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (backup) await unwrap(authClient.twoFactor.verifyBackupCode({ code: code.trim(), trustDevice: trust }))
      else await unwrap(authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, ''), trustDevice: trust }))
      onDone()
    } catch (err) {
      setError(errorMessage(err, t('auth.2fa.invalid', 'That code is not valid.')))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <header className={s.head}>
        <h1>{t('auth.2fa.title', 'Two-factor authentication')}</h1>
        <p>
          {backup
            ? t('auth.2fa.backupDesc', 'Enter one of the backup codes you saved when you set up two-factor authentication.')
            : t('auth.2fa.desc', 'Enter the 6-digit code from your authenticator app.')}
        </p>
      </header>
      <form className={s.form} onSubmit={submit}>
        <label className={`${s.field} ${backup ? '' : s.otp}`} htmlFor={codeId}>
          {backup ? t('auth.2fa.backupCode', 'Backup code') : t('auth.2fa.code', 'Authentication code')}
          <Input
            id={codeId}
            value={code}
            autoFocus
            required
            inputMode={backup ? 'text' : 'numeric'}
            autoComplete="one-time-code"
            maxLength={backup ? 32 : 7}
            onChange={(e) => setCode(e.target.value)}
          />
        </label>
        <Checkbox checked={trust} onChange={setTrust} label={<span className={s.checkboxText}>{t('auth.2fa.trust', 'Trust this device for 30 days')}</span>} />
        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!code.trim()}>
          {t('auth.2fa.verify', 'Verify')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setBackup(!backup)
            setCode('')
            setError(null)
          }}
        >
          {backup ? t('auth.2fa.useApp', 'Use your authenticator app') : t('auth.2fa.useBackup', 'Use a backup code')}
        </Button>
      </form>
    </>
  )
}

export default function LoginPage() {
  const t = useT()
  const navigate = useNavigate()
  const [search] = useSearchParams()
  const next = safeNext(search.get('next'))
  const auth = useAuth()
  const { config, available } = useServer()
  const emailId = useId()
  const pwId = useId()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<'password' | 'passkey' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState<'credentials' | '2fa'>('credentials')
  useDocumentTitle(t('auth.signIn', 'Sign in'))

  const finish = async () => {
    await auth.refresh()
    navigate(next, { replace: true })
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy('password')
    setError(null)
    try {
      const data = await unwrap(authClient.signIn.email({ email: email.trim(), password }))
      if ((data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) setStep('2fa')
      else await finish()
    } catch (err) {
      const status = (err as { status?: number }).status
      setError(
        status === 403
          ? t('auth.verifyFirst', 'Please verify your email address first — we sent you a link.')
          : errorMessage(err, t('auth.invalidCredentials', 'Email or password is not correct.')),
      )
    } finally {
      setBusy(null)
    }
  }

  const passkey = async () => {
    setBusy('passkey')
    setError(null)
    try {
      await unwrap(authClient.signIn.passkey())
      await finish()
    } catch (err) {
      setError(errorMessage(err, t('auth.passkeyFailed', 'Passkey sign-in was cancelled or failed.')))
    } finally {
      setBusy(null)
    }
  }

  if (step === '2fa') return <TwoFactorStep onDone={() => void finish()} />

  const passkeysEnabled = config?.features.passkeys !== false && typeof window !== 'undefined' && 'PublicKeyCredential' in window
  return (
    <>
      <header className={s.head}>
        <h1>{t('auth.welcomeBack', 'Welcome back')}</h1>
        <p>{t('auth.signInDesc', 'Sign in to sync your projects and collaborate.')}</p>
      </header>
      {available === false && <ServerDown />}
      <form className={s.form} onSubmit={submit}>
        <label className={s.field} htmlFor={emailId}>
          {t('auth.email', 'Email')}
          <Input id={emailId} type="email" required autoComplete="username webauthn" value={email} prefix={<Mail size={15} />} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </label>
        <div className={s.field}>
          <span className={s.fieldTop}>
            <label htmlFor={pwId}>{t('auth.password', 'Password')}</label>
            <Link to="/forgot-password">{t('auth.forgot', 'Forgot password?')}</Link>
          </span>
          <Input id={pwId} type="password" required autoComplete="current-password" value={password} prefix={<KeyRound size={15} />} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" icon={<LogIn size={16} />} loading={busy === 'password'} disabled={!!busy}>
          {t('auth.signIn', 'Sign in')}
        </Button>
      </form>
      {passkeysEnabled && (
        <>
          <div className={s.divider}>{t('auth.or', 'or')}</div>
          <Button variant="secondary" size="lg" icon={<Fingerprint size={16} />} loading={busy === 'passkey'} disabled={!!busy} onClick={passkey}>
            {t('auth.signInPasskey', 'Sign in with a passkey')}
          </Button>
        </>
      )}
      <p className={s.alt}>
        {t('auth.noAccount', 'New to CadSandbox?')} <Link to={`/signup${search.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`}>{t('auth.createAccount', 'Create account')}</Link>
        {' · '}
        <Link to="/">{t('auth.continueLocal', 'Continue without account')}</Link>
      </p>
    </>
  )
}
