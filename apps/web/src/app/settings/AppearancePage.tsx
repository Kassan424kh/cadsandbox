// /settings/appearance — theme, language, default units, install app, storage on this device.
import { useEffect, useState } from 'react'
import { Download, Monitor, Moon, Sun } from 'lucide-react'
import { LENGTH_UNITS, UNIT_LABEL, type LengthUnit } from '@cadsandbox/shared'
import { Button, Progress, SegmentedControl, Select, useTheme, type ThemeSetting } from '../../ui'
import { LANGUAGES, formatBytes, setLanguage, useLanguage, useT, type Lang } from '../../i18n'
import { setPrefs, usePrefs } from '../../data/prefs'
import { requestPersistentStorage, storageEstimate } from '../../data/local/db'
import { useAuth } from '../../data/auth/AuthProvider'
import { api } from '../../data/api/endpoints'
import { useInstallPrompt } from '../pwa'
import { useDocumentTitle } from '../hooks'
import s from './settings.module.css'

function StorageInfo() {
  const t = useT()
  const [est, setEst] = useState<{ usage: number; quota: number } | null>(null)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  useEffect(() => {
    void storageEstimate().then(setEst)
    void navigator.storage?.persisted?.().then(setPersisted, () => setPersisted(null))
  }, [])
  return (
    <section className={s.section}>
      <div className={s.sectionHead}>
        <div>
          <h2>{t('settings.storage', 'Storage on this device')}</h2>
          <p>{t('settings.storageDesc', 'Local projects, offline copies of cloud projects and cached files live in this browser.')}</p>
        </div>
      </div>
      {est && est.quota > 0 && (
        <div className={s.form}>
          <Progress value={est.usage / est.quota} label={t('settings.storage', 'Storage on this device')} />
          <span className={s.hint}>{t('settings.storageUsed', '{used} used of about {quota} available', { used: formatBytes(est.usage), quota: formatBytes(est.quota) })}</span>
        </div>
      )}
      <div className={s.choiceRow}>
        <div>
          <strong>{t('settings.persist', 'Keep data when storage is low')}</strong>
          <span>
            {persisted
              ? t('settings.persistOn', 'Enabled — the browser will not evict your local projects.')
              : t('settings.persistOff', 'Not enabled — the browser may clear data under storage pressure.')}
          </span>
        </div>
        {!persisted && (
          <Button variant="secondary" onClick={() => void requestPersistentStorage().then(setPersisted)}>
            {t('settings.persistEnable', 'Enable')}
          </Button>
        )}
      </div>
    </section>
  )
}

export default function AppearancePage() {
  const t = useT()
  const auth = useAuth()
  const { theme, setTheme } = useTheme()
  const lang = useLanguage()
  const prefs = usePrefs()
  const { canInstall, install } = useInstallPrompt()
  useDocumentTitle(t('settings.appearance', 'Appearance'))

  const changeLanguage = async (next: Lang) => {
    await setLanguage(next)
    if (auth.status === 'signed-in') api.me.update({ locale: next }).catch(() => undefined)
  }

  return (
    <div className={s.page}>
      <section className={s.section}>
        <div className={s.sectionHead}>
          <div>
            <h2>{t('settings.appearance', 'Appearance')}</h2>
            <p>{t('settings.appearanceDesc', 'These preferences are stored on this device.')}</p>
          </div>
        </div>
        <div className={s.choiceRow}>
          <div>
            <strong>{t('menu.theme', 'Theme')}</strong>
            <span>{t('settings.themeDesc', 'Dark is easiest on the eyes for long modelling sessions.')}</span>
          </div>
          <SegmentedControl<ThemeSetting>
            value={theme}
            onChange={setTheme}
            aria-label={t('menu.theme', 'Theme')}
            options={[
              { value: 'dark', label: t('theme.dark', 'Dark'), icon: <Moon size={14} /> },
              { value: 'light', label: t('theme.light', 'Light'), icon: <Sun size={14} /> },
              { value: 'system', label: t('theme.system', 'System'), icon: <Monitor size={14} /> },
            ]}
          />
        </div>
        <div className={s.choiceRow}>
          <div>
            <strong>{t('menu.language', 'Language')}</strong>
            <span>{t('settings.languageDesc', 'Used for the interface and emails we send you.')}</span>
          </div>
          <Select<Lang> className={s.choiceControl} value={lang} onChange={(v) => void changeLanguage(v)} options={LANGUAGES.map((l) => ({ value: l.id, label: l.native }))} aria-label={t('menu.language', 'Language')} />
        </div>
        <div className={s.choiceRow}>
          <div>
            <strong>{t('settings.units', 'Default units')}</strong>
            <span>{t('settings.unitsDesc', 'Length unit for new designs. Each design can change its own units later.')}</span>
          </div>
          <Select<LengthUnit>
            className={s.choiceControl}
            value={prefs.units}
            onChange={(units) => setPrefs({ units })}
            options={LENGTH_UNITS.map((u) => ({ value: u, label: t(`units.${u}`, UNIT_LABEL[u]) }))}
            aria-label={t('settings.units', 'Default units')}
          />
        </div>
      </section>
      {canInstall && (
        <section className={s.section}>
          <div className={s.choiceRow}>
            <div>
              <strong>{t('menu.install', 'Install app')}</strong>
              <span>{t('settings.installDesc', 'Open CadSandbox in its own window, with offline support, like a desktop app.')}</span>
            </div>
            <Button variant="primary" icon={<Download size={15} />} onClick={() => void install()}>
              {t('menu.install', 'Install app')}
            </Button>
          </div>
        </section>
      )}
      <StorageInfo />
    </div>
  )
}
