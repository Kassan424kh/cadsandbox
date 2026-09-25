// Generic confirmation and single-field prompt dialogs (destructive actions always confirm).
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Button, Dialog, DialogContent, Input } from '../../ui'
import { useT } from '../../i18n'
import s from './components.module.css'

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  title: string
  description?: ReactNode
  confirmLabel: string
  danger?: boolean
  /** When set, the user must type this text to enable the confirm button. */
  requireText?: string
  onConfirm(): Promise<unknown> | unknown
  children?: ReactNode
}

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, danger, requireText, onConfirm, children }: ConfirmDialogProps) {
  const t = useT()
  const id = useId()
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (open) {
      setTyped('')
      setError(null)
    }
  }, [open])
  const blocked = !!requireText && typed.trim() !== requireText
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (blocked || busy) return
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent size="sm" title={title} description={description} closeLabel={t('common.close', 'Close')}>
        <form className={s.form} onSubmit={submit}>
          {children}
          {requireText && (
            <label className={s.label} htmlFor={id}>
              <span>
                {t('common.typeToConfirm', 'To confirm, type')} <span className={s.confirmWord}>{requireText}</span>
              </span>
              <Input id={id} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoFocus spellCheck={false} />
            </label>
          )}
          {error && (
            <p className={s.error} role="alert">
              {error}
            </p>
          )}
          <div className={s.footer}>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button type="submit" variant={danger ? 'danger-solid' : 'primary'} loading={busy} disabled={blocked} autoFocus={!requireText}>
              {confirmLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export interface PromptDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  title: string
  label: string
  initialValue?: string
  placeholder?: string
  confirmLabel: string
  maxLength?: number
  onSubmit(value: string): Promise<unknown> | unknown
}

export function PromptDialog({ open, onOpenChange, title, label, initialValue = '', placeholder, confirmLabel, maxLength = 120, onSubmit }: PromptDialogProps) {
  const t = useT()
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(initialValue)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (open) {
      setValue(initialValue)
      setError(null)
    }
  }, [open, initialValue])
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const v = value.trim()
    if (!v || busy) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit(v)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent
        size="sm"
        title={title}
        closeLabel={t('common.close', 'Close')}
        // Focus the field explicitly: opened from a dropdown item, the closing menu's focus trap takes
        // focus away from `autoFocus`, and Radix then falls back to the first tabbable (the × button).
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          inputRef.current?.focus()
        }}
      >
        <form className={s.form} onSubmit={submit}>
          <label className={s.label} htmlFor={id}>
            {label}
            <Input
              ref={inputRef}
              id={id}
              value={value}
              placeholder={placeholder}
              maxLength={maxLength}
              onChange={(e) => setValue(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              autoFocus
              autoComplete="off"
            />
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
            <Button type="submit" variant="primary" loading={busy} disabled={!value.trim()}>
              {confirmLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Human-readable message for any thrown value (API errors carry server messages). */
export function errorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'string' && err) return err
  return fallback
}
