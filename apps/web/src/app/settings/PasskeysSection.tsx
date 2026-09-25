// Passkeys (WebAuthn): list, add, rename, delete.
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Fingerprint, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button, IconButton, Skeleton, toast } from '../../ui'
import { formatDate, useT } from '../../i18n'
import { authClient, unwrap } from '../../data/auth/client'
import { ConfirmDialog, PromptDialog, errorMessage } from '../components/Dialogs'
import s from './settings.module.css'

interface PasskeyRow {
  id: string
  name?: string | null
  createdAt?: string | Date | null
  deviceType?: string | null
}

function defaultPasskeyName(): string {
  const ua = navigator.userAgent
  const os = /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : 'Device'
  return `${os} · ${new Date().toLocaleDateString()}`
}

export function PasskeysSection() {
  const t = useT()
  const qc = useQueryClient()
  const key = ['auth', 'passkeys']
  const supported = typeof window !== 'undefined' && 'PublicKeyCredential' in window
  const list = useQuery({ queryKey: key, queryFn: async () => ((await unwrap(authClient.passkey.listUserPasskeys())) ?? []) as PasskeyRow[] })
  const [adding, setAdding] = useState(false)
  const [rename, setRename] = useState<PasskeyRow | null>(null)
  const [remove, setRemove] = useState<PasskeyRow | null>(null)

  const add = async () => {
    setAdding(true)
    try {
      await unwrap(authClient.passkey.addPasskey({ name: defaultPasskeyName() }))
      await qc.invalidateQueries({ queryKey: key })
      toast.success(t('security.passkeys.added', 'Passkey added'))
    } catch (err) {
      toast.error(errorMessage(err, t('security.passkeys.failed', 'The passkey could not be created.')))
    } finally {
      setAdding(false)
    }
  }

  return (
    <section className={s.section}>
      <div className={s.sectionHead}>
        <div>
          <h2>{t('security.passkeys.title', 'Passkeys')}</h2>
          <p>{t('security.passkeys.desc', 'Sign in with your fingerprint, face or device PIN instead of a password. Passkeys are phishing-resistant.')}</p>
        </div>
        <Button variant="secondary" icon={<Plus size={15} />} loading={adding} disabled={!supported} onClick={add}>
          {t('security.passkeys.add', 'Add passkey')}
        </Button>
      </div>
      {!supported && <p className={s.hint}>{t('security.passkeys.unsupported', 'This browser does not support passkeys.')}</p>}
      {list.isLoading ? (
        <Skeleton height={48} />
      ) : list.isError ? (
        <p className={s.error}>{errorMessage(list.error)}</p>
      ) : list.data && list.data.length > 0 ? (
        <div className={s.list}>
          {list.data.map((p) => (
            <div key={p.id} className={s.listItem}>
              <Fingerprint size={18} />
              <div className={s.itemText}>
                <strong>{p.name || t('security.passkeys.unnamed', 'Passkey')}</strong>
                <span>
                  {p.createdAt ? t('security.passkeys.added.on', 'Added {date}', { date: formatDate(p.createdAt) }) : ''}
                  {p.deviceType === 'multiDevice' ? ` · ${t('security.passkeys.synced', 'synced')}` : ''}
                </span>
              </div>
              <div className={s.row}>
                <IconButton size="sm" variant="ghost" label={t('common.rename', 'Rename')} icon={<Pencil size={14} />} onClick={() => setRename(p)} />
                <IconButton size="sm" variant="ghost" label={t('common.delete', 'Delete')} icon={<Trash2 size={14} />} onClick={() => setRemove(p)} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className={s.hint}>{t('security.passkeys.none', 'No passkeys yet.')}</p>
      )}
      <PromptDialog
        open={!!rename}
        onOpenChange={(o) => !o && setRename(null)}
        title={t('security.passkeys.rename', 'Rename passkey')}
        label={t('security.passkeys.name', 'Name')}
        initialValue={rename?.name ?? ''}
        confirmLabel={t('common.rename', 'Rename')}
        onSubmit={async (name) => {
          if (!rename) return
          await unwrap(authClient.passkey.updatePasskey({ id: rename.id, name }))
          await qc.invalidateQueries({ queryKey: key })
        }}
      />
      <ConfirmDialog
        open={!!remove}
        onOpenChange={(o) => !o && setRemove(null)}
        danger
        title={t('security.passkeys.deleteTitle', 'Delete this passkey?')}
        description={t('security.passkeys.deleteDesc', 'You can no longer sign in with “{name}”. Also remove it from your device’s password manager.', { name: remove?.name ?? '' })}
        confirmLabel={t('common.delete', 'Delete')}
        onConfirm={async () => {
          if (!remove) return
          await unwrap(authClient.passkey.deletePasskey({ id: remove.id }))
          await qc.invalidateQueries({ queryKey: key })
        }}
      />
    </section>
  )
}
