// /forgot-password — request a reset link (same response whether or not the account exists).
import { useId, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Mail } from 'lucide-react'
import { Button, Input } from '../../ui'
import { useT } from '../../i18n'
import { authClient, unwrap } from '../../data/auth/client'
import { useDocumentTitle } from '../hooks'
import { errorMessage } from '../components/Dialogs'
import s from './auth.module.css'

export default function ForgotPasswordPage() {
  const t = useT()
  const emailId = useId()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useDocumentTitle(t('auth.resetTitle', 'Reset password'))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await unwrap(authClient.requestPasswordReset({ email: email.trim(), redirectTo: `${window.location.origin}/reset-password` }))
      setSent(true)
    } catch (err) {
      // Rate limits / server errors are shown; unknown accounts are not revealed by the server.
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <header className={s.head}>
        <h1>{t('auth.resetTitle', 'Reset password')}</h1>
        <p>{t('auth.resetDesc', 'Enter the email address of your account and we’ll send you a link to choose a new password.')}</p>
      </header>
      {sent ? (
        <p className={s.success} role="status">
          {t('auth.resetSent', 'If an account exists for {email}, a reset link is on its way. The link is valid for one hour.', { email })}
        </p>
      ) : (
        <form className={s.form} onSubmit={submit}>
          <label className={s.field} htmlFor={emailId}>
            {t('auth.email', 'Email')}
            <Input id={emailId} type="email" required autoComplete="email" value={email} prefix={<Mail size={15} />} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </label>
          {error && (
            <p className={s.error} role="alert">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" size="lg" loading={busy}>
            {t('auth.sendResetLink', 'Send reset link')}
          </Button>
        </form>
      )}
      <p className={s.alt}>
        <Link to="/login">{t('auth.backToSignIn', 'Back to sign in')}</Link>
      </p>
    </>
  )
}
