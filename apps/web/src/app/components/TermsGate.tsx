// Signed-in users whose recorded terms version is missing or outdated accept the current terms before
// continuing (proof of inclusion). Hidden on the legal pages themselves and while staff impersonate.
import { useState } from 'react'
import { Link, useLocation } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { LEGAL } from '@cadsandbox/shared'
import { Button, Dialog, DialogContent } from '../../ui'
import { useT } from '../../i18n'
import { useAuth } from '../../data/auth/AuthProvider'
import { api } from '../../data/api/endpoints'
import { errorMessage } from './Dialogs'
import s from './components.module.css'

export function TermsGate() {
  const t = useT()
  const auth = useAuth()
  const location = useLocation()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const me = auth.me
  if (auth.status !== 'signed-in' || !me || auth.impersonatedBy || me.termsAcceptedVersion === LEGAL.termsVersion) return null
  if (location.pathname.startsWith('/legal/')) return null

  const accept = async () => {
    setBusy(true)
    setError(null)
    try {
      qc.setQueryData(['me'], await api.me.acceptTerms(LEGAL.termsVersion))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open>
      <DialogContent
        size="sm"
        hideClose
        title={t('auth.termsGateTitle', 'Please accept our terms')}
        description={t('auth.termsGateDesc', 'To keep using your account, read and accept the current terms of service and privacy policy.')}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        footer={
          <>
            <Button variant="ghost" disabled={busy} onClick={() => void auth.signOut()}>
              {t('auth.signOut', 'Sign out')}
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void accept()}>
              {t('auth.termsAccept', 'Accept and continue')}
            </Button>
          </>
        }
      >
        <p className={s.legalLinks}>
          <Link to="/legal/terms" target="_blank">{t('legal.terms', 'Terms of service')}</Link>
          <Link to="/legal/privacy" target="_blank">{t('legal.privacy', 'Privacy policy')}</Link>
        </p>
        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
