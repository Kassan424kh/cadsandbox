// /settings/profile — name, avatar (stored as a small data URL), account language, email status.
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, ImagePlus, MailWarning, Trash2 } from 'lucide-react'
import { Avatar, Badge, Button, Input, Select, toast } from '../../ui'
import { LANGUAGES, setLanguage, useLanguage, useT, type Lang } from '../../i18n'
import { useAuth } from '../../data/auth/AuthProvider'
import { api } from '../../data/api/endpoints'
import { userColor } from '../../data/session/user'
import { useDocumentTitle } from '../hooks'
import { RequireAuth } from '../components/Guards'
import { errorMessage } from '../components/Dialogs'
import s from './settings.module.css'

/** Downscale an image file to a square webp data URL (≤ 256 px, well under the 200 KB limit). */
async function toAvatarDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  const side = Math.min(bitmap.width, bitmap.height)
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size)
  bitmap.close()
  const url = canvas.toDataURL('image/webp', 0.86)
  return url.startsWith('data:image/webp') ? url : canvas.toDataURL('image/png')
}

function Profile() {
  const t = useT()
  const auth = useAuth()
  const qc = useQueryClient()
  const lang = useLanguage()
  const nameId = useId()
  const fileRef = useRef<HTMLInputElement>(null)
  const user = auth.user!
  const [name, setName] = useState(user.name)
  const [image, setImage] = useState<string | null>(user.image)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setName(user.name)
    setImage(user.image)
  }, [user.name, user.image])

  const dirty = name.trim() !== user.name || image !== user.image
  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.me.update({ name: name.trim(), image })
      await qc.invalidateQueries({ queryKey: ['me'] })
      await auth.refresh()
      toast.success(t('settings.saved', 'Changes saved'))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const changeLanguage = async (next: Lang) => {
    await setLanguage(next)
    api.me.update({ locale: next }).catch(() => undefined)
  }

  return (
    <div className={s.page}>
      <section className={s.section}>
        <div className={s.sectionHead}>
          <div>
            <h2>{t('settings.profile', 'Profile')}</h2>
            <p>{t('settings.profileDesc', 'Your name and picture are shown to collaborators on shared projects.')}</p>
          </div>
        </div>
        <form className={s.form} onSubmit={save}>
          <div className={s.avatarRow}>
            <Avatar name={name || user.email} src={image} color={userColor(user.id)} size={64} />
            <div className={s.row}>
              <Button type="button" variant="secondary" size="sm" icon={<ImagePlus size={15} />} onClick={() => fileRef.current?.click()}>
                {t('settings.uploadPhoto', 'Upload photo')}
              </Button>
              {image && (
                <Button type="button" variant="ghost" size="sm" icon={<Trash2 size={15} />} onClick={() => setImage(null)}>
                  {t('common.remove', 'Remove')}
                </Button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (!f) return
                  try {
                    setImage(await toAvatarDataUrl(f))
                  } catch (err) {
                    toast.error(errorMessage(err))
                  }
                }}
              />
            </div>
          </div>
          <label className={s.field} htmlFor={nameId}>
            {t('auth.name', 'Name')}
            <Input id={nameId} value={name} required maxLength={120} autoComplete="name" onChange={(e) => setName(e.target.value)} />
          </label>
          <div className={s.field}>
            {t('auth.email', 'Email')}
            <div className={s.row}>
              <Input value={user.email} readOnly aria-readonly wrapperClassName={s.grow} />
              {user.emailVerified ? (
                <Badge tone="success" icon={<BadgeCheck size={12} />}>
                  {t('settings.verified', 'Verified')}
                </Badge>
              ) : (
                <Badge tone="warning" icon={<MailWarning size={12} />}>
                  <Link to="/verify-email">{t('settings.unverified', 'Not verified')}</Link>
                </Badge>
              )}
            </div>
          </div>
          {error && (
            <p className={s.error} role="alert">
              {error}
            </p>
          )}
          <div>
            <Button type="submit" variant="primary" loading={busy} disabled={!dirty || !name.trim()}>
              {t('common.save', 'Save')}
            </Button>
          </div>
        </form>
      </section>
      <section className={s.section}>
        <div className={s.choiceRow}>
          <div>
            <strong>{t('menu.language', 'Language')}</strong>
            <span>{t('settings.languageDesc', 'Used for the interface and emails we send you.')}</span>
          </div>
          <Select<Lang> className={s.choiceControl} value={lang} onChange={(v) => void changeLanguage(v)} options={LANGUAGES.map((l) => ({ value: l.id, label: l.native }))} aria-label={t('menu.language', 'Language')} />
        </div>
      </section>
    </div>
  )
}

export default function ProfilePage() {
  const t = useT()
  const auth = useAuth()
  const { pathname } = useLocation()
  useDocumentTitle(t('settings.profile', 'Profile'))
  // Signed out, /settings opens the settings that work without an account.
  if (auth.status === 'signed-out' && pathname.replace(/\/$/, '') === '/settings') return <Navigate to="/settings/appearance" replace />
  return (
    <RequireAuth>
      <Profile />
    </RequireAuth>
  )
}
