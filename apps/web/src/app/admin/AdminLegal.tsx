// /admin/legal — the operator details shown in the imprint, privacy policy and terms. Stored on the
// server (never in the repository); the legal pages fill them in and hide optional lines left empty.
import { useEffect, useId, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Save } from 'lucide-react'
import type { LegalOperatorDTO } from '@cadsandbox/shared'
import { Button, Input, PageHeader, toast } from '../../ui'
import { formatDateTime, useT } from '../../i18n'
import { api } from '../../data/api/endpoints'
import { useAuth } from '../../data/auth/AuthProvider'
import { useDocumentTitle } from '../hooks'
import { NotFoundPage } from '../components/PageStates'
import { errorMessage } from '../components/Dialogs'
import p from '../pages/pages.module.css'
import c from '../components/components.module.css'

const EMPTY: LegalOperatorDTO = {
  name: '',
  street: '',
  postalCity: '',
  country: '',
  email: '',
  phone: '',
  vatId: '',
  registerCourt: '',
  registerNumber: '',
  representedBy: '',
  contentResponsible: '',
  privacyEmail: '',
}

type Field = keyof LegalOperatorDTO

export default function AdminLegal() {
  const t = useT()
  const auth = useAuth()
  const qc = useQueryClient()
  const idBase = useId()
  const [form, setForm] = useState<LegalOperatorDTO>(EMPTY)
  const [loaded, setLoaded] = useState(false)
  useDocumentTitle(t('admin.legal', 'Legal details'))
  const current = useQuery({ queryKey: ['legal-operator'], queryFn: api.legal.operator, enabled: auth.isAdmin })
  useEffect(() => {
    if (loaded || !current.data) return
    setForm({ ...EMPTY, ...(current.data.operator ?? {}) })
    setLoaded(true)
  }, [current.data, loaded])
  const save = useMutation({
    mutationFn: () => api.admin.updateLegalOperator(form),
    onSuccess: (res) => {
      qc.setQueryData(['legal-operator'], res)
      toast.success(t('admin.legalSaved', 'Legal details saved — the imprint, privacy policy and terms show them now'))
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  if (!auth.isAdmin) return <NotFoundPage />

  const fields: { key: Field; label: string; required?: boolean; type?: string; hint?: string }[] = [
    { key: 'name', label: t('admin.legal.name', 'Name or company (incl. legal form)'), required: true },
    { key: 'street', label: t('admin.legal.street', 'Street and number'), required: true },
    { key: 'postalCity', label: t('admin.legal.postalCity', 'Postcode and city'), required: true },
    { key: 'country', label: t('admin.legal.country', 'Country') },
    { key: 'email', label: t('admin.legal.email', 'Contact email'), required: true, type: 'email' },
    { key: 'phone', label: t('admin.legal.phone', 'Phone'), required: true, type: 'tel' },
    { key: 'vatId', label: t('admin.legal.vatId', 'VAT ID (if you have one)') },
    { key: 'registerCourt', label: t('admin.legal.registerCourt', 'Register court (companies)') },
    { key: 'registerNumber', label: t('admin.legal.registerNumber', 'Register number (companies)') },
    { key: 'representedBy', label: t('admin.legal.representedBy', 'Managing director(s) (companies)') },
    { key: 'contentResponsible', label: t('admin.legal.contentResponsible', 'Responsible for content'), hint: t('admin.legal.contentResponsibleHint', 'Empty: name and address from above') },
    { key: 'privacyEmail', label: t('admin.legal.privacyEmail', 'Privacy contact email'), type: 'email', hint: t('admin.legal.privacyEmailHint', 'Empty: the contact email') },
  ]
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }
  return (
    <div className={p.page}>
      <PageHeader
        title={t('admin.legal', 'Legal details')}
        description={t('admin.legalDesc', 'Shown in the imprint, privacy policy and terms. Optional lines left empty are hidden; missing required ones stay highlighted.')}
      />
      <form className={p.panel} onSubmit={submit}>
        <div className={p.formGrid}>
          {fields.map((f) => (
            <label key={f.key} className={c.label} htmlFor={`${idBase}-${f.key}`}>
              {f.label}
              <Input
                id={`${idBase}-${f.key}`}
                type={f.type ?? 'text'}
                required={f.required}
                maxLength={f.key === 'contentResponsible' ? 500 : 200}
                placeholder={f.hint}
                autoComplete="off"
                value={form[f.key]}
                onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
              />
            </label>
          ))}
        </div>
        <div className={p.actionsRow}>
          <Button type="submit" variant="primary" icon={<Save size={15} />} loading={save.isPending} disabled={!loaded}>
            {t('common.save', 'Save')}
          </Button>
          <Button type="button" variant="ghost" icon={<ExternalLink size={15} />} onClick={() => window.open('/legal/imprint', '_blank', 'noopener,noreferrer')}>
            {t('admin.legalView', 'View imprint')}
          </Button>
          {current.data?.updatedAt && <span className={p.muted}>{t('admin.legalUpdated', 'Last saved {date}', { date: formatDateTime(current.data.updatedAt) })}</span>}
        </div>
      </form>
    </div>
  )
}
