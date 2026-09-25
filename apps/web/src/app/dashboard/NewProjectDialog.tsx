// "New project": pick a template, a name and where it lives (this device, my cloud, an org).
import { useEffect, useId, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Cloud, HardDrive, Building2 } from 'lucide-react'
import { Button, Dialog, DialogContent, Input, Select, type SelectOption } from '../../ui'
import { useT } from '../../i18n'
import { useAuth } from '../../data/auth/AuthProvider'
import { useServer } from '../../data/online'
import { createCloudProject, createLocalProject } from '../../data/create'
import { requestPersistentStorage } from '../../data/local/db'
import { invalidateProjects } from '../../data/queries'
import { TEMPLATES, getTemplate, type TemplateId } from '../templates'
import { TemplateArt } from './TemplateArt'
import { useDashboardUI } from './store'
import { errorMessage } from '../components/Dialogs'
import s from './dashboard.module.css'
import c from '../components/components.module.css'

export default function NewProjectDialog() {
  const t = useT()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const auth = useAuth()
  const { available } = useServer()
  const { newProject, closeNewProject } = useDashboardUI()
  const nameId = useId()
  const [template, setTemplate] = useState<TemplateId>(newProject.template)
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const cloudOk = auth.status === 'signed-in' && available === true
  const [location, setLocation] = useState<string>(newProject.orgId ? `org:${newProject.orgId}` : cloudOk ? 'cloud' : 'device')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!nameTouched) {
      const tpl = getTemplate(template)
      setName(template === 'empty' ? t('dashboard.untitled', 'Untitled project') : t(tpl.name[0], tpl.name[1]))
    }
  }, [template, nameTouched, t])

  useEffect(() => {
    if (!cloudOk && location !== 'device') setLocation('device')
  }, [cloudOk, location])

  const options = useMemo(() => {
    const out: SelectOption[] = [{ value: 'device', label: t('dashboard.location.device', 'This device only'), icon: <HardDrive size={15} /> }]
    if (cloudOk) {
      out.push({ value: 'cloud', label: t('dashboard.location.cloud', 'My cloud (sync & share)'), icon: <Cloud size={15} /> })
      for (const o of auth.me?.orgs ?? []) out.push({ value: `org:${o.id}`, label: o.name, icon: <Building2 size={15} />, group: t('nav.organizations', 'Organizations') })
    }
    return out
  }, [cloudOk, auth.me?.orgs, t])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    const seed = getTemplate(template).seed()
    const createdBy = auth.user?.id ?? null
    try {
      let id: string
      if (location === 'device') {
        id = await createLocalProject({ name, seed, folderId: newProject.orgId ? null : newProject.folderId, createdBy })
        void requestPersistentStorage()
      } else {
        const orgId = location.startsWith('org:') ? location.slice(4) : null
        const folderId = orgId === newProject.orgId ? newProject.folderId : null
        id = (await createCloudProject({ name, seed, folderId, orgId, createdBy })).id
      }
      await invalidateProjects(qc)
      closeNewProject()
      navigate(`/p/${id}`)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && closeNewProject()}>
      <DialogContent
        size="lg"
        title={t('dashboard.newProject', 'New project')}
        description={t('dashboard.newProjectDesc', 'Start from a template — everything stays editable.')}
        closeLabel={t('common.close', 'Close')}
      >
        <form className={s.formGrid} onSubmit={submit}>
          <div className={s.choiceGrid} role="group" aria-label={t('dashboard.templates', 'Templates')}>
            {TEMPLATES.map((tpl) => (
              <button key={tpl.id} type="button" className={s.template} aria-pressed={template === tpl.id} onClick={() => setTemplate(tpl.id)}>
                <div className={s.templateArt}>
                  <TemplateArt id={tpl.id} />
                </div>
                <div className={s.templateBody}>
                  <strong>{t(tpl.name[0], tpl.name[1])}</strong>
                </div>
              </button>
            ))}
          </div>
          <p className={c.hint}>{t(getTemplate(template).description[0], getTemplate(template).description[1])}</p>
          <label className={c.label} htmlFor={nameId}>
            {t('dashboard.projectName', 'Project name')}
            <Input
              id={nameId}
              value={name}
              maxLength={120}
              onChange={(e) => {
                setNameTouched(true)
                setName(e.target.value)
              }}
            />
          </label>
          <div className={c.label}>
            {t('dashboard.location', 'Location')}
            <Select value={location} onChange={setLocation} options={options} aria-label={t('dashboard.location', 'Location')} />
            <span className={c.hint}>
              {location === 'device'
                ? t('dashboard.location.deviceHint', 'Stored only in this browser. Works offline; you can upload it to the cloud later.')
                : t('dashboard.location.cloudHint', 'Synced to your account, available offline on this device and shareable.')}
            </span>
          </div>
          {error && (
            <p className={c.error} role="alert">
              {error}
            </p>
          )}
          <div className={c.footer}>
            <Button type="button" variant="ghost" onClick={closeNewProject} disabled={busy}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button type="submit" variant="primary" loading={busy} disabled={!name.trim()}>
              {t('dashboard.create', 'Create project')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
