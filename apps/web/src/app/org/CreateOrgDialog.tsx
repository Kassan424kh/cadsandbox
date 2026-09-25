// Create an organization (better-auth organization plugin).
import { useEffect, useId, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { Button, Dialog, DialogContent, Input, toast } from '../../ui'
import { useT } from '../../i18n'
import { authClient, unwrap } from '../../data/auth/client'
import { useAuth } from '../../data/auth/AuthProvider'
import { errorMessage } from '../components/Dialogs'
import s from '../components/components.module.css'

export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

export function CreateOrgDialog({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const t = useT()
  const auth = useAuth()
  const navigate = useNavigate()
  const nameId = useId()
  const slugId = useId()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (open) {
      setName('')
      setSlug('')
      setSlugTouched(false)
      setError(null)
    }
  }, [open])
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !slug) return
    setBusy(true)
    setError(null)
    try {
      const org = await unwrap(authClient.organization.create({ name: name.trim(), slug }))
      await auth.refresh()
      toast.success(t('org.created', 'Organization created'))
      onOpenChange(false)
      if (org && typeof (org as { id?: unknown }).id === 'string') navigate(`/org/${(org as { id: string }).id}/settings`)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent
        size="sm"
        title={t('org.createTitle', 'New organization')}
        description={t('org.createDesc', 'Organizations share projects, folders and collections with their members.')}
        closeLabel={t('common.close', 'Close')}
      >
        <form className={s.form} onSubmit={submit}>
          <label className={s.label} htmlFor={nameId}>
            {t('org.name', 'Name')}
            <Input
              id={nameId}
              value={name}
              maxLength={80}
              autoFocus
              placeholder={t('org.namePlaceholder', 'Acme Architects')}
              onChange={(e) => {
                setName(e.target.value)
                if (!slugTouched) setSlug(slugify(e.target.value))
              }}
            />
          </label>
          <label className={s.label} htmlFor={slugId}>
            {t('org.slug', 'URL name')}
            <Input
              id={slugId}
              value={slug}
              maxLength={48}
              prefix={<span style={{ color: 'var(--cs-text-3)' }}>/</span>}
              onChange={(e) => {
                setSlugTouched(true)
                setSlug(slugify(e.target.value))
              }}
            />
            <span className={s.hint}>{t('org.slugHint', 'Lowercase letters, numbers and dashes.')}</span>
          </label>
          {error && (
            <p className={s.error} role="alert">
              {error}
            </p>
          )}
          <div className={s.footer}>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button type="submit" variant="primary" loading={busy} disabled={!name.trim() || !slug}>
              {t('org.create', 'Create organization')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
