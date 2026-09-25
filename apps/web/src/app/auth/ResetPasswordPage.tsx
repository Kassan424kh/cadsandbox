// /reset-password?token=… — choose a new password.
import { useId, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { KeyRound } from 'lucide-react'
import { Button, Input, toast } from '../../ui'
import { useT } from '../../i18n'
import { authClient, unwrap } from '../../data/auth/client'
import { useDocumentTitle } from '../hooks'
import { errorMessage } from '../components/Dialogs'
import { MIN_PASSWORD } from './AuthLayout'
import { PasswordStrength } from './SignupPage'
import s from './auth.module.css'
import { LinkButton } from '../components/LinkButton'

export default function ResetPasswordPage() {
  const t = useT()
  const navigate = useNavigate()
  const [search] = useSearchParams()
  const token = search.get('token')
  const invalid = !token || !!search.get('error')
  const pwId = useId()
  const confirmId = useId()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useDocumentTitle(t('auth.newPassword', 'New password'))

  const mismatch = confirm.length > 0 && confirm !== password
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!token || mismatch || password.length < MIN_PASSWORD) return
    setBusy(true)
    setError(null)
    try {
      await unwrap(authClient.resetPassword({ newPassword: password, token }))
      toast.success(t('auth.passwordChanged', 'Password changed — please sign in.'))
      navigate('/login', { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (invalid)
    return (
      <header className={s.head}>
        <h1>{t('auth.resetInvalid', 'This reset link is invalid or has expired')}</h1>
        <p>{t('auth.resetInvalidDesc', 'Request a new link and use it within one hour.')}</p>
        <LinkButton to="/forgot-password" variant="primary">{t('auth.requestNewLink', 'Request a new link')}</LinkButton>
      </header>
    )

  return (
    <>
      <header className={s.head}>
        <h1>{t('auth.newPassword', 'New password')}</h1>
        <p>{t('auth.newPasswordDesc', 'Choose a strong password you don’t use anywhere else. Other devices will be signed out.')}</p>
      </header>
      <form className={s.form} onSubmit={submit}>
        <label className={s.field} htmlFor={pwId}>
          {t('auth.newPassword', 'New password')}
          <Input id={pwId} type="password" required minLength={MIN_PASSWORD} maxLength={128} autoComplete="new-password" value={password} prefix={<KeyRound size={15} />} onChange={(e) => setPassword(e.target.value)} autoFocus />
          <PasswordStrength password={password} />
        </label>
        <label className={s.field} htmlFor={confirmId}>
          {t('auth.confirmPassword', 'Confirm password')}
          <Input id={confirmId} type="password" required autoComplete="new-password" value={confirm} invalid={mismatch} prefix={<KeyRound size={15} />} onChange={(e) => setConfirm(e.target.value)} />
          {mismatch && <span className={s.hint}>{t('auth.passwordMismatch', 'Passwords do not match.')}</span>}
        </label>
        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" loading={busy} disabled={mismatch || password.length < MIN_PASSWORD}>
          {t('auth.setPassword', 'Set new password')}
        </Button>
      </form>
    </>
  )
}
