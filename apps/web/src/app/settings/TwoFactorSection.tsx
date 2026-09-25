// Two-factor authentication (TOTP): enable with a locally rendered QR code, verify, backup codes,
// regenerate codes, disable. The shared secret never leaves the browser except to the server.
import { useId, useState, type FormEvent } from 'react'
import { Copy, Download, KeyRound, ShieldCheck, ShieldOff } from 'lucide-react'
import { Badge, Button, Input, downloadBlob, toast } from '../../ui'
import { useT } from '../../i18n'
import { authClient, unwrap } from '../../data/auth/client'
import { useAuth } from '../../data/auth/AuthProvider'
import { QrCode } from '../components/QrCode'
import { errorMessage } from '../components/Dialogs'
import s from './settings.module.css'

type Step = { kind: 'idle' } | { kind: 'password'; purpose: 'enable' | 'disable' | 'codes' } | { kind: 'scan'; uri: string; codes: string[] } | { kind: 'codes'; codes: string[] }

function secretFromUri(uri: string): string {
  try {
    const secret = new URL(uri).searchParams.get('secret') ?? ''
    return secret.replace(/(.{4})/g, '$1 ').trim()
  } catch {
    return ''
  }
}

export function BackupCodes({ codes }: { codes: string[] }) {
  const t = useT()
  const text = codes.join('\n')
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <p className={s.hint}>{t('security.2fa.codesDesc', 'Save these one-time backup codes somewhere safe. Each code works once if you lose access to your authenticator app.')}</p>
      <div className={s.codes}>
        {codes.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      <div className={s.row}>
        <Button
          size="sm"
          variant="secondary"
          icon={<Copy size={14} />}
          onClick={() => navigator.clipboard.writeText(text).then(() => toast.success(t('security.2fa.copied', 'Codes copied')), () => undefined)}
        >
          {t('common.copy', 'Copy')}
        </Button>
        <Button size="sm" variant="secondary" icon={<Download size={14} />} onClick={() => downloadBlob(new Blob([`CadSandbox backup codes\n\n${text}\n`], { type: 'text/plain' }), 'cadsandbox-backup-codes.txt')}>
          {t('common.download', 'Download')}
        </Button>
      </div>
    </div>
  )
}

export function TwoFactorSection() {
  const t = useT()
  const auth = useAuth()
  const pwId = useId()
  const codeId = useId()
  const enabled = !!auth.user?.twoFactorEnabled
  const [step, setStep] = useState<Step>({ kind: 'idle' })
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setStep({ kind: 'idle' })
    setPassword('')
    setCode('')
    setError(null)
  }

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault()
    if (step.kind !== 'password') return
    setBusy(true)
    setError(null)
    try {
      if (step.purpose === 'enable') {
        const res = await unwrap(authClient.twoFactor.enable({ password }))
        const data = res as { totpURI: string; backupCodes: string[] }
        setStep({ kind: 'scan', uri: data.totpURI, codes: data.backupCodes })
      } else if (step.purpose === 'disable') {
        await unwrap(authClient.twoFactor.disable({ password }))
        await auth.refresh()
        toast.success(t('security.2fa.disabled', 'Two-factor authentication turned off'))
        reset()
      } else {
        const res = await unwrap(authClient.twoFactor.generateBackupCodes({ password }))
        setStep({ kind: 'codes', codes: (res as { backupCodes: string[] }).backupCodes })
      }
      setPassword('')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const verify = async (e: FormEvent) => {
    e.preventDefault()
    if (step.kind !== 'scan') return
    setBusy(true)
    setError(null)
    try {
      await unwrap(authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, '') }))
      await auth.refresh()
      toast.success(t('security.2fa.enabled', 'Two-factor authentication is on'))
      setStep({ kind: 'codes', codes: step.codes })
      setCode('')
    } catch (err) {
      setError(errorMessage(err, t('auth.2fa.invalid', 'That code is not valid.')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={s.section}>
      <div className={s.sectionHead}>
        <div>
          <h2>
            {t('security.2fa.title', 'Two-factor authentication')}{' '}
            {enabled ? <Badge tone="success">{t('security.on', 'On')}</Badge> : <Badge tone="neutral">{t('security.off', 'Off')}</Badge>}
          </h2>
          <p>{t('security.2fa.desc', 'Require a code from an authenticator app (e.g. Aegis, 2FAS, 1Password) in addition to your password.')}</p>
        </div>
        {step.kind === 'idle' &&
          (enabled ? (
            <div className={s.row}>
              <Button variant="secondary" icon={<KeyRound size={15} />} onClick={() => setStep({ kind: 'password', purpose: 'codes' })}>
                {t('security.2fa.newCodes', 'New backup codes')}
              </Button>
              <Button variant="danger" icon={<ShieldOff size={15} />} onClick={() => setStep({ kind: 'password', purpose: 'disable' })}>
                {t('security.2fa.disable', 'Turn off')}
              </Button>
            </div>
          ) : (
            <Button variant="primary" icon={<ShieldCheck size={15} />} onClick={() => setStep({ kind: 'password', purpose: 'enable' })}>
              {t('security.2fa.enable', 'Set up')}
            </Button>
          ))}
      </div>

      {step.kind === 'password' && (
        <form className={s.form} onSubmit={submitPassword}>
          <label className={s.field} htmlFor={pwId}>
            {t('security.confirmPassword', 'Confirm with your password')}
            <Input id={pwId} type="password" required autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {error && <p className={s.error}>{error}</p>}
          <div className={s.row}>
            <Button type="submit" variant={step.purpose === 'disable' ? 'danger-solid' : 'primary'} loading={busy}>
              {t('common.continue', 'Continue')}
            </Button>
            <Button type="button" variant="ghost" onClick={reset}>
              {t('common.cancel', 'Cancel')}
            </Button>
          </div>
        </form>
      )}

      {step.kind === 'scan' && (
        <form className={s.setup} onSubmit={verify}>
          <QrCode value={step.uri} label={t('security.2fa.qr', 'QR code for your authenticator app')} />
          <div className={s.form}>
            <p className={s.hint}>{t('security.2fa.scan', 'Scan the QR code with your authenticator app, or enter this key manually:')}</p>
            <code className={s.secret}>{secretFromUri(step.uri)}</code>
            <label className={s.field} htmlFor={codeId}>
              {t('security.2fa.enterCode', 'Enter the 6-digit code to confirm')}
              <Input id={codeId} inputMode="numeric" autoComplete="one-time-code" maxLength={7} required value={code} onChange={(e) => setCode(e.target.value)} />
            </label>
            {error && <p className={s.error}>{error}</p>}
            <div className={s.row}>
              <Button type="submit" variant="primary" loading={busy} disabled={code.replace(/\s/g, '').length < 6}>
                {t('security.2fa.activate', 'Activate')}
              </Button>
              <Button type="button" variant="ghost" onClick={reset}>
                {t('common.cancel', 'Cancel')}
              </Button>
            </div>
          </div>
        </form>
      )}

      {step.kind === 'codes' && (
        <>
          <BackupCodes codes={step.codes} />
          <div>
            <Button variant="primary" onClick={reset}>
              {t('security.2fa.savedCodes', 'I saved my codes')}
            </Button>
          </div>
        </>
      )}
    </section>
  )
}
